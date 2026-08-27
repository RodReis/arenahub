import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { GatilhoDeXp, VersaoDeRegra } from './domain/regra-de-xp.js';
import { somarSaldo } from './domain/movimento-de-xp.js';
import type { DefinicaoDeConquista } from './domain/conquista.js';
import type {
  ConquistaDoExtratoDeXp,
  ConquistaParaGravar,
  EntradaDeGravacao,
  MovimentoDoExtratoDeXp,
  MovimentoDoLedger,
  PortaDeXp,
  SessaoPontuavel,
} from './engagement-xp.repository.js';

/** Entrada de configuracao de `comRegra` -- so os campos que o teste varia. */
export interface RegraDeTeste {
  points: number;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
}

/** Entrada de configuracao de `comDefinicoes`. */
export interface DefinicaoDeTeste {
  id: string;
  code: string;
  version: number;
  title: string;
  criterionKind: 'SESSOES_ACUMULADAS';
  threshold: number;
}

/** Linha do ledger guardada em memoria. */
interface LinhaDoLedger {
  id: string;
  studentId: string;
  points: number;
  localMonth: string;
  type: 'GRANT' | 'ADJUSTMENT' | 'REVERSAL';
  sourceKind: 'ATTENDANCE_SESSION' | 'MANUAL_ADJUSTMENT';
  sourceId: string;
  reversesEntryId: string | null;
  ruleVersionId: string;
  occurredAt: Date;
  reason: string | null;
}

/** Conquista desbloqueada, guardada em memoria -- para o EXTRATO (Task 9). */
interface ConquistaDesbloqueada {
  studentId: string;
  definitionVersionId: string;
  unlockedAt: Date;
  revertida: boolean;
  motivo: string | null;
}

/**
 * Dublê de `PortaDeXp` em memoria.
 *
 * Instancia NOVA por teste (`new FakePortaDeXp()` num `beforeEach`) --
 * instancia compartilhada vaza estado entre casos (memoria
 * duble-com-estado-vaza-entre-testes).
 *
 * `comOptOut` existe so para o teste que prende `M5-BR-002`: o dublê aceita
 * a chamada, mas NADA aqui consulta esse estado -- e o proprio ponto que o
 * teste prova, que o servico de XP nao amarra concessao a opt-out de
 * ranking.
 */
export class FakePortaDeXp implements PortaDeXp {
  private readonly regras: VersaoDeRegra[] = [];
  private readonly sessoes: SessaoPontuavel[] = [];
  private readonly definicoes: DefinicaoDeConquista[] = [];
  private readonly ledger: LinhaDoLedger[] = [];
  private readonly conquistasDesbloqueadas = new Set<string>();
  private readonly conquistasPorAluno: ConquistaDesbloqueada[] = [];
  private readonly optOuts = new Set<string>();
  private colidirNaEscrita = false;
  private proximoId = 1;

  comRegra(entrada: RegraDeTeste): void {
    this.regras.push({
      id: `regra-${this.proximoId++}`,
      code: 'treino-diario',
      version: this.regras.length + 1,
      trigger: 'SESSAO_CONFIRMADA',
      points: entrada.points,
      effectiveFrom: entrada.effectiveFrom ?? new Date('2000-01-01T00:00:00Z'),
      effectiveTo: entrada.effectiveTo ?? null,
    });
  }

  comSessoes(sessoes: readonly SessaoPontuavel[]): void {
    this.sessoes.push(...sessoes);
  }

  comDefinicoes(definicoes: readonly DefinicaoDeTeste[]): void {
    this.definicoes.push(...definicoes);
  }

  /** So do dublê: marca o aluno como opt-out de ranking -- ver o comentario da classe. */
  comOptOut(studentId: string): void {
    this.optOuts.add(studentId);
  }

  /** So do dublê: a proxima escrita no ledger colide (P2002 simulado). */
  colidirNaProximaEscrita(): void {
    this.colidirNaEscrita = true;
  }

  /**
   * So do dublê: estorna a `GRANT` da sessao `sourceId`, gravando um
   * `REVERSAL` que aponta para ela via `reversesEntryId` -- a `GRANT`
   * original PERMANECE no ledger (append-only), e e o `REVERSAL` que a
   * anula na contagem liquida.
   */
  reverterSessao(sourceId: string): void {
    const original = this.ledger.find(
      (linha) =>
        linha.sourceId === sourceId &&
        linha.sourceKind === 'ATTENDANCE_SESSION' &&
        linha.type === 'GRANT',
    );
    if (!original) throw new Error(`Nenhuma GRANT encontrada para a sessao ${sourceId}`);

    this.ledger.push({
      id: `mov-${this.proximoId++}`,
      studentId: original.studentId,
      points: -original.points,
      localMonth: original.localMonth,
      type: 'REVERSAL',
      sourceKind: original.sourceKind,
      sourceId: original.sourceId,
      reversesEntryId: original.id,
      ruleVersionId: original.ruleVersionId,
      occurredAt: original.occurredAt,
      reason: 'sessao estornada',
    });
  }

