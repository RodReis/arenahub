/**
 * Fronteira da extracao de midia externa (ADR-042, Decisao 7).
 *
 * PORTA SEPARADA porque a dependencia atras dela e a mais instavel do
 * sistema: o Instagram nao expoe URL estavel de midia, e a extracao e nao
 * oficial -- ela quebra sem aviso a cada mudanca da Meta. Isso foi assumido
 * pelo PI e esta registrado no ADR; o que a porta compra e que a quebra
 * fique de UM lado so, testavel por dublê e substituivel sem tocar em caso
 * de uso.
 *
 * ---------------------------------------------------------------------------
 * FALHA DE EXTRACAO NAO E ERRO DE SISTEMA. E RESULTADO ESPERADO.
 * ---------------------------------------------------------------------------
 *
 * Mesma disciplina de `MalwareScanner`: um reel apagado, privado ou
 * indisponivel e caso de uso NORMAL -- o painel avisa o gerente enquanto ele
 * olha e oferece o upload de MP4 (trava 1 do ADR). Tratar isso como excecao
 * de infraestrutura misturaria "o reel nao esta la" com "a ferramenta
 * quebrou", que pedem respostas opostas: a primeira o gerente resolve
 * trocando o link, a segunda ninguem resolve pela tela.
 *
 * Por isso `baixar` devolve veredito e so lanca quando a FERRAMENTA falhou.
 */

export type MotivoDeFalhaDeExtracao =
  /** O post nao existe, foi apagado, e privado ou exige login. */
  | 'MIDIA_INDISPONIVEL'
  /** Veio, mas passa do teto -- o mesmo de `TAMANHO_MAXIMO_DE_MIDIA_BYTES`. */
  | 'MIDIA_GRANDE_DEMAIS'
  /** Nao ha faixa de video no post (carrossel so de imagem, por exemplo). */
  | 'MIDIA_SEM_VIDEO';

export type ResultadoDaExtracao =
  | {
      readonly extraido: true;
      readonly conteudo: Uint8Array;
      readonly contentType: string;
    }
  | {
      readonly extraido: false;
      readonly motivo: MotivoDeFalhaDeExtracao;
    };

export type CodigoDeErroDeExtracao =
  /** A ferramenta nao existe no ambiente, ou nao pode ser executada. */
  | 'EXTRATOR_INDISPONIVEL'
  /** Passou do tempo. Rede lenta, ou a Meta segurando a resposta. */
  | 'EXTRATOR_TIMEOUT'
  /**
   * A ferramenta rodou e falhou de um jeito que nao sabemos ler.
   *
   * E O CODIGO QUE A QUEBRA DA META VAI PRODUZIR, e por isso ele existe
   * separado de `MIDIA_INDISPONIVEL`: no dia em que o extrator parar de
   * funcionar para TODO reel, o painel precisa dizer "a ferramenta quebrou",
   * nao "seu link esta errado" -- senao o gerente troca de link para sempre
   * atras de um defeito que nao e dele.
   */
  | 'EXTRATOR_FALHOU';

export class ErroDoExtrator extends Error {
  constructor(
    readonly codigo: CodigoDeErroDeExtracao,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroDoExtrator';
  }
}

export interface MediaFetcher {
  /**
   * Baixa a midia de `url` -- que JA passou por `aceitarLinkDeReel`.
   *
   * O adapter NAO revalida o host: quem chama e responsavel por so trazer
   * URL aprovada, e duplicar a regra criaria duas definicoes de "link
   * aceitavel" que divergem na primeira mudanca. O teste que prende isso
   * vive no caso de uso.
   */
  baixar(url: string, tetoBytes: number): Promise<ResultadoDaExtracao>;
}

export const MEDIA_FETCHER = Symbol('MEDIA_FETCHER');
