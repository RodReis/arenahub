import { describe, expect, it } from '@jest/globals';

import type { FacialDeviceAdapter } from '../domain/facial-device.js';
import type { DeviceUserRepository } from '../persistence/device-user-repository.js';
import {
  executarComando,
  executarLote,
  type ComandoDaNuvem,
  type DependenciasDoWorker,
} from './device-sync-worker.js';

const AGORA = new Date('2026-08-16T12:00:00.000Z');

const IDENTIDADE = '11111111-1111-4111-8111-111111111111';

const comando = (sobrescreve: Partial<ComandoDaNuvem> = {}): ComandoDaNuvem => ({
  id: 'cmd-1',
  sequence: '1',
  type: 'DEVICE_USER_UPSERT',
  payload: {
    deviceSerial: 'SER-1',
    externalUserId: '1001',
    identityId: IDENTIDADE,
  },
  correlationId: 'corr-1',
  ...sobrescreve,
});

/** Repositorio em memoria, com o contrato minimo que o worker usa. */
function repoFalso(): DeviceUserRepository {
  const registros = new Map<
    string,
    { externalEnrollId: string; estado: string }
  >();

  const chave = (pessoaId: string, dispositivoId: string): string =>
    `${pessoaId}:${dispositivoId}`;

  return {
    buscar: (pessoaId: string, dispositivoId: string) => {
      const achado = registros.get(chave(pessoaId, dispositivoId));

      return achado
        ? {
            pessoaId,
            dispositivoId,
            externalEnrollId: achado.externalEnrollId,
            estado: achado.estado,
            atualizadoEm: AGORA,
            detalhe: null,
          }
        : null;
    },
    registrarIntencaoDeCadastro: (
      pessoaId: string,
      externalEnrollId: string,
      dispositivoId: string,
    ) => {
      registros.set(chave(pessoaId, dispositivoId), {
        externalEnrollId,
        estado: 'pendente_cadastro',
      });
    },
    marcarEstado: (pessoaId: string, dispositivoId: string, estado: string) => {
      const atual = registros.get(chave(pessoaId, dispositivoId));

      if (atual) registros.set(chave(pessoaId, dispositivoId), { ...atual, estado });
    },
    listarEsperados: () => [],
  } as unknown as DeviceUserRepository;
}

/** Adapter que confirma tudo, contando as chamadas fisicas. */
function dispositivoFalso(opcoes: { confirmar?: boolean } = {}): FacialDeviceAdapter & {
  cadastros: number;
  remocoes: number;
} {
  const confirmar = opcoes.confirmar ?? true;

  const adapter = {
    cadastros: 0,
    remocoes: 0,
    cadastrar: () => {
      adapter.cadastros += 1;

      return Promise.resolve(
        confirmar ? { confirmado: true as const } : { confirmado: false as const, razao: 'recusado' },
      );
    },
    remover: () => {
      adapter.remocoes += 1;

      return Promise.resolve(
        confirmar ? { confirmado: true as const } : { confirmado: false as const, razao: 'offline' },
      );
    },
    listar: () => Promise.resolve([]),
  };

  return adapter as unknown as FacialDeviceAdapter & { cadastros: number; remocoes: number };
}

function montarDeps(
  dispositivo: ReturnType<typeof dispositivoFalso>,
  executados = new Set<string>(),
): DependenciasDoWorker & { executados: Set<string> } {
  return {
    repo: repoFalso(),
    dispositivo,
    registrarExecucao: (commandId: string) => executados.add(commandId),
    jaExecutado: (commandId: string) => executados.has(commandId),
    executados,
  };
}

