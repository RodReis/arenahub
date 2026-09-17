import { type Logger } from 'pino';

import type { Config } from '../config/env.js';
import type { FacialDeviceAdapter } from '../domain/facial-device.js';
import type { TurnstileAdapter } from '../domain/turnstile.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';
import { TurnstileSimulator } from '../adapters/turnstile-simulator.js';
import { TopdataFacialAdapter } from '../adapters/topdata/topdata-facial-adapter.js';
import { TopdataInnerAdapter } from '../adapters/topdata/topdata-inner-adapter.js';
import { PonteEasyInnerProcesso } from '../adapters/topdata/ponte-easyinner-processo.js';
import { conectarComRetry } from './conectar-com-retry.js';

const MAX_TENTATIVAS = 5;
const INTERVALO_RETRY_MS = 3_000;
const INNER_PADRAO = 1;
const CAMINHO_PONTE = 'native/easyinner-bridge/EasyInnerBridge.exe';
const PORTA_CATRACA = 3570;
const TEMPO_CONECTAR_CATRACA_S = 10;
const PORTA_FACIAL = 7792;

export interface DispositivosMontados {
  facial: FacialDeviceAdapter;
  catraca: TurnstileAdapter;
  /** Desconecta os dois, na ordem inversa da montagem (`M0-NFR-007`). */
  encerrar: () => Promise<void>;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Monta catraca e leitor facial, real ou simulador por flag (F59).
 *
 * ORDEM IMPORTA (insumo §3.2): catraca antes do facial. O leitor pode
 * disparar reconhecimento assim que conecta; se o processador ainda nao
 * tem catraca, o primeiro evento se perde ou explode.
 */
export async function montarDispositivos(
  config: Config,
  logger: Logger,
): Promise<DispositivosMontados> {
  const catraca: TurnstileAdapter =
    config.CATRACA_MODE === 'simulador'
      ? new TurnstileSimulator()
      : await montarCatracaReal(logger);

  const facial: FacialDeviceAdapter =
    config.FACIAL_MODE === 'simulador' ? new FacialSimulator() : await montarFacialReal(logger);

  return {
    facial,
    catraca,
    // Ordem inversa: facial primeiro (para de receber evento novo), depois catraca.
    encerrar: async () => {
      await facial.encerrar();
      await catraca.encerrar();
    },
  };
}

async function montarCatracaReal(logger: Logger): Promise<TurnstileAdapter> {
  const ponte = PonteEasyInnerProcesso.lancar({ comando: CAMINHO_PONTE });
  const adapter = new TopdataInnerAdapter(ponte, logger, INNER_PADRAO);

  await conectarComRetry({
    dispositivo: 'catraca',
    maxTentativas: MAX_TENTATIVAS,
    intervaloMs: INTERVALO_RETRY_MS,
    esperar,
    tentar: async () => {
      await adapter.conectar(PORTA_CATRACA, TEMPO_CONECTAR_CATRACA_S);

      const conectado = await adapter.testarConexao();
      if (!conectado) throw new Error('testarConexao devolveu false');
    },
  });

  return adapter;
}

async function montarFacialReal(logger: Logger): Promise<FacialDeviceAdapter> {
  const adapter = new TopdataFacialAdapter(logger, PORTA_FACIAL);

  await conectarComRetry({
    dispositivo: 'facial',
    maxTentativas: MAX_TENTATIVAS,
    intervaloMs: INTERVALO_RETRY_MS,
    esperar,
    tentar: () => adapter.iniciar(),
  });

  return adapter;
}
