import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Student } from '@arenahub/database';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { cpfEhValido, mascararCpf } from './domain/identificacao.js';
import { transicionarAluno } from './domain/student.js';
import { StudentRepository, type CandidatoADuplicata } from './student.repository.js';

/**
 * Data no formato `YYYY-MM-DD`, convertida para meia-noite UTC.
 *
 * `new Date('2000-05-10')` ja produz UTC; o cuidado e nao aceitar
 * `datetime`, que traria hora e fuso para um campo que nao tem nem um nem
 * outro (a coluna e `@db.Date`).
 */
const dataSimples = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato YYYY-MM-DD')
  .transform((valor) => new Date(`${valor}T00:00:00.000Z`))
  .refine((data) => !Number.isNaN(data.getTime()), 'data invalida');

const contato = z
  .object({
    type: z.enum(['EMAIL', 'PHONE', 'WHATSAPP']),
    value: z.string().min(1).max(160),
    isPrimary: z.boolean().default(false),
  })
  .strict();

// `.strict()`: `tenantId` ou `membershipNumber` no corpo sao RECUSADOS, nao
// ignorados. O tenant vem da identidade (regra no 2) e a matricula e gerada
// pelo servidor (INV-010) -- aceitar qualquer um dos dois seria deixar o
// cliente escolher.
const esquemaDeCriacao = z
  .object({
    fullName: z.string().min(2).max(160),
    birthDate: dataSimples,
    cpf: z
      .string()
      .optional()
      .refine((valor) => valor === undefined || cpfEhValido(valor), 'CPF invalido'),
    contacts: z.array(contato).max(10).default([]),
  })
  .strict();

const esquemaDeStatus = z
  .object({
    status: z.enum(['LEAD', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'BLOCKED', 'CANCELLED', 'ARCHIVED']),
    version: z.number().int().min(0),
  })
  .strict();

/** DTO de saida. Nunca a entidade -- e nunca o CPF completo. */
interface AlunoDto {
  id: string;
  membershipNumber: string;
  fullName: string;
  birthDate: string;
  cpfMasked: string | null;
  status: string;
  archivedAt: string | null;
  version: number;
}

interface AlunoCriadoDto extends AlunoDto {
  /**
   * Avisa, nao bloqueia (INV-014): a recepcao decide. Nao ha endpoint de
   * merge nesta fatia.
   */
  duplicateCandidates: CandidatoADuplicata[];
}

@Controller('api/v1/students')
export class StudentsController {
  constructor(
    private readonly alunos: StudentRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('student.read')
  async buscar(
    @Query('q') termo?: string,
    @Query('limit') limite?: string,
    @Query('cursor') cursor?: string,
  ): Promise<AlunoDto[]> {
    // Teto de 100: sem ele, `?limit=1000000` vira exportacao da base inteira
    // numa requisicao.
    const take = Math.min(Number(limite) || 20, 100);

    const encontrados = await this.alunos.buscar(this.contexto.require(), {
      termo,
      limite: take,
      cursor,
    });

    return encontrados.map((a) => this.paraDto(a));
  }

  @Get(':id')
  @RequirePermissions('student.read')
  async detalhar(@Param('id') id: string): Promise<AlunoDto> {
    const aluno = await this.alunos.encontrar(this.contexto.require(), id);

    // 404, nunca 403: 403 confirmaria que o recurso existe noutro tenant.
    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    return this.paraDto(aluno);
  }

  @Post()
  @RequirePermissions('student.create')
  async criar(@Body() corpo: unknown, @Req() requisicao: Request): Promise<AlunoCriadoDto> {
    const dados = esquemaDeCriacao.parse(corpo);
    const contexto = this.contexto.require();

    const candidatos = await this.alunos.buscarCandidatosADuplicata(contexto, dados);

    const agora = new Date();
    const aluno = await this.alunos.criar(
      contexto,
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
      agora.getUTCFullYear(),
    );

    return { ...this.paraDto(aluno), duplicateCandidates: candidatos };
  }

  /**
   * Troca de status, incluindo arquivamento.
   *
   * A transicao e validada pela funcao pura ANTES de tocar o banco: pedido
   * invalido nao abre transacao, e portanto nao escreve timeline nem outbox.
   */
  @Patch(':id/status')
  @RequirePermissions('student.update')
  async alterarStatus(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<AlunoDto> {
    const dados = esquemaDeStatus.parse(corpo);
    const contexto = this.contexto.require();

    const atual = await this.alunos.encontrar(contexto, id);
    if (!atual) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    const novoStatus = transicionarAluno(atual.status, dados.status);

    const aluno = await this.alunos.alterarStatus(
      contexto,
      id,
      dados.version,
      novoStatus,
      requisicao.correlationId ?? 'sem-correlacao',
      new Date(),
    );

    // `null` aqui e conflito de versao, nao ausencia: o aluno existe (foi
    // lido acima), mas mudou entre a leitura e a escrita.
    if (!aluno) throw new NotFoundException({ code: 'STUDENT_VERSION_CONFLICT' });

    return this.paraDto(aluno);
  }

  private paraDto(aluno: Student): AlunoDto {
    return {
      id: aluno.id,
      membershipNumber: aluno.membershipNumber,
      fullName: aluno.fullName,
      // `@db.Date` volta como Date a meia-noite UTC; `toISOString` mantem o
      // dia correto porque a gravacao tambem foi em UTC.
      birthDate: aluno.birthDate.toISOString().slice(0, 10),
      cpfMasked: mascararCpf(aluno.cpfLast3),
      status: aluno.status,
      archivedAt: aluno.archivedAt?.toISOString() ?? null,
      version: aluno.version,
    };
  }
}
