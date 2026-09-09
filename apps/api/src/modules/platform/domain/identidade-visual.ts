/**
 * Regras de aceitacao da identidade visual do tenant (F62, ADR-052 §9).
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`).
 *
 * IRMA de `kiosk-admin/domain/logotipo-do-patrocinador.ts`, e nao uma
 * extensao dela -- pelo mesmo motivo que aquele arquivo escreveu sobre a
 * midia do totem: la SVG e RECUSADO por decisao explicita (tela publica que
 * fica ligada o dia inteiro na recepcao, sem quem olhe), e aqui SVG e o
 * formato do icone, porque favicon vetorial e o que o PI pediu. Juntar as
 * duas listas produziria um lugar onde o patrocinador volta a poder enviar
 * SVG sem que ninguem tenha decidido isso.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SVG PRECISA DE SANITIZACAO, E ANTIVIRUS NAO BASTA.
 * ---------------------------------------------------------------------------
 *
 * SVG e XML, nao raster: carrega `<script>`, handlers `on*` e
 * `<foreignObject>` (que embute HTML arbitrario dentro do vetor). Servido com
 * `image/svg+xml` e aberto em aba propria, o navegador EXECUTA esse script na
 * origem que serviu o arquivo. Antivirus nao pega: um `<script>` dentro de um
 * SVG nao e malware para nenhuma assinatura -- e um documento XML valido e
 * inofensivo em disco.
 *
 * A recusa e no UPLOAD, e nao so na hora de servir: sanitizar na leitura
 * deixaria o payload gravado no bucket, esperando o dia em que alguem
 * servisse o objeto por outro caminho -- URL assinada, migracao de bucket,
 * ferramenta de suporte. O que nao entra nao vaza.
 *
 * RECUSA, NAO REESCREVE. A alternativa seria remover o `<script>` e gravar o
 * resto. Foi descartada: reescrever o arquivo de alguem sem avisar entrega um
 * logo diferente do que a pessoa viu ao escolher, e um sanitizador que
 * "limpa" e um sanitizador cuja falha e silenciosa -- basta uma construcao
 * nao prevista para o arquivo entrar parecendo limpo. Recusando, a falha e
 * ruidosa: a tela diz que o arquivo tem script e quem enviou troca o arquivo.
 */

export type MotivoDeRecusaDeIdentidade =
  | 'FILE_TOO_LARGE'
  | 'FILE_EMPTY'
  | 'FILE_TYPE_NOT_ALLOWED'
  /** Os bytes nao sao do formato declarado. */
  | 'FILE_SIGNATURE_MISMATCH'
  /** SVG com `<script>`, `on*` ou `<foreignObject>`. */
  | 'SVG_UNSAFE_CONTENT';

export type ResultadoDaAceitacaoDeIdentidade =
  | { readonly aceito: true }
  | { readonly aceito: false; readonly motivo: MotivoDeRecusaDeIdentidade };

/**
 * Teto de 1 MB, para logo e para icone.
 *
 * Metade dos 2 MB do logotipo de patrocinador, e de proposito: estes dois
 * arquivos entram na tela de LOGIN, que e a primeira coisa carregada por quem
 * ainda nao tem sessao -- inclusive na recepcao com internet ruim. Um MB ja e
 * folgado para um SVG de marca (que costuma ter poucos KB) e para um PNG de
 * assinatura.
 */
export const TAMANHO_MAXIMO_DE_IDENTIDADE_BYTES = 1024 * 1024;

/** Lista fechada. Nada de `image/*` -- ele deixaria entrar o que nao foi decidido. */
export const CONTENT_TYPES_DE_IDENTIDADE = ['image/svg+xml', 'image/png'] as const;

export type ContentTypeDeIdentidade = (typeof CONTENT_TYPES_DE_IDENTIDADE)[number];

