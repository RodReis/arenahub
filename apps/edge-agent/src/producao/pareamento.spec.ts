import { describe, expect, it, jest } from '@jest/globals';

import { ArmazenamentoDeCredencialEmMemoria } from './armazenamento-de-credencial.js';
import { PareamentoRecusadoError, parear } from './pareamento.js';

describe('parear', () => {
  it('troca o codigo por credencial e salva no armazenamento', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    const trocarPorHttp = jest.fn(() =>
      Promise.resolve({ ok: true as const, keyId: 'key-1', secret: 'segredo-1' }),
    );

    const resultado = await parear({
      cloudApiUrl: 'https://nuvem.teste',
      codigo: 'codigo-123',
      armazenamento,
      trocarPorHttp,
    });

    expect(resultado).toEqual({ keyId: 'key-1', secret: 'segredo-1' });
    await expect(armazenamento.carregar()).resolves.toEqual({ keyId: 'key-1', secret: 'segredo-1' });
  });

  /**
   * Issue #406 -- instalacao real na Arena Positiva, 26/09/2026.
   *
   * O codigo tinha expirado (TTL de 10 min), a nuvem respondeu 409, e o
   * agente encerrou dizendo "Defina EDGE_PAIRING_CODE" -- para uma variavel
   * que ESTAVA definida, como o proprio log mostrava duas linhas acima.
   * "Recusado" e "nao configurado" pedem acoes opostas: gerar outro codigo
   * versus conferir o `.env`.
   */
  it('lanca erro de RECUSA quando a nuvem rejeita o codigo, sem salvar nada', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    const trocarPorHttp = jest.fn(() =>
      Promise.resolve({ ok: false as const, motivo: 'RECUSADO' as const, status: 409 }),
    );

    await expect(
      parear({
        cloudApiUrl: 'https://nuvem.teste',
        codigo: 'codigo-expirado',
        armazenamento,
        trocarPorHttp,
      }),
    ).rejects.toBeInstanceOf(PareamentoRecusadoError);

    await expect(armazenamento.carregar()).resolves.toBeNull();
  });

  it('a mensagem da recusa diz que o codigo expira e como gerar outro', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    const trocarPorHttp = jest.fn(() =>
      Promise.resolve({ ok: false as const, motivo: 'RECUSADO' as const, status: 409 }),
    );

    const erro = await parear({
      cloudApiUrl: 'https://nuvem.teste',
      codigo: 'codigo-expirado',
      armazenamento,
      trocarPorHttp,
    }).then(
      () => new Error('deveria ter lancado'),
      (e: unknown) => e as Error,
    );

    expect(erro.message).toContain('409');
    expect(erro.message).toContain('expira');
    expect(erro.message).toContain('Parear');
    // O codigo e segredo: nunca na mensagem (`env.ts` ja o trata assim).
    expect(erro.message).not.toContain('codigo-expirado');
  });

  /** Rede fora do ar pede outra acao: conferir `CLOUD_API_URL`, nao gerar codigo. */
  it('distingue falha de REDE da recusa, e nomeia a URL', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    const trocarPorHttp = jest.fn(() =>
      Promise.resolve({ ok: false as const, motivo: 'REDE' as const, detalhe: 'ENOTFOUND' }),
    );

    const erro = await parear({
      cloudApiUrl: 'https://nuvem.teste',
      codigo: 'codigo-123',
      armazenamento,
      trocarPorHttp,
    }).then(
      () => new Error('deveria ter lancado'),
      (e: unknown) => e as Error,
    );

    expect(erro.message).toContain('https://nuvem.teste');
    expect(erro.message).toContain('ENOTFOUND');
    // Nao manda gerar outro codigo -- o codigo nao e o problema aqui.
    expect(erro.message).not.toContain('Parear');
  });

  /**
   * Issue #406 -- o padrao que apareceu tres vezes na mesma instalacao.
   *
   * A troca CONSOME o codigo de uso unico. Se o `salvar` falha depois disso
   * (assembly ausente, pasta inexistente, DPAPI de outra conta), o agente
   * perdia credencial E codigo de uma vez, e a unica saida era gerar outro
   * no painel -- tres vezes seguidas, na Arena Positiva.
   *
   * A credencial JA ESTA EM MAOS neste ponto. Devolve-la deixa este arranque
   * funcionar (o heartbeat sobe, a catraca decide); o que se perde e a
   * persistencia, e o proximo arranque pedira novo pareamento. Melhor que
   * perder tudo -- e o erro do armazenamento nao e engolido, sobe no log.
   */
  it('devolve a credencial mesmo quando o armazenamento falha ao salvar', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();

    jest
      .spyOn(armazenamento, 'salvar')
      .mockRejectedValue(new Error('WriteAllBytes: caminho nao encontrado'));

    const trocarPorHttp = jest.fn(() =>
      Promise.resolve({ ok: true as const, keyId: 'key-1', secret: 'segredo-1' }),
    );

    const aoFalharPersistencia = jest.fn();

    const resultado = await parear({
      cloudApiUrl: 'https://nuvem.teste',
      codigo: 'codigo-123',
      armazenamento,
      trocarPorHttp,
      aoFalharPersistencia,
    });

    // O codigo foi gasto: a credencial nao se perde junto.
    expect(resultado).toEqual({ keyId: 'key-1', secret: 'segredo-1' });
    // Mas a falha nao e silenciosa -- quem instala precisa saber que o
    // proximo arranque vai pedir pareamento de novo.
    expect(aoFalharPersistencia).toHaveBeenCalledTimes(1);
  });

  it('se ja existe credencial salva, nao troca de novo -- devolve a existente', async () => {
    const armazenamento = new ArmazenamentoDeCredencialEmMemoria();
    await armazenamento.salvar('key-existente', 'segredo-existente');
    const trocarPorHttp = jest.fn(() =>
      Promise.resolve({ ok: false as const, motivo: 'RECUSADO' as const, status: 409 }),
    );

    const resultado = await parear({
      cloudApiUrl: 'https://nuvem.teste',
      codigo: 'codigo-123',
      armazenamento,
      trocarPorHttp,
    });

    expect(resultado).toEqual({ keyId: 'key-existente', secret: 'segredo-existente' });
    expect(trocarPorHttp).not.toHaveBeenCalled();
  });
});
