import { DatabaseSync } from 'node:sqlite';

/**
 * Maquina de estado da passagem online -- F9, Task 4.
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 * -----------------------------------
 * Entre reconhecer alguem e a catraca girar existem quatro momentos em que o
 * processo pode morrer: antes de pedir a decisao, depois de pedir e antes de
 * receber, depois de receber e antes de comandar, e depois de comandar. Em
 * DOIS deles a resposta certa ao reiniciar e "continue"; nos outros dois e
 * "nao repita". Sem estado persistido nao ha como saber em qual deles o
 * processo estava.
 *
 * O caso que dói: crash DEPOIS de mandar girar. O equipamento ja liberou, e
 * o SDK Inner Acesso nao tem id de comando no protocolo -- reenviar
 * `LiberarCatracaEntrada` libera de novo. Se ao reiniciar o agente nao
 * souber que ja comandou, a pessoa passa duas vezes ou a catraca gira
 * sozinha na cara de quem vem atras.
 *
 * Por isso TODA transicao e gravada ANTES do efeito que ela autoriza, com
 * `synchronous = FULL`: numa academia, queda de energia e o cenario
 * esperado, nao a excecao.
 */

/**
 * Estados. A ordem das constantes e a ordem do fluxo.
 *
 * `DECISION_PENDING` existe separado de `RECOGNIZED` porque so ele responde
 * "eu ja perguntei para a nuvem?". Sem essa distincao, um crash entre
 * reconhecer e perguntar seria indistinguivel de um crash entre perguntar e
 * receber -- e o primeiro pede retry, o segundo pede consulta idempotente.
 */
export const ESTADO = {
  RECOGNIZED: 'RECOGNIZED',
  DECISION_PENDING: 'DECISION_PENDING',
  DENIED: 'DENIED',
  ALLOWED: 'ALLOWED',
  COMMAND_PENDING: 'COMMAND_PENDING',
  COMMAND_SENT: 'COMMAND_SENT',
  PASSAGE_CONFIRMED: 'PASSAGE_CONFIRMED',
  PASSAGE_TIMED_OUT: 'PASSAGE_TIMED_OUT',
  /** Enviado a nuvem e confirmado. Linha pode ser limpa depois. */
  REPORTED: 'REPORTED',
} as const;

export type EstadoAcesso = (typeof ESTADO)[keyof typeof ESTADO];

/** Estados dos quais nao se sai. */
const TERMINAIS: ReadonlySet<string> = new Set([ESTADO.REPORTED]);

/**
 * Transicoes permitidas.
 *
 * Tabela explicita, e nao `if` espalhado: a unica forma de a catraca girar
 * duas vezes e uma transicao que ninguem previu, e tabela e o que torna o
 * conjunto de transicoes AUDITAVEL de uma olhada.
 *
 * Note o que NAO existe: nada volta para `COMMAND_PENDING`, e `DENIED` nao
 * chega a `ALLOWED` por caminho nenhum.
 */
const TRANSICOES: Readonly<Record<EstadoAcesso, readonly EstadoAcesso[]>> = {
  RECOGNIZED: [ESTADO.DECISION_PENDING],
  DECISION_PENDING: [ESTADO.DENIED, ESTADO.ALLOWED],
  DENIED: [ESTADO.REPORTED],
  ALLOWED: [ESTADO.COMMAND_PENDING],
  COMMAND_PENDING: [ESTADO.COMMAND_SENT],
  COMMAND_SENT: [ESTADO.PASSAGE_CONFIRMED, ESTADO.PASSAGE_TIMED_OUT],
  PASSAGE_CONFIRMED: [ESTADO.REPORTED],
  PASSAGE_TIMED_OUT: [ESTADO.REPORTED],
  REPORTED: [],
};

