import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { MaquinaDeAcesso } from './maquina-de-acesso.js';

describe('MaquinaDeAcesso', () => {
  let raiz: string;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'arenahub-maquina-'));
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  /**
   * Issue #406, quarto elo da mesma cadeia -- Arena Positiva, 26/09/2026.
   *
   * `SQLITE_PATH` tem default `data/edge-agent.sqlite`, relativo, e numa
   * instalacao nova a pasta `data/` nao existe. `new DatabaseSync(caminho)`
   * nao a cria: morre com "unable to open database file", uma mensagem que
   * nao diz qual arquivo nem por que.
   *
   * Mesmo defeito que a pasta da credencial teve, em outro lugar: ninguem
   * cria o diretorio antes de escrever nele.
   */
  it('cria a pasta do banco quando ela ainda nao existe', () => {
    const caminho = join(raiz, 'data', 'edge-agent.sqlite');

    expect(existsSync(join(raiz, 'data'))).toBe(false);

    const maquina = new MaquinaDeAcesso(caminho);

    expect(existsSync(caminho)).toBe(true);

    maquina.fechar();
  });

  /** Pasta ja existente nao e recriada nem perde o que tem dentro. */
  it('abre normalmente quando a pasta ja existe', () => {
    const caminho = join(raiz, 'edge-agent.sqlite');

    const primeira = new MaquinaDeAcesso(caminho);
    primeira.fechar();

    const segunda = new MaquinaDeAcesso(caminho);

    expect(existsSync(caminho)).toBe(true);

    segunda.fechar();
  });
});
