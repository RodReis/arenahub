import type { EventoDoFeed } from '../../actions/dashboard';

/**
 * Quanto tempo uma passagem continua na lista "Acessos em tempo real".
 *
 * Pedido do PI, 03/10/2026: a saída da catraca é giro livre, sem leitura, então
 * não existe horário de saída. Em média o aluno fica 1h30 na academia; passado
 * isso a linha sai da lista, para ela mostrar quem provavelmente ainda está lá.
 * É estimativa, como o "treinando agora" do totem.
 */
export const JANELA_DE_PERMANENCIA_MIN = 90;

/** Eventos de até `JANELA_DE_PERMANENCIA_MIN` atrás, na ordem recebida. `agora` entra por parâmetro. */
export function naJanelaDePermanencia(
  eventos: readonly EventoDoFeed[],
  agora: number,
): EventoDoFeed[] {
  const limite = agora - JANELA_DE_PERMANENCIA_MIN * 60_000;

  return eventos.filter((evento) => Date.parse(evento.occurredAt) >= limite);
}