  /** So do dublê: marca a conquista `definitionVersionId` do aluno como REVERTIDA, com motivo. */
  reverterConquista(studentId: string, definitionVersionId: string, motivo = 'estorno de teste'): void {
    const conquista = this.conquistasPorAluno.find(
      (item) => item.studentId === studentId && item.definitionVersionId === definitionVersionId,
    );
    if (!conquista) throw new Error(`Conquista ${definitionVersionId} nao desbloqueada para ${studentId}`);

    conquista.revertida = true;
    conquista.motivo = motivo;
  }

  regrasDoTenant(_contexto: TenantContext, gatilho: GatilhoDeXp): Promise<VersaoDeRegra[]> {
    return Promise.resolve(this.regras.filter((regra) => regra.trigger === gatilho));
  }

  sessoesSemMovimento(_contexto: TenantContext, _studentId: string): Promise<SessaoPontuavel[]> {
    const pontuadas = new Set(
      this.ledger
        .filter((linha) => linha.sourceKind === 'ATTENDANCE_SESSION' && linha.type === 'GRANT')
        .map((linha) => linha.sourceId),
    );

    return Promise.resolve(this.sessoes.filter((sessao) => !pontuadas.has(sessao.id)));
  }

  gravarConcessao(_contexto: TenantContext, entrada: EntradaDeGravacao): Promise<void> {
    if (this.colidirNaEscrita) {
      this.colidirNaEscrita = false;
      const erroColisao = new Error('Unique constraint failed') as Error & { code: string };
      erroColisao.code = 'P2002';
      return Promise.reject(erroColisao);
    }

    const movimento = entrada.movimento;
    this.ledger.push({
      id: `mov-${this.proximoId++}`,
      studentId: entrada.studentId,
      points: movimento.points,
      localMonth: movimento.localMonth,
      type: movimento.type,
      sourceKind: movimento.sourceKind,
      sourceId: movimento.sourceId,
      reversesEntryId: movimento.reversesEntryId,
      ruleVersionId: movimento.ruleVersionId,
      occurredAt: movimento.occurredAt,
      reason: movimento.reason,
    });

    return Promise.resolve();
  }

  recalcularSaldo(_contexto: TenantContext, _studentId: string): Promise<void> {
    // No fake, `saldoDoAluno` le direto do ledger em memoria -- nao ha
    // projecao separada para recalcular.
    return Promise.resolve();
  }

  definicoesDeConquista(_contexto: TenantContext): Promise<DefinicaoDeConquista[]> {
    return Promise.resolve([...this.definicoes]);
  }

  conquistasDoAluno(_contexto: TenantContext, _studentId: string): Promise<ReadonlySet<string>> {
    return Promise.resolve(new Set(this.conquistasDesbloqueadas));
  }

  gravarConquistas(_contexto: TenantContext, conquistas: readonly ConquistaParaGravar[]): Promise<void> {
    for (const conquista of conquistas) {
      this.conquistasDesbloqueadas.add(conquista.definitionVersionId);
      this.conquistasPorAluno.push({
        studentId: conquista.studentId,
        definitionVersionId: conquista.definitionVersionId,
        unlockedAt: conquista.unlockedAt,
        revertida: false,
        motivo: null,
      });
    }

    return Promise.resolve();
  }

  saldoDoAluno(_contexto: TenantContext, studentId: string, localMonth: string): Promise<number> {
    const doMes = this.ledger.filter(
      (linha) => linha.studentId === studentId && linha.localMonth === localMonth,
    );

    return Promise.resolve(somarSaldo(doMes));
  }

  movimentosDoAluno(_contexto: TenantContext, studentId: string): Promise<MovimentoDoLedger[]> {
    return Promise.resolve(
      this.ledger
        .filter((linha) => linha.studentId === studentId)
        .map((linha) => ({
          id: linha.id,
          points: linha.points,
          localMonth: linha.localMonth,
          type: linha.type,
          sourceKind: linha.sourceKind,
          sourceId: linha.sourceId,
          reversesEntryId: linha.reversesEntryId,
        })),
    );
  }

  /** `regra` = code da versao de regra para GRANT; `reason` para ADJUSTMENT/REVERSAL. */
  movimentosDoExtrato(_contexto: TenantContext, studentId: string): Promise<MovimentoDoExtratoDeXp[]> {
    return Promise.resolve(
      this.ledger
        .filter((linha) => linha.studentId === studentId)
        .map((linha) => ({
          pontos: linha.points,
          regra: linha.reason ?? this.regras.find((r) => r.id === linha.ruleVersionId)?.code ?? '',
          quando: linha.occurredAt,
        })),
    );
  }

  conquistasDoExtrato(_contexto: TenantContext, studentId: string): Promise<ConquistaDoExtratoDeXp[]> {
    const definicaoPorId = new Map(this.definicoes.map((definicao) => [definicao.id, definicao]));

    return Promise.resolve(
      this.conquistasPorAluno
        .filter((conquista) => conquista.studentId === studentId)
        .map((conquista) => ({
          titulo: definicaoPorId.get(conquista.definitionVersionId)?.title ?? '',
          desbloqueadaEm: conquista.unlockedAt,
          revertida: conquista.revertida,
          motivo: conquista.motivo,
        })),
    );
  }
}
