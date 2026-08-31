/**
 * A regra explicavel da baseline de retencao (F37, Slice 6.2).
 *
 * PURO: sem banco, sem relogio, sem `eval`. Recebe uma regra e UM valor de
 * feature, devolve a contribuicao ou `null`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE DECLARATIVA, E NAO EXPRESSAO
 * ---------------------------------------------------------------------------
 *
 * A tentacao obvia e guardar a regra como texto (`"attendance_days_30d <= 4"`)
 * e interpretar. Isso quebra a fatia por dois lados ao mesmo tempo:
 *
 *   1. `M6-AC-002` exige score REPRODUZIVEL. Expressao arbitraria pode ler
 *      relogio, sortear, chamar funcao -- e a mesma regra sobre o mesmo
 *      snapshot deixa de dar o mesmo numero.
 *   2. Regra vinda do banco e DADO, e dado que vira codigo e execucao remota.
 *
 * Aqui a regra e uma tupla fechada: feature, operador de uma allowlist, limite
 * numerico, peso e direcao. Nao ha ponto de extensao que aceite texto
 * executavel -- acrescentar comportamento exige mexer neste arquivo, passar
 * pela revisao e pelo teste que trava a allowlist.
 *
 * ---------------------------------------------------------------------------
 * AUSENTE NAO PONTUA. NEM PARA CIMA, NEM PARA BAIXO.
 * ---------------------------------------------------------------------------
 *
 * `M6-BR-002`: "ausencia de dado reduz confianca/completude; nao aumenta risco
 * arbitrariamente". A F36 ja garantiu que ausente chega como `valor: null`; o
 * que esta fatia acrescenta e que uma regra sobre feature ausente devolve
 * `null` -- ela nao entra na soma e nao vira fator na explicacao.
 *
 * Consequencia deliberada: aluno com muitos dados ausentes tem score BAIXO e
 * completude BAIXA. Sao dois numeros distintos, e e a completude que avisa a
 * recepcao que o score sabe pouco. Colapsar os dois -- tratar ausencia como
 * risco -- poria o recem-matriculado na fila de ligacao, que e exatamente o
 * defeito que a F36 documentou no handoff.
 */

import type { ValorDeFeature } from './valor-de-feature.js';

/**
 * Os operadores que uma regra pode usar. Allowlist FECHADA.
 *
 * Cada um compara o valor da feature com um limite numerico e devolve
 * booleano. Nenhum le estado externo. O teste que compara esta lista inteira
 * existe para que acrescentar operador seja uma decisao visivel no diff, e nao
 * um efeito colateral de outra mudanca.
 */
export const OPERADORES_DE_REGRA = [
  'MAIOR_QUE',
  'MAIOR_OU_IGUAL',
  'MENOR_QUE',
  'MENOR_OU_IGUAL',
  /**
   * Para `attendance_change_30d_vs_previous_30d`, que ja chega como RAZAO de
   * variacao (`-1` parou, `0` manteve, positivo aumentou -- F36,
   * `features.ts`). "Caiu pelo menos 40%" e `valor <= -0.4`, e escrever isso
   * como `MENOR_OU_IGUAL` com limite `-0.4` obrigaria quem le o catalogo a
   * lembrar do sinal. Com limite positivo e nome explicito, a regra se le
   * sozinha.
   */
  'QUEDA_PERCENTUAL_MINIMA',
] as const;

export type OperadorDeRegra = (typeof OPERADORES_DE_REGRA)[number];

/**
 * Para que lado a regra empurra o risco.
 *
 * O PRD §7 pede "fatores positivos/negativos": a explicacao precisa mostrar
 * tambem o que SEGURA o aluno, nao so o que o afasta. Sem `REDUZ`, a tela lista
 * apenas motivos de alarme e a recepcao nunca ve que o aluno treinou vinte dias
 * no mes.
 */
export type DirecaoDeRegra = 'AUMENTA' | 'REDUZ';

/** Uma regra do catalogo versionado. */
export interface RegraDeRetencao {
  readonly id: string;
  /** A feature do snapshot que esta regra observa. */
  readonly feature: string;
  readonly operador: OperadorDeRegra;
  readonly limite: number;
  /** Quanto soma ao score quando dispara. Sempre positivo; a direcao da o sinal. */
  readonly peso: number;
  readonly direcao: DirecaoDeRegra;
  /** Texto que a operacao le. Nao e chave: versionado junto da regra. */
  readonly rotulo: string;
}

/** Uma regra que disparou, e por que. Vira linha da explicacao. */
export interface FatorDeRisco {
  readonly regraId: string;
  readonly feature: string;
  /** O valor observado que fez a regra disparar. E o que torna o fator contestavel. */
  readonly valor: number;
  /** Positiva quando aumenta o risco, negativa quando reduz. */
  readonly contribuicao: number;
  readonly direcao: DirecaoDeRegra;
  readonly rotulo: string;
}

function cruzaOLimite(operador: OperadorDeRegra, valor: number, limite: number): boolean {
  switch (operador) {
    case 'MAIOR_QUE':
      return valor > limite;
    case 'MAIOR_OU_IGUAL':
      return valor >= limite;
    case 'MENOR_QUE':
      return valor < limite;
    case 'MENOR_OU_IGUAL':
      return valor <= limite;
    case 'QUEDA_PERCENTUAL_MINIMA':
      return valor <= -Math.abs(limite);
  }
}

/**
 * Avalia UMA regra contra UM valor de feature.
 *
 * Devolve `null` quando a regra nao se aplica -- feature ausente, valor nao
 * finito, ou limite nao cruzado. `null` significa "nao entra na soma e nao
 * aparece na explicacao", e os tres casos merecem o mesmo tratamento: nenhum
 * deles e evidencia de risco.
 *
 * Lanca quando a regra e confrontada com feature diferente da sua: e erro de
 * programacao no orquestrador, nao dado ruim do aluno, e passar batido faria a
 * regra de frequencia pontuar com o valor de atraso.
 */
export function avaliarRegra(regra: RegraDeRetencao, valor: ValorDeFeature): FatorDeRisco | null {
  if (regra.feature !== valor.nome) {
    throw new Error(
      `REGRA_FEATURE_INCOMPATIVEL: regra ${regra.id} observa ${regra.feature}, recebeu ${valor.nome}`,
    );
  }

  // Ausente nao pontua -- `M6-BR-002`.
  if (valor.valor === null || !Number.isFinite(valor.valor)) {
    return null;
  }

  if (!cruzaOLimite(regra.operador, valor.valor, regra.limite)) {
    return null;
  }

  return {
    regraId: regra.id,
    feature: regra.feature,
    valor: valor.valor,
    contribuicao: regra.direcao === 'AUMENTA' ? regra.peso : -regra.peso,
    direcao: regra.direcao,
    rotulo: regra.rotulo,
  };
}
