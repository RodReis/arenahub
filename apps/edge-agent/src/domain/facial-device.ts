/**
 * Porta do dispositivo facial -- o contrato que separa o dominio do SDK.
 *
 * O `TopdataFacialAdapter` e o simulador implementam esta interface. Nenhuma
 * regra de negocio conhece qualquer detalhe da Topdata, e essa fronteira e o
 * que permite o CI rodar sem hardware (`M0-NFR-006`).
 *
 * IMPORTANTE: nada aqui e derivado de documentacao do SDK. O contrato nasce
 * do que o PRD exige (`M0-FR-002` a `M0-FR-004`), nao do que a Topdata
 * oferece. Quando o SDK chegar, o adapter se adapta a esta interface -- nao
 * o contrario. Interface moldada pelo fornecedor vaza fornecedor para o
 * dominio inteiro.
 */

/**
 * Identificador da pessoa NO DISPOSITIVO.
 *
 * `M0-FR-002` fala em "persistir a correlacao interna/externa": este e o
 * lado externo. O interno e o id da pessoa no ArenaHub.
 *
 * NUNCA derivado de CPF -- ver `gerarExternalEnrollId`.
 */
export type ExternalEnrollId = string;

/** Como a pessoa foi reconhecida. */
export type MetodoReconhecimento = 'facial' | 'teclado' | 'cartao';

export type EventoReconhecimento = {
  externalEnrollId: ExternalEnrollId;
  /**
   * Quando o DISPOSITIVO reconheceu, não quando nós recebemos. `M0-FR-004`
   * pede timestamp do evento; usar o horario de recebimento embaralha a
   * ordem quando ha fila ou reconexao.
   */
  ocorridoEm: Date;
  metodo: MetodoReconhecimento;
  /** Identificador do proprio evento no dispositivo, quando houver. */
  idExternoDoEvento?: string;
};

export type IdentidadeNoDispositivo = {
  externalEnrollId: ExternalEnrollId;
  /** Rotulo legivel, para operacao. NUNCA PII: nome completo nao entra. */
  rotulo: string;
};

/**
 * Resultado de operacao no dispositivo.
 *
 * Deliberadamente NAO e `void`: "mandei o comando" e diferente de "o
 * dispositivo confirmou". A Slice 0.2 exige "exclusao E CONFIRMACAO", e o
 * `M0-AC-002` exige confirmar a ausencia -- um `void` esconderia justamente
 * a diferenca que o aceite mede.
 */
export type ResultadoOperacao =
  | { confirmado: true }
  | { confirmado: false; razao: string };

export interface FacialDeviceAdapter {
  /** Nome legivel do adapter, para log e diagnostico. */
  readonly nome: string;

  /**
   * Cadastra uma identidade. `M0-FR-002` exige UMA POR OPERACAO -- lote
   * esconde qual falhou, e o aceite mede identidade por identidade.
   */
  cadastrar(identidade: IdentidadeNoDispositivo): Promise<ResultadoOperacao>;

  /**
   * Remove e CONFIRMA a remocao (`M0-FR-003`).
   *
   * Remover identidade que nao existe e sucesso, nao erro: o estado
   * desejado -- ausencia -- foi alcancado. Reprocessar exclusao precisa ser
   * seguro (regra de arquitetura no 4).
   */
  remover(externalEnrollId: ExternalEnrollId): Promise<ResultadoOperacao>;

  /**
   * Lista o que existe HOJE no dispositivo.
   *
   * E o que permite detectar dado orfao -- identidade no equipamento sem
   * correspondencia local. O aceite da Slice 0.2 exige "sem deixar dado
   * orfao no dispositivo", e sem esta operacao isso seria afirmacao, nao
   * verificacao.
   */
  listar(): Promise<readonly IdentidadeNoDispositivo[]>;

  /** Registra quem recebe evento de reconhecimento (`M0-FR-004`). */
  aoReconhecer(ouvinte: (evento: EventoReconhecimento) => void): void;

  /** Encerra a conexao. Chamado no shutdown gracioso (`M0-NFR-007`). */
  encerrar(): Promise<void>;
}
