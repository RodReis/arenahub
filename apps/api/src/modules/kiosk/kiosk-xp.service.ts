import { Injectable } from '@nestjs/common';

import { EngagementXpService, type ExtratoCompletoDeXp } from '../engagement/engagement-xp.service.js';
import { EngagementRankingService } from '../engagement/engagement-ranking.service.js';
import { mesLocal } from '../engagement/domain/movimento-de-xp.js';
import type { AlunoDaSessao } from './kiosk-area-do-aluno.service.js';

/** O extrato de XP como o totem o mostra -- so o aluno daquela sessao. */
export interface ExtratoDeXpDoTotem extends ExtratoCompletoDeXp {
  posicao: number | null;
}

/**
 * Fuso da UNIDADE nao chega ate `ContextoDoKiosk`/`AlunoDaSessao` -- so
 * `tenantId`/`gymUnitId`. Mesma funcao `mesLocal` que o ledger usa
 * (`domain/movimento-de-xp.ts`), com o fuso padrao do produto: toda unidade
 * semeada nesta base usa `America/Sao_Paulo` (ver fixtures de integracao).
 * Se um dia houver unidade em outro fuso, este e o unico ponto a ajustar --
 * ler o fuso real exigiria uma consulta a mais só para nomear o mes.
 */
const FUSO_PADRAO_DO_MES = 'America/Sao_Paulo';

/**
 * XP e posicao do aluno no totem (F31, Task 9).
 *
 * REUSA `EngagementXpService` e `EngagementRankingService` (regra de
 * arquitetura no 9): nenhuma leitura direta de `XpLedgerEntry`,
 * `StudentAchievement` nem `RankingSnapshot` aqui -- `aluno.contexto` ja e o
 * `TenantContext` que os dois services publicos exigem, montado por
 * `KioskAreaDoAlunoService.resolver()` com `modulo: 'xp'`.
 *
 * Espelha `KioskEngajamentoService`: um metodo por operacao, sem logica de
 * dominio propria -- so traduz `AlunoDaSessao` para a chamada certa.
 */
@Injectable()
export class KioskXpService {
  constructor(
    private readonly xp: EngagementXpService,
    private readonly ranking: EngagementRankingService,
  ) {}

  /**
   * Sincroniza o XP do aluno com as sessoes de treino pendentes e devolve o
   * extrato do mes: saldo, movimentos explicaveis, conquistas (com
   * revertidas) e a posicao no placar publicado.
   *
   * Sincronizar ANTES de ler garante que o totem sempre mostra o saldo
   * atualizado, mesmo que a sincronizacao periodica de fundo ainda nao
   * tenha rodado para este aluno.
   */
  async obterExtrato(aluno: AlunoDaSessao, agora: Date): Promise<ExtratoDeXpDoTotem> {
    const mes = mesLocal(agora, FUSO_PADRAO_DO_MES);

    await this.xp.sincronizarXp(aluno.contexto, aluno.studentId, agora);

    const [extrato, entradaDoPlacar] = await Promise.all([
      this.xp.obterExtratoCompleto(aluno.contexto, aluno.studentId, mes),
      // AO VIVO, nao publicado -- Emenda de 27/08/2026 (ADR-047): o mes
      // corrente nunca tem snapshot, so o job mensal fecha o mes anterior.
      this.ranking.posicaoAoVivoDoAluno(aluno.contexto, gymUnitIdDoAluno(aluno), mes, aluno.studentId),
    ]);

    return { ...extrato, posicao: entradaDoPlacar?.position ?? null };
  }
}

/**
 * A unidade do proprio aluno -- `KioskAreaDoAlunoService.resolver()` monta
 * `allowedUnitIds` sempre como UM elemento so, a unidade do dispositivo
 * (nunca `'ALL'`, o totem e fisico e pertence a uma recepcao so).
 */
function gymUnitIdDoAluno(aluno: AlunoDaSessao): string {
  const unidades = aluno.contexto.allowedUnitIds;

  if (unidades === 'ALL' || unidades.size !== 1) {
    throw new Error('Sessao de totem sem unidade unica -- contrato de KioskAreaDoAlunoService quebrado.');
  }

  return [...unidades][0] as string;
}
