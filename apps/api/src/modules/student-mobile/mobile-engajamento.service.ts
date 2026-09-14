import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import { mesLocal } from '../engagement/domain/movimento-de-xp.js';
import { EngagementChallengesService } from '../engagement/engagement-challenges.service.js';
import { EngagementRankingService } from '../engagement/engagement-ranking.service.js';
import { EngagementXpService } from '../engagement/engagement-xp.service.js';
import { EngagementService } from '../engagement/engagement.service.js';
import { dataLocalIso } from '../health/domain/periodo.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';
import { AlunoDaSessaoNaoEncontradoError, tenantContextDoAluno } from './contexto-do-aluno.js';

/** Quantas linhas do placar o app recebe -- o topo, nao a lista inteira. */
const LINHAS_DO_PLACAR = 10;

export interface LinhaDoPlacarDoApp {
  readonly posicao: number;
  readonly nome: string;
  readonly pontos: number;
  readonly souEu: boolean;
}

export interface RankingDoApp {
  readonly participa: boolean;
  readonly nomeExibido: string;
  readonly minhaPosicao: { readonly posicao: number; readonly pontos: number } | null;
  readonly placar: readonly LinhaDoPlacarDoApp[];
}

export interface DesafioDoApp {
  readonly id: string;
  readonly titulo: string;
  readonly meta: number;
  readonly progresso: number;
  readonly inscrito: boolean;
  readonly inicio: string;
  readonly fim: string;
}

export interface RespostaDoEngajamento {
  readonly asOf: string;
  readonly status: 'AVAILABLE';
  readonly mes: string;
  readonly unidade: { readonly nome: string };
  readonly xp: {
    readonly saldoDoMes: number;
    readonly conquistas:
      | readonly { readonly titulo: string; readonly desbloqueadaEm: string; readonly revertida: boolean }[]
      | null;
  };
  readonly consistencia: {
    readonly atual: number;
    readonly recorde: number;
    readonly diasPorSemana: number;
  };
  /** `null` = o tenant desligou o ranking. Nunca lista vazia no lugar. */
  readonly ranking: RankingDoApp | null;
  /** `null` = o tenant desligou os desafios. */
  readonly desafios: readonly DesafioDoApp[] | null;
}

export interface PreferenciaDeRankingDoApp {
  readonly participa: boolean;
  readonly nomeExibido: string;
}

/**
 * XP, consistencia, placar e desafios do aluno no app.
 *
 * ---------------------------------------------------------------------------
 * ESTE ARQUIVO NAO CALCULA ENGAJAMENTO. ELE SO O TRADUZ PARA O APP.
 * ---------------------------------------------------------------------------
 *
 * Espelha o que o totem ja faz em `kiosk-xp.service.ts` e
 * `kiosk-engajamento.service.ts`, pelos MESMOS casos de uso publicos do
 * `EngagementModule` (regra de arquitetura no 9). Um calculo proprio aqui
 * daria ao aluno um saldo no celular e outro no totem da recepcao.
 *
 * DUAS DIFERENCAS em relacao ao totem, ambas deliberadas:
 *
 *  1. A UNIDADE vem do cadastro do aluno, e nao do dispositivo. O totem e
 *     fisico e pertence a uma recepcao; o app nao pertence a unidade nenhuma,
 *     e `tenantContextDoAluno` monta `allowedUnitIds: 'ALL'`. O placar exige
 *     uma unidade explicita, e a do aluno e a unica que responde "o placar da
 *     minha academia" sem inventar escolha.
 *
 *  2. O FUSO e o da unidade do aluno, lido junto com ela. O totem fixa
 *     `America/Sao_Paulo` porque o contexto dele nao carrega fuso; aqui a
 *     leitura da unidade ja e necessaria, e o fuso vem de graca -- fixa-lo
 *     nomearia o mes errado para quem treina fora de Brasilia na virada.
 *
 * Secao desligada pelo tenant volta `null`, e NAO lista vazia: "sem desafio
 * aberto" e "desafios desligados" pedem telas diferentes, e colapsar os dois
 * faria o app anunciar "nenhum desafio este mes" numa academia que nem usa.
 */
@Injectable()
export class MobileEngajamentoService {
  constructor(
    private readonly db: PrismaService,
    private readonly engajamento: EngagementService,
    private readonly xp: EngagementXpService,
    private readonly ranking: EngagementRankingService,
    private readonly desafios: EngagementChallengesService,
  ) {}

