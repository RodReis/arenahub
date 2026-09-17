import { describe, expect, it, jest } from '@jest/globals';
import { conectarComRetry, FalhaDeConexaoError } from './conectar-com-retry.js';

describe('conectarComRetry', () => {
  it('devolve o resultado na primeira tentativa bem-sucedida', async () => {
    const tentar = jest.fn(async () => 'ok');
    const esperar = jest.fn(async () => {});

    const resultado = await conectarComRetry({ tentar, esperar, maxTentativas: 5, intervaloMs: 3000 });

    expect(resultado).toBe('ok');
    expect(tentar).toHaveBeenCalledTimes(1);
    expect(esperar).not.toHaveBeenCalled();
  });

  it('tenta ate maxTentativas e falha alto se todas falharem', async () => {
    const erro = new Error('sem resposta');
    const tentar = jest.fn(async () => { throw erro; });
    const esperar = jest.fn(async () => {});

    await expect(
      conectarComRetry({ tentar, esperar, maxTentativas: 3, intervaloMs: 3000 }),
    ).rejects.toBeInstanceOf(FalhaDeConexaoError);

    expect(tentar).toHaveBeenCalledTimes(3);
    expect(esperar).toHaveBeenCalledTimes(2);
  });

  it('recupera se uma tentativa intermediaria falhar e a seguinte funcionar', async () => {
    let chamada = 0;
    const tentar = jest.fn(async () => {
      chamada += 1;
      if (chamada < 3) throw new Error('catraca ainda bootando');
      return 'conectado';
    });
    const esperar = jest.fn(async () => {});

    const resultado = await conectarComRetry({ tentar, esperar, maxTentativas: 5, intervaloMs: 3000 });

    expect(resultado).toBe('conectado');
    expect(tentar).toHaveBeenCalledTimes(3);
  });

  it('a mensagem de erro final preserva a causa da ultima tentativa', async () => {
    const tentar = jest.fn(async () => { throw new Error('porta 3570 recusou conexao'); });
    const esperar = jest.fn(async () => {});

    await expect(
      conectarComRetry({ tentar, esperar, maxTentativas: 2, intervaloMs: 3000 }),
    ).rejects.toThrow(/porta 3570 recusou conexao/);
  });
});
