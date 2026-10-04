import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { DeviceReaderNumberRepository } from '../devices/device-reader-number.repository.js';
import { DeviceRepository } from '../devices/device.repository.js';
import { StudentCredentialRepository } from '../students/student-credential.repository.js';
import { StudentRepository } from '../students/student.repository.js';
import { TurnstileNumberService } from '../students/turnstile-number.service.js';
import { BiometricIdentityRepository } from './biometric-identity.repository.js';
import { VincularCadastroLegadoUseCase } from './vincular-cadastro-legado.use-case.js';

/** Corpo recusa campo extra: o tenant vem da identidade autenticada (regra no 2). */
const esquemaDoNumero = z
  .object({ externalId: z.string().regex(/^\d{1,12}$/).optional() })
  .strict();

const ESQUEMA_DO_NUMERO = {
  type: 'object',
  properties: { externalId: { type: 'string' }, linkedReaders: { type: 'integer' } },
  required: ['externalId', 'linkedReaders'],
};

const ESQUEMA_DOS_SEM_ALUNO = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      externalId: { type: 'string' },
      readerName: { type: 'string', nullable: true },
      deviceSerial: { type: 'string' },
    },
    required: ['externalId', 'readerName', 'deviceSerial'],
  },
};

/**
 * Acao "Numero da catraca" da lista de alunos -- spec 2026-10-03.
 *
 * Mora em `biometrics` e nao em `students`: o vinculo imediato e caso de uso
 * daqui, e `biometrics` ja importa `students` -- o contrario fecharia ciclo.
 */
@Controller('api/v1')
export class StudentTurnstileNumberController {
  constructor(
    private readonly contexto: TenantContextService,
    private readonly alunos: StudentRepository,
    private readonly credenciais: StudentCredentialRepository,
    private readonly numeroDaCatraca: TurnstileNumberService,
    private readonly numerosDoLeitor: DeviceReaderNumberRepository,
    private readonly dispositivos: DeviceRepository,
    private readonly identidades: BiometricIdentityRepository,
    private readonly vincular: VincularCadastroLegadoUseCase,
  ) {}

  /** Gera (sem corpo) ou grava o numero escolhido e ja vincula nos leitores que o tem. */
  @Post('students/:id/turnstile-number')
  @HttpCode(200)
  @RequirePermissions('student.update')
  @ApiOkResponse({ schema: ESQUEMA_DO_NUMERO })
  async definir(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ externalId: string; linkedReaders: number }> {
    const dados = esquemaDoNumero.parse(corpo);
    const contexto = this.contexto.require();

    if (!(await this.alunos.encontrar(contexto, id))) {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
    }

    if (dados.externalId !== undefined) {
      await this.recusarSeDeOutroAluno(contexto.tenantId, id, dados.externalId);
    }

    let externalId: string;
    try {
      externalId =
        dados.externalId === undefined
          ? (await this.numeroDaCatraca.gerar(contexto, id)).externalId
          : (
              await this.credenciais.definir(contexto, id, 'FACIAL_ENROLL_ID', dados.externalId)
            ).externalId;
    } catch (erro: unknown) {
      // `CredencialJaAtribuidaError` carrega `code: 'P2002'`, igual ao UNIQUE do Prisma.
      if (!ehViolacaoDeUnicidade(erro)) throw erro;

      throw numeroJaVinculado();
    }

    const { linkedReaders } = await this.vincular.vincularNumero(
      contexto.tenantId,
      externalId,
      requisicao.correlationId ?? 'sem-correlacao',
      new Date(),
    );

    return { externalId, linkedReaders };
  }

  /**
   * A unicidade do banco e por `kind`: o numero que e CARTAO de outro aluno
   * passaria como facial deste. Cartao e facial dividem o espaco de numero do
   * leitor, entao a recusa cobre qualquer `kind`. Linha do proprio aluno
   * (ex.: o cartao dele com o mesmo numero) nao e conflito.
   *
   * Credencial nao basta: quem trocou X -> Y com Y ainda fora do leitor
   * continua vinculado em X (`DeviceUser`). X sem credencial ainda abre a
   * catraca para essa pessoa -- cadastrar outro aluno em X sobrescreveria a
   * face dela. Vinculo de outro aluno em qualquer leitor tambem recusa.
   */
  private async recusarSeDeOutroAluno(
    tenantId: string,
    studentId: string,
    externalId: string,
  ): Promise<void> {
    const donos = await this.credenciais.encontrarPorNumeros(tenantId, [externalId]);

    if (donos.some((d) => d.studentId !== studentId)) throw numeroJaVinculado();

    for (const leitor of await this.numerosDoLeitor.leitoresComNumero(tenantId, externalId)) {
      const vinculado = await this.identidades.alunoDoNumero(tenantId, leitor.deviceId, externalId);
      if (vinculado !== null && vinculado !== studentId) throw numeroJaVinculado();
    }
  }

  /**
   * Numeros que o leitor tem e nenhum aluno do tenant tem como credencial
   * NEM como vinculo (`DeviceUser`). Credencial de QUALQUER kind conta: cartao
   * e facial dividem o espaco de numero do leitor. O vinculo conta porque quem
   * trocou de numero continua no leitor sob o antigo ate o novo chegar. O
   * cruzamento e aqui, nao em `devices` (regra no 9).
   */
  @Get('device-reader-numbers/unlinked')
  @RequirePermissions('student.read')
  @ApiOkResponse({ schema: ESQUEMA_DOS_SEM_ALUNO })
  async semAluno(): Promise<
    { externalId: string; readerName: string | null; deviceSerial: string }[]
  > {
    const { tenantId } = this.contexto.require();
    const [doLeitor, ocupados, vinculados] = await Promise.all([
      this.numerosDoLeitor.listarComNome(tenantId),
      this.credenciais.listarNumerosDoTenant(tenantId),
      this.dispositivos.listarNumerosVinculadosDoTenant(tenantId),
    ]);
    const comAluno = new Set([...ocupados, ...vinculados]);

    return doLeitor.filter((n) => !comAluno.has(n.externalId));
  }
}

function numeroJaVinculado(): ConflictException {
  return new ConflictException({
    code: 'CREDENTIAL_ALREADY_ASSIGNED',
    title: 'Este número já está vinculado a outro aluno.',
  });
}

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}