describe('executarComando', () => {
  it('cadastra a identidade no leitor', async () => {
    const dispositivo = dispositivoFalso();
    const resultado = await executarComando(montarDeps(dispositivo), comando(), AGORA);

    expect(resultado).toMatchObject({ commandId: 'cmd-1', success: true });
    expect(dispositivo.cadastros).toBe(1);
  });

  it('remove a identidade do leitor', async () => {
    const dispositivo = dispositivoFalso();
    const deps = montarDeps(dispositivo);

    // Precisa existir para haver o que remover.
    await executarComando(deps, comando(), AGORA);

    const resultado = await executarComando(
      deps,
      comando({ id: 'cmd-2', type: 'DEVICE_USER_DELETE' }),
      AGORA,
    );

    expect(resultado.success).toBe(true);
    expect(dispositivo.remocoes).toBe(1);
  });

  it('NAO toca o leitor quando o comando ja foi executado', async () => {
    const dispositivo = dispositivoFalso();
    const deps = montarDeps(dispositivo, new Set(['cmd-1']));

    const resultado = await executarComando(deps, comando(), AGORA);

    // A nuvem so repetiu o envio porque o resultado dela nao chegou -- o
    // efeito fisico ja aconteceu.
    expect(resultado.success).toBe(true);
    expect(dispositivo.cadastros).toBe(0);
  });

  it('reporta falha quando o leitor recusa o cadastro', async () => {
    const dispositivo = dispositivoFalso({ confirmar: false });

    const resultado = await executarComando(montarDeps(dispositivo), comando(), AGORA);

    expect(resultado).toMatchObject({
      success: false,
      errorCode: 'DEVICE_ENROLLMENT_REJECTED',
    });
  });

  it('trata tipo desconhecido como erro permanente', async () => {
    const dispositivo = dispositivoFalso();

    const resultado = await executarComando(
      montarDeps(dispositivo),
      comando({ type: 'COMANDO_DO_FUTURO' }),
      AGORA,
    );

    // Retentar o que este agente nao sabe executar so gasta as cinco
    // tentativas da nuvem.
    expect(resultado).toMatchObject({
      success: false,
      errorCode: 'DEVICE_OPERATION_UNSUPPORTED',
    });
    expect(dispositivo.cadastros).toBe(0);
  });

  it('recusa comando sem identificador, sem tocar o leitor', async () => {
    const dispositivo = dispositivoFalso();

    const resultado = await executarComando(
      montarDeps(dispositivo),
      comando({ payload: { deviceSerial: 'SER-1' } }),
      AGORA,
    );

    expect(resultado.success).toBe(false);
    expect(dispositivo.cadastros).toBe(0);
  });

  it('nao manda nome nem CPF ao equipamento (INV-012, INV-022)', async () => {
    const dispositivo = dispositivoFalso();
    const rotulos: string[] = [];

    const espiao = {
      ...dispositivo,
      cadastrar: (entrada: { rotulo: string }) => {
        rotulos.push(entrada.rotulo);

        return Promise.resolve({ confirmado: true as const });
      },
    } as unknown as ReturnType<typeof dispositivoFalso>;

    await executarComando(montarDeps(espiao), comando(), AGORA);

    // O que vai ao leitor e o identificador tecnico, nao a pessoa.
    expect(rotulos[0]).toBe('1001');
    expect(rotulos[0]).not.toMatch(/[a-z]{3,}/i);
  });
});

describe('executarLote', () => {
  it('executa na ordem recebida', async () => {
    const dispositivo = dispositivoFalso();

    const resultados = await executarLote(
      montarDeps(dispositivo),
      [comando({ id: 'a' }), comando({ id: 'b' }), comando({ id: 'c' })],
      AGORA,
    );

    expect(resultados.map((r) => r.commandId)).toEqual(['a', 'b', 'c']);
  });

  it('um comando com falha nao interrompe o lote', async () => {
    const dispositivo = dispositivoFalso();
    const deps = montarDeps(dispositivo);

    const resultados = await executarLote(
      deps,
      [
        comando({ id: 'a' }),
        comando({ id: 'b', type: 'TIPO_INVALIDO' }),
        comando({ id: 'c' }),
      ],
      AGORA,
    );

    // Parar tudo por causa de um faria um leitor com problema bloquear a
    // fila inteira da academia.
    expect(resultados).toHaveLength(3);
    expect(resultados[0]?.success).toBe(true);
    expect(resultados[1]?.success).toBe(false);
    expect(resultados[2]?.success).toBe(true);
  });

  it('devolve resultado para todo comando, mesmo em excecao', async () => {
    const explosivo = {
      cadastrar: () => Promise.reject(new Error('leitor explodiu')),
      remover: () => Promise.resolve({ confirmado: true as const }),
      listar: () => Promise.resolve([]),
    } as unknown as ReturnType<typeof dispositivoFalso>;

    const resultados = await executarLote(montarDeps(explosivo), [comando()], AGORA);

    // Comando sem resultado ficaria preso em PROCESSING na nuvem para sempre.
    expect(resultados).toHaveLength(1);
    expect(resultados[0]?.success).toBe(false);
  });
});
