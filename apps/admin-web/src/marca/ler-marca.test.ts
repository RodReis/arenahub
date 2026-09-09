import { afterEach, describe, expect, it, vi } from 'vitest';

import { MARCA_ARENAHUB, lerMarca } from './ler-marca';

function respondendo(corpo: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(corpo) } as unknown as Response)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A leitura da marca na tela de login — F62 (ADR-052 §10).
 *
 * A propriedade que TODOS estes testes protegem é uma só: esta função nunca
 * lança. A tela de login é a última que pode quebrar — quem não consegue
 * entrar por causa de um logo não tem para onde ir, e o erro apareceria como
 * página de erro do Next, sem formulário nenhum.
 */
describe('lerMarca', () => {
  it('devolve a marca da academia quando a API responde', async () => {
    respondendo({
      slug: 'arena-positiva',
      displayName: 'Arena Positiva',
      missionText: 'Treinar todo mundo.',
      highlightsText: 'Quadra de areia.',
      temLogo: true,
      temIcone: false,
    });

    await expect(lerMarca('arena-positiva')).resolves.toEqual({
      slug: 'arena-positiva',
      displayName: 'Arena Positiva',
      missionText: 'Treinar todo mundo.',
      highlightsText: 'Quadra de areia.',
      temLogo: true,
      temIcone: false,
    });
  });

  it('cai na marca ArenaHub quando a API recusa', async () => {
    respondendo({}, false);

    await expect(lerMarca('nao-existe')).resolves.toEqual(MARCA_ARENAHUB);
  });

  /**
   * API FORA DO AR não pode virar página de erro. Sem o `catch`, o `fetch` que
   * rejeita subiria pela árvore de render e a tela de login inteira sumiria
   * porque a API estava reiniciando.
   */
  it('cai na marca ArenaHub quando o fetch rejeita', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    await expect(lerMarca('arena-positiva')).resolves.toEqual(MARCA_ARENAHUB);
  });

  it('cai na marca ArenaHub quando o corpo nao e objeto', async () => {
    respondendo('nao sou json de marca');

    await expect(lerMarca('arena-positiva')).resolves.toEqual(MARCA_ARENAHUB);
  });

  /**
   * `displayName` AUSENTE é o campo que a tela renderiza como título da
   * coluna. Aceitá-lo pintaria uma coluna com título vazio — pior que o
   * fallback, que ao menos diz "ArenaHub".
   */
  it('cai na marca ArenaHub quando falta o nome', async () => {
    respondendo({ slug: 'x', temLogo: true });

    await expect(lerMarca('x')).resolves.toEqual(MARCA_ARENAHUB);
  });

  /**
   * TIPO ERRADO NO CAMPO OPCIONAL não derruba a marca inteira: o nome veio, e
   * é o que a tela precisa. O campo malformado vira `null` e a tela cai no
   * discurso do produto naquele bloco — degradar por parte é melhor que
   * descartar uma resposta boa por causa de um campo.
   */
  it('descarta campo de texto com tipo errado sem perder o resto', async () => {
    respondendo({
      slug: 'arena-positiva',
      displayName: 'Arena Positiva',
      missionText: 42,
      temLogo: 'sim',
    });

    await expect(lerMarca('arena-positiva')).resolves.toEqual({
      slug: 'arena-positiva',
      displayName: 'Arena Positiva',
      missionText: null,
      highlightsText: null,
      // `'sim'` NÃO é `true`: a comparação é estrita de propósito, senão
      // qualquer string ligaria o `<img>` de um logo que não existe.
      temLogo: false,
      temIcone: false,
    });
  });

  /**
   * SLUG COM BARRA não pode escapar do caminho. Sem `encodeURIComponent`,
   * `../../auth/me` viraria outra rota da API — e esta função a chama sem
   * cookie, mas o próximo endpoint público a ganhar dado sensível herdaria o
   * buraco.
   */
  it('escapa o slug no caminho', async () => {
    const espia = vi.fn((_url: string) =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as unknown as Response),
    );

    vi.stubGlobal('fetch', espia);

    await lerMarca('../auth/me');

    const chamada = espia.mock.calls[0]?.[0] ?? '';

    expect(chamada).toContain('%2F');
    expect(chamada).not.toContain('/auth/me');
  });
});
