import 'server-only';

/**
 * A marca da academia daquele slug — F62 (ADR-052 §10).
 *
 * NÃO usa `chamarApi`: aquele repassa os cookies da sessão, e esta leitura
 * acontece na tela de LOGIN, onde não há sessão para repassar. Chamar de lá
 * gastaria uma leitura de cookies para nada e, pior, faria uma rota pública
 * parecer autenticada para quem lesse o código depois.
 *
 * Mesma variável de ambiente das Server Actions, pelo motivo que o
 * `next.config.ts` já registra: `API_INTERNAL_URL` não vai para o bundle.
 */
const URL_INTERNA = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3344';

export interface MarcaDaAcademia {
  readonly slug: string;
  readonly displayName: string;
  readonly missionText: string | null;
  readonly highlightsText: string | null;
  readonly temLogo: boolean;
  readonly temIcone: boolean;
}

/**
 * A marca do ArenaHub — o que a tela mostra sem slug, e também quando o slug
 * não corresponde a academia nenhuma.
 *
 * Os dois casos são o MESMO objeto de propósito: a API já responde assim para
 * slug desconhecido (ver `branding-publico.controller.ts`), e ter aqui um
 * segundo texto para "slug errado" faria a tela dizer, sem querer, que aquele
 * identificador foi tentado e não existe.
 */
export const MARCA_ARENAHUB: MarcaDaAcademia = {
  slug: '',
  displayName: 'ArenaHub',
  missionText: null,
  highlightsText: null,
  temLogo: false,
  temIcone: false,
};

/**
 * Lê a marca pelo slug. NUNCA lança.
 *
 * API fora do ar, slug desconhecido, resposta malformada: os três caem na
 * marca ArenaHub. A tela de login é a última que pode quebrar — quem não
 * consegue entrar por causa de um logo não tem para onde ir.
 */
export async function lerMarca(slug: string): Promise<MarcaDaAcademia> {
  try {
    const resposta = await fetch(
      `${URL_INTERNA}/api/v1/branding/${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    );

    if (!resposta.ok) return MARCA_ARENAHUB;

    const corpo: unknown = await resposta.json();

    if (typeof corpo !== 'object' || corpo === null) return MARCA_ARENAHUB;

    const dados = corpo as Record<string, unknown>;

    // Checagem campo a campo, e não `as MarcaDaAcademia`: a resposta é dado
    // externo, e um `displayName` ausente viraria `undefined` renderizado
    // como texto vazio no lugar do nome da academia.
    if (typeof dados['displayName'] !== 'string' || dados['displayName'] === '') {
      return MARCA_ARENAHUB;
    }

    return {
      slug: typeof dados['slug'] === 'string' ? dados['slug'] : '',
      displayName: dados['displayName'],
      missionText: typeof dados['missionText'] === 'string' ? dados['missionText'] : null,
      highlightsText:
        typeof dados['highlightsText'] === 'string' ? dados['highlightsText'] : null,
      temLogo: dados['temLogo'] === true,
      temIcone: dados['temIcone'] === true,
    };
  } catch {
    return MARCA_ARENAHUB;
  }
}
