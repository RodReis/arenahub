/**
 * Drift das features do snapshot (F41, Slice 6.6, `M6-FR-018`).
 *
 * PURA: recebe dois resumos ja agregados e compara. Sem banco, sem relogio.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA FATIA CONSEGUE MONITORAR, E O QUE NAO
 * ---------------------------------------------------------------------------
 *
 * A Slice 6.6 foi escrita para um modelo: champion/challenger, drift de score,
 * calibracao por faixa. A F40 nao foi executada (ADR-050) porque o gate de dado
 * nao fecha, entao esses tres nao tem objeto -- score de REGRA nao calibra, e
 * nao ha duas versoes competindo.
 *
 * O que sobrevive, e sobrevive com valor proprio: **drift de FEATURE**. As 13
 * features da F36 sao a entrada de tudo -- da baseline hoje, do modelo um dia.
 * Se `attendance_days_30d` vira ausente em massa porque a catraca parou de
 * sincronizar, a baseline continua pontuando, o score sai baixo (ausencia nao
 * pontua, `M6-BR-002`), e a fila esvazia **sem ninguem perceber**. O sintoma e
 * a ausencia de alarme.
 *
 * ---------------------------------------------------------------------------
 * DUAS FORMAS DE DRIFT, E A PRIMEIRA E A QUE MACHUCA
 * ---------------------------------------------------------------------------
 *
 * `AUSENCIA` -- a feature parou de ser observada. Quase sempre e falha de
 * fonte, e e o caso mais grave porque degrada em silencio.
 *
 * `MEDIA` -- a feature continua chegando, mas o valor tipico mudou. Pode ser
 * mundo real (janeiro na academia nao e junho) ou defeito de calculo. O alarme
 * nao decide qual: ele avisa que alguem precisa olhar.
 */

export type TipoDeDrift = 'AUSENCIA' | 'MEDIA';

export type SeveridadeDeDrift = 'ATENCAO' | 'CRITICO';

/** O resumo de uma feature num periodo, ja agregado pelo repositorio. */
export interface ResumoDeFeature {
  readonly nome: string;
  readonly observados: number;
  readonly ausentes: number;
  /** Media dos valores OBSERVADOS. Ausentes nao entram -- eles nao sao zero. */
  readonly media: number;
}

export interface AchadoDeDrift {
  readonly feature: string;
  readonly tipo: TipoDeDrift;
  readonly severidade: SeveridadeDeDrift;
  /** Variacao relativa, em fracao. `0.6` = subiu 60%. */
  readonly variacao: number;
  readonly antes: number;
  readonly depois: number;
}

export interface LimiaresDeDrift {
  readonly atencao: number;
  readonly critico: number;
}

/**
 * 25% para atencao, 50% para critico.
 *
 * Grosseiros de proposito: sem historico acumulado nao ha como calibrar limiar
 * estatistico, e um teste de hipotese sobre duas amostras de dias adjacentes
 * dispararia com qualquer sazonalidade. Estes numeros pegam o que interessa
 * hoje -- fonte que caiu, calculo que quebrou -- e sao substituiveis quando
 * houver serie longa.
 */
export const LIMIARES_PADRAO: LimiaresDeDrift = { atencao: 0.25, critico: 0.5 };

const ORDEM_DE_SEVERIDADE: Record<SeveridadeDeDrift, number> = { CRITICO: 0, ATENCAO: 1 };

function taxaDeAusencia(resumo: ResumoDeFeature): number {
  const total = resumo.observados + resumo.ausentes;
  return total === 0 ? 0 : resumo.ausentes / total;
}

function severidade(
  variacao: number,
  limiares: LimiaresDeDrift,
): SeveridadeDeDrift | null {
  const absoluta = Math.abs(variacao);
  if (absoluta >= limiares.critico) return 'CRITICO';
  if (absoluta >= limiares.atencao) return 'ATENCAO';
  return null;
}

/**
 * Compara dois periodos e devolve o que mudou demais.
 *
 * Feature que existe em um periodo e nao no outro e IGNORADA: catalogo mudou, e
 * isso e mudanca de contrato, nao drift de dado. Tratar como drift produziria
 * alarme em toda troca de versao de features, e alarme que sempre dispara vira
 * alarme que ninguem le.
 */
export function compararDistribuicoes(
  antes: readonly ResumoDeFeature[],
  depois: readonly ResumoDeFeature[],
  limiares: LimiaresDeDrift = LIMIARES_PADRAO,
): AchadoDeDrift[] {
  const anteriores = new Map(antes.map((resumo) => [resumo.nome, resumo]));
  const achados: AchadoDeDrift[] = [];

  for (const atual of depois) {
    const anterior = anteriores.get(atual.nome);
    if (anterior === undefined) {
      continue;
    }

    // AUSENCIA primeiro: quando a fonte cai, a media dos poucos observados que
    // sobraram tambem muda, e reportar os dois esconderia a causa no meio do
    // efeito.
    const ausenciaAntes = taxaDeAusencia(anterior);
    const ausenciaDepois = taxaDeAusencia(atual);
    const saltoDeAusencia = ausenciaDepois - ausenciaAntes;
    const gravidadeDaAusencia = severidade(saltoDeAusencia, limiares);

    if (gravidadeDaAusencia !== null && saltoDeAusencia > 0) {
      achados.push({
        feature: atual.nome,
        tipo: 'AUSENCIA',
        severidade: gravidadeDaAusencia,
        variacao: saltoDeAusencia,
        antes: ausenciaAntes,
        depois: ausenciaDepois,
      });
      continue;
    }

    // Media anterior zero: a variacao relativa seria infinita. Usa a diferenca
    // absoluta contra o limiar, que e o melhor que se pode dizer sem base.
    const base = Math.abs(anterior.media);
    const variacao =
      base === 0 ? (atual.media === 0 ? 0 : 1) : (atual.media - anterior.media) / base;
    const gravidadeDaMedia = severidade(variacao, limiares);

    if (gravidadeDaMedia !== null) {
      achados.push({
        feature: atual.nome,
        tipo: 'MEDIA',
        severidade: gravidadeDaMedia,
        variacao,
        antes: anterior.media,
        depois: atual.media,
      });
    }
  }

  // Critico primeiro, depois alfabetico: a ordem de leitura da tela nao pode
  // depender da ordem em que o banco devolveu as linhas.
  return achados.sort((a, b) => {
    const porSeveridade = ORDEM_DE_SEVERIDADE[a.severidade] - ORDEM_DE_SEVERIDADE[b.severidade];
    return porSeveridade !== 0 ? porSeveridade : a.feature.localeCompare(b.feature);
  });
}
