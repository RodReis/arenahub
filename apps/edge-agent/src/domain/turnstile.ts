/**
 * Porta da catraca -- o que comanda o mundo fisico.
 *
 * Este e o unico lugar do sistema que MOVE alguma coisa. Todo o resto lê,
 * decide e registra; aqui gira. Por isso o contrato e mais estreito que o
 * do leitor facial: menos superficie, menos chance de acionar sem querer.
 */

/** Como a tentativa terminou -- `M0-FR-007`. */
export type DesfechoPassagem =
  /** A pessoa passou e o equipamento confirmou o giro. */
  | 'girou'
  /** Liberou, ninguem passou, a catraca voltou a travar. */
  | 'timeout'
  /** O equipamento nao confirmou nem negou dentro do prazo. */
  | 'desconhecido';

export type ResultadoLiberacao = {
  desfecho: DesfechoPassagem;
  /**
   * Quanto tempo entre o comando e a confirmacao. Alimenta o `M0-NFR-001`
   * (p50, p95 e maximo) -- a medicao que pode reabrir o ADR-004 se o p95
   * passar de 300 ms.
   */
  duracaoMs: number;
};

export interface TurnstileAdapter {
  readonly nome: string;

  /**
   * Libera a catraca UMA vez e espera o desfecho.
   *
   * `comandoId` NAO e decorativo: e a chave de idempotencia. `M0-FR-006`
   * exige "uma unica liberacao para uma decisao autorizada", e `M0-AC-003`
   * mede isso com dez acessos. Reenviar o mesmo `comandoId` tem de ser
   * inofensivo -- a rede repete, o processo reinicia, o operador clica duas
   * vezes.
   *
   * NAO existe metodo `abrir()` sem `comandoId`. Um comando sem chave seria
   * o caminho por onde a dupla liberacao entraria.
   */
  liberar(comandoId: string, timeoutMs: number): Promise<ResultadoLiberacao>;

  encerrar(): Promise<void>;
}
