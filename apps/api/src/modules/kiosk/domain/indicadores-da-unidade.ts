/**
 * Janelas dos indicadores da tela publica (F51, decisao 4 do PI de
 * 26/08/2026).
 *
 * Funcoes puras: o "agora" ENTRA por parametro, nao e lido do relogio
 * (`CLAUDE.md`). Sem isso, testar a virada do dia exigiria mexer no relogio
 * do processo.
 *
 * ---------------------------------------------------------------------------
 * "TREINANDO AGORA" E ESTIMATIVA, E O ROTULO PRECISA DIZER ISSO.
 * ---------------------------------------------------------------------------
 *
 * A catraca do MVP 0/1 registra ENTRADA. Nao ha evento de saida, entao nao ha
 * como saber quem foi embora. O que existe e "entrou nas ultimas N horas", e
 * chamar isso de contagem exata seria prometer um numero que o dado nao
 * sustenta -- na recepcao, ao lado de patrocinador, com a fila olhando.
 *
 * Se um dia a catraca registrar saida, o calculo muda aqui e so aqui.
 */

/**
 * Quem entrou nas ultimas 3 horas conta como "treinando agora".
 *
 * O numero e da duracao tipica de um treino com folga: menos que isso perde
 * quem chegou cedo e ainda esta na sala; muito mais transforma o indicador
 * em "movimento da tarde".
 */
export const JANELA_DE_TREINO_HORAS = 3;

const MS_POR_HORA = 60 * 60 * 1000;

/**
 * Inicio do dia LOCAL da academia.
 *
 * `-03:00` fixo e uma simplificacao consciente: o ArenaHub e brasileiro e o
 * horario de verao acabou em 2019. Quando a primeira unidade abrir fora do
 * fuso de Brasilia, isto vira campo da unidade -- e vai passar por aqui, que
 * e o unico lugar que decide onde o dia comeca.
 */
const OFFSET_DA_ACADEMIA_MS = -3 * MS_POR_HORA;

/** O instante em que o dia local de `agora` comecou, em UTC. */
export function inicioDoDiaLocal(agora: Date): Date {
  const local = new Date(agora.getTime() + OFFSET_DA_ACADEMIA_MS);

  const meiaNoiteLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );

  return new Date(meiaNoiteLocal - OFFSET_DA_ACADEMIA_MS);
}

/** O instante a partir do qual uma entrada ainda conta como treino em curso. */
export function inicioDaJanelaDeTreino(agora: Date): Date {
  return new Date(agora.getTime() - JANELA_DE_TREINO_HORAS * MS_POR_HORA);
}
