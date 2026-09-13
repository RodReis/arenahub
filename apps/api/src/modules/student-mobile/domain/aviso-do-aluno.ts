/**
 * ---------------------------------------------------------------------------
 * AVISO AO ALUNO -- F29, Slice 4.7.
 * ---------------------------------------------------------------------------
 *
 * A caixa interna e a ENTREGA; o push e so um atalho ate ela. Consequencia
 * pratica: nada aqui depende de push ter funcionado, e o aluno que recusou
 * notificacao ve os mesmos avisos de quem aceitou.
 *
 * Funcoes puras -- sem banco, sem relogio proprio.
 */

export const ACOES_DE_AVISO = ['NONE', 'OPEN_INVOICE', 'OPEN_ATTENDANCE', 'OPEN_HEALTH'] as const;

export type AcaoDeAviso = (typeof ACOES_DE_AVISO)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Codigo -> rota local do app.
 *
 * ESTE MAPA E A RAZAO DE O BANCO NAO GUARDAR URL.
 *
 * Guardando URL, quem escrevesse uma linha na tabela escolheria para onde o
 * app navega -- e `https://` num campo que o aplicativo abre e phishing com a
 * marca da academia em volta. Com codigo, o conjunto de destinos possiveis e
 * este objeto, escrito aqui, e uma linha adulterada nao consegue inventar
 * destino novo.
 */
const ROTA: Record<AcaoDeAviso, string | null> = {
  NONE: null,
  OPEN_INVOICE: '/financeiro',
  OPEN_ATTENDANCE: '/frequencia',
  OPEN_HEALTH: '/avaliacoes',
};

/**
 * Para onde o toque leva. `null` = aviso que so informa.
 *
 * O alvo entra como QUERY, nunca concatenado no caminho: `/financeiro/${alvo}`
 * com um alvo `../../admin` mudaria a rota. E ele so viaja se for UUID --
 * qualquer outra coisa cai na lista, que e o destino seguro.
 */
export function rotaDoAviso(acao: AcaoDeAviso, alvo: string | null): string | null {
  const base = ROTA[acao];
  if (base === undefined || base === null) return null;

  if (alvo === null || !UUID.test(alvo)) return base;

  return `${base}?${parametroDe(acao)}=${alvo}`;
}

function parametroDe(acao: AcaoDeAviso): string {
  return acao === 'OPEN_INVOICE' ? 'invoice' : 'id';
}

/**
 * O aviso ainda vale a pena mostrar?
 *
 * Some da TELA, nunca do banco: a linha continua existindo porque "o aluno
 * foi avisado?" e a primeira pergunta quando ele contesta uma cobranca.
 */
export function estaVisivel(aviso: { readonly expiresAt: Date | null }, agora: Date): boolean {
  if (aviso.expiresAt === null) return true;

  // `>` e nao `>=`: prazo "ate as 12h" que ainda aparece as 12h em ponto e,
  // na pratica, prazo ate 12h00'01".
  return aviso.expiresAt.getTime() > agora.getTime();
}
