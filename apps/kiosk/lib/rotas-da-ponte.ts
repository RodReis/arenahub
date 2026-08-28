/**
 * Allowlist dos caminhos que a ponte assinada aceita.
 *
 * NAO confiar em normalizacao -- enumerar o permitido. A reescrita textual
 * anterior (`/api/kiosk/X` -> `/api/v1/kiosk/X`) nao se concretizava em
 * travessia hoje, mas so por dois acidentes FORA deste codigo: com `..` a
 * assinatura quebra porque o `fetch` normaliza e o texto canonico nao, e com
 * `%2f` a assinatura bate mas o Express nao decodifica como separador. Troque
 * o cliente HTTP ou ponha um proxy na frente e a ponte vira proxy assinado
 * para `/api/v1/*` inteiro -- rotas administrativas incluidas, com a
 * credencial do dispositivo.
 *
 * PURA: entra o pathname cru, sai o caminho da API ou `null`. Sem rede, sem
 * ambiente -- e o que a torna testavel sem subir servidor.
 */

/** UUID v4, o formato que o Prisma gera para `KioskSession.id`. */
const ID_DE_SESSAO = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * Um padrao por endpoint da jornada. `^...$` ancorado nas duas pontas: sem a
 * ancora final, `config/../../admin` casaria o prefixo e passaria.
 */
const PERMITIDOS: readonly RegExp[] = [
  /^config$/,
  /^heartbeat$/,
  /^sessions$/,
  new RegExp(`^sessions/${ID_DE_SESSAO}/extend$`),
  new RegExp(`^sessions/${ID_DE_SESSAO}$`),
  /*
   * AREA DO ALUNO (F52). Um padrao por endpoint, com o id da sessao
   * ancorado no mesmo formato -- e nao um `sessions/<id>/.*` que passaria
   * qualquer sub-caminho futuro sem ninguem reler esta lista.
   */
  new RegExp(`^sessions/${ID_DE_SESSAO}/payments$`),
  new RegExp(`^sessions/${ID_DE_SESSAO}/payments/pix$`),
  new RegExp(`^sessions/${ID_DE_SESSAO}/payments/card-checkout$`),
  new RegExp(`^sessions/${ID_DE_SESSAO}/payments/${ID_DE_SESSAO}$`),
  new RegExp(`^sessions/${ID_DE_SESSAO}/assessment$`),
  new RegExp(`^sessions/${ID_DE_SESSAO}/assessments$`),
  new RegExp(`^sessions/${ID_DE_SESSAO}/evolution$`),
  /* PREFERENCIA DE ENGAJAMENTO E IDENTIDADE PUBLICA (F30, Task 8). */
  new RegExp(`^sessions/${ID_DE_SESSAO}/engajamento/preferencias$`),
  new RegExp(`^sessions/${ID_DE_SESSAO}/engajamento/perfil-publico$`),
  /* XP E CONQUISTAS DO ALUNO (F31, Task 9). */
  new RegExp(`^sessions/${ID_DE_SESSAO}/engajamento/xp$`),
  /*
   * DESAFIOS (F34, Slice 5.5).
   *
   * Um padrao por endpoint, como manda o comentario do topo -- e o
   * `challengeId` e ancorado no MESMO formato de UUID: `[^/]+` deixaria
   * passar `..%2f` e qualquer caminho que a API venha a expor depois.
   *
   * ⚠️ ESTA LISTA E O QUE FEZ A TELA DE DESAFIOS DAR 404 EM 28/08/2026: a
   * rota existia na API, o modulo estava ligado, a tela renderizava -- e a
   * ponte recusava antes de assinar. Endpoint novo no totem SEMPRE precisa
   * de uma linha aqui, e nenhum teste da API pega a falta dela.
   */
  new RegExp(`^sessions/${ID_DE_SESSAO}/engajamento/desafios$`),
  new RegExp(`^sessions/${ID_DE_SESSAO}/engajamento/desafios/${ID_DE_SESSAO}/join$`),
  new RegExp(`^sessions/${ID_DE_SESSAO}/engajamento/desafios/avisos/lidos$`),
  /* CONTESTACOES (F35, Slice 5.6) -- abrir (POST) e acompanhar (GET). */
  new RegExp(`^sessions/${ID_DE_SESSAO}/engajamento/contestacoes$`),
];

/**
 * Traduz o pathname da ponte para o caminho da API, ou `null` se nao estiver
 * na lista.
 *
 * A comparacao e feita sobre o caminho AINDA CODIFICADO: decodificar antes
 * transformaria `%2e%2e` em `..` e faria o proprio filtro produzir a
 * travessia que ele existe para barrar. `%` sequer aparece nos padroes
 * acima, entao qualquer codificacao percentual e recusada por nao casar.
 */
export function resolverCaminhoDaPonte(pathname: string): string | null {
  const prefixo = '/api/kiosk/';

  if (!pathname.startsWith(prefixo)) return null;

  const resto = pathname.slice(prefixo.length);

  if (!PERMITIDOS.some((padrao) => padrao.test(resto))) return null;

  return `/api/v1/kiosk/${resto}`;
}
