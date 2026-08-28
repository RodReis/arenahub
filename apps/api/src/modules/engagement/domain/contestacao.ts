/**
 * Contestacao de engajamento -- `M5-FR-016`.
 *
 * O aluno abre no totem; a secretaria resolve no painel. A contestacao nunca
 * e apagada nem reaberta: resolver grava desfecho, ator e instante, e a linha
 * vira historico.
 *
 * Reabrir sobrescreveria quem decidiu e quando -- e a trilha e o produto
 * desta fatia, nao um efeito colateral dela. Um aluno que discorda do
 * desfecho abre outra contestacao, que nasce com o proprio ator e a propria
 * data; as duas linhas contam a historia inteira, uma linha mutada nao conta.
 *
 * Pura: sem banco, sem relogio, sem rede.
 */

export type AssuntoDaContestacao = 'XP' | 'CONQUISTA' | 'CONSISTENCIA' | 'RANKING' | 'DESAFIO';

export type StatusDaContestacao = 'ABERTA' | 'CORRIGIDA' | 'IMPROCEDENTE';

/** Desfecho possivel. `ABERTA` nao esta aqui: nao se "resolve" para aberta. */
export type DesfechoDaContestacao = Extract<StatusDaContestacao, 'CORRIGIDA' | 'IMPROCEDENTE'>;

/**
 * Minimo para a descricao ser acionavel. "ue" nao diz a ninguem o que revisar.
 */
export const DESCRICAO_MIN = 5;
export const DESCRICAO_MAX = 500;

export interface EntradaDeAbertura {
  subject: AssuntoDaContestacao;
  descricao: string;
}

export interface ContestacaoAberta {
  subject: AssuntoDaContestacao;
  descricao: string;
  status: 'ABERTA';
}

export function abrirContestacao(entrada: EntradaDeAbertura): ContestacaoAberta {
  // Apara PRIMEIRO e mede o resultado. Medir o bruto deixaria passar uma
  // descricao feita de espaco com duas letras no meio -- tamanho "valido",
  // conteudo nenhum.
  const descricao = entrada.descricao.trim();

  if (descricao.length === 0) {
    throw new Error('CONTESTACAO_DESCRICAO_OBRIGATORIA');
  }

  if (descricao.length < DESCRICAO_MIN) {
    throw new Error('CONTESTACAO_DESCRICAO_CURTA');
  }

  if (descricao.length > DESCRICAO_MAX) {
    throw new Error('CONTESTACAO_DESCRICAO_LONGA');
  }

  return { subject: entrada.subject, descricao, status: 'ABERTA' };
}

export interface EntradaDeResolucao {
  desfecho: DesfechoDaContestacao;
  /**
   * Resposta da secretaria. Obrigatoria nos DOIS desfechos.
   *
   * Improcedente sem explicacao e silencio com carimbo: o aluno fica sabendo
   * que perdeu, nao por que. E quem perde sem saber por que reclama de novo.
   */
  resolucao: string;
}

export interface ContestacaoResolvida {
  status: DesfechoDaContestacao;
  resolucao: string;
}

export function resolverContestacao(
  atual: { status: StatusDaContestacao },
  entrada: EntradaDeResolucao,
): ContestacaoResolvida {
  if (atual.status !== 'ABERTA') {
    throw new Error('CONTESTACAO_JA_RESOLVIDA');
  }

  const resolucao = entrada.resolucao.trim();

  if (resolucao.length === 0) {
    throw new Error('CONTESTACAO_RESOLUCAO_OBRIGATORIA');
  }

  return { status: entrada.desfecho, resolucao };
}
