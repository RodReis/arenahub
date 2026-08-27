import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { resolverRegraVigente } from './domain/regra-de-xp.js';
import { concederPorSessao, mesLocal } from './domain/movimento-de-xp.js';
import { avaliarConquistas } from './domain/conquista.js';
import { PORTA_DE_XP, type PortaDeXp } from './engagement-xp.repository.js';

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

/** Gatilho unico do catalogo v1 -- ver `domain/regra-de-xp.ts`. */
const GATILHO_DE_SESSAO = 'SESSAO_CONFIRMADA';

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
   * `M5-NFR-002`: a projecao e reconstruivel a partir do ledger, sem tocar
   * nele. So repassa para a porta -- `recalcularSaldo` ja faz exatamente
   * isso (Task 6); expor aqui evita que o teste precise conhecer a porta.
   */
  async reconstruirProjecao(contexto: TenantContext, studentId: string): Promise<void> {
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
