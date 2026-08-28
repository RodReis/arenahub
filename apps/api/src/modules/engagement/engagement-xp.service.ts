import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { resolverRegraVigente } from './domain/regra-de-xp.js';
import { ajustar, concederPorSessao, mesLocal } from './domain/movimento-de-xp.js';
import { avaliarConquistas } from './domain/conquista.js';
import {
  POLITICA_DE_STREAK,
  avaliarSemanas,
  resumirStreak,
  type SemanaAvaliada,
} from './domain/semana-de-consistencia.js';
import {
  PORTA_DE_XP,
  type ConquistaDoExtratoDeXp,
  type MovimentoDoExtratoDeXp,
  type PortaDeXp,
} from './engagement-xp.repository.js';

/** O que `sincronizarXp` devolve -- consumido pela Task 9 (kiosk) direto. */
export interface ResumoDeXp {
  concedidos: number;
  saldoDoMes: number;
  conquistasNovas: readonly string[];
}

/** Extrato de um mes -- leitura pura, sem gravar nada. */
export interface ExtratoDeXp {
  localMonth: string;
  saldo: number;
}

/**
 * Extrato COMPLETO do aluno (F31, Task 9) -- saldo do mes, movimentos
 * explicaveis (`M5-FR-004`, §13 do PRD) e conquistas, incluindo as
 * revertidas (`M5-FR-007`).
 */
export interface ExtratoCompletoDeXp {
  saldoDoMes: number;
  mes: string;
  movimentos: readonly MovimentoDoExtratoDeXp[];
  conquistas: readonly ConquistaDoExtratoDeXp[];
}

/**
 * Consistencia semanal do aluno (F32) -- o que a tela do totem mostra.
 *
 * `semanas` vem da mais recente para a mais antiga: a tela le de cima para
 * baixo e a semana corrente e a que importa primeiro.
 */
export interface Consistencia {
  readonly atual: number;
  readonly recorde: number;
  /** A meta da politica vigente -- a tela nunca a repete por conta propria. */
  readonly diasPorSemana: number;
  readonly politica: string;
  readonly semanas: readonly SemanaAvaliada[];
}

/** Gatilho unico do catalogo v1 -- ver `domain/regra-de-xp.ts`. */
const GATILHO_DE_SESSAO = 'SESSAO_CONFIRMADA';

/**
 * Quantas semanas a tela recebe -- tres meses.
 *
 * Corta a EXIBICAO, nunca o calculo: `atual` e `recorde` saem da serie
 * inteira, antes deste corte. Cortar a serie antes de resumir romperia o
 * streak de quem tem historico mais longo que a janela.
 */
const SEMANAS_EXIBIDAS = 12;

/*
 * Checagem duck-typed, nao `instanceof Prisma.PrismaClientKnownRequestError`:
 * o repositorio Prisma real lanca a classe do driver, mas o dublê em memoria
 * simula a colisao com um `Error` comum + `.code`, no mesmo padrao ja usado
 * em `billing/*.use-case.ts` (`erro.code === 'P2002'`). Exigir a classe
 * concreta aqui obrigaria o dublê a importar `@arenahub/database` so para
 * fabricar um erro que ele nunca teve motivo de conhecer.
 */
function ehColisaoDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}

/**
 * Concede XP por sessao de treino e avalia conquistas, de forma idempotente.
 *
 * NAO chama `resolverExposicao` nem `participaDoRanking` de proposito:
 * `M5-BR-002` diz que recusar o ranking nao reduz XP. Um aluno em opt-out
 * acumula XP, ve o saldo dele e desbloqueia conquistas -- so nao aparece no
 * placar, e isso e problema da Task 8 (ranking), nunca desta.
 */
@Injectable()
export class EngagementXpService {
  constructor(@Inject(PORTA_DE_XP) private readonly porta: PortaDeXp) {}