export interface TentativaDeAcesso {
  correlationId: string;
  externalUserId: string;
  deviceId: string;
  recognitionId: string;
  estado: EstadoAcesso;
  /** Preenchido quando a nuvem responde. */
  accessEventId: string | null;
  outcome: 'ALLOW' | 'DENY' | null;
  reason: string | null;
  /** Id do comando fisico. Derivado do `accessEventId` -- um evento, um comando. */
  commandId: string | null;
  recognizedAt: string;
  atualizadoEm: string;
  tentativasDeEnvio: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tentativas_de_acesso (
    correlation_id     TEXT PRIMARY KEY,
    external_user_id   TEXT NOT NULL,
    device_id          TEXT NOT NULL,
    recognition_id     TEXT NOT NULL,
    estado             TEXT NOT NULL,
    access_event_id    TEXT,
    outcome            TEXT,
    reason             TEXT,
    command_id         TEXT,
    recognized_at      TEXT NOT NULL,
    atualizado_em      TEXT NOT NULL,
    tentativas_envio   INTEGER NOT NULL DEFAULT 0
  );

  -- Um reconhecimento do equipamento nunca vira duas tentativas. E a
  -- primeira barreira contra dupla liberacao: o leitor dispara em rajada
  -- enquanto a pessoa esta na frente dele.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tentativa_reconhecimento
    ON tentativas_de_acesso (device_id, recognition_id);

