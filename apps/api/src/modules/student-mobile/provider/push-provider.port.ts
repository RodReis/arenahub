/**
 * ---------------------------------------------------------------------------
 * ENTREGA DE PUSH -- F29, Slice 4.7.
 * ---------------------------------------------------------------------------
 *
 * PROVEDOR ESCOLHIDO PELO PI EM 14/09/2026: OneSignal. O adapter real entra
 * quando as credenciais existirem (conta OneSignal, chave FCM e certificado
 * APNs); ate la vale o dublê, e `PUSH_NOTIFICATIONS` fica desligado.
 *
 * A ausencia do adapter NAO tira funcionalidade do aluno: a caixa interna e a
 * entrega, e push e so um atalho ate ela. Sem provedor, o aviso continua
 * chegando -- o aluno o le ao abrir o app.
 *
 * Mesmo criterio de `AI_PROVIDER` e `DOCUMENT_EXTRACTOR`: chave presente usa
 * o real, ausente cai no dublê, e a API nunca morre por falta de credencial
 * de terceiro.
 */

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export type CodigoDeErroDePush =
  /** Provedor fora do ar ou recusando. Vale repetir. */
  | 'PUSH_PROVIDER_UNAVAILABLE'
  /**
   * O provedor recusou ESTE token: app desinstalado, token rotacionado.
   *
   * NAO vale repetir, e a consequencia e desativar a subscription -- insistir
   * num endereco morto so gasta cota.
   */
  | 'PUSH_TOKEN_REJECTED';

export class ErroDePush extends Error {
  constructor(
    readonly codigo: CodigoDeErroDePush,
    readonly recuperavel: boolean,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroDePush';
  }
}

/**
 * O que sai daqui para o provedor.
 *
 * CONTEUDO MINIMO, e a lista curta e o desenho. O que chega ao provedor
 * tambem chega a tela bloqueada do celular -- onde qualquer um que olhe o
 * aparelho le. Por isso nao ha valor de fatura, nome de exame nem numero de
 * matricula: o titulo generico e o corpo neutro levam o aluno a abrir o app,
 * e o detalhe vive atras da sessao autenticada.
 *
 * `destinationToken` e o token JA DECIFRADO. Vive em memoria, entre a leitura
 * do banco e a chamada HTTP, e nao pode ser logado nem serializado -- o
 * adapter que o imprimir num log de erro vaza endereco de entrega de push de
 * aluno identificavel.
 */
export interface EnvioDePush {
  readonly destinationToken: string;
  readonly title: string;
  readonly body: string;
  /**
   * Para onde o toque leva, como CODIGO opaco -- nunca URL.
   *
   * O app troca o token pelo aviso autenticado e navega a partir dele. Assim
   * o payload que trafega pelo provedor (um terceiro) nao diz nem o que o
   * aviso e, nem para qual recurso aponta.
   */
  readonly actionToken: string;
}

export interface ReciboDePush {
  readonly receiptId: string;
}

export interface PushProvider {
  enviar(envio: EnvioDePush): Promise<ReciboDePush>;
}
