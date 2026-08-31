/**
 * Quem pode receber score, e por que alguem nao pode (F37, `M6-FR-006`).
 *
 * PURO: recebe o estado ja lido, decide. Separado do calculo de proposito --
 * "este aluno nao deve ser pontuado" e uma decisao de GOVERNANCA, e misturada
 * com aritmetica de pesos ela some. O PRD §7 exige que a decisao seja auditada:
 * o motivo e gravado mesmo quando nao ha score.
 *
 * ---------------------------------------------------------------------------
 * INELEGIVEL NAO E RISCO ZERO
 * ---------------------------------------------------------------------------
 *
 * A implementacao preguicosa devolveria score `0` para quem nao pode ser
 * pontuado. Isso mente duas vezes: poe o suprimido no mesmo balde do aluno
 * saudavel, e faz uma supressao por opt-out parecer com uma avaliacao de baixo
 * risco. Aqui a resposta e um veredito com razao -- quem chama decide o que
 * fazer, e a razao chega ate a auditoria.
 */

/** Status do aluno que interessa a decisao. Espelha `Student.status`. */
export type StatusDoAluno = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

/** Status da assinatura que interessa a decisao. Espelha `Subscription.status`. */
export type StatusDaAssinatura = 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED';

/**
 * Por que um aluno esta fora do scoring.
 *
 * `OPT_OUT` e `EXCLUSAO_PENDENTE` sao decisoes do aluno ou da politica de dados;
 * `MANUAL_COM_MOTIVO` e a valvula da operacao, e o nome carrega a exigencia --
 * `M6-BR-007` nao aceita supressao manual sem motivo registrado.
 */
export type MotivoDeSupressao = 'OPT_OUT' | 'EXCLUSAO_PENDENTE' | 'MANUAL_COM_MOTIVO';

/**
 * As razoes de recusa, em ORDEM DE PRECEDENCIA.
 *
 * A ordem e o contrato: um aluno cancelado que tambem pediu opt-out e recusado
 * como `CANCELADO`. Sem ordem fixa, dois processos leriam o mesmo estado e
 * gravariam razoes diferentes, e a auditoria nao fecharia. A mais estavel vence:
 * cancelamento nao se desfaz sozinho, supressao pode expirar, completude sobe
 * amanha.
 */
export const RAZOES_DE_INELEGIBILIDADE = [
  'CANCELADO',
  'SUPRIMIDO',
  'HISTORICO_INSUFICIENTE',
] as const;

export type RazaoDeInelegibilidade = (typeof RAZOES_DE_INELEGIBILIDADE)[number];

export interface EstadoDoAluno {
  readonly statusDoAluno: StatusDoAluno;
  readonly statusDaAssinatura: StatusDaAssinatura;
  /** A completude do snapshot que seria pontuado. */
  readonly completude: number;
  readonly supressoesVigentes: readonly MotivoDeSupressao[];
}

export type Elegibilidade =
  | { readonly elegivel: true }
  | { readonly elegivel: false; readonly razao: RazaoDeInelegibilidade };

export interface PoliticaDeElegibilidade {
  /**
   * Abaixo disto o snapshot sabe pouco demais para ordenar uma fila.
   *
   * Nao e limiar de risco: e limiar de CONFIANCA. Com menos de um terco das
   * features observadas, a diferenca entre dois alunos e ruido, e ordenar por
   * ruido gasta a hora da recepcao com quem nao precisava de ligacao.
   */
  readonly completudeMinima: number;
}

export const POLITICA_PADRAO: PoliticaDeElegibilidade = { completudeMinima: 0.3 };

export function avaliarElegibilidade(
  estado: EstadoDoAluno,
  politica: PoliticaDeElegibilidade = POLITICA_PADRAO,
): Elegibilidade {
  // `M6-BR-003`: cancelado nao gera tarefa de PREVENCAO. Reconquista e outro
  // fluxo, fora deste MVP -- e chamar de "risco de churn" quem ja saiu
  // confundiria a fila com uma lista de ex-alunos.
  if (
    estado.statusDoAluno === 'ARCHIVED' ||
    estado.statusDaAssinatura === 'CANCELLED' ||
    estado.statusDaAssinatura === 'EXPIRED'
  ) {
    return { elegivel: false, razao: 'CANCELADO' };
  }

  if (estado.supressoesVigentes.length > 0) {
    return { elegivel: false, razao: 'SUPRIMIDO' };
  }

  if (estado.completude < politica.completudeMinima) {
    return { elegivel: false, razao: 'HISTORICO_INSUFICIENTE' };
  }

  return { elegivel: true };
}
