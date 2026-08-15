import { z } from 'zod';

/**
 * Contrato da ponte com a EasyInner.dll.
 *
 * POR QUE EXISTE UMA PONTE
 * ------------------------
 * O manual do SDK Inner Acesso e categorico (ver
 * `docs/vendor/topdata/PROTOCOLO-CATRACA.md`):
 *
 *   - "EasyInner.dll, uma biblioteca de vinculo dinamico (DLL) para ambiente
 *     Windows";
 *   - "ela e uma biblioteca de 32 bits (x86)";
 *   - "nao e uma API REST"; o transporte e "protocolo binario proprietario",
 *     e reimplementa-lo exige NDA com a Topdata.
 *
 * Ou seja: Node nao fala com a catraca. Um processo Windows x86 com .NET
 * fala, e o edge-agent conversa com esse processo.
 *
 * Isso FECHA o ADR-010 -- e a resposta e diferente para cada dispositivo:
 * o leitor facial e WebSocket puro (roda em Node), a catraca exige bridge
 * nativo. Os dois caminhos ja eram portas separadas desde a F2, o que agora
 * se mostra necessario e nao so arrumado.
 *
 * ESTE ARQUIVO NAO IMPLEMENTA A PONTE. Ele define o contrato entre os dois
 * lados -- as mensagens que atravessam. O processo Windows e trabalho de
 * outra fatia, e a forma (servico .NET com stdio? socket local?) e decisao
 * de arquitetura do PI.
 *
 * O contrato e deliberadamente ESTREITO: quatro comandos. Cada funcao da
 * DLL exposta aqui e uma funcao que alguem pode chamar por engano num
 * equipamento real.
 */

/**
 * Codigos de retorno da DLL.
 *
 * Do manual §2.3. A lista nao e exaustiva -- "a principal fonte para
 * consultar a lista completa... sao os exemplos de codigo da SDK".
 */
export const RETORNO = {
  /** `RET_COMANDO_OK` */
  OK: 0,
  /** `RET_ERRO` -- generico: timeout, parametro invalido, estado errado. */
  ERRO: 1,
  PORTA_NAO_ABERTA: 2,
  PORTA_JA_ABERTA: 3,
  /**
   * GPF. Quase sempre ambiente, nao codigo: DLL nao registrada, .NET 3.5
   * ausente, ou aplicacao 64 bits tentando carregar DLL de 32.
   */
  GPF: 8,
} as const;

/**
 * `Origem` do evento em `ReceberDadosOnLine` -- manual §4.3.2.
 *
 * So os valores que a POC usa. Origem de urna e expedidora existem no
 * manual e nao se aplicam a bancada.
 */
export const ORIGEM = {
  TECLADO: 1,
  LEITOR1: 2,
  LEITOR2: 3,
  /**
   * Tempo de acionamento expirou -- ou seja, LIBEROU E NINGUEM PASSOU.
   *
   * Chega no lugar da Origem 6 quando a pessoa desiste. `M0-FR-007` chama
   * isso de "timeout de passagem".
   */
  FIM_TEMPO_ACIONAMENTO: 5,
  /**
   * Giro confirmado pelo sensor optico. E ESTE o evento que prova a
   * passagem (`M0-AC-005`).
   */
  GIRO_CONFIRMADO: 6,
  SENSOR_BIOMETRICO: 12,
  QRCODE: 21,
} as const;

/** Porta TCP padrao da catraca. Diferente da 7792 do leitor facial. */
export const PORTA_PADRAO_CATRACA = 3570;

/** `DefinirTipoConexao(2)` = TCP/IP com porta fixa, catraca conecta em nos. */
export const TIPO_CONEXAO_TCP_PORTA_FIXA = 2;

// --- o que a ponte ACEITA -------------------------------------------------

/**
 * Comandos que o edge-agent manda para a ponte.
 *
 * Superficie minima de proposito: cada comando aqui e algo que pode mover
 * uma catraca. `ConfigurarAcionamento`, listas offline e mensagens de
 * display existem no SDK e NAO estao expostos -- entram quando uma fatia
 * precisar, com a mesma justificativa que esta exige.
 */
