import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { CAMINHO_PONTE, montarDispositivos } from './montar-dispositivos.js';
import { carregarConfig } from '../config/env.js';
import { criarLogger } from '../observability/logger.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';
import { TurnstileSimulator } from '../adapters/turnstile-simulator.js';

const baseEnv = {
  EDGE_AGENT_ID: 'edge-1',
  TENANT_ID: '11111111-1111-4111-8111-111111111111',
  GYM_UNIT_ID: '22222222-2222-4222-8222-222222222222',
};

/**
 * Issue #406, oitavo elo -- Arena Positiva, 26-29/09/2026.
 *
 * `CAMINHO_PONTE` era `'native/easyinner-bridge/EasyInnerBridge.exe'`,
 * relativo. Como servico Windows o `cwd` e `C:\Windows\System32`, e o spawn
 * morria com `ENOENT` -- so achado ao testar contra hardware real, porque o
 * driver de diagnostico (`driver-teste.mjs`) nao passa por
 * `montarDispositivos`.
 *
 * Segundo defeito, escondido atras do primeiro: faltava o segmento `bin/`
 * -- `bridge:build` gera o executavel em `native/easyinner-bridge/bin/
 * EasyInnerBridge.exe` (`build.ps1`), nao direto em `native/easyinner-
 * bridge/`. Corrigir so o `cwd` teria continuado a dar ENOENT, pela pasta
 * errada.
 */
describe('CAMINHO_PONTE', () => {
  it('e absoluto, nao depende do cwd do processo', () => {
    expect(isAbsolute(CAMINHO_PONTE)).toBe(true);
  });

  it('aponta para dentro de bin/, onde bridge:build gera o executavel', () => {
    expect(CAMINHO_PONTE).toContain(`${sep}native${sep}easyinner-bridge${sep}bin${sep}`);
    expect(CAMINHO_PONTE.endsWith('EasyInnerBridge.exe')).toBe(true);
  });

  /**
   * #406, nono elo: a correcao do #447 subia UM nivel a partir deste arquivo,
   * o que so vale para `dist/main.js`. Este modulo compila para
   * `dist/producao/`, e o caminho saiu com um `dist\` a mais --
   * `...\edge-agent\dist\native\...\EasyInnerBridge.exe`, ENOENT de novo.
   *
   * Os dois testes acima passavam assim mesmo: conferiam o SUFIXO do caminho,
   * nunca a raiz. Este confere a raiz pelo que a define -- quatro niveis acima
   * do executavel (bin, easyinner-bridge, native) tem de estar o
   * `package.json` do pacote. `dist/` e `src/` nao tem um.
   */
  it('parte da raiz do pacote, onde esta o package.json', () => {
    const raiz = resolve(CAMINHO_PONTE, '..', '..', '..', '..');

    expect(existsSync(join(raiz, 'package.json'))).toBe(true);
  });
});

describe('montarDispositivos', () => {
  it('monta os dois simuladores quando os flags sao simulador (padrao)', async () => {
    const config = carregarConfig(baseEnv);
    const logger = criarLogger(config);

    const montado = await montarDispositivos(config, logger);

    expect(montado.facial).toBeInstanceOf(FacialSimulator);
    expect(montado.catraca).toBeInstanceOf(TurnstileSimulator);

    await montado.encerrar();
  });

  it('encerrar() e idempotente e nao lanca', async () => {
    const config = carregarConfig(baseEnv);
    const logger = criarLogger(config);
    const montado = await montarDispositivos(config, logger);

    await montado.encerrar();
    await expect(montado.encerrar()).resolves.not.toThrow();
  });
});