/** PNG e reconhecido pelos oito primeiros bytes. */
export const BYTES_DO_CABECALHO_DE_IDENTIDADE = 8;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function comecaCom(cabecalho: Uint8Array, assinatura: readonly number[]): boolean {
  if (cabecalho.length < assinatura.length) return false;

  return assinatura.every((byte, indice) => cabecalho[indice] === byte);
}

/** Os bytes sao de PNG? */
export function pareceBytesDePng(cabecalho: Uint8Array): boolean {
  return comecaCom(cabecalho, PNG);
}

/**
 * O texto e um documento SVG?
 *
 * Exige a tag de abertura em algum ponto. NAO e prova de SVG valido, e nao
 * precisa ser: quem prova o conteudo e `svgTemConteudoExecutavel` logo
 * abaixo. Aqui o objetivo e so recusar quem declarou `image/svg+xml` e enviou
 * um ZIP -- o equivalente da checagem de assinatura do PNG.
 */
export function pareceDocumentoSvg(texto: string): boolean {
  return /<svg[\s>]/i.test(texto);
}

/**
 * O SVG carrega algo executavel?
 *
 * Tres familias, e cada uma ja foi vetor de XSS real em SVG servido como
 * `image/svg+xml`:
 *
 *   1. `<script>` -- o obvio;
 *   2. handlers `on*` (`onload`, `onclick`, `onmouseover`, ...) -- script sem
 *      a tag `<script>`;
 *   3. `<foreignObject>` -- embute HTML arbitrario, e com ele `<iframe>`,
 *      `<img onerror>` e o resto do catalogo.
 *
 * Alem dessas tres, tambem recusa `javascript:` em atributo (`href` e
 * `xlink:href` dentro do vetor) e `<use href="http...">`, que puxa conteudo
 * externo em tempo de render.
 *
 * A checagem e por EXPRESSAO SOBRE O TEXTO, e nao por parser de XML. Nao e
 * pouco rigor: e recusa por FAMILIA, nao aceitacao por analise. Um parser
 * responderia "o que este documento significa", e o buraco de um parser e a
 * construcao que ele interpreta diferente do navegador. Aqui a pergunta e
 * outra -- "estas sequencias aparecem?" --, e a resposta erra para o lado
 * seguro: um SVG legitimo que contenha a palavra `onload` num comentario e
 * recusado, e quem enviou tira o comentario. O contrario (script que passa
 * porque o parser discordou do navegador) e o que nao pode acontecer.
 *
 * Por isso o padrao de `on*` casa com espaco antes e `=` depois, tolerando
 * espaco em volta do `=`: `version=` e `font-size=` nao casam, e `onload =`
 * casa -- o espaco antes do `=` e legal em XML e ja foi usado exatamente para
 * escapar de filtro ingenuo.
 */