  CREATE INDEX IF NOT EXISTS idx_tentativa_estado
    ON tentativas_de_acesso (estado, atualizado_em);
`;

type LinhaSqlite = {
  correlation_id: string;
  external_user_id: string;
  device_id: string;
  recognition_id: string;
  estado: string;
  access_event_id: string | null;
  outcome: string | null;
  reason: string | null;
  command_id: string | null;
  recognized_at: string;
  atualizado_em: string;
  tentativas_envio: number;
};

export class MaquinaDeAcesso {
  private readonly db: DatabaseSync;
  private fechada = false;

  constructor(caminho: string) {
    this.db = new DatabaseSync(caminho);

    // WAL com `synchronous = FULL`: o padrao `NORMAL` devolve "gravei" antes
    // de o SO ter escrito no disco. Sobrevive a crash de processo, nao a
    // queda de energia -- que e justamente o cenario de uma catraca.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = FULL');
    this.db.exec(SCHEMA);
  }

  /**
   * Registra o reconhecimento, ou devolve a tentativa que ja existe.
   *
   * Reentrada idempotente: o mesmo `(deviceId, recognitionId)` nunca vira
   * duas tentativas. O leitor facial dispara varios eventos enquanto a
   * pessoa esta parada na frente dele, e sem esta unicidade cada disparo
   * viraria uma decisao e um comando.
   */
  registrarReconhecimento(dados: {
    correlationId: string;
    externalUserId: string;
    deviceId: string;
    recognitionId: string;
    recognizedAt: Date;
  }): TentativaDeAcesso {
    const existente = this.porReconhecimento(dados.deviceId, dados.recognitionId);

    if (existente) return existente;

    const agora = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO tentativas_de_acesso
           (correlation_id, external_user_id, device_id, recognition_id,
            estado, recognized_at, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        dados.correlationId,
        dados.externalUserId,
        dados.deviceId,
        dados.recognitionId,
        ESTADO.RECOGNIZED,
        dados.recognizedAt.toISOString(),
        agora,
      );

    return this.porCorrelacaoOuFalhar(dados.correlationId);
  }

  /**
   * Move para um estado novo, validando a transicao.
   *
   * Transicao invalida LANCA. Nao devolve `false`, nao registra aviso: um
   * caminho que tenta ir de `DENIED` para `ALLOWED` e bug, e bug perto de
   * catraca precisa parar a operacao, nao seguir degradado.
   */
  transicionar(
    correlationId: string,
    novo: EstadoAcesso,
    dados: {
      accessEventId?: string | null;
      outcome?: 'ALLOW' | 'DENY' | null;
      reason?: string | null;
      commandId?: string | null;
    } = {},
  ): TentativaDeAcesso {
    const atual = this.porCorrelacaoOuFalhar(correlationId);

    // Reentrada no MESMO estado e inofensiva: acontece quando o processo
    // reinicia entre gravar e agir, e o retomador refaz o passo.
    if (atual.estado === novo) return atual;

    if (TERMINAIS.has(atual.estado)) {
      throw new Error(
        `tentativa ${correlationId} ja esta em estado terminal ${atual.estado}; ` +
          `transicao para ${novo} recusada`,
      );
    }

    if (!TRANSICOES[atual.estado].includes(novo)) {
      throw new Error(
        `transicao invalida de ${atual.estado} para ${novo} na tentativa ${correlationId}`,
      );
    }

    this.db
      .prepare(
        `UPDATE tentativas_de_acesso
            SET estado = ?,
                access_event_id = COALESCE(?, access_event_id),
                outcome = COALESCE(?, outcome),
                reason = COALESCE(?, reason),
                command_id = COALESCE(?, command_id),
                atualizado_em = ?
          WHERE correlation_id = ?`,
      )
      .run(
        novo,
        dados.accessEventId ?? null,
        dados.outcome ?? null,
        dados.reason ?? null,
        dados.commandId ?? null,
        new Date().toISOString(),
        correlationId,
      );

    return this.porCorrelacaoOuFalhar(correlationId);
  }

  porCorrelacao(correlationId: string): TentativaDeAcesso | null {
    const linha = this.db
      .prepare('SELECT * FROM tentativas_de_acesso WHERE correlation_id = ?')
      .get(correlationId) as LinhaSqlite | undefined;

    return linha ? this.paraTentativa(linha) : null;
  }

  porReconhecimento(deviceId: string, recognitionId: string): TentativaDeAcesso | null {
    const linha = this.db
      .prepare(
        'SELECT * FROM tentativas_de_acesso WHERE device_id = ? AND recognition_id = ?',
      )
      .get(deviceId, recognitionId) as LinhaSqlite | undefined;

    return linha ? this.paraTentativa(linha) : null;
  }

  /**
   * Tentativas presas em estado nao-terminal -- o que retomar apos reinicio.
   *
   * `COMMAND_SENT` entra na lista de proposito: o comando ja foi dado, mas o
   * desfecho ainda nao chegou a nuvem. Retomar significa REPORTAR, nunca
   * recomandar -- quem consome esta lista precisa olhar o estado antes de
   * agir, e e por isso que o metodo devolve a tentativa inteira.
   */
  pendentes(limite = 100): TentativaDeAcesso[] {
    const linhas = this.db
      .prepare(
        `SELECT * FROM tentativas_de_acesso
          WHERE estado != ?
          ORDER BY atualizado_em ASC
          LIMIT ?`,
      )
      .all(ESTADO.REPORTED, limite) as LinhaSqlite[];

    return linhas.map((l) => this.paraTentativa(l));
  }

  contarEnvio(correlationId: string): void {
    this.db
      .prepare(
        `UPDATE tentativas_de_acesso
            SET tentativas_envio = tentativas_envio + 1, atualizado_em = ?
          WHERE correlation_id = ?`,
      )
      .run(new Date().toISOString(), correlationId);
  }

  /** Remove tentativas ja reportadas e antigas. Higiene, nao regra. */
  limpar(anterioresA: Date): number {
    const resultado = this.db
      .prepare('DELETE FROM tentativas_de_acesso WHERE estado = ? AND atualizado_em < ?')
      .run(ESTADO.REPORTED, anterioresA.toISOString());

    return Number(resultado.changes);
  }

  fechar(): void {
    if (this.fechada) return;

    this.db.close();
    this.fechada = true;
  }

  private porCorrelacaoOuFalhar(correlationId: string): TentativaDeAcesso {
    const tentativa = this.porCorrelacao(correlationId);

    if (!tentativa) {
      throw new Error(`tentativa ${correlationId} nao encontrada`);
    }

    return tentativa;
  }

  private paraTentativa(linha: LinhaSqlite): TentativaDeAcesso {
    return {
      correlationId: linha.correlation_id,
      externalUserId: linha.external_user_id,
      deviceId: linha.device_id,
      recognitionId: linha.recognition_id,
      estado: linha.estado as EstadoAcesso,
      accessEventId: linha.access_event_id,
      outcome: linha.outcome as 'ALLOW' | 'DENY' | null,
      reason: linha.reason,
      commandId: linha.command_id,
      recognizedAt: linha.recognized_at,
      atualizadoEm: linha.atualizado_em,
      tentativasDeEnvio: linha.tentativas_envio,
    };
  }
}
