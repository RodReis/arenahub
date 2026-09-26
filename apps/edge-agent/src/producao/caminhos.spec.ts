import { pathToFileURL } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { absoluto, raizDoPacote } from './caminhos.js';

/**
 * Issue #406, setimo elo -- descoberto ao instalar o servico Windows na
 * Arena Positiva, 26/09/2026, ANTES de o servico rodar.
 *
 * Servico Windows inicia em `C:\Windows\System32`. Todo caminho relativo
 * resolvido contra `process.cwd()` apontaria para la: o `.env` seria
 * procurado em `C:\Windows\.env` (agente morre reclamando de EDGE_AGENT_ID,
 * com o valor sentado no arquivo) e o SQLite tentaria nascer em
 * `C:\Windows\System32\data\`, sem permissao -- loop de restart a cada 5 s.
 */
describe('absoluto', () => {
  const RAIZ = process.platform === 'win32' ? 'C:\\ArenaHub\\arenahub' : '/opt/arenahub';

  it('resolve caminho relativo contra a base, nao contra o cwd', () => {
    const resolvido = absoluto('data/edge-agent.sqlite', RAIZ);

    expect(resolvido).toContain('edge-agent.sqlite');
    expect(resolvido.startsWith(RAIZ)).toBe(true);
    // O cwd do processo de teste nao pode influenciar o resultado.
    expect(resolvido).not.toContain(process.cwd());
  });

  /** Quem escreveu caminho absoluto no `.env` quis aquele caminho. */
  it('deixa caminho absoluto intacto', () => {
    const jaAbsoluto = process.platform === 'win32' ? 'D:\\dados\\edge.sqlite' : '/dados/edge.sqlite';

    expect(absoluto(jaAbsoluto, RAIZ)).toBe(jaAbsoluto);
  });
});

describe('raizDoPacote', () => {
  /**
   * O arquivo compilado vive em `<pacote>/dist/main.js`, entao a raiz do
   * pacote e um nivel acima do `dist`.
   */
  it('sobe um nivel a partir de dist/', () => {
    const base = process.platform === 'win32' ? 'C:\\ArenaHub\\apps\\edge-agent' : '/opt/apps/edge-agent';
    const url = pathToFileURL(`${base}${process.platform === 'win32' ? '\\' : '/'}dist${process.platform === 'win32' ? '\\' : '/'}main.js`).href;

    expect(raizDoPacote(url)).toBe(base);
  });

  /**
   * O caminho real do PC da recepcao tem ESPACO no nome do usuario
   * (`C Musculação`), e `new URL(...).pathname` devolveria `%20` -- por isso
   * `fileURLToPath`.
   */
  it('decodifica espaco e acento no caminho', () => {
    const base =
      process.platform === 'win32'
        ? 'C:\\Users\\C Musculação\\edge-agent'
        : '/home/C Musculação/edge-agent';
    const separador = process.platform === 'win32' ? '\\' : '/';
    const url = pathToFileURL(`${base}${separador}dist${separador}main.js`).href;

    expect(raizDoPacote(url)).toBe(base);
  });
});