export const esquemaComandoPonte = z.discriminatedUnion('cmd', [
  /** Testa se a catraca esta conectada. `TestarConexaoInner`. */
  z.object({
    cmd: z.literal('testar-conexao'),
    inner: z.number().int().min(1).max(99),
  }),

  /**
   * Libera o giro. `LiberarCatracaEntrada` / `Saida` / `DoisSentidos`.
   *
   * `invertido` existe porque o manual diz que a escolha "depende da
   * orientacao fisica da catraca" -- e a bancada tem a catraca a esquerda
   * ao entrar. Qual das duas serve se descobre NA BANCADA, testando; nao
   * se deduz do papel.
   */
  z.object({
    cmd: z.literal('liberar'),
    inner: z.number().int().min(1).max(99),
    sentido: z.enum(['entrada', 'saida', 'ambos']),
    invertido: z.boolean().default(false),
  }),

  /**
   * Le um evento. `ReceberDadosOnLine` -- BLOQUEANTE do lado da ponte.
   *
   * O manual: "pausa a execucao da thread que a chama ate que um evento
   * seja recebido... ou ocorra um timeout". A ponte e quem sofre esse
   * bloqueio; para nos e uma chamada assincrona normal.
   */
  z.object({
    cmd: z.literal('receber-evento'),
    inner: z.number().int().min(1).max(99),
    timeoutMs: z.number().int().positive(),
  }),

  /**
   * Keep-alive. `PingOnline`.
   *
   * Nao e opcional: "a falta do PingOnline fara com que a catraca mude para
   * o modo offline". Sem ping, a catraca para de perguntar e passa a decidir
   * sozinha -- que e exatamente o que a POC nao quer.
   */
  z.object({
    cmd: z.literal('ping'),
    inner: z.number().int().min(1).max(99),
  }),
]);

export type ComandoPonte = z.infer<typeof esquemaComandoPonte>;

// --- o que a ponte DEVOLVE ------------------------------------------------

/** Evento lido de `ReceberDadosOnLine`, com os campos que a POC usa. */
export const esquemaEventoCatraca = z.object({
  origem: z.number().int(),
  complemento: z.number().int().optional(),
  /**
   * Cartao, senha digitada, QR Code ou id biometrico -- o que veio na
   * leitura. Vazio em evento de giro.
   */
  cartao: z.string().optional(),
  /**
   * Horario DO EQUIPAMENTO. A DLL devolve dia/mes/ano/hora/minuto/segundo
   * separados; a ponte junta em ISO local antes de mandar.
   */
  ocorridoEm: z.string().optional(),
});

export const esquemaRespostaPonte = z.discriminatedUnion('tipo', [
  /** A DLL respondeu. `retorno` e o codigo cru, sem interpretacao. */
  z.object({
    tipo: z.literal('retorno'),
    retorno: z.number().int(),
  }),

  /** `ReceberDadosOnLine` trouxe evento. */
  z.object({
    tipo: z.literal('evento'),
    evento: esquemaEventoCatraca,
  }),

  /** `ReceberDadosOnLine` estourou o prazo sem evento. Nao e erro. */
  z.object({
    tipo: z.literal('sem-evento'),
  }),

  /**
   * A ponte falhou antes de chegar na DLL -- processo morto, protocolo
   * quebrado, DLL nao carregou.
   *
   * Separado de `retorno` de proposito: "a DLL disse nao" e "nao consegui
   * falar com a DLL" pedem acoes diferentes.
   */
  z.object({
    tipo: z.literal('falha-da-ponte'),
    mensagem: z.string(),
  }),
]);

export type RespostaPonte = z.infer<typeof esquemaRespostaPonte>;
export type EventoCatraca = z.infer<typeof esquemaEventoCatraca>;

/**
 * O que o adapter precisa da ponte. Um metodo.
 *
 * Implementacoes: a ponte real (processo Windows, fatia futura) e a falsa
 * dos testes.
 */
export interface PonteEasyInner {
  readonly nome: string;
  executar(comando: ComandoPonte): Promise<RespostaPonte>;
  encerrar(): Promise<void>;
}