  async montar(ctx: StudentChannelContext, agora: Date): Promise<RespostaDoEngajamento> {
    const unidade = await this.unidadeDoAluno(ctx);
    const contexto = tenantContextDoAluno(ctx);
    const mes = mesLocal(agora, unidade.timezone);
    const hoje = dataLocalIso(agora, unidade.timezone);

    const configuracao = await this.engajamento.obterConfiguracao(ctx.tenantId);

    // Sincronizar ANTES de ler, como o totem: sem isto o app mostraria o
    // saldo de antes do treino de hoje ate a sincronizacao de fundo rodar.
    await this.xp.sincronizarXp(contexto, ctx.studentId, agora);

    const [extrato, consistencia, ranking, desafios] = await Promise.all([
      this.xp.obterExtratoCompleto(contexto, ctx.studentId, mes),
      this.xp.obterConsistencia(contexto, ctx.studentId, hoje, unidade.timezone),
      configuracao.rankingEnabled ? this.montarRanking(ctx, unidade.gymUnitId, mes, agora) : null,
      configuracao.challengesEnabled
        ? this.desafios.paraOAluno(contexto, ctx.studentId, unidade.gymUnitId, hoje)
        : null,
    ]);

    return {
      asOf: agora.toISOString(),
      status: 'AVAILABLE',
      mes,
      unidade: { nome: unidade.nome },
      xp: {
        saldoDoMes: extrato.saldoDoMes,
        // `motivo` da reversao fica de fora: e texto livre escrito pela
        // secretaria, e a tela do app so sinaliza que a conquista caiu.
        conquistas: configuracao.achievementsEnabled
          ? extrato.conquistas.map((conquista) => ({
              titulo: conquista.titulo,
              desbloqueadaEm: conquista.desbloqueadaEm.toISOString(),
              revertida: conquista.revertida,
            }))
          : null,
      },
      // `semanas` e `politica` sao do totem, que desenha a grade; o app so
      // mostra os tres numeros.
      consistencia: {
        atual: consistencia.atual,
        recorde: consistencia.recorde,
        diasPorSemana: consistencia.diasPorSemana,
      },
      ranking,
      desafios:
        desafios === null
          ? null
          : desafios.map((desafio) => ({
              id: desafio.id,
              titulo: desafio.title,
              meta: desafio.meta,
              progresso: desafio.progresso,
              inscrito: desafio.inscrito,
              inicio: desafio.startsOn,
              fim: desafio.endsOn,
            })),
    };
  }

  /**
   * Liga ou desliga a participacao no ranking -- mesma chamada do totem
   * (`KioskEngajamentoService.atualizarPreferencia`).
   *
   * `actorId` nulo e o que `tenantContextDoAluno` monta: quem decide e o
   * proprio aluno, nao um usuario do painel, e `consent_records.actor_id` e
   * anulavel exatamente para isto.
   */
  async atualizarRanking(
    ctx: StudentChannelContext,
    participa: boolean,
    idempotencyKey: string | undefined,
    agora: Date,
  ): Promise<PreferenciaDeRankingDoApp> {
    const preferencias = await this.engajamento.atualizarPreferencia(
      tenantContextDoAluno(ctx),
      { studentId: ctx.studentId, finalidade: 'RANKING', participa, idempotencyKey },
      agora,
    );

    return { participa: preferencias.finalidades.RANKING, nomeExibido: preferencias.nomeExibido };
  }

  private async montarRanking(
    ctx: StudentChannelContext,
    gymUnitId: string,
    mes: string,
    agora: Date,
  ): Promise<RankingDoApp> {
    const contexto = tenantContextDoAluno(ctx);

    const [preferencias, minha, placar] = await Promise.all([
      this.engajamento.obterPreferencias(contexto, ctx.studentId),
      // AO VIVO, como o totem: o mes corrente nunca tem snapshot publicado
      // (Emenda de 27/08/2026, ADR-047).
      this.ranking.posicaoAoVivoDoAluno(contexto, gymUnitId, mes, ctx.studentId),
      this.ranking.placarAoVivo(contexto, gymUnitId, mes, agora),
    ]);

    return {
      participa: preferencias.finalidades.RANKING,
      nomeExibido: preferencias.nomeExibido,
      minhaPosicao: minha === null ? null : { posicao: minha.position, pontos: minha.points },
      placar: placar.slice(0, LINHAS_DO_PLACAR).map((linha) => ({
        posicao: linha.position,
        nome: linha.nomeExibido,
        pontos: linha.points,
        /*
         * O placar publico NAO carrega `studentId` (M5-AC-001), e nao vai
         * passar a carregar so para o app achar a propria linha: o mesmo
         * formato atravessa o heartbeat do totem, na tela da recepcao.
         *
         * Casa pelos TRES campos que `posicaoAoVivoDoAluno` devolve. Posicao
         * sozinha nao basta -- empate divide posicao --, e nome sozinho
         * tambem nao, porque "Ana" se repete. `minha === null` (opt-out,
         * coorte abaixo do minimo) nunca marca linha nenhuma.
         */
        souEu:
          minha !== null &&
          linha.position === minha.position &&
          linha.nomeExibido === minha.nomeExibido &&
          linha.points === minha.points,
      })),
    };
  }

  /**
   * Unidade de matricula do aluno da SESSAO, com nome e fuso.
   *
   * `comTenant` e nao `db.student` direto -- ADR-054 §3: `students` tem RLS
   * com FORCE, e fora de transacao com contexto o Postgres devolve zero
   * linhas calado (ver `mobile-home.service.ts`). A raiz aqui E a tabela com
   * politica; `gymUnit` vem aninhado e nao tem politica, entao nao cai no
   * caso do include que volta nulo.
   */
  private async unidadeDoAluno(
    ctx: StudentChannelContext,
  ): Promise<{ gymUnitId: string; nome: string; timezone: string }> {
    const aluno = await this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id: ctx.studentId, tenantId: ctx.tenantId },
        select: { gymUnitId: true, gymUnit: { select: { name: true, timezone: true } } },
      }),
    );

    if (!aluno) throw new AlunoDaSessaoNaoEncontradoError();

    return { gymUnitId: aluno.gymUnitId, nome: aluno.gymUnit.name, timezone: aluno.gymUnit.timezone };
  }
}
