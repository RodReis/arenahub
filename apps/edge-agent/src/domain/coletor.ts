/**
 * Porta do coletor na nuvem.
 *
 * O `edge-agent` e executor fisico; a nuvem e a fonte da verdade (regra de
 * arquitetura no 3). Esta porta e por onde o que aconteceu na catraca sobe.
 *
 * A implementacao real (HTTP com HMAC) e da F5 ou da fatia de nuvem. Aqui
 * fica o contrato e o dublê, que e o que a Slice 0.4 precisa: "simulacao de
 * queda cloud antes e depois do reconhecimento".
 */

export type EventoParaColetor = {
  /** Chave de idempotencia. O coletor deduplica por ela (`M0-FR-009`). */
  eventoId: string;
  tenantId: string;
  gymUnitId: string;
  edgeAgentId: string;
  tipo: string;
  /** Horario da OCORRENCIA. O aceite exige que ele sobreviva intacto. */
  ocorridoEm: Date;
  payload: string;
};

/**
 * Resposta do coletor.
 *
 * `duplicado` NAO e erro: significa que o coletor ja tinha esse evento. Um
 * reenvio que descobre isso teve sucesso -- o estado desejado (o evento
 * esta la) vale. Tratar como falha faria a fila retentar para sempre um
 * evento que ja chegou.
 */
export type RespostaColetor =
  | { estado: 'aceito' }
  | { estado: 'duplicado' }
  | { estado: 'recusado'; razao: string }
  | { estado: 'indisponivel'; razao: string };

export interface Coletor {
  readonly nome: string;

  /**
   * Envia UM evento.
   *
   * Um por vez, nao em lote: lote esconde qual falhou, e a fila precisa
   * saber exatamente qual evento confirmar. Se a medicao mostrar que o
   * custo por requisicao pesa, lote vira decisao registrada -- nao
   * conveniencia.
   */
  enviar(evento: EventoParaColetor): Promise<RespostaColetor>;
}
