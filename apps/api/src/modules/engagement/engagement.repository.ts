import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AliasRejectionReason, type StudentStatus } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { DecisaoDeEngajamento, FinalidadeDeEngajamento } from './domain/participacao.js';
import type { IdentidadeEscolhida, StatusDoPerfilPublico } from './domain/exposicao.js';

/** Nome do indice parcial que garante alias unico entre os aprovados. */
const INDICE_ALIAS_APROVADO_UNICO = 'public_profiles_alias_aprovado_unico';

/** Token de injecao da porta -- o modulo Nest liga isto ao repositorio Prisma. */
export const PORTA_DE_ENGAJAMENTO = Symbol('PortaDeEngajamento');

/** O que a camada de service precisa saber sobre o aluno para expor. */
export interface AlunoParaExposicao {
  id: string;
  tenantId: string;
  fullName: string;
  status: StudentStatus;
  birthDate: Date;
}

/** Perfil publico, na forma que o service e o dublê expoem. */
export interface PerfilPublicoDoAluno {
  id: string;
  identityChoice: IdentidadeEscolhida;
  alias: string | null;
  status: StatusDoPerfilPublico;
  screeningSignals: readonly string[];
  rejectionReason: AliasRejectionReason | null;
  version: number;
}

/**
 * Perfil publico com o nome do aluno anexado -- so para a fila de moderacao.
 *
 * NAO e o formato de `perfilDoAluno`/`salvarPerfil`: aquele alimenta
 * `obterPreferencias`, que o TOTEM consome (`PreferenciasDoAluno.perfil`), e
 * o totem fala com o proprio aluno -- nao precisa do nome dele de volta.
 * Vazar `alunoNome` ali inchava um tipo compartilhado por um consumidor que
 * nao pediu. O moderador, ao contrario, julga um perfil de outra pessoa e
 * precisa do NOME COMPLETO para distinguir alunos com o mesmo primeiro nome
 * -- diferente da tela do totem, que mostra so o primeiro nome para o
 * proprio aluno.
 */
export interface PerfilParaModeracao extends PerfilPublicoDoAluno {
  alunoNome: string;
}

export interface EntradaDeRegistro {
  tenantId: string;
  actorId: string;
  studentId: string;
  finalidade: FinalidadeDeEngajamento;
  decision: 'ACCEPTED' | 'REFUSED';
  subjectAgeYears: number;
  idempotencyKey?: string | undefined;
}

export interface EntradaDeSalvamento {
  tenantId: string;
  studentId: string;
  identityChoice: IdentidadeEscolhida;
  alias: string | null;
  aliasNormalized: string | null;
  screeningSignals: readonly string[];
  /** `null` = criacao. Presente = compare-and-swap contra a versao lida. */
  version: number | null;
}

export interface EntradaDeModeracaoNoBanco {
  tenantId: string;
  actorId: string;
  perfilId: string;
  status: 'APPROVED' | 'REJECTED';
  rejectionReason: AliasRejectionReason | null;
}

/**
 * Le e escreve consentimento de ENGAJAMENTO e perfil publico.
 *
 * `ConsentRecord` e a mesma tabela da biometria, e isso e deliberado
 * (ADR-046): append-only, revogacao por linha nova, ator e IP ja modelados.
 * O que muda e o REGIME de leitura -- ver `domain/participacao.ts`.
 */
export interface PortaDeEngajamento {
  buscarAluno(tenantId: string, studentId: string): Promise<AlunoParaExposicao | null>;
  decisaoVigente(
    tenantId: string,
    studentId: string,
    finalidade: FinalidadeDeEngajamento,
  ): Promise<DecisaoDeEngajamento | null>;
  registrarDecisao(entrada: EntradaDeRegistro, agora: Date): Promise<void>;
  perfilDoAluno(tenantId: string, studentId: string): Promise<PerfilPublicoDoAluno | null>;
  perfilPorId(tenantId: string, perfilId: string): Promise<PerfilPublicoDoAluno | null>;
  salvarPerfil(entrada: EntradaDeSalvamento, agora: Date): Promise<PerfilPublicoDoAluno>;
  moderarPerfil(entrada: EntradaDeModeracaoNoBanco, agora: Date): Promise<PerfilPublicoDoAluno>;
  listarPorStatus(
    tenantId: string,
    status: StatusDoPerfilPublico,
    limite: number,
  ): Promise<PerfilParaModeracao[]>;
}

