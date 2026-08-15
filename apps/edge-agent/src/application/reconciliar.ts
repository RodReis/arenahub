import { type Coletor } from '../domain/coletor.js';
import { type FilaDeEventos } from '../persistence/fila-de-eventos.js';

/**
 * Drena a fila para o coletor -- `M0-FR-009`.
 *
 * O aceite da Slice 0.4: "eventos ocorridos offline chegam UMA UNICA VEZ
 * LOGICAMENTE ao coletor apos reconexao e mantem o horario original".
 *
 * Duas garantias, e elas se sustentam em lugares diferentes:
 *
 *   - **uma unica vez** -- pela chave de idempotencia (`eventoId`). O
 *     coletor deduplica; nos so precisamos mandar sempre a mesma chave para
 *     o mesmo evento fisico;
 *   - **horario original** -- porque `ocorridoEm` vem do evento e atravessa
 *     a fila sem ser tocado. Carimbar no envio destruiria o dado.
 *
 * "Uma unica vez" e LOGICO, nao fisico: a rede pode entregar duas vezes, e
 * vai. O que nao pode e virar dois registros.
 */

export type ResultadoReconciliacao = {
  enviados: number;
  duplicados: number;
  falhas: number;
  /**
   * Quantos sairam da fila por recusa repetida nesta rodada.
   *
   * Metrica de saude: quarentena subindo significa que algo esta gerando
   * evento que o coletor nunca aceita -- e isso e problema nosso, nao dele.
   */
  quarentenados: number;
  /** Quantos ainda esperam depois desta rodada. */
  backlog: number;
  /**
   * Se parou por indisponibilidade.
   *
   * Importa para quem chama: `parouPorIndisponibilidade` significa "tente
   * de novo depois", e nao "esses eventos tem problema".
   */
  parouPorIndisponibilidade: boolean;
};

export type DepsReconciliacao = {
  fila: FilaDeEventos;
  coletor: Coletor;
};

/**
 * Envia ate `lote` eventos pendentes.
 *
 * PARA NA PRIMEIRA INDISPONIBILIDADE. Se o coletor esta fora, insistir com
 * os outros 99 eventos so gera 99 timeouts -- e cada timeout e tempo em que
 * a fila nao esta registrando quem esta passando na catraca agora.
 *
 * Recusa (`recusado`) e diferente: e problema DAQUELE evento, entao segue
 * para o proximo.
 */
export async function reconciliar(
  deps: DepsReconciliacao,
  lote = 50,
): Promise<ResultadoReconciliacao> {
  const pendentes = deps.fila.proximosPendentes(lote);

  let enviados = 0;
  let duplicados = 0;
  let falhas = 0;
  let quarentenados = 0;
  let parouPorIndisponibilidade = false;

  for (const evento of pendentes) {
    const resposta = await deps.coletor.enviar({
      eventoId: evento.eventoId,
      tenantId: evento.tenantId,
      gymUnitId: evento.gymUnitId,
      edgeAgentId: evento.edgeAgentId,
      tipo: evento.tipo,
      // Intacto. Este e o campo que o aceite manda preservar.
      ocorridoEm: evento.ocorridoEm,
      payload: evento.payload,
    });

    if (resposta.estado === 'aceito') {
      deps.fila.marcarEnviado(evento.eventoId);
      enviados += 1;
      continue;
    }

    if (resposta.estado === 'duplicado') {
      // O coletor ja tinha. O estado desejado vale -- marcar como enviado e
      // o certo. Tratar como falha faria a fila retentar para sempre algo
      // que ja chegou.
      deps.fila.marcarEnviado(evento.eventoId);
      duplicados += 1;
      continue;
    }

    if (resposta.estado === 'indisponivel') {
      // NAO conta como recusa: o coletor estar fora nao diz nada sobre este
      // evento. Contar quarentenaria a fila inteira numa queda longa --
      // exatamente o cenario que a Slice 0.4 existe para atravessar.
      deps.fila.registrarFalha(evento.eventoId, resposta.razao);
      falhas += 1;
      parouPorIndisponibilidade = true;
      break;
    }

    // `recusado`: problema DESTE evento. Conta como recusa; depois do
    // limite vai para quarentena e para de ocupar vaga do lote.
    const quarentenou = deps.fila.registrarFalha(evento.eventoId, resposta.razao, true);
    falhas += 1;
    if (quarentenou) quarentenados += 1;
  }

  return {
    enviados,
    duplicados,
    falhas,
    quarentenados,
    backlog: deps.fila.backlog,
    parouPorIndisponibilidade,
  };
}
