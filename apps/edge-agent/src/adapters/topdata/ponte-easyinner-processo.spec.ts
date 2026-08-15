import { describe, it, expect } from '@jest/globals';
import { spawn } from 'node:child_process';

import { PonteEasyInnerProcesso } from './ponte-easyinner-processo.js';

// Processo-eco: para cada linha recebida, responde uma resposta valida.
// Nao e o .exe real -- valida so a serializacao/parsing do protocolo stdio.
function ecoProcesso(respostaJson: string) {
  return spawn(process.execPath, [
    '-e',
    `let buf='';
     process.stdin.on('data', d => {
       buf += d; let i;
       while ((i = buf.indexOf('\\n')) >= 0) {
         buf.slice(0, i); buf = buf.slice(i + 1);
         process.stdout.write(${JSON.stringify(respostaJson)} + '\\n');
       }
     });`,
  ]);
}

describe('PonteEasyInnerProcesso', () => {
  it('envia comando como JSON e traduz a resposta da ponte', async () => {
    const ponte = PonteEasyInnerProcesso.comProcesso(
      ecoProcesso('{"tipo":"retorno","retorno":0}'),
    );
    const r = await ponte.executar({ cmd: 'ping', inner: 1 });
    expect(r).toEqual({ tipo: 'retorno', retorno: 0 });
    await ponte.encerrar();
  });

  it('devolve falha-da-ponte quando o processo emite linha invalida', async () => {
    const ponte = PonteEasyInnerProcesso.comProcesso(ecoProcesso('nao-e-json'));
    const r = await ponte.executar({ cmd: 'ping', inner: 1 });
    expect(r.tipo).toBe('falha-da-ponte');
    await ponte.encerrar();
  });

  it('traduz um evento de giro vindo da ponte', async () => {
    const evento =
      '{"tipo":"evento","evento":{"origem":6,"complemento":0,"cartao":"","ocorridoEm":"2026-08-15T10:00:00"}}';
    const ponte = PonteEasyInnerProcesso.comProcesso(ecoProcesso(evento));
    const r = await ponte.executar({ cmd: 'receber-evento', inner: 1, timeoutMs: 1000 });
    expect(r.tipo).toBe('evento');
    if (r.tipo === 'evento') {
      expect(r.evento.origem).toBe(6);
    }
    await ponte.encerrar();
  });
});
