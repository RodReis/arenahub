/**
 * Comparativo longitudinal: primeira, anterior, atual e meta (F18).
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). A serie ja filtrada
 * por tenant, aluno e periodo entra por parametro.
 *
 * O aceite da Slice 3.2 e literal -- "os mesmos dados sempre geram o mesmo
 * comparativo, inclusive em unidades e arredondamento". Tres invariantes
 * sustentam isso:
 *
 * - **INV-102** a correcao vinculada SUBSTITUI a original na serie. As duas
 *   continuam publicadas no banco (a original prova que o numero errado
 *   circulou), mas plotar ambas mostraria erro e acerto como se fossem duas
 *   medicoes do aluno;
 * - **INV-104** ausencia NAO E ZERO. Sem baseline, sem meta ou sem a medida
 *   no dia, o resultado e `null` com razao -- nunca `0`, nunca `-100%`;
 * - **INV-106** o calculo devolve a precisao que recebeu. Arredondar aqui
 *   contaminaria a comparacao; quem exibe usa `arredondarParaExibicao`.
 */

/**
 * Uma avaliacao publicada reduzida ao que a comparacao precisa saber.
 *
 * `valor` e `null` quando aquela avaliacao NAO mediu o tipo pedido -- uma
 * avaliacao so de circunferencia nao tem peso, e isso e ausencia, nao zero.
 */
export interface AvaliacaoDaSerie {
  readonly id: string;
  /** Instante da MEDICAO (`assessedAt`), nunca o do cadastro. */
  readonly assessedAt: Date;
  /** Id da correcao que substitui esta avaliacao, quando existe (INV-102). */
  readonly supersededById: string | null;
  /** Valor canonico do tipo pedido, ou `null` se a avaliacao nao o mediu. */
  readonly valor: number | null;
}

/** Ponto da serie: avaliacao que efetivamente mediu o tipo pedido. */
export interface PontoDaSerie {
  readonly id: string;
  readonly assessedAt: Date;
  readonly valor: number;
}

/** Meta ativa do aluno para o tipo pedido (`M3-FR-012`). */
export interface MetaDaSerie {
  readonly alvo: number;
  readonly unidade: string | null;
}

/**
 * Por que uma comparacao nao produziu numero.
 *
 * Existe para a tela dizer o que houve em vez de mostrar campo vazio: "sem
 * medicao anterior" e "meta nao cadastrada" pedem acoes diferentes do
 * avaliador.
 */
export type RazaoDeAusencia = 'SEM_BASELINE' | 'BASELINE_ZERO' | 'SEM_META';

/**
 * Diferenca entre dois pontos, com a proveniencia de cada lado.
 *
 * `deId`/`paraId` atendem o `M3-NFR-006`: numero na tela sem origem nao pode
 * ser conferido pelo aluno nem contestado pelo avaliador.
 */
export interface Variacao {
  readonly absoluta: number | null;
  readonly percentual: number | null;
  readonly deId: string | null;
  readonly paraId: string | null;
  readonly razao: RazaoDeAusencia | null;
}

export interface Comparativo {
  readonly pontos: readonly PontoDaSerie[];
  readonly primeira: PontoDaSerie | null;
  readonly anterior: PontoDaSerie | null;
  readonly atual: PontoDaSerie | null;
  readonly desdeAPrimeira: Variacao;
  readonly desdeAAnterior: Variacao;
  readonly ateAMeta: Variacao;
}

const AUSENTE = (razao: RazaoDeAusencia): Variacao => ({
  absoluta: null,
  percentual: null,
  deId: null,
  paraId: null,
  razao,
});

/**
 * Descarta as avaliacoes que ja foram corrigidas e ordena por medicao.
 *
 * Correcao forma CADEIA, nao leque (`correcaoPermitida` recusa a segunda
 * correcao do mesmo original), entao basta remover quem tem `supersededById`
 * -- o que sobra e a folha de cada cadeia.
 *
 * O desempate por `id` nao e detalhe: sem ele, duas medicoes no mesmo
 * instante sairiam em ordem indefinida e o mesmo dado geraria comparativos
 * diferentes entre chamadas, quebrando o aceite da fatia.
 */
