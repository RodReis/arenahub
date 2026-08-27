import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AliasRejectionReason } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { type FinalidadeDeEngajamento, participaDoRanking } from './domain/participacao.js';
import { type IdentidadeEscolhida, resolverExposicao } from './domain/exposicao.js';
import { triarAlias } from './domain/triagem-de-alias.js';
import {
  type PerfilParaModeracao,
  type PerfilPublicoDoAluno,
  PORTA_DE_ENGAJAMENTO,
  type PortaDeEngajamento,
} from './engagement.repository.js';

/** As quatro finalidades que compoem `PreferenciasDoAluno.finalidades`. */
const FINALIDADES: readonly FinalidadeDeEngajamento[] = [
  'RANKING',
  'CHALLENGE',
  'ENGAGEMENT_PUSH',
  'PHYSICAL_EVOLUTION_RANKING',
];

export interface PreferenciasDoAluno {
  finalidades: Record<FinalidadeDeEngajamento, boolean>;
  perfil: PerfilPublicoDoAluno | null;
  nomeExibido: string;
}

export interface EntradaDeAtualizacao {
  studentId: string;
  finalidade: FinalidadeDeEngajamento;
  participa: boolean;
  idempotencyKey?: string | undefined;
}

export interface EntradaDeAlias {
  studentId: string;
  identityChoice: IdentidadeEscolhida;
  alias: string | null;
  /** `null` = perfil novo. Presente = compare-and-swap. */
  version: number | null;
}

export interface FiltroDeModeracao {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'HIDDEN';
}

/** Espelha o enum Prisma `AliasRejectionReason` -- checagem de pertinencia
 * em runtime, ja que o tipo gerado some na compilacao. */
const RAZOES_DE_REJEICAO: readonly AliasRejectionReason[] = [
  'OFENSIVO',
  'CONTEM_PII',
  'IMPERSONACAO',
  'SPAM_OU_PROPAGANDA',
  'ILEGIVEL',
];

export interface EntradaDeModeracao {
  perfilId: string;
  decisao: 'APPROVED' | 'REJECTED';
  rejectionReason: AliasRejectionReason | null;
}

/** Idade em anos completos, calculada a partir da data de nascimento. */
function calcularIdadeEmAnos(nascimento: Date, referencia: Date): number {
  const anos = referencia.getUTCFullYear() - nascimento.getUTCFullYear();

  const mesDeReferencia = referencia.getUTCMonth();
  const mesDeNascimento = nascimento.getUTCMonth();

  const aindaNaoFezAniversario =
    mesDeReferencia < mesDeNascimento ||
    (mesDeReferencia === mesDeNascimento && referencia.getUTCDate() < nascimento.getUTCDate());

  return aindaNaoFezAniversario ? anos - 1 : anos;
}

/** Primeiro nome, a partir do nome completo. */
function primeiroNomeDe(fullName: string): string {
  return fullName.trim().split(/\s+/u)[0] ?? fullName;
}

/**
 * Orquestra preferencia de engajamento e identidade publica do aluno.
 *
 * So o que traduz `TenantContext` e a porta de dados em decisao de dominio
 * -- as regras em si vivem em `domain/*.ts` e nao sao reimplementadas aqui.
 */
@Injectable()
export class EngagementService {
  constructor(@Inject(PORTA_DE_ENGAJAMENTO) private readonly repo: PortaDeEngajamento) {}

  async obterPreferencias(ctx: TenantContext, studentId: string): Promise<PreferenciasDoAluno> {
    const aluno = await this.repo.buscarAluno(ctx.tenantId, studentId);
    if (!aluno) {
      throw new NotFoundException({ code: 'ALUNO_NAO_ENCONTRADO', message: 'Aluno nao encontrado' });
    }

    const decisoes = await Promise.all(
      FINALIDADES.map((finalidade) => this.repo.decisaoVigente(ctx.tenantId, studentId, finalidade)),
    );

    const finalidades = FINALIDADES.reduce<Record<FinalidadeDeEngajamento, boolean>>(
      (acc, finalidade, indice) => {
        const decisao = decisoes[indice] ?? null;
        return { ...acc, [finalidade]: participaDoRanking(decisao) };
      },
      {} as Record<FinalidadeDeEngajamento, boolean>,
    );

    const perfil = await this.repo.perfilDoAluno(ctx.tenantId, studentId);
    const decisaoDeRanking = decisoes[FINALIDADES.indexOf('RANKING')] ?? null;

    const exposicao = resolverExposicao({
      decisao: decisaoDeRanking,
      perfil: perfil
        ? { alias: perfil.alias, status: perfil.status, identidade: perfil.identityChoice }
        : null,
      primeiroNome: primeiroNomeDe(aluno.fullName),
      statusDoAluno: aluno.status,
    });

    return {
      finalidades,
      perfil,
      nomeExibido: exposicao.exibe ? exposicao.nome : '',
    };
  }

