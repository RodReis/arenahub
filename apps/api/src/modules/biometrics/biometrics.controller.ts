import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { BiometricIdentity } from '@arenahub/database';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import {
  OBJECT_STORAGE,
  montarChaveDeCadastro,
  type ObjectStoragePort,
} from '../../common/storage/object-storage.port.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { carregarConfig } from '../../config/env.js';
import { DeviceRepository } from '../devices/device.repository.js';
import { formatarExternalUserId } from '../devices/domain/hardware-homologado.js';
import { ConsentRepository } from '../privacy/consent.repository.js';
import {
  avaliarConsentimento,
  calcularIdadeEmAnos,
} from '../privacy/domain/consentimento.js';
import { StudentRepository } from '../students/student.repository.js';
import { BiometricIdentityRepository } from './biometric-identity.repository.js';

const esquemaDeUpload = z
  .object({
    gymUnitId: z.string().uuid(),
    contentType: z.enum(['image/jpeg', 'image/png']),
  })
  .strict();

const esquemaDeCriacao = z
  .object({
    gymUnitId: z.string().uuid(),
    /** Devolvido pelo endpoint de upload. */
    uploadToken: z.string().min(1),
  })
  .strict();

const esquemaDeRevogacao = z
  .object({
    reason: z.string().min(3).max(200),
    /** Confirmacao explicita: revogar apaga biometria de equipamento fisico. */
    confirm: z.literal(true),
  })
  .strict();

interface IdentidadeDto {
  id: string;
  studentId: string;
  state: string;
  createdAt: string;
  revokedAt: string | null;
  deletedAt: string | null;
  /** NUNCA a chave do objeto nem URL da imagem. */
  hasEnrollmentObject: boolean;
}

