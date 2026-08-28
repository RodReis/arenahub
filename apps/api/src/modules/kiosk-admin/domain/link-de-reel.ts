/**
 * Aceitacao do link de reel do Instagram (ADR-042, Decisao 7).
 *
 * PURA: sem rede, sem processo, sem relogio. Entra texto, sai veredito.
 *
 * ---------------------------------------------------------------------------
 * ESTA FUNCAO E UMA FRONTEIRA DE SEGURANCA, NAO UMA VALIDACAO DE FORMULARIO.
 * ---------------------------------------------------------------------------
 *
 * O que ela aprova vira (a) argumento de um processo externo que BAIXA o que a
 * URL apontar e (b) parte de uma chave no object storage. As duas coisas
 * mudam o que "invalido" custa:
 *
 *   - host livre = SSRF. O servidor buscaria qualquer coisa alcancavel a
 *     partir dele -- rede interna, endpoint de metadados de nuvem, `file://`.
 *     Por isso o host e comparado INTEIRO contra uma lista fechada, nunca por
 *     `includes`/`endsWith` (que aceitariam `evil-instagram.com`).
 *   - codigo livre = argumento hostil. Por isso `[A-Za-z0-9_-]`, o alfabeto
 *     real do shortcode do Instagram: o que nao casa, nao passa.
 *
 * A URL devolvida e CANONICA (sem query, sempre `www`, sempre com barra
 * final). O gerente cola o link do botao "copiar" do app, cheio de parametro
 * de rastreamento; guardar a forma crua faria o mesmo reel parecer dois links
 * diferentes conforme de onde foi copiado.
 */

/** Hosts aceitos, INTEIROS. Comparacao por igualdade, nunca por sufixo. */
const HOSTS = new Set(['instagram.com', 'www.instagram.com']);

/**
 * Caminhos sob os quais o Instagram serve um post.
 *
 * `reel` e `reels` coexistem (o app gera um, a web gera o outro), `p` e o
 * post classico e `tv` e o IGTV legado -- todos resolvem para o mesmo
 * conteudo, entao recusar qualquer um deles rejeitaria link legitimo.
 */
const CAMINHOS = new Set(['reel', 'reels', 'p', 'tv']);

/** O alfabeto do shortcode. Fecha a porta para argumento hostil. */
const CODIGO = /^[A-Za-z0-9_-]{5,64}$/u;

export type MotivoDeRecusaDeLink = 'LINK_NAO_E_DO_INSTAGRAM' | 'LINK_NAO_APONTA_PARA_POST';

export type AceitacaoDeLink =
  | { readonly aceito: true; readonly url: string; readonly codigo: string }
  | { readonly aceito: false; readonly motivo: MotivoDeRecusaDeLink };

export function aceitarLinkDeReel(entrada: string): AceitacaoDeLink {
  let url: URL;

  try {
    url = new URL(entrada.trim());
  } catch {
    // Texto que nem e URL cai aqui -- inclusive `javascript:alert(1)` mal
    // formado. Recusar sem lancar mantem a funcao total: quem chama trata
    // veredito, nunca excecao.
    return { aceito: false, motivo: 'LINK_NAO_E_DO_INSTAGRAM' };
  }

  /*
   * HTTPS e nada mais. `http:` desceria para texto claro e `file:`/`ftp:`
   * fariam o processo externo ler disco ou falar outro protocolo.
   *
   * `url.hostname` (e nao `url.host`) descarta porta, e a classe `URL` ja
   * resolve credencial embutida: em
   * `https://www.instagram.com@evil.com/...` o hostname e `evil.com`, que
   * nao esta na lista -- e por isso a checagem abaixo o recusa sem precisar
   * de regra propria para esse truque.
   */
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) {
    return { aceito: false, motivo: 'LINK_NAO_E_DO_INSTAGRAM' };
  }

  const partes = url.pathname.split('/').filter((parte) => parte !== '');

  if (partes.length < 2 || !CAMINHOS.has(partes[0]!)) {
    return { aceito: false, motivo: 'LINK_NAO_APONTA_PARA_POST' };
  }

  const codigo = partes[1]!;

  if (!CODIGO.test(codigo)) {
    return { aceito: false, motivo: 'LINK_NAO_APONTA_PARA_POST' };
  }

  /*
   * Reconstruida a partir das PARTES VALIDADAS, e nao `url.toString()` com a
   * query removida: montar do que passou pela checagem garante que nada do
   * texto original sobrevive na saida -- nem fragmento, nem porta, nem
   * caixa alta no host.
   */
  return {
    aceito: true,
    url: `https://www.instagram.com/${partes[0]}/${codigo}/`,
    codigo,
  };
}