  async sincronizarXp(
    contexto: TenantContext,
    studentId: string,
    agora: Date,
  ): Promise<ResumoDeXp> {
    const [regras, sessoes] = await Promise.all([
      this.porta.regrasDoTenant(contexto, GATILHO_DE_SESSAO),
      this.porta.sessoesSemMovimento(contexto, studentId),
    ]);

    let concedidos = 0;

    /*
     * Uma transacao por sessao, e nao uma por sincronizacao inteira: se a
     * quinta sessao colidir, as quatro primeiras ja estao gravadas e nao
     * precisam ser refeitas. Transacao longa aqui tambem seguraria linha de
     * `xp_ledger_entries` durante a leitura da tela.
     */
    for (const sessao of sessoes) {
      const regra = resolverRegraVigente(regras, GATILHO_DE_SESSAO, sessao.occurredAt);
      if (!regra) continue;

      const movimento = concederPorSessao({
        regra,
        sessionId: sessao.id,
        occurredAt: sessao.occurredAt,
        fusoDaUnidade: sessao.fusoDaUnidade,
      });

      try {
        await this.porta.gravarConcessao(contexto, {
          studentId,
          movimento,
          /* O evento vai na MESMA transacao da mudanca de estado -- regra de
           * arquitetura 5. Publicar antes de commitar e o defeito que o
           * outbox existe para impedir. */
          evento: { eventType: 'XPGranted', aggregateType: 'XpLedgerEntry' },
        });
        concedidos += 1;
      } catch (erro) {
        /*
         * P2002 e SUCESSO: outra requisicao ja gravou este mesmo fato.
         * Deixar o erro subir transformaria duas abas abertas no totem num
         * 500 na cara do aluno -- a idempotencia que a chave unica garante
         * existe justamente para que isso nao seja um problema.
         */
        if (!ehColisaoDeUnicidade(erro)) throw erro;
      }
    }

    await this.porta.recalcularSaldo(contexto, studentId);

    const conquistasNovas = await this.avaliarEGravarConquistas(contexto, studentId);

    const mesDeReferencia = mesLocal(agora, sessoes[sessoes.length - 1]?.fusoDaUnidade ?? 'UTC');
    const saldoDoMes = await this.porta.saldoDoAluno(contexto, studentId, mesDeReferencia);

    return { concedidos, saldoDoMes, conquistasNovas };
  }

  async obterExtrato(contexto: TenantContext, studentId: string, mes: string): Promise<ExtratoDeXp> {
    const saldo = await this.porta.saldoDoAluno(contexto, studentId, mes);
    return { localMonth: mes, saldo };
  }

  /**
   * O extrato COMPLETO que o totem mostra (Task 9): saldo, movimentos
   * explicaveis e conquistas -- incluindo a REVERTIDA, que `M5-FR-007`
   * exige continuar visivel, com o motivo anexado.
   *
   * Nao sincroniza XP antes de ler -- quem decide QUANDO sincronizar e o
   * chamador (`KioskXpService`), porque sincronizar e uma escrita e este
   * metodo e leitura pura.
   */
  async obterExtratoCompleto(
    contexto: TenantContext,
    studentId: string,
    mes: string,
  ): Promise<ExtratoCompletoDeXp> {
    const [saldoDoMes, movimentos, conquistas] = await Promise.all([
      this.porta.saldoDoAluno(contexto, studentId, mes),
      this.porta.movimentosDoExtrato(contexto, studentId),
      this.porta.conquistasDoExtrato(contexto, studentId),
    ]);

    return { saldoDoMes, mes, movimentos, conquistas };
  }

  /**
   * Consistencia semanal do aluno (F32, Slice 5.3).
   *
   * LEITURA PURA, derivada -- nao ha tabela de streak. `StudentAttendanceSession`
   * (F24) ja e a projecao de dias treinados deduplicada por dia local, e o
   * streak e uma funcao dela: materializar numa segunda tabela criaria uma
   * fonte de verdade paralela que pode divergir, do mesmo jeito que a F31
   * resolveu o placar do mes corrente ao vivo em vez de snapshot.
   *
   * Devolve as semanas mais recentes primeiro para a tela, e o resumo
   * (`atual`/`recorde`) calculado sobre a serie INTEIRA -- cortar a serie
   * antes de resumir romperia o streak de quem tem historico mais longo que a
   * janela exibida (memoria corte-de-periodo-parte-cadeia).
   */
  async obterConsistencia(
    contexto: TenantContext,
    studentId: string,
    hojeLocal: string,
    fusoDaUnidade: string,
  ): Promise<Consistencia> {
    const [dias, pausas] = await Promise.all([
      this.porta.diasTreinados(contexto, studentId),
      this.porta.pausasAprovadas(contexto, studentId, fusoDaUnidade),
    ]);

    const semanas = avaliarSemanas(
      dias.map((dataLocal) => ({ dataLocal })),
      pausas,
      POLITICA_DE_STREAK,
      hojeLocal,
    );

    const resumo = resumirStreak(semanas);

    return {
      ...resumo,
      diasPorSemana: POLITICA_DE_STREAK.diasPorSemana,
      politica: POLITICA_DE_STREAK.versao,
      semanas: [...semanas].reverse().slice(0, SEMANAS_EXIBIDAS),
    };
  }

  /**
   * `M5-NFR-002`: a projecao e reconstruivel a partir do ledger, sem tocar
   * nele. So repassa para a porta -- `recalcularSaldo` ja faz exatamente
   * isso (Task 6); expor aqui evita que o teste precise conhecer a porta.
   */
  async reconstruirProjecao(contexto: TenantContext, studentId: string): Promise<void> {
    await this.porta.recalcularSaldo(contexto, studentId);
  }