export function selecionarFolhas(
  serie: readonly AvaliacaoDaSerie[],
): readonly AvaliacaoDaSerie[] {
  return serie
    .filter((avaliacao) => avaliacao.supersededById === null)
    .sort((a, b) => {
      const porInstante = a.assessedAt.getTime() - b.assessedAt.getTime();

      return porInstante !== 0 ? porInstante : a.id.localeCompare(b.id);
    });
}

/**
 * Diferenca de `base` para `alvo`, preservando a precisao (INV-106).
 *
 * Baseline zero devolve a absoluta e recusa a percentual: a diferenca
 * continua verdadeira, mas dividir por zero produziria `Infinity`, que na
 * tela nao significa nada.
 */
function variacao(base: PontoDaSerie, alvo: PontoDaSerie): Variacao {
  const absoluta = alvo.valor - base.valor;

  if (base.valor === 0) {
    return {
      absoluta,
      percentual: null,
      deId: base.id,
      paraId: alvo.id,
      razao: 'BASELINE_ZERO',
    };
  }

  return {
    absoluta,
    percentual: (absoluta / base.valor) * 100,
    deId: base.id,
    paraId: alvo.id,
    razao: null,
  };
}

/**
 * Monta o comparativo de UM tipo de medida.
 *
 * Avaliacao que nao mediu o tipo nao vira ponto (INV-104): tratar como zero
 * faria o grafico despencar num dia em que ninguem pesou o aluno.
 *
 * `meta` e `null` quando o aluno nao tem meta ativa para o tipo -- a
 * comparacao sai ausente com razao propria, e nao some da resposta.
 */
export function compararSerie(
  serie: readonly AvaliacaoDaSerie[],
  meta: MetaDaSerie | null,
): Comparativo {
  const pontos: PontoDaSerie[] = selecionarFolhas(serie)
    .filter((avaliacao): avaliacao is AvaliacaoDaSerie & { valor: number } =>
      avaliacao.valor !== null,
    )
    .map((avaliacao) => ({
      id: avaliacao.id,
      assessedAt: avaliacao.assessedAt,
      valor: avaliacao.valor,
    }));

  const atual = pontos.at(-1) ?? null;
  const primeira = pontos.at(0) ?? null;
  // A penultima medicao. Com um unico ponto NAO existe anterior: comparar a
  // atual com ela mesma daria 0, e zero aqui leria como "nao mudou" em vez
  // de "nao ha com o que comparar".
  const anterior = pontos.length >= 2 ? (pontos.at(-2) ?? null) : null;

  return {
    pontos,
    primeira,
    anterior,
    atual,
    desdeAPrimeira:
      atual !== null && primeira !== null && primeira !== atual
        ? variacao(primeira, atual)
        : AUSENTE('SEM_BASELINE'),
    desdeAAnterior:
      atual !== null && anterior !== null ? variacao(anterior, atual) : AUSENTE('SEM_BASELINE'),
    ateAMeta: compararComMeta(atual, meta),
  };
}

/**
 * Quanto falta do valor atual ate o alvo.
 *
 * O sinal segue a mesma convencao das outras variacoes (alvo menos base):
 * `-5` significa que faltam 5 unidades PARA BAIXO, e a tela nao precisa
 * saber se a meta era ganhar ou perder para escrever a frase.
 */
function compararComMeta(atual: PontoDaSerie | null, meta: MetaDaSerie | null): Variacao {
  if (atual === null) {
    // Meta sem nenhuma medicao nao vira ponto: nao ha de onde partir.
    return AUSENTE('SEM_BASELINE');
  }

  if (meta === null) {
    return AUSENTE('SEM_META');
  }

  const absoluta = meta.alvo - atual.valor;

  if (atual.valor === 0) {
    return {
      absoluta,
      percentual: null,
      deId: atual.id,
      paraId: null,
      razao: 'BASELINE_ZERO',
    };
  }

  return {
    absoluta,
    percentual: (absoluta / atual.valor) * 100,
    deId: atual.id,
    paraId: null,
    razao: null,
  };
}