@Controller('api/v1/students/:studentId/biometric-identities')
export class BiometricsController {
  constructor(
    private readonly identidades: BiometricIdentityRepository,
    private readonly consentimentos: ConsentRepository,
    private readonly alunos: StudentRepository,
    private readonly dispositivos: DeviceRepository,
    private readonly contexto: TenantContextService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  @Get()
  @RequirePermissions('biometric.read')
  async listar(@Param('studentId') studentId: string): Promise<IdentidadeDto[]> {
    const contexto = this.contexto.require();

    const aluno = await this.alunos.encontrar(contexto, studentId);
    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    const encontradas = await this.identidades.listarDoAluno(contexto, studentId);

    return encontradas.map((i) => this.paraDto(i));
  }

  /**
   * Devolve URL pre-assinada para o cliente enviar a foto DIRETO ao storage.
   *
   * A imagem nao passa pela API: menos um lugar onde biometria bruta trafega
   * e fica em log de acesso, buffer ou dump de memoria.
   *
   * A CHAVE E GERADA AQUI, no servidor. Aceitar `key` do corpo deixaria o
   * cliente escolher o prefixo do tenant.
   */
  @Post('upload')
  @RequirePermissions('biometric.enroll')
  async prepararUpload(
    @Param('studentId') studentId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ uploadUrl: string; uploadToken: string; expiresAt: string }> {
    const dados = esquemaDeUpload.parse(corpo);
    const contexto = this.contexto.require();

    const aluno = await this.alunos.encontrar(contexto, studentId);
    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    // O consentimento e checado ANTES de gerar a URL: sem ele, nem a imagem
    // deveria subir (INV-017). Checar so na criacao deixaria foto de quem
    // recusou parada no bucket.
    await this.exigirConsentimentoValido(contexto, studentId, aluno.birthDate);

    const config = carregarConfig().storage;

    // Identificador do objeto, ainda sem identidade criada. Vira o `token`
    // que a criacao usa para localizar a imagem.
    const referencia = crypto.randomUUID();
    const chave = montarChaveDeCadastro(contexto.tenantId, referencia);

    const upload = await this.storage.createPrivateUpload({
      key: chave,
      contentType: dados.contentType,
      maxBytes: config.maxBytesDeCadastro,
      expiresInSeconds: config.ttlDeUploadEmSegundos,
    });

    await this.identidades.registrarAcesso(
      contexto,
      {
        identityId: referencia,
        kind: 'ENROLLMENT_IMAGE',
        purpose: 'ENROLLMENT',
        actorType: 'USER',
        actorIp: requisicao.ip,
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return {
      uploadUrl: upload.uploadUrl,
      uploadToken: referencia,
      expiresAt: upload.expiresAt,
    };
  }

  /**
   * Cria a identidade e dispara o sync para todos os dispositivos-alvo.
   *
   * Confere o objeto no storage ANTES de criar: o cliente diz que enviou, e
   * isto verifica. Sem a checagem, upload de 0 byte viraria identidade
   * biometrica valida que nenhum leitor consegue usar.
   */
  @Post()
  @RequirePermissions('biometric.enroll')
  async criar(
    @Param('studentId') studentId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<IdentidadeDto> {
    const dados = esquemaDeCriacao.parse(corpo);
    const contexto = this.contexto.require();
    const correlationId = requisicao.correlationId ?? 'sem-correlacao';

    const aluno = await this.alunos.encontrar(contexto, studentId);
    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    const consentimento = await this.exigirConsentimentoValido(
      contexto,
      studentId,
      aluno.birthDate,
    );

    const chave = montarChaveDeCadastro(contexto.tenantId, dados.uploadToken);

    try {
      const objeto = await this.storage.headPrivateObject(chave);

      if (objeto.size <= 0) {
        throw new BadRequestException({ code: 'BIOMETRIC_ENROLLMENT_OBJECT_EMPTY' });
      }
    } catch (erro: unknown) {
      if (erro instanceof BadRequestException) throw erro;

      throw new BadRequestException({ code: 'BIOMETRIC_ENROLLMENT_OBJECT_MISSING' });
    }

    // Ja existe identidade ativa? Criar outra deixaria duas biometrias vivas
    // para a mesma pessoa, e a revogacao de uma nao bloquearia a outra.
    const ativa = await this.identidades.encontrarAtiva(contexto, studentId);

    if (ativa) throw new BadRequestException({ code: 'BIOMETRIC_IDENTITY_ALREADY_ACTIVE' });

    const alvos = await this.dispositivos.listarAlvosDeSync(contexto, dados.gymUnitId);

    if (alvos.length === 0) {
      throw new BadRequestException({ code: 'BIOMETRIC_NO_TARGET_DEVICE' });
    }

    const comExternalId = await Promise.all(
      alvos.map(async (dispositivo) => ({
        deviceId: dispositivo.id,
        externalUserId: formatarExternalUserId(
          await this.dispositivos.proximoExternalUserId(dispositivo.id),
        ),
      })),
    );

    const identidade = await this.identidades.criarComSync(
      contexto,
      {
        studentId,
        consentRecordId: consentimento,
        enrollmentObjectKey: chave,
        alvos: comExternalId,
      },
      correlationId,
    );

    return this.paraDto(identidade);
  }

  /**
   * Revoga a identidade: bloqueio logico imediato (INV-018).
   *
   * Depois desta chamada a biometria nao autoriza mais nada, mesmo que
   * nenhum leitor tenha confirmado a exclusao fisica. O `DELETE` fisico vira
   * job; o bloqueio ja aconteceu.
   */
  @Delete(':identityId')
  @RequirePermissions('biometric.revoke')
  async revogar(
    @Param('studentId') studentId: string,
    @Param('identityId') identityId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<IdentidadeDto> {
    const dados = esquemaDeRevogacao.parse(corpo);
    const contexto = this.contexto.require();
    const correlationId = requisicao.correlationId ?? 'sem-correlacao';

    const aluno = await this.alunos.encontrar(contexto, studentId);
    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    const identidade = await this.identidades.revogar(
      contexto,
      identityId,
      dados.reason,
      correlationId,
      new Date(),
    );

    if (!identidade) throw new NotFoundException({ code: 'BIOMETRIC_IDENTITY_NOT_FOUND' });

    await this.identidades.registrarAcesso(
      contexto,
      {
        identityId,
        kind: 'IDENTITY_METADATA',
        purpose: 'REVOCATION',
        actorType: 'USER',
        actorIp: requisicao.ip,
      },
      correlationId,
    );

    const atualizada = await this.identidades.encontrar(contexto, identityId);

    return this.paraDto(atualizada ?? identidade);
  }

  /**
   * Exige consentimento que autoriza biometria AGORA, e devolve o id dele.
   *
   * Centralizado porque tanto o upload quanto a criacao precisam da mesma
   * garantia -- e porque a virada dos 18 (INV-143) faz "tinha consentimento"
   * e "pode cadastrar" serem perguntas diferentes.
   */
  private async exigirConsentimentoValido(
    contexto: ReturnType<TenantContextService['require']>,
    studentId: string,
    nascimento: Date,
  ): Promise<string> {
    const decisao = await this.consentimentos.encontrarDecisaoVigente(
      contexto,
      studentId,
      'BIOMETRIC',
    );

    const avaliacao = avaliarConsentimento(
      decisao,
      calcularIdadeEmAnos(nascimento, new Date()),
    );

    if (!avaliacao.valido) {
      // O codigo diz POR QUE nao pode: recusado, revogado, precisa
      // revalidar aos 18. A recepcao age diferente em cada caso.
      throw new BadRequestException({ code: avaliacao.motivo });
    }

    return decisao!.id;
  }

  private paraDto(identidade: BiometricIdentity): IdentidadeDto {
    return {
      id: identidade.id,
      studentId: identidade.studentId,
      state: identidade.state,
      createdAt: identidade.createdAt.toISOString(),
      revokedAt: identidade.revokedAt?.toISOString() ?? null,
      deletedAt: identidade.deletedAt?.toISOString() ?? null,
      // Booleano, nunca a chave: expor o caminho do objeto daria a quem tem
      // a resposta um alvo para tentar acessar direto.
      hasEnrollmentObject: identidade.enrollmentObjectKey !== null,
    };
  }
}