const PADROES_EXECUTAVEIS: readonly RegExp[] = [
  /<\s*script/i,
  /<\s*foreignObject/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /<\s*use[^>]+href\s*=\s*["']?\s*https?:/i,
];

export function svgTemConteudoExecutavel(texto: string): boolean {
  return PADROES_EXECUTAVEIS.some((padrao) => padrao.test(texto));
}

/**
 * O arquivo de identidade pode ser aceito?
 *
 * Ordem barata-antes-de-cara, a mesma de `aceitarLogotipo`: tamanho primeiro,
 * porque e o teste que protege a memoria; conteudo por ultimo, porque le o
 * arquivo inteiro.
 *
 * Recebe o CONTEUDO COMPLETO, e nao so o cabecalho como o logotipo do
 * patrocinador: `<script>` pode estar na ultima linha de um SVG, e conferir
 * so os primeiros bytes deixaria passar exatamente o caso que a fatia existe
 * para barrar.
 */
export function aceitarArquivoDeIdentidade(entrada: {
  readonly conteudo: Uint8Array;
  readonly contentType: string;
}): ResultadoDaAceitacaoDeIdentidade {
  if (entrada.conteudo.byteLength > TAMANHO_MAXIMO_DE_IDENTIDADE_BYTES) {
    return { aceito: false, motivo: 'FILE_TOO_LARGE' };
  }

  if (entrada.conteudo.byteLength === 0) {
    return { aceito: false, motivo: 'FILE_EMPTY' };
  }

  const tipo = entrada.contentType.toLowerCase();

  if (!CONTENT_TYPES_DE_IDENTIDADE.includes(tipo as ContentTypeDeIdentidade)) {
    return { aceito: false, motivo: 'FILE_TYPE_NOT_ALLOWED' };
  }

  if (tipo === 'image/png') {
    /*
     * A assinatura tem de bater com o TIPO DECLARADO, e nao apenas ser de
     * alguma imagem: senao a lista fechada acima nao trava nada -- bastaria
     * declarar `image/png` e enviar um SVG para pular a sanitizacao inteira.
     * Este e o caminho de fuga obvio, e ele fecha aqui.
     */
    return pareceBytesDePng(entrada.conteudo.subarray(0, BYTES_DO_CABECALHO_DE_IDENTIDADE))
      ? { aceito: true }
      : { aceito: false, motivo: 'FILE_SIGNATURE_MISMATCH' };
  }

  /*
   * `latin1` e nao `utf-8`: a decodificacao UTF-8 de bytes invalidos produz
   * `U+FFFD`, e uma sequencia mal formada podia -- em tese -- apagar o texto
   * que a expressao procura. Em latin1 todo byte vira exatamente um
   * caractere, entao nada some antes da checagem. As tags e atributos que
   * interessam sao todos ASCII.
   */
  const texto = Buffer.from(entrada.conteudo).toString('latin1');

  if (!pareceDocumentoSvg(texto)) {
    return { aceito: false, motivo: 'FILE_SIGNATURE_MISMATCH' };
  }

  if (svgTemConteudoExecutavel(texto)) {
    return { aceito: false, motivo: 'SVG_UNSAFE_CONTENT' };
  }

  return { aceito: true };
}

/**
 * A chave do objeto de identidade visual do tenant.
 *
 * Formato: `tenants/{tenantId}/branding/{logo|icon}.{ext}`.
 *
 * SERVIDOR GERA, cliente nunca escolhe prefixo -- mesma disciplina de
 * `montarChaveDeCadastro` e `montarChaveDeMidia`. Aceitar `key` do corpo
 * deixaria o Super Admin (ou quem tomasse a sessao dele) escrever sobre a
 * biometria de qualquer tenant.
 *
 * Nome FIXO por peca, e nao UUID: sao no maximo dois arquivos por tenant e o
 * upload novo substitui o anterior. Com UUID cada troca de logo deixaria o
 * arquivo velho orfao no bucket, sem ninguem para apaga-lo.
 */
export function montarChaveDeIdentidade(
  tenantId: string,
  peca: 'logo' | 'icon',
  contentType: ContentTypeDeIdentidade,
): string {
  const extensao = contentType === 'image/png' ? 'png' : 'svg';

  return `tenants/${tenantId}/branding/${peca}.${extensao}`;
}

/**
 * O prefixo sob o qual a identidade daquele tenant pode morar.
 *
 * Existe separado porque a LEITURA precisa conferir o que a ESCRITA montou:
 * a chave vem da coluna do tenant, que e dado de banco, e servir uma chave
 * sem conferir o prefixo entregaria objeto de outro tenant -- ou a foto
 * biometrica de um aluno -- a quem conseguisse escrever nessa coluna.
 *
 * Termina em `/` de proposito: sem a barra, `tenants/t1/branding` casaria
 * com `tenants/t1/branding-antigo`, e `startsWith` deixaria de significar
 * "esta dentro do diretorio".
 */
export function prefixoDeIdentidade(tenantId: string): string {
  return `tenants/${tenantId}/branding/`;
}

/** A chave pertence a identidade visual deste tenant? */
export function chaveDeIdentidadePertenceA(chave: string, tenantId: string): boolean {
  return chave.startsWith(prefixoDeIdentidade(tenantId));
}