  async atualizarPreferencia(
    ctx: TenantContext,
    entrada: EntradaDeAtualizacao,
    agora: Date,
  ): Promise<PreferenciasDoAluno> {
    const aluno = await this.repo.buscarAluno(ctx.tenantId, entrada.studentId);
    if (!aluno) {
      throw new NotFoundException({ code: 'ALUNO_NAO_ENCONTRADO', message: 'Aluno nao encontrado' });
    }

    await this.repo.registrarDecisao(
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        studentId: entrada.studentId,
        finalidade: entrada.finalidade,
        decision: entrada.participa ? 'ACCEPTED' : 'REFUSED',
        subjectAgeYears: calcularIdadeEmAnos(aluno.birthDate, agora),
        idempotencyKey: entrada.idempotencyKey,
      },
      agora,
    );

    return this.obterPreferencias(ctx, entrada.studentId);
  }

  async definirAliasPublico(
    ctx: TenantContext,
    entrada: EntradaDeAlias,
    agora: Date,
  ): Promise<PerfilPublicoDoAluno> {
    const aluno = await this.repo.buscarAluno(ctx.tenantId, entrada.studentId);
    if (!aluno) {
      throw new NotFoundException({ code: 'ALUNO_NAO_ENCONTRADO', message: 'Aluno nao encontrado' });
    }

    if (entrada.identityChoice !== 'APELIDO' || entrada.alias === null) {
      return this.repo.salvarPerfil(
        {
          tenantId: ctx.tenantId,
          studentId: entrada.studentId,
          identityChoice: entrada.identityChoice,
          alias: null,
          aliasNormalized: null,
          screeningSignals: [],
          version: entrada.version,
        },
        agora,
      );
    }

    // Lista de palavras bloqueadas do tenant: vazia nesta fatia -- nao ha
    // tela de configuracao ainda. O parametro existe para a F34 preencher.
    const triagem = triarAlias(entrada.alias, []);

    return this.repo.salvarPerfil(
      {
        tenantId: ctx.tenantId,
        studentId: entrada.studentId,
        identityChoice: entrada.identityChoice,
        alias: entrada.alias,
        aliasNormalized: triagem.normalizado,
        screeningSignals: triagem.sinais,
        version: entrada.version,
      },
      agora,
    );
  }

  async listarParaModeracao(
    ctx: TenantContext,
    filtro: FiltroDeModeracao,
  ): Promise<PerfilParaModeracao[]> {
    return this.repo.listarPorStatus(ctx.tenantId, filtro.status, 100);
  }

  async moderarAlias(
    ctx: TenantContext,
    entrada: EntradaDeModeracao,
    agora: Date,
  ): Promise<PerfilPublicoDoAluno> {
    if (entrada.decisao === 'REJECTED') {
      if (!entrada.rejectionReason) {
        throw new BadRequestException({
          code: 'RAZAO_DE_RECUSA_OBRIGATORIA',
          message: 'rejectionReason e obrigatorio ao rejeitar',
        });
      }

      if (!RAZOES_DE_REJEICAO.includes(entrada.rejectionReason)) {
        throw new BadRequestException({
          code: 'RAZAO_DE_RECUSA_INVALIDA',
          message: 'rejectionReason nao pertence ao enum AliasRejectionReason',
        });
      }
    }

    return this.repo.moderarPerfil(
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        perfilId: entrada.perfilId,
        status: entrada.decisao,
        rejectionReason: entrada.rejectionReason,
      },
      agora,
    );
  }
}
