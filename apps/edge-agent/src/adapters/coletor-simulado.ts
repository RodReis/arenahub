import {
  type Coletor,
  type EventoParaColetor,
  type RespostaColetor,
} from '../domain/coletor.js';

/**
 * Coletor simulado -- "simulacao de queda cloud antes e depois do
 * reconhecimento" (Slice 0.4).
 *
 * Ele NAO imita a API real: imita o CONTRATO e, principalmente, o
 * comportamento que a reconciliacao precisa enfrentar -- ficar fora,
 * voltar, e deduplicar por chave.
 *
 * A DEDUPLICACAO AQUI E DE PROPOSITO. O coletor real vai deduplicar por
 * `eventoId` (regra de arquitetura no 4). Se o dublê aceitasse tudo, o
 * teste do `M0-AC-006` ("sem duplicacao logica") passaria mesmo com a fila
 * mandando o mesmo evento duas vezes -- e nao provaria nada.
 *
 * Dublê vive no boundary, nunca dentro da regra (`docs/TESTING.md`).
 */
export class ColetorSimulado implements Coletor {
  readonly nome = 'coletor-simulado';

  /** O que ele ja aceitou, por `eventoId`. */
  private readonly recebidos = new Map<string, EventoParaColetor>();

  /** Fora do ar? */
  private disponivel = true;

  /** Recusa programada por `eventoId`. */
  private readonly recusas = new Map<string, string>();

  /** Quantas requisicoes chegaram -- incluindo as que caíram. */
  private chamadas = 0;

  /** Simula queda da nuvem. */
  cair(razao = 'coletor indisponivel'): void {
    this.disponivel = false;
    this.razaoDaQueda = razao;
  }

  /** Simula reconexao. */
  voltar(): void {
    this.disponivel = true;
  }

  private razaoDaQueda = 'coletor indisponivel';

  /** Programa recusa de um evento especifico -- payload invalido, etc. */
  recusar(eventoId: string, razao: string): void {
    this.recusas.set(eventoId, razao);
  }

  enviar(evento: EventoParaColetor): Promise<RespostaColetor> {
    this.chamadas += 1;

    if (!this.disponivel) {
      return Promise.resolve({ estado: 'indisponivel', razao: this.razaoDaQueda });
    }

    const recusa = this.recusas.get(evento.eventoId);
    if (recusa) {
      return Promise.resolve({ estado: 'recusado', razao: recusa });
    }

    // Deduplicacao por chave -- o que o coletor real faz, e o que torna o
    // teste do M0-AC-006 honesto.
    if (this.recebidos.has(evento.eventoId)) {
      return Promise.resolve({ estado: 'duplicado' });
    }

    this.recebidos.set(evento.eventoId, evento);
    return Promise.resolve({ estado: 'aceito' });
  }

  /** Quantos eventos DISTINTOS chegaram. E isto que o aceite conta. */
  get distintosRecebidos(): number {
    return this.recebidos.size;
  }

  get totalDeChamadas(): number {
    return this.chamadas;
  }

  recebido(eventoId: string): EventoParaColetor | undefined {
    return this.recebidos.get(eventoId);
  }

  get todos(): readonly EventoParaColetor[] {
    return [...this.recebidos.values()];
  }
}
