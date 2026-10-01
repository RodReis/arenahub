import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { CommandInbox } from './command-inbox.js';

describe('CommandInbox', () => {
  let raiz: string;
  let caminho: string;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'arenahub-inbox-'));
    caminho = join(raiz, 'data', 'edge-agent.sqlite');
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('cria a pasta do banco quando ela ainda nao existe', () => {
    expect(existsSync(join(raiz, 'data'))).toBe(false);

    const inbox = new CommandInbox(caminho);

    expect(existsSync(caminho)).toBe(true);
    inbox.fechar();
  });

  it('comando nunca registrado nao esta executado', () => {
    const inbox = new CommandInbox(caminho);

    expect(inbox.jaExecutado('cmd-1')).toBe(false);
    inbox.fechar();
  });

  it('registra sucesso e passa a responder executado', () => {
    const inbox = new CommandInbox(caminho);

    inbox.registrarExecucao('cmd-1', true);

    expect(inbox.jaExecutado('cmd-1')).toBe(true);
    inbox.fechar();
  });

  it('registra falha -- NAO conta como executado, para o worker retentar', () => {
    const inbox = new CommandInbox(caminho);

    inbox.registrarExecucao('cmd-1', false);

    // Comando malformado tambem passa por aqui com sucesso=false
    // (device-sync-worker.ts) -- mas o inbox so protege o leitor de
    // reexecucao, nao decide se a nuvem deve retentar. `jaExecutado` falso
    // mantem o worker livre para tentar de novo caso a nuvem reenvie.
    expect(inbox.jaExecutado('cmd-1')).toBe(false);
    inbox.fechar();
  });

  it('sobrevive a reinicio -- novo processo le o que o anterior gravou', () => {
    const primeiro = new CommandInbox(caminho);
    primeiro.registrarExecucao('cmd-1', true);
    primeiro.fechar();

    const segundo = new CommandInbox(caminho);

    expect(segundo.jaExecutado('cmd-1')).toBe(true);
    segundo.fechar();
  });

  it('fechar duas vezes e seguro', () => {
    const inbox = new CommandInbox(caminho);

    inbox.fechar();
    expect(() => inbox.fechar()).not.toThrow();
  });
});
