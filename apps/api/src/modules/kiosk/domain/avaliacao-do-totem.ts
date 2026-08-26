import type { ComparativoDeTipo } from '../../health/health-progress.service.js';
import { REGIAO_DO_TIPO, type RegiaoCorporal, type TipoDeMedida } from '../../health/domain/medida.js';

/**
 * As SEIS metricas do `DS-TOTEM.md` §5.3, nesta ordem.
 *
 * Lista fechada e explicita: o aluno mede dezenas de tipos, e despejar todos
 * num totem de recepcao seria parede de numero. A ordem e a do documento,
 * nao a ordem em que o aparelho reporta.
 *
 * `HEART_RATE` NAO ESTA AQUI, e nao pode entrar sem ADR: e dado cardiaco,
 * nunca interpretado (ADR-035), e o proprio `BodyEvolutionService` ja o
 * filtra para fora das metricas.
 */
export const METRICAS_DO_TOTEM: readonly TipoDeMedida[] = [
  'WEIGHT',
  'BODY_FAT_PERCENT',
  'SKELETAL_MUSCLE_MASS',
  'TOTAL_BODY_WATER',
  'VISCERAL_FAT_LEVEL',
  'BASAL_METABOLIC_RATE',
];

export interface MetricaDoTotem {
  readonly tipo: TipoDeMedida;
  readonly valor: number | null;
  readonly unidade: string | null;
  /** Delta contra a medicao ANTERIOR. `null` quando nao ha com o que comparar. */
  readonly deltaAbsoluto: number | null;
  /**
   * Por que o delta esta ausente -- `SEM_BASELINE` e "primeira medicao", que
   * e diferente de "nao mudou". Zero aqui leria como se o aluno tivesse
   * medido duas vezes o mesmo numero.
   */
  readonly razaoDaAusencia: string | null;
}

/** Uma das TRES linhas do §5.3: braços, tronco, pernas. */
export interface SegmentoDoTotem {
  readonly segmento: 'ARMS' | 'TRUNK' | 'LEGS';
  readonly gorduraKg: number | null;
  readonly musculoKg: number | null;
}

/** O minimo que `agruparSegmentos` le de uma medida. */
export interface MedidaCrua {
  readonly type: string;
  readonly canonicalValue: unknown;
}

/**
 * As seis metricas com o delta contra a anterior.
 *
 * PURA. `assessmentId` opcional escolhe o ponto da serie: sem ele, o ponto
 * ATUAL (a tela do §5.3); com ele, o valor daquela avaliacao especifica (uma
 * linha do §5.5).
 *
 * Tipo nao medido NAO some da lista: vem com `valor: null`. Some-lo faria a
 * grade de seis cards mudar de tamanho conforme o aparelho, e "nao medimos
 * isso" viraria indistinguivel de "esta metrica nao existe".
 */
export function resumirMetricas(
  tipos: readonly ComparativoDeTipo[],
  quais: readonly TipoDeMedida[],
  assessmentId?: string,
): readonly MetricaDoTotem[] {
  const porTipo = new Map(tipos.map((t) => [t.type, t]));

  return quais.map((tipo) => {
    const achado = porTipo.get(tipo);

    if (!achado) {
      return { tipo, valor: null, unidade: null, deltaAbsoluto: null, razaoDaAusencia: null };
    }

    const ponto =
      assessmentId === undefined
        ? achado.comparativo.atual
        : (achado.comparativo.pontos.find((p) => p.id === assessmentId) ?? null);

    /*
     * O DELTA SO VALE PARA O PONTO ATUAL. `desdeAAnterior` compara os dois
     * ultimos pontos da serie; devolve-lo ao lado do valor de uma avaliacao
     * antiga (§5.5) casaria o numero de marco com a variacao de agosto.
     */
    const delta = assessmentId === undefined ? achado.comparativo.desdeAAnterior : null;

    return {
      tipo,
      valor: ponto?.valor ?? null,
      unidade: achado.unidade,
      deltaAbsoluto: delta?.absoluta ?? null,
      razaoDaAusencia: delta?.razao ?? null,
    };
  });
}

const SEGMENTO_DA_REGIAO: Readonly<Record<RegiaoCorporal, SegmentoDoTotem['segmento']>> = {
  ARM_LEFT: 'ARMS',
  ARM_RIGHT: 'ARMS',
  TRUNK: 'TRUNK',
  LEG_LEFT: 'LEGS',
  LEG_RIGHT: 'LEGS',
};

const ORDEM: readonly SegmentoDoTotem['segmento'][] = ['ARMS', 'TRUNK', 'LEGS'];

/**
 * As CINCO regioes da API viram as TRES linhas do §5.3.
 *
 * Braco esquerdo + direito somam em "Braços"; pernas idem. O documento
 * desenha tres linhas, a API entrega cinco regioes (INV-104, sempre as
 * cinco), e a soma acontece AQUI -- num lugar so, testavel, e nao dentro do
 * JSX de duas telas diferentes.
 *
 * AUSENCIA NAO VIRA ZERO. Se nenhum lado do par foi medido, o valor e
 * `null`: zero desenharia uma barra vazia que le como "nao ha gordura ali",
 * que e afirmacao clinica que ninguem fez. Um lado medido e o outro nao
 * soma o que existe -- meia informacao e melhor que nenhuma, e o par de
 * membros e simetrico o bastante para isso nao enganar.
 */
export function agruparSegmentos(medidas: readonly MedidaCrua[]): readonly SegmentoDoTotem[] {
  const gordura = new Map<SegmentoDoTotem['segmento'], number>();
  const musculo = new Map<SegmentoDoTotem['segmento'], number>();

  for (const medida of medidas) {
    const regiao = REGIAO_DO_TIPO[medida.type as TipoDeMedida];

    if (!regiao) continue;

    const valor = Number(medida.canonicalValue);

    if (!Number.isFinite(valor)) continue;

    const segmento = SEGMENTO_DA_REGIAO[regiao];
    const alvo = medida.type.startsWith('SEGMENTAL_FAT_MASS') ? gordura : musculo;

    alvo.set(segmento, (alvo.get(segmento) ?? 0) + valor);
  }

  return ORDEM.map((segmento) => ({
    segmento,
    gorduraKg: gordura.get(segmento) ?? null,
    musculoKg: musculo.get(segmento) ?? null,
  }));
}