  /**
   * Ajuste manual de XP pelo painel (F31, Task 11) -- `M5-FR-007`/`M5-AC-010`.
   *
   * NAO HA EDICAO: isto sempre GRAVA um movimento `ADJUSTMENT` novo, nunca
   * altera um existente (o ledger e append-only por trigger no banco).
   *
   * `idempotencyKey` vira o `sourceId` do movimento -- a chave unica do
   * ledger e quem impede duplicar, entao P2002 aqui e SUCESSO idempotente,
   * no mesmo padrao de `sincronizarXp`: reenviar o mesmo ajuste (rede
   * instavel, duplo clique) devolve o resultado ja gravado, nao um erro.
   */
  async ajustarXp(
    contexto: TenantContext,
    studentId: string,
    entrada: { pontos: number; motivo: string; idempotencyKey: string },
    agora: Date,
  ): Promise<void> {
    const unidade = await this.porta.unidadeDoAluno(contexto, studentId);

    // Mesmo erro para "nao existe" e "existe, mas e de outra unidade"
    // (padrao de `ManualOverrideUseCase`/`GYM_UNIT_NOT_FOUND`): um gerente
    // restrito a unidade A nao pode ajustar XP de aluno da unidade B, e a
    // resposta nao pode denunciar QUAL dos dois motivos foi.
    if (
      unidade === null ||
      (contexto.allowedUnitIds !== 'ALL' && !contexto.allowedUnitIds.has(unidade.gymUnitId))
    ) {
      throw new NotFoundException({ code: 'ALUNO_NAO_ENCONTRADO', message: 'Aluno nao encontrado' });
    }

    const fusoDaUnidade = unidade.timezone;

    const regra = await this.porta.qualquerVersaoDeRegra(contexto);
    if (regra === null) {
      throw new NotFoundException({
        code: 'CATALOGO_DE_XP_VAZIO',
        message: 'Tenant sem nenhuma versao de regra de XP semeada',
      });
    }

    const movimento = ajustar({
      pontos: entrada.pontos,
      motivo: entrada.motivo,
      idempotencyKey: entrada.idempotencyKey,
      ruleVersionId: regra.id,
      agora,
      fusoDaUnidade,
    });

    try {
      await this.porta.gravarConcessao(contexto, {
        studentId,
        movimento,
        evento: { eventType: 'XPAdjusted', aggregateType: 'XpLedgerEntry' },
      });
    } catch (erro) {
      if (!ehColisaoDeUnicidade(erro)) throw erro;
    }

    await this.porta.recalcularSaldo(contexto, studentId);
  }

  /** Avalia conquistas contra a evidencia do ledger e grava as novas. */
  private async avaliarEGravarConquistas(
    contexto: TenantContext,
    studentId: string,
  ): Promise<readonly string[]> {
    const [definicoes, jaDesbloqueadas, movimentos] = await Promise.all([
      this.porta.definicoesDeConquista(contexto),
      this.porta.conquistasDoAluno(contexto, studentId),
      this.porta.movimentosDoAluno(contexto, studentId),
    ]);

    // Evidencia = GRANT por sessao de treino -- ADJUSTMENT nao conta como
    // sessao, e misturar os dois infla a contagem que a conquista
    // `SESSOES_ACUMULADAS` promete.
    const grantsDeSessao = movimentos.filter(
      (movimento) => movimento.type === 'GRANT' && movimento.sourceKind === 'ATTENDANCE_SESSION',
    );

    /*
     * O ledger e APPEND-ONLY: estornar uma sessao GRAVA um REVERSAL, nao
     * apaga a GRANT original. Contar toda GRANT historica (bruta) manteria
     * uma sessao corrigida valendo para sempre -- `M5-FR-006` exige
     * conquista a partir de fato VERIFICADO, e o fato deixou de valer no
     * instante em que o REVERSAL foi gravado. A contagem LIQUIDA e por isso
     * "GRANT cujo sourceId nao tem REVERSAL apontando de volta para ela via
     * reversesEntryId" -- nunca "todo GRANT que ja existiu".
     */
    const sourceIdsRevertidos = new Set(
      movimentos
        .filter((movimento) => movimento.type === 'REVERSAL' && movimento.reversesEntryId !== null)
        .map((movimento) => {
          const grantOriginal = grantsDeSessao.find((grant) => grant.id === movimento.reversesEntryId);
          return grantOriginal?.sourceId;
        }),
    );

    const sessoesValidas = grantsDeSessao.filter(
      (grant) => !sourceIdsRevertidos.has(grant.sourceId),
    );

    if (sessoesValidas.length === 0) return [];

    const ultimoMovimentoId = sessoesValidas[sessoesValidas.length - 1]?.id;
    if (!ultimoMovimentoId) return [];

    const aDesbloquear = avaliarConquistas(
      definicoes,
      { sessoesAcumuladas: sessoesValidas.length, ultimoMovimentoId },
      jaDesbloqueadas,
    );

    if (aDesbloquear.length === 0) return [];

    await this.porta.gravarConquistas(
      contexto,
      aDesbloquear.map((conquista) => ({
        studentId,
        definitionVersionId: conquista.definicao.id,
        unlockedAt: new Date(),
        evidenceEntryId: conquista.evidenceEntryId,
      })),
    );

    return aDesbloquear.map((conquista) => conquista.definicao.code);
  }
}