/** Converte a linha do Prisma para a forma que o service consome. */
function paraPerfilPublico(linha: {
  id: string;
  identityChoice: string;
  alias: string | null;
  status: string;
  screeningSignals: string[];
  rejectionReason: AliasRejectionReason | null;
  version: number;
}): PerfilPublicoDoAluno {
  return {
    id: linha.id,
    identityChoice: linha.identityChoice as IdentidadeEscolhida,
    alias: linha.alias,
    status: linha.status as StatusDoPerfilPublico,
    screeningSignals: linha.screeningSignals,
    rejectionReason: linha.rejectionReason,
    version: linha.version,
  };
}

@Injectable()
export class EngagementRepository implements PortaDeEngajamento {
  constructor(private readonly db: PrismaService) {}

  async buscarAluno(tenantId: string, studentId: string): Promise<AlunoParaExposicao | null> {
    const aluno = await this.db.student.findFirst({
      where: { id: studentId, tenantId },
      select: { id: true, tenantId: true, fullName: true, status: true, birthDate: true },
    });

    return aluno;
  }

  async decisaoVigente(
    tenantId: string,
    studentId: string,
    finalidade: FinalidadeDeEngajamento,
  ): Promise<DecisaoDeEngajamento | null> {
    // orderBy obrigatorio: sem ele a ordem fisica do Postgres decide qual
    // decisao vale (memoria sort-estavel-decide-consentimento).
    const registro = await this.db.consentRecord.findFirst({
      where: {
        tenantId,
        studentId,
        supersededAt: null,
        document: { type: finalidade },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      select: { decision: true, supersededAt: true },
    });

    if (!registro) return null;

    return { decision: registro.decision, supersededAt: registro.supersededAt };
  }

  async registrarDecisao(entrada: EntradaDeRegistro, agora: Date): Promise<void> {
    // Idempotencia por evidence.idempotencyKey: procura decisao com a mesma
    // chave nas ultimas 24h e nao grava de novo se ja existir.
    if (entrada.idempotencyKey) {
      const desde = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
      const existente = await this.db.consentRecord.findFirst({
        where: {
          tenantId: entrada.tenantId,
          studentId: entrada.studentId,
          document: { type: entrada.finalidade },
          occurredAt: { gte: desde },
          evidence: { path: ['idempotencyKey'], equals: entrada.idempotencyKey },
        },
      });

      if (existente) return;
    }

    // Documento vigente do TENANT (nunca global/null): so o seed publica
    // estes quatro, um por tenant -- ver `packages/database/prisma/seed.ts`.
    // orderBy obrigatorio pelo mesmo motivo de `decisaoVigente`.
    const documento = await this.db.consentDocument.findFirst({
      where: { tenantId: entrada.tenantId, type: entrada.finalidade, retiredAt: null },
      orderBy: [{ version: 'desc' }],
      select: { id: true },
    });

    if (!documento) {
      throw new NotFoundException({
        code: 'DOCUMENTO_DE_ENGAJAMENTO_AUSENTE',
        message: `Nenhum documento de consentimento publicado para ${entrada.finalidade}`,
      });
    }

    await this.db.$transaction(async (tx) => {
      await tx.consentRecord.updateMany({
        where: {
          tenantId: entrada.tenantId,
          studentId: entrada.studentId,
          documentId: documento.id,
          supersededAt: null,
        },
        data: { supersededAt: agora },
      });

      await tx.consentRecord.create({
        data: {
          tenantId: entrada.tenantId,
          studentId: entrada.studentId,
          documentId: documento.id,
          decision: entrada.decision,
          subjectKind: 'STUDENT',
          subjectAgeYears: entrada.subjectAgeYears,
          actorId: entrada.actorId,
          evidence: entrada.idempotencyKey
            ? { idempotencyKey: entrada.idempotencyKey }
            : Prisma.JsonNull,
          occurredAt: agora,
        },
      });
    });
  }

  async perfilDoAluno(tenantId: string, studentId: string): Promise<PerfilPublicoDoAluno | null> {
    const perfil = await this.db.publicProfile.findFirst({
      where: { tenantId, studentId },
    });

    return perfil ? paraPerfilPublico(perfil) : null;
  }

  async perfilPorId(tenantId: string, perfilId: string): Promise<PerfilPublicoDoAluno | null> {
    const perfil = await this.db.publicProfile.findFirst({
      where: { id: perfilId, tenantId },
    });

    return perfil ? paraPerfilPublico(perfil) : null;
  }

  async salvarPerfil(entrada: EntradaDeSalvamento, _agora: Date): Promise<PerfilPublicoDoAluno> {
    try {
      if (entrada.version === null) {
        const criado = await this.db.publicProfile.upsert({
          where: { tenantId_studentId: { tenantId: entrada.tenantId, studentId: entrada.studentId } },
          create: {
            tenantId: entrada.tenantId,
            studentId: entrada.studentId,
            identityChoice: entrada.identityChoice,
            alias: entrada.alias,
            aliasNormalized: entrada.aliasNormalized,
            screeningSignals: [...entrada.screeningSignals],
            status: 'PENDING',
            version: 1,
          },
          update: {
            identityChoice: entrada.identityChoice,
            alias: entrada.alias,
            aliasNormalized: entrada.aliasNormalized,
            screeningSignals: [...entrada.screeningSignals],
            status: 'PENDING',
            rejectionReason: null,
            moderatedBy: null,
            moderatedAt: null,
            version: { increment: 1 },
          },
        });

        return paraPerfilPublico(criado);
      }

      // Compare-and-swap: so atualiza se a versao ainda for a lida.
      const resultado = await this.db.publicProfile.updateMany({
        where: { tenantId: entrada.tenantId, studentId: entrada.studentId, version: entrada.version },
        data: {
          identityChoice: entrada.identityChoice,
          alias: entrada.alias,
          aliasNormalized: entrada.aliasNormalized,
          screeningSignals: [...entrada.screeningSignals],
          status: 'PENDING',
          rejectionReason: null,
          moderatedBy: null,
          moderatedAt: null,
          version: { increment: 1 },
        },
      });

      if (resultado.count === 0) {
        throw new ConflictException({
          code: 'PERFIL_PUBLICO_VERSAO_CONFLITANTE',
          message: 'Perfil publico foi alterado por outra edicao',
        });
      }

      const atualizado = await this.db.publicProfile.findFirst({
        where: { tenantId: entrada.tenantId, studentId: entrada.studentId },
      });

      if (!atualizado) {
        throw new NotFoundException({
          code: 'PERFIL_PUBLICO_NAO_ENCONTRADO',
          message: 'Perfil publico nao encontrado',
        });
      }

      return paraPerfilPublico(atualizado);
    } catch (erro) {
      throw traduzirErroDeColisao(erro);
    }
  }

  async moderarPerfil(
    entrada: EntradaDeModeracaoNoBanco,
    agora: Date,
  ): Promise<PerfilPublicoDoAluno> {
    try {
      const resultado = await this.db.publicProfile.updateMany({
        // tenantId no where, nunca so o id: e o que barra o moderador de
        // outro tenant.
        where: { id: entrada.perfilId, tenantId: entrada.tenantId },
        data: {
          status: entrada.status,
          rejectionReason: entrada.rejectionReason,
          moderatedBy: entrada.actorId,
          moderatedAt: agora,
        },
      });

      if (resultado.count === 0) {
        throw new NotFoundException({
          code: 'PERFIL_PUBLICO_NAO_ENCONTRADO',
          message: 'Perfil publico nao encontrado',
        });
      }

      const atualizado = await this.db.publicProfile.findFirst({
        where: { id: entrada.perfilId, tenantId: entrada.tenantId },
      });

      if (!atualizado) {
        throw new NotFoundException({
          code: 'PERFIL_PUBLICO_NAO_ENCONTRADO',
          message: 'Perfil publico nao encontrado',
        });
      }

      return paraPerfilPublico(atualizado);
    } catch (erro) {
      throw traduzirErroDeColisao(erro);
    }
  }

  async listarPorStatus(
    tenantId: string,
    status: StatusDoPerfilPublico,
    limite: number,
  ): Promise<PerfilParaModeracao[]> {
    const perfis = await this.db.publicProfile.findMany({
      where: { tenantId, status },
      orderBy: [{ createdAt: 'asc' }],
      take: limite,
      include: { student: { select: { fullName: true } } },
    });

    return perfis.map((perfil) => ({
      ...paraPerfilPublico(perfil),
      alunoNome: perfil.student.fullName,
    }));
  }
}

/**
 * O nome do indice esta em `erro.meta.driverAdapterError.cause.originalMessage`
 * (texto livre do Postgres), confirmado contra Postgres real -- mesmo
 * caminho documentado em `assessment.repository.ts` (`violaIndiceDeOrigem`).
 * `erro.message` (o texto formatado pelo Prisma) e fallback: `create`/`upsert`
 * citam o NOME do indice ali, mas `updateMany` (usado em `moderarPerfil`)
 * cita os CAMPOS em vez do nome -- o wording muda conforme a operacao, entao
 * o fallback casa os dois formatos.
 */
function mensagemOriginalDoDriver(erro: Prisma.PrismaClientKnownRequestError): string | null {
  const meta: unknown = erro.meta;
  if (meta === null || typeof meta !== 'object') return null;

  const driverError: unknown = (meta as Record<string, unknown>)['driverAdapterError'];
  if (driverError === null || typeof driverError !== 'object') return null;

  const cause: unknown = (driverError as Record<string, unknown>)['cause'];
  if (cause === null || typeof cause !== 'object') return null;

  const mensagem: unknown = (cause as Record<string, unknown>)['originalMessage'];
  return typeof mensagem === 'string' ? mensagem : null;
}

/** Campos do indice parcial, na forma como `updateMany` relata a colisao no
 * `erro.message` formatado (entre crases, separados por virgula) -- so usado
 * no fallback, quando `meta` estruturado nao trouxer o nome do indice. */
const CAMPOS_DO_INDICE_ALIAS_APROVADO = '`tenant_id`, `alias_normalized`';

/**
 * Colisao de alias aprovado dispara erro do Postgres no indice parcial.
 *
 * Prisma 7 + adapter-pg NAO popula `error.meta.target` como versoes
 * anteriores documentavam (memoria prisma7-adapter-pg-sem-meta-target) --
 * mas populam `error.meta.driverAdapterError.cause.originalMessage`, que
 * carrega o nome do indice em texto livre. Tenta esse caminho primeiro;
 * so cai para casar `erro.message` se `meta` nao trouxer nada usavel.
 */
function traduzirErroDeColisao(erro: unknown): unknown {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
    const doMeta = mensagemOriginalDoDriver(erro);
    const mensagem = doMeta ?? String(erro.message ?? '');

    if (
      mensagem.includes(INDICE_ALIAS_APROVADO_UNICO) ||
      mensagem.includes(CAMPOS_DO_INDICE_ALIAS_APROVADO)
    ) {
      return new ConflictException({
        code: 'ALIAS_JA_APROVADO_PARA_OUTRO_ALUNO',
        message: 'Este apelido ja foi aprovado para outro aluno',
      });
    }
  }

  return erro;
}
