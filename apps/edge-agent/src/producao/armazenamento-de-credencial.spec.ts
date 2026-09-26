import { describe, expect, it, jest } from '@jest/globals';

import {
  ArmazenamentoDeCredencialEmMemoria,
  ArmazenamentoDeCredencialWindows,
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

/**
 * Issue #406 -- instalacao real na Arena Positiva, 26/09/2026.
 *
 * O pareamento com a nuvem funcionou e a credencial chegou, mas `salvar`
 * morreu com "Nao e possivel localizar o tipo
 * [System.Security.Cryptography.ProtectedData]" -- e o codigo de uso unico
 * ja tinha sido queimado na troca.
 *
 * No Windows PowerShell 5.1 (Desktop, .NET Framework) o tipo mora em
 * `System.Security.dll`, que NAO vem carregado numa sessao `-NoProfile`.
 * Sem `Add-Type -AssemblyName System.Security`, os tres scripts que tocam
 * DPAPI falham na primeira linha que menciona o tipo.
 */
describe('ArmazenamentoDeCredencialWindows', () => {
  function espiao() {
    const chamadas: string[] = [];

    const executar = jest.fn((...args: unknown[]) => {
      // O script e o ultimo argumento, depois de `-Command`.
      const argumentos = (args[1] ?? []) as readonly string[];

      chamadas.push(argumentos[argumentos.length - 1] ?? '');

      return Promise.resolve({ stdout: '', stderr: '' });
    });

    /*
     * `as never`: a assinatura real de `promisify(execFile)` e um conjunto de
     * sobrecargas que nenhum `jest.fn` satisfaz. O duble so precisa do
     * caminho que a classe usa (arquivo, argumentos, opcoes).
     */
    return { chamadas, executar: executar as never };
  }

  const CAMINHO = 'C:\\Users\\alguem\\AppData\\Local\\ArenaHub\\edge-agent\\credencial.dat';

  it('carrega System.Security antes de usar ProtectedData ao salvar', async () => {
    const { chamadas, executar } = espiao();

    await new ArmazenamentoDeCredencialWindows(CAMINHO, executar).salvar('key-1', 'segredo-1');

    const script = chamadas[0] ?? '';

    expect(script).toContain('Add-Type -AssemblyName System.Security');
    // A ordem importa: o tipo tem de estar disponivel ANTES da linha que o usa.
    expect(script.indexOf('Add-Type')).toBeLessThan(script.indexOf('ProtectedData'));
  });

  it('carrega System.Security antes de usar ProtectedData ao carregar', async () => {
    const { chamadas, executar } = espiao();

    await new ArmazenamentoDeCredencialWindows(CAMINHO, executar).carregar();

    const script = chamadas[0] ?? '';

    expect(script).toContain('Add-Type -AssemblyName System.Security');
    expect(script.indexOf('Add-Type')).toBeLessThan(script.indexOf('ProtectedData'));
  });

  /** O segredo nunca viaja na linha de comando -- so por variavel de ambiente. */
  it('passa o segredo por ambiente, nunca como argumento', async () => {
    const { chamadas, executar } = espiao();

    await new ArmazenamentoDeCredencialWindows(CAMINHO, executar).salvar('key-1', 'segredo-1');

    expect(chamadas[0]).not.toContain('segredo-1');
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
