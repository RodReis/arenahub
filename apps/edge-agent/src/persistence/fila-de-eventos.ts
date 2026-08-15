import { DatabaseSync } from 'node:sqlite';

/**
 * Fila local de eventos fisicos -- Slice 0.4.
 *
 * `M0-FR-008`: enfileirar eventos durante indisponibilidade do coletor.
 * `M0-NFR-003`: **reinicio do processo nao pode perder evento confirmado**.
 * `M0-AC-007`: reinicio abrupto com backlog nao perde o que ja foi
 * persistido.
 *
 * A NUVEM E A FONTE DA VERDADE (regra de arquitetura no 3). Esta fila e
 * banco operacional temporario: guarda o que ainda nao chegou la, e esquece
 * assim que chegar.
 *
 * O QUE FAZ ESTA FILA SOBREVIVER A UM KILL -9
 * -------------------------------------------
 * `synchronous = FULL` com WAL. O padrao do WAL e `NORMAL`, que devolve
 * "gravei" antes de o SO ter escrito no disco -- sobrevive a crash de
 * processo, NAO a queda de energia. Numa catraca de academia, queda de
 * energia e o cenario esperado, nao a exceção.
 *
 * O custo e um fsync por commit. Numa fila que grava um evento por
 * passagem, isso e irrelevante; perder a passagem de alguem que ja girou a
 * catraca, nao.
 */

/** Estado do evento na fila. */
export type EstadoEvento =
  /** Persistido, ainda nao enviado. */
  | 'pendente'
  /** Confirmado pelo coletor. Fica para deduplicar, some na limpeza. */
  | 'enviado'
  /**
   * Recusado tantas vezes que nao adianta insistir.
   *
   * SAI DA FILA, NAO DO BANCO. Sem este estado, um evento com payload
   * invalido volta como primeiro pendente em toda rodada, para sempre --
   * gasta uma vaga do lote a cada tentativa e infla o backlog do
   * `M0-AC-008` com algo que nunca vai subir. Backlog que so cresce deixa
   * de ser sinal.
   *
   * A linha fica para alguem investigar. Descartar dado de passagem em
   * silencio seria pior que a fila entupida.
   */
  | 'quarentena';

/**
 * Recusas antes de quarentenar.
 *
 * Tres, nao uma: recusa pode ser transitoria (o coletor subiu com schema
 * velho, uma versao antiga rejeitou campo novo). Tres tentativas separam
 * "problema momentaneo" de "este evento nunca vai ser aceito".
 */
export const MAXIMO_DE_RECUSAS = 3;

export type EventoParaEnviar = {
  /**
   * Chave de idempotencia -- `M0-FR-009`.
   *
   * E o `correlationId` da tentativa: um evento fisico, uma chave. O
   * coletor usa isso para descartar reenvio, e e o que faz o `M0-AC-006`
   * ("sem duplicacao logica") valer mesmo com retry.
   */
  eventoId: string;
  tenantId: string;
  gymUnitId: string;
  edgeAgentId: string;
  /** Tipo do evento: `passagem`, `acesso-negado`, etc. */
  tipo: string;
  /**
   * Quando ACONTECEU, nao quando foi enfileirado.
   *
   * O aceite da Slice 0.4 e explicito: os eventos "mantem o horario
   * original". Carimbar no envio destruiria justamente o dado que a
   * reconciliacao precisa preservar.
   */
  ocorridoEm: Date;
  /** Corpo do evento, ja serializado. NUNCA PII, nunca biometria. */
  payload: string;
};

