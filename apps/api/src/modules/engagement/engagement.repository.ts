import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StudentStatus } from '@arenahub/database';

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
  rejectionReason: string | null;
  version: number;
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
  rejectionReason: string | null;
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
  ): Promise<PerfilPublicoDoAluno[]>;
}

/** Converte a linha do Prisma para a forma que o service consome. */
function paraPerfilPublico(linha: {
  id: string;
  identityChoice: string;
  alias: string | null;
  status: string;
  screeningSignals: string[];
  rejectionReason: string | null;
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

    const documento = await this.encontrarOuCriarDocumentoVigente(
      entrada.tenantId,
      entrada.finalidade,
      agora,
    );

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

  /**
   * Documento de engajamento nao tem tela de publicacao nesta fatia -- as
   * quatro finalidades usam um documento GLOBAL implicito, criado sob
   * demanda na primeira decisao. `purpose`/`content` sao placeholders: nao
   * ha termo juridico para OPT-OUT de ranking, so o registro da decisao.
   */
  private async encontrarOuCriarDocumentoVigente(
    tenantId: string,
    finalidade: FinalidadeDeEngajamento,
    agora: Date,
  ): Promise<{ id: string }> {
    const existente = await this.db.consentDocument.findFirst({
      where: { tenantId: null, type: finalidade, retiredAt: null },
      orderBy: [{ version: 'desc' }],
      select: { id: true },
    });

    if (existente) return existente;

    return this.db.consentDocument.create({
      data: {
        tenantId: null,
        type: finalidade,
        version: 1,
        purpose: `Participacao em ${finalidade}`,
        content: `Documento de preferencia de engajamento (${finalidade})`,
        contentSha256: '0'.repeat(64),
        effectiveFrom: agora,
      },
      select: { id: true },
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
        throw new ConflictException('Perfil publico foi alterado por outra edicao');
      }

      const atualizado = await this.db.publicProfile.findFirst({
        where: { tenantId: entrada.tenantId, studentId: entrada.studentId },
      });

      if (!atualizado) {
        throw new NotFoundException('Perfil publico nao encontrado');
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
          rejectionReason: entrada.rejectionReason as never,
          moderatedBy: entrada.actorId,
          moderatedAt: agora,
        },
      });

      if (resultado.count === 0) {
        throw new NotFoundException('Perfil publico nao encontrado');
      }

      const atualizado = await this.db.publicProfile.findFirst({
        where: { id: entrada.perfilId, tenantId: entrada.tenantId },
      });

      if (!atualizado) {
        throw new NotFoundException('Perfil publico nao encontrado');
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
  ): Promise<PerfilPublicoDoAluno[]> {
    const perfis = await this.db.publicProfile.findMany({
      where: { tenantId, status },
      orderBy: [{ createdAt: 'asc' }],
      take: limite,
    });

    return perfis.map(paraPerfilPublico);
  }
}

/**
 * Colisao de alias aprovado dispara erro do Postgres no indice parcial.
 *
 * Prisma 7 + adapter-pg NAO popula `error.meta.target` (memoria
 * prisma7-adapter-pg-sem-meta-target): o nome do constraint so vem em
 * texto livre na mensagem. Casar pelo nome do indice, nao por `meta`.
 */
function traduzirErroDeColisao(erro: unknown): unknown {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
    const mensagem = String(erro.message ?? '');

    if (mensagem.includes(INDICE_ALIAS_APROVADO_UNICO)) {
      return new ConflictException({
        code: 'ALIAS_JA_APROVADO_PARA_OUTRO_ALUNO',
        message: 'Este apelido ja foi aprovado para outro aluno',
      });
    }
  }

  return erro;
}
