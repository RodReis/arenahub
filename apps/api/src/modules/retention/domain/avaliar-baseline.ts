/**
 * O motor da baseline explicavel (F37, Slice 6.2).
 *
 * PURO e DETERMINISTICO: mesmo snapshot + mesma versao de regras = mesmo score,
 * mesmos fatores, mesma ordem. E isso que `M6-AC-002` pede, e o unico jeito de
 * a recepcao CONTESTAR um score: se o numero muda entre duas execucoes iguais,
 * nao ha o que contestar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE REGRA ANTES DE MODELO
 * ---------------------------------------------------------------------------
 *
 * O PRD poe a baseline (6.2) antes do modelo supervisionado (6.5) e condiciona
 * o segundo a superar a primeira. A ordem nao e didatica: score que ninguem
 * explica nao vira tarefa operacional, vira desconfianca da recepcao. Aqui
 * cada ponto do score tem uma regra com nome, um valor observado e um limite --
 * a atendente ve "37 dias sem passar na catraca" e nao "risco 0.82".
 *
 * ---------------------------------------------------------------------------
 * O SCORE NAO E PROBABILIDADE
 * ---------------------------------------------------------------------------
 *
 * `probabilidadeCalibrada` e sempre `null` nesta fatia, e a decisao e do PRD
 * §16: "nao mostrar probabilidades com falsa precisao quando nao calibradas".
 * A soma de pesos e uma ORDENACAO -- serve para dizer quem ligar primeiro, nao
 * "68% de chance de sair". O campo existe nulo em vez de ausente para que a
 * F40 tenha onde escrever sem migrar de novo, e para que a tela ja saiba
 * esconder o numero quando ele nao existe.
 */

import { avaliarRegra, type FatorDeRisco, type RegraDeRetencao } from './regra-de-retencao.js';
import { completude, type ValorDeFeature } from './valor-de-feature.js';

/**
 * As quatro faixas do PRD §16, na ordem.
 *
 * Texto, nunca cor sozinha: `M6-BR-001` diz que score e recomendacao, e uma
 * pilula vermelha sem palavra le-se como veredito sobre o aluno.
 */
export type FaixaDeRisco = 'BAIXO' | 'MEDIO' | 'ALTO' | 'CRITICO';

/**
 * O piso de cada faixa, do maior para o menor.
 *
 * Vem da VERSAO de regras, nao daqui -- trocar o corte muda o significado de
 * todo score ja gravado, entao ele e versionado junto. Este e o padrao inicial,
 * e o adjetivo importa: "calibradas operacionalmente" (PRD §7) quer dizer que o
 * corte segue a capacidade da equipe, e so a operacao real dira onde ele fica.
 */
export const FAIXAS_PADRAO: readonly (readonly [FaixaDeRisco, number])[] = [
  ['CRITICO', 75],
  ['ALTO', 50],
  ['MEDIO', 25],
  ['BAIXO', 0],
];

/** Ate cinco fatores na explicacao -- PRD §16. */
export const MAXIMO_DE_FATORES = 5;

const SCORE_MINIMO = 0;
const SCORE_MAXIMO = 100;

export interface ResultadoDaBaseline {
  /** Inteiro em `[0, 100]`. Ordenacao, nao probabilidade. */
  readonly score: number;
  readonly faixa: FaixaDeRisco;
  /** Ate cinco, ordenados por peso absoluto. Corte da EXPLICACAO, nao da soma. */
  readonly fatores: readonly FatorDeRisco[];
  /** Fracao de features observadas. E CONFIANCA, nao risco -- nunca entra na soma. */
  readonly completude: number;
  /** Sempre `null` na baseline. A F40 preenche, se e quando calibrar. */
  readonly probabilidadeCalibrada: number | null;
}

export function faixaDoScore(
  score: number,
  faixas: readonly (readonly [FaixaDeRisco, number])[],
): FaixaDeRisco {
  for (const [faixa, piso] of faixas) {
    if (score >= piso) {
      return faixa;
    }
  }
  return 'BAIXO';
}

/**
 * Aplica o catalogo de regras sobre os valores de UM snapshot.
 *
 * Regra sem a feature correspondente no snapshot e ignorada em silencio: o
 * catalogo pode citar feature que a versao do snapshot ainda nao materializa, e
 * derrubar o calculo do aluno inteiro por causa disso trocaria um score
 * incompleto por nenhum score. A completude e quem denuncia o buraco.
 */
export function avaliarBaseline(
  valores: readonly ValorDeFeature[],
  regras: readonly RegraDeRetencao[],
  faixas: readonly (readonly [FaixaDeRisco, number])[] = FAIXAS_PADRAO,
): ResultadoDaBaseline {
  const porNome = new Map(valores.map((valor) => [valor.nome, valor]));

  const disparados: FatorDeRisco[] = [];
  for (const regra of regras) {
    const valor = porNome.get(regra.feature);
    if (valor === undefined) {
      continue;
    }
    const fator = avaliarRegra(regra, valor);
    if (fator !== null) {
      disparados.push(fator);
    }
  }

  const soma = disparados.reduce((total, fator) => total + fator.contribuicao, 0);
  const score = Math.min(SCORE_MAXIMO, Math.max(SCORE_MINIMO, soma));

  // Ordena por peso absoluto; desempata pelo id da regra para nao deixar a
  // ordem de insercao decidir o que a recepcao le primeiro.
  const fatores = [...disparados]
    .sort((a, b) => {
      const diferenca = Math.abs(b.contribuicao) - Math.abs(a.contribuicao);
      return diferenca !== 0 ? diferenca : a.regraId.localeCompare(b.regraId);
    })
    .slice(0, MAXIMO_DE_FATORES);

  return {
    score,
    faixa: faixaDoScore(score, faixas),
    fatores,
    completude: completude(valores),
    probabilidadeCalibrada: null,
  };
}
