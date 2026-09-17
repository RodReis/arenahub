import { describe, expect, it } from '@jest/globals';

import {
  ArmazenamentoDeCredencialEmMemoria,
  CredencialIlegivelError,
} from './armazenamento-de-credencial.js';

describe('CredencialIlegivelError', () => {
  it('carrega o caminho do arquivo e a causa original, com mensagem acionavel', () => {
    const causaOriginal = new Error('Command failed: powershell.exe ... <script embutido>');
    const erro = new CredencialIlegivelError(
      'C:\\Users\\alguem\\AppData\\Local\\ArenaHub\\edge-agent\\credencial.dat',
      causaOriginal,
    );

    expect(erro.name).toBe('CredencialIlegivelError');
    expect(erro.code).toBe('EDGE_CREDENCIAL_ILEGIVEL');
    expect(erro.cause).toBe(causaOriginal);
    expect(erro.message).toContain('credencial.dat');
    expect(erro.message).toContain('outra conta Windows');
    expect(erro.message).toContain('EDGE_PAIRING_CODE');
    // Nunca deve vazar o texto cru do erro do PowerShell na mensagem
    // principal -- so na `cause`, para quem quiser investigar.
    expect(erro.message).not.toContain('powershell.exe');
  });
});

describe('ArmazenamentoDeCredencialEmMemoria', () => {
  it('carrega null quando nada foi salvo', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await expect(armazenamento.carregar()).resolves.toBeNull();
  });

  it('salva e recupera a credencial', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await armazenamento.salvar('key-1', 'segredo-1');
    await expect(armazenamento.carregar()).resolves.toEqual({ keyId: 'key-1', secret: 'segredo-1' });
  });

  it('apagar remove a credencial', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await armazenamento.salvar('key-1', 'segredo-1');
    await armazenamento.apagar();
    await expect(armazenamento.carregar()).resolves.toBeNull();
  });
});
