/**
 * Quem entra na fila de hoje, e ate onde ela vai (F38, Slice 6.3).
 *
 * PURA: sem banco, sem relogio -- o "agora" entra por parametro.
 *
 * ---------------------------------------------------------------------------
 * CAPACIDADE E O QUE IMPEDE A FILA DE VIRAR BACKLOG
 * ---------------------------------------------------------------------------
 *
 * `M6-BR-005` e explicito: "capacidade da equipe limita o top-K; score nao cria
 * backlog infinito". A tentacao e gerar tarefa para todo aluno em risco -- e o
 * resultado seria uma fila de 300 numa academia que trata 20 por dia. Fila que
 * ninguem alcanca nao e trabalho pendente, e ruido: a recepcao para de olhar, e
 * as 20 que importavam somem no meio das 280 que nunca seriam tratadas.
 *
 * O corte e por DIA e nao acumula. Capacidade nao usada na terca nao vira 40
 * vagas na quarta -- o dia seguinte tem os proprios 20 mais urgentes, que sao
 * calculados sobre o snapshot novo.
 *
 * ---------------------------------------------------------------------------
 * COOLDOWN SUPRIME A TAREFA, NAO O SCORE
 * ---------------------------------------------------------------------------
 *
 * `M6-BR-004`: "tarefa duplicada e suprimida durante cooldown, MAS NOVO SCORE
 * PERMANECE NO HISTORICO". As duas metades importam. Sem a primeira, o aluno
 * recebe ligacao todo dia pelo mesmo motivo. Sem a segunda, a evolucao do risco
 * ganharia buracos justamente nos alunos mais acompanhados -- e a serie que a
 * tela mostra deixaria de existir onde ela mais interessa.
 *
 * Por isso a supressao mora AQUI, na selecao da fila, e nao no calculo do score
 * (F37), que continua pontuando todo mundo elegivel todo dia.
 */

import type { FaixaDeRisco } from './avaliar-baseline.js';

const MILISSEGUNDOS_POR_DIA = 86_400_000;

/**
 * Decisoes do PI em 31/08/2026.
 *
 * Sao PADROES, nao constantes de regra: cada unidade configura os seus no banco.
 * 20/dia porque cabe numa manha de recepcao sem atrapalhar o balcao; 14 dias de
 * cooldown para agir sem importunar; 3 dias uteis de SLA porque risco de churn
 * tem janela curta -- ligacao com duas semanas de atraso nao serve.
 */
export const CAPACIDADE_PADRAO = 20;
export const COOLDOWN_PADRAO_EM_DIAS = 14;
export const SLA_PADRAO_EM_DIAS_UTEIS = 3;

export interface CandidatoAFila {
  readonly studentId: string;
  readonly scoreId: string;
  readonly valor: number;
  readonly faixa: FaixaDeRisco;
  /** Ja existe tarefa em estado ativo para este aluno -- `M6-FR-007`. */
  readonly temTarefaAtiva: boolean;
  /** Quando a ultima tarefa deste aluno foi criada. `null` = nunca houve. */
  readonly ultimaTarefaEm: Date | null;
}

export interface OpcoesDeSelecao {
  readonly capacidade: number;
  readonly cooldownEmDias: number;
  readonly agora: Date;
}

/**
 * Escolhe os candidatos que viram tarefa hoje.
 *
 * A ordem e risco decrescente com desempate por `studentId`: dois alunos com o
 * mesmo score deixariam a ordem de chegada decidir quem a recepcao liga
 * primeiro, e ela muda entre execucoes. Determinismo aqui e o que permite
 * reprocessar o dia e obter a mesma fila.
 */
export function selecionarFila(
  candidatos: readonly CandidatoAFila[],
  opcoes: OpcoesDeSelecao,
): CandidatoAFila[] {
  const limiteDoCooldown = opcoes.cooldownEmDias * MILISSEGUNDOS_POR_DIA;

  return [...candidatos]
    .filter((candidato) => {
      if (candidato.temTarefaAtiva) {
        return false;
      }
      if (candidato.ultimaTarefaEm === null) {
        return true;
      }
      const decorrido = opcoes.agora.getTime() - candidato.ultimaTarefaEm.getTime();
      return decorrido >= limiteDoCooldown;
    })
    .sort((a, b) => {
      const diferenca = b.valor - a.valor;
      return diferenca !== 0 ? diferenca : a.studentId.localeCompare(b.studentId);
    })
    .slice(0, Math.max(0, opcoes.capacidade));
}

/**
 * O prazo da tarefa, em dias UTEIS.
 *
 * Dias corridos dariam vencimento no domingo para tarefa aberta na quinta, e a
 * recepcao acharia a fila cheia de `EXPIRADA` na segunda sem ninguem ter
 * falhado. Feriado nao entra: exigiria calendario por unidade, e a diferenca de
 * um dia num SLA de tres nao paga a tabela -- quando pagar, entra aqui com o
 * calendario por parametro, como o "agora".
 */
export function venceEm(inicio: Date, diasUteis: number): Date {
  const prazo = new Date(inicio.getTime());
  let restantes = diasUteis;

  while (restantes > 0) {
    prazo.setUTCDate(prazo.getUTCDate() + 1);
    const diaDaSemana = prazo.getUTCDay();
    // 0 = domingo, 6 = sabado.
    if (diaDaSemana !== 0 && diaDaSemana !== 6) {
      restantes -= 1;
    }
  }

  return prazo;
}