export type EventoEnfileirado = EventoParaEnviar & {
  estado: EstadoEvento;
  tentativas: number;
  ultimaFalha: string | null;
  enfileiradoEm: string;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS fila_eventos (
    evento_id      TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    gym_unit_id    TEXT NOT NULL,
    edge_agent_id  TEXT NOT NULL,
    tipo           TEXT NOT NULL,
    ocorrido_em    TEXT NOT NULL,
    payload        TEXT NOT NULL,
    estado         TEXT NOT NULL DEFAULT 'pendente',
    tentativas     INTEGER NOT NULL DEFAULT 0,
    ultima_falha   TEXT,
    enfileirado_em TEXT NOT NULL
  );

  -- Ordem de envio: por ocorrencia, nao por insercao. Se o processo
  -- reiniciar e reprocessar, a ordem cronologica se mantem.
  CREATE INDEX IF NOT EXISTS idx_fila_pendentes
    ON fila_eventos (estado, ocorrido_em);
`;

export class FilaDeEventos {
  private readonly db: DatabaseSync;
  private fechado = false;

  constructor(caminho: string) {
    this.db = new DatabaseSync(caminho);

    // WAL: leitura nao bloqueia escrita. Numa catraca, ler a fila para
    // reenviar nao pode travar o registro de quem esta passando agora.
    this.db.exec('PRAGMA journal_mode = WAL');

    // FULL, nao NORMAL. Ver o comentario do topo: NORMAL sobrevive a crash
    // de processo, nao a queda de energia -- e queda de energia e o cenario
    // esperado numa academia, nao a exceção.
    this.db.exec('PRAGMA synchronous = FULL');

    this.db.exec(SCHEMA);
  }

  /**
   * Enfileira. Idempotente por `eventoId`.
   *
   * Reprocessar o mesmo evento fisico -- reinicio no meio, retry da fila
   * interna -- nao cria segunda linha (regra de arquitetura no 4).
   *
   * Devolve `true` se enfileirou agora, `false` se ja existia. A diferenca
   * importa para log e metrica; para o chamador, os dois sao sucesso.
   */
  enfileirar(evento: EventoParaEnviar, agora: Date): boolean {
    const r = this.db
      .prepare(
        `INSERT INTO fila_eventos
           (evento_id, tenant_id, gym_unit_id, edge_agent_id, tipo,
            ocorrido_em, payload, estado, tentativas, ultima_falha, enfileirado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', 0, NULL, ?)
         ON CONFLICT (evento_id) DO NOTHING`,
      )
      .run(
        evento.eventoId,
        evento.tenantId,
        evento.gymUnitId,
        evento.edgeAgentId,
        evento.tipo,
        evento.ocorridoEm.toISOString(),
        evento.payload,
        agora.toISOString(),
      );

    // `changes` ja diz se inseriu. A versao anterior fazia dois COUNT(*)
    // de tabela inteira por enfileiramento -- numa fila com backlog grande,
    // isso e varredura completa a cada passagem de catraca.
    return Number(r.changes) > 0;
  }

  /**
   * Proximos pendentes, do mais antigo para o mais novo.
   *
   * Ordem por `ocorrido_em`: o coletor recebe na ordem em que as coisas
   * aconteceram, nao na ordem em que a fila esvaziou.
   */
  proximosPendentes(limite: number): readonly EventoEnfileirado[] {
    return this.db
      .prepare(
        `SELECT * FROM fila_eventos
          WHERE estado = 'pendente'
          ORDER BY ocorrido_em
          LIMIT ?`,
      )
      .all(limite)
      .map(paraEvento);
  }

  /**
   * Marca como confirmado pelo coletor.
   *
   * NAO apaga: a linha fica para deduplicar reenvio tardio -- resposta que
   * chegou depois do timeout, retry de rede. Apagar aqui abriria a janela
   * onde o mesmo evento entra de novo como pendente.
   */
  marcarEnviado(eventoId: string): void {
    this.db
      .prepare(`UPDATE fila_eventos SET estado = 'enviado', ultima_falha = NULL WHERE evento_id = ?`)
      .run(eventoId);
  }

  /**
   * Registra falha de envio e conta a tentativa.
   *
   * `recusa: true` significa que o coletor rejeitou ESTE evento -- payload
   * invalido, schema errado. Depois de `MAXIMO_DE_RECUSAS`, vai para
   * quarentena e sai da fila.
   *
   * Indisponibilidade NAO conta como recusa: o coletor estar fora nao diz
   * nada sobre o evento. Contar quarentenaria a fila inteira numa queda
   * longa -- exatamente o cenario que a Slice 0.4 existe para atravessar.
   *
   * Devolve `true` se quarentenou agora.
   */
  registrarFalha(eventoId: string, falha: string, recusa = false): boolean {
    this.db
      .prepare(
        `UPDATE fila_eventos
            SET tentativas = tentativas + 1, ultima_falha = ?
          WHERE evento_id = ?`,
      )
      .run(falha, eventoId);

    if (!recusa) return false;

    const r = this.db
      .prepare(
        `UPDATE fila_eventos
            SET estado = 'quarentena'
          WHERE evento_id = ? AND estado = 'pendente' AND tentativas >= ?`,
      )
      .run(eventoId, MAXIMO_DE_RECUSAS);

    return Number(r.changes) > 0;
  }

  /** O que foi quarentenado. Para alguem investigar -- nunca se descarta. */
  emQuarentena(limite = 100): readonly EventoEnfileirado[] {
    return this.db
      .prepare(
        `SELECT * FROM fila_eventos
          WHERE estado = 'quarentena'
          ORDER BY ocorrido_em
          LIMIT ?`,
      )
      .all(limite)
      .map(paraEvento);
  }

  /** Quantos eventos aguardam envio -- o backlog do `M0-AC-008`. */
  get backlog(): number {
    return this.contarPorEstado('pendente');
  }

  contarPorEstado(estado: EstadoEvento): number {
    const linha = this.db
      .prepare(`SELECT COUNT(*) AS total FROM fila_eventos WHERE estado = ?`)
      .get(estado);

    return numero(linha?.['total']);
  }

  /**
   * Remove enviados antigos.
   *
   * A linha enviada existe para deduplicar reenvio tardio; passado o prazo,
   * ninguem vai reenviar. Sem isto o SQLite cresce para sempre num agente
   * que roda por anos.
   */
  limparEnviadosAntesDe(limite: Date): number {
    const antes = this.contarPorEstado('enviado');

    this.db
      .prepare(`DELETE FROM fila_eventos WHERE estado = 'enviado' AND enfileirado_em < ?`)
      .run(limite.toISOString());

    return antes - this.contarPorEstado('enviado');
  }

  /** Já conhecemos este evento? Enviado ou pendente. */
  conhece(eventoId: string): boolean {
    const linha = this.db
      .prepare(`SELECT 1 AS existe FROM fila_eventos WHERE evento_id = ?`)
      .get(eventoId);

    return linha !== undefined;
  }

  /**
   * Fecha. Idempotente -- fechar duas vezes e seguro.
   *
   * Regra de arquitetura no 4 vale aqui tambem: o shutdown gracioso pode
   * fechar, e o `finally` de quem chamou fecha de novo. Explodir no segundo
   * `fechar()` transformaria encerramento limpo em erro.
   */
  fechar(): void {
    if (this.fechado) return;
    this.fechado = true;
    this.db.close();
  }
}

/** Toda coluna e TEXT ou INTEGER; conversao explicita, falha alto. */
function texto(valor: unknown, coluna: string): string {
  if (typeof valor !== 'string') {
    throw new TypeError(`coluna ${coluna} deveria ser TEXT, veio ${typeof valor}`);
  }
  return valor;
}

function numero(valor: unknown): number {
  return typeof valor === 'number' ? valor : 0;
}

function paraEvento(linha: Record<string, unknown>): EventoEnfileirado {
  return {
    eventoId: texto(linha['evento_id'], 'evento_id'),
    tenantId: texto(linha['tenant_id'], 'tenant_id'),
    gymUnitId: texto(linha['gym_unit_id'], 'gym_unit_id'),
    edgeAgentId: texto(linha['edge_agent_id'], 'edge_agent_id'),
    tipo: texto(linha['tipo'], 'tipo'),
    ocorridoEm: new Date(texto(linha['ocorrido_em'], 'ocorrido_em')),
    payload: texto(linha['payload'], 'payload'),
    estado: texto(linha['estado'], 'estado') as EstadoEvento,
    tentativas: numero(linha['tentativas']),
    ultimaFalha: linha['ultima_falha'] === null ? null : texto(linha['ultima_falha'], 'ultima_falha'),
    enfileiradoEm: texto(linha['enfileirado_em'], 'enfileirado_em'),
  };
}
