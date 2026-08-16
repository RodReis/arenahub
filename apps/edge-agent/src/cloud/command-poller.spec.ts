import { describe, expect, it } from '@jest/globals';

import type { DependenciasDoWorker } from '../application/device-sync-worker.js';
import type { FacialDeviceAdapter } from '../domain/facial-device.js';
import type { DeviceUserRepository } from '../persistence/device-user-repository.js';
import { rodarCiclo, type EstadoDoPoller } from './command-poller.js';
import type { SignedCloudClient } from './signed-client.js';

const AGORA = new Date('2026-08-16T12:00:00.000Z');
const IDENTIDADE = '11111111-1111-4111-8111-111111111111';

const comandoDaNuvem = (id: string, sequence: string) => ({
  id,
  sequence,
  type: 'DEVICE_USER_UPSERT',
  payload: { deviceSerial: 'SER-1', externalUserId: '1001', identityId: IDENTIDADE },
  correlationId: 'corr',
});

/** Cliente falso, com registro do que foi chamado. */
function clienteFalso(respostas: {
  comandos?: unknown;
  comandosOk?: boolean;
  leaseOk?: boolean;
  leaseConcedido?: boolean;
  envioOk?: boolean;
}): SignedCloudClient & { chamadas: string[] } {
  const chamadas: string[] = [];

  const cliente = {
    chamadas,
    get: (caminho: string) => {
      chamadas.push(`GET ${caminho}`);

      return Promise.resolve(
        respostas.comandosOk === false
          ? { ok: false, status: 0, body: null, errorCode: 'CLOUD_UNREACHABLE' }
          : { ok: true, status: 200, body: respostas.comandos, errorCode: null },
      );
    },
    post: (caminho: string) => {
      chamadas.push(`POST ${caminho}`);

      if (caminho.includes('/lease')) {
        return Promise.resolve(
          respostas.leaseOk === false
            ? { ok: false, status: 409, body: null, errorCode: 'CONFLICT' }
            : {
                ok: true,
                status: 201,
                body: { leased: respostas.leaseConcedido ?? true },
                errorCode: null,
              },
        );
      }

      return Promise.resolve(
        respostas.envioOk === false
          ? { ok: false, status: 0, body: null, errorCode: 'CLOUD_TIMEOUT' }
          : { ok: true, status: 201, body: { accepted: 1 }, errorCode: null },
      );
    },
  };

  return cliente as unknown as SignedCloudClient & { chamadas: string[] };
}

function workerFalso(): DependenciasDoWorker & { execucoes: number } {
  const executados = new Set<string>();

  const deps = {
    execucoes: 0,
    repo: {
      buscar: () => null,
      registrarIntencaoDeCadastro: () => undefined,
      marcarEstado: () => undefined,
      listarEsperados: () => [],
    } as unknown as DeviceUserRepository,
    dispositivo: {
      cadastrar: () => {
        deps.execucoes += 1;

        return Promise.resolve({ confirmado: true as const });
      },
      remover: () => Promise.resolve({ confirmado: true as const }),
      listar: () => Promise.resolve([]),
    } as unknown as FacialDeviceAdapter,
    registrarExecucao: (id: string) => executados.add(id),
    jaExecutado: (id: string) => executados.has(id),
  };

  return deps;
}

describe('rodarCiclo', () => {
  it('busca, arrenda, executa e reporta', async () => {
    const cliente = clienteFalso({ comandos: { commands: [comandoDaNuvem('cmd-1', '5')] } });
    const worker = workerFalso();
    const estado: EstadoDoPoller = { ultimaSequencia: 0n };

    const resultado = await rodarCiclo({ cliente, worker, estado }, AGORA);

    expect(resultado).toMatchObject({ buscados: 1, executados: 1, reportados: 1, erro: null });
    expect(worker.execucoes).toBe(1);
    expect(cliente.chamadas).toContain('POST /api/v1/edge/commands/cmd-1/lease');
  });

  it('avanca a sequencia so depois de reportar com sucesso', async () => {
    const cliente = clienteFalso({ comandos: { commands: [comandoDaNuvem('cmd-1', '7')] } });
    const estado: EstadoDoPoller = { ultimaSequencia: 0n };

    await rodarCiclo({ cliente, worker: workerFalso(), estado }, AGORA);

    expect(estado.ultimaSequencia).toBe(7n);
  });

  it('NAO avanca a sequencia quando o envio falha', async () => {
    const cliente = clienteFalso({
      comandos: { commands: [comandoDaNuvem('cmd-1', '9')] },
      envioOk: false,
    });
    const estado: EstadoDoPoller = { ultimaSequencia: 0n };

    const resultado = await rodarCiclo({ cliente, worker: workerFalso(), estado }, AGORA);

    // Avancar aqui perderia o relato: o proximo ciclo pediria a partir de
    // uma sequencia que nunca foi confirmada. O efeito fisico ja aconteceu;
    // o que se protege e o RELATO.
    expect(estado.ultimaSequencia).toBe(0n);
    expect(resultado.reportados).toBe(0);
    expect(resultado.erro).toBe('CLOUD_TIMEOUT');
  });

  it('nao executa comando cujo lease foi recusado', async () => {
    const cliente = clienteFalso({
      comandos: { commands: [comandoDaNuvem('cmd-1', '1')] },
      leaseConcedido: false,
    });
    const worker = workerFalso();

    const resultado = await rodarCiclo(
      { cliente, worker, estado: { ultimaSequencia: 0n } },
      AGORA,
    );

    // Outro processo pegou primeiro -- insistir seria a execucao dupla que o
    // lease existe para evitar.
    expect(worker.execucoes).toBe(0);
    expect(resultado.executados).toBe(0);
  });

  it('sobrevive a nuvem fora do ar', async () => {
    const cliente = clienteFalso({ comandosOk: false });

    const resultado = await rodarCiclo(
      { cliente, worker: workerFalso(), estado: { ultimaSequencia: 0n } },
      AGORA,
    );

    // Queda de link nao pode virar catraca parada: o ciclo devolve erro e o
    // proximo tenta de novo.
    expect(resultado.erro).toBe('CLOUD_UNREACHABLE');
    expect(resultado.executados).toBe(0);
  });

  it('nao faz nada quando nao ha comando', async () => {
    const cliente = clienteFalso({ comandos: { commands: [] } });

    const resultado = await rodarCiclo(
      { cliente, worker: workerFalso(), estado: { ultimaSequencia: 3n } },
      AGORA,
    );

    expect(resultado).toMatchObject({ buscados: 0, executados: 0, erro: null });
    // Nenhum lease pedido: nao ha o que arrendar.
    expect(cliente.chamadas.filter((c) => c.includes('lease'))).toHaveLength(0);
  });

  it('pede a partir da ultima sequencia conhecida', async () => {
    const cliente = clienteFalso({ comandos: { commands: [] } });

    await rodarCiclo(
      { cliente, worker: workerFalso(), estado: { ultimaSequencia: 42n } },
      AGORA,
    );

    // Ponto de retomada apos reinicio -- sem ele o Edge reprocessaria a fila
    // inteira a cada restart.
    expect(cliente.chamadas[0]).toContain('after=42');
  });
});
