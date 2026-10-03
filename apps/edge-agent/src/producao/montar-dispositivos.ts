import { resolve } from 'node:path';

import { type Logger } from 'pino';

import type { Config } from '../config/env.js';
import type { FacialDeviceAdapter } from '../domain/facial-device.js';
import type { TurnstileAdapter } from '../domain/turnstile.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';
import { TurnstileSimulator } from '../adapters/turnstile-simulator.js';
import type { ConfiguracaoAcesso } from '../adapters/topdata/easyinner-ponte.js';
import { TopdataFacialAdapter } from '../adapters/topdata/topdata-facial-adapter.js';
import {
  INTERVALO_KEEP_ALIVE_MS,
  TopdataInnerAdapter,
} from '../adapters/topdata/topdata-inner-adapter.js';
import { PonteEasyInnerProcesso } from '../adapters/topdata/ponte-easyinner-processo.js';
import { absoluto, raizDoPacote } from './caminhos.js';
import { conectarComRetry } from './conectar-com-retry.js';

const MAX_TENTATIVAS = 5;
const INTERVALO_RETRY_MS = 3_000;
const INNER_PADRAO = 1;
/*
 * Absoluto a partir da localizacao DESTE ARQUIVO, nao de `process.cwd()`.
 * Como servico Windows o cwd e `C:\Windows\System32`, e um caminho relativo
 * aqui daria `spawn ... ENOENT` -- mesma classe de defeito que `SQLITE_PATH`
 * e `INVENTORY_PATH` tiveram no `main.ts` (#406), agora achada ao testar
 * contra hardware real: o driver de diagnostico nao passa por
 * `montarDispositivos`, entao nunca exercitou este caminho.
 */
export const CAMINHO_PONTE = absoluto(
  'native/easyinner-bridge/bin/EasyInnerBridge.exe',
  /*
   * `raizDoPacote` sobe UM nivel -- vale para `dist/main.js`. Este modulo
   * mora em `producao/` (`dist/producao/` compilado, `src/producao/` no
   * teste), um nivel mais fundo: sem o `..` o caminho saia com `dist\` a
   * mais e o spawn dava ENOENT de novo (#406, nono elo).
   */
  resolve(raizDoPacote(import.meta.url), '..'),
);
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
      : await montarCatracaReal(
          logger,
          config.CATRACA_INVERTIDA,
          config.CATRACA_TEMPO_LIBERADA_S,
          configuracaoDeAcesso(config),
        );

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

/** Os tres campos vem juntos ou nenhum -- `carregarConfig` ja garante (#507). */
function configuracaoDeAcesso(config: Config): ConfiguracaoAcesso | undefined {
  const { CATRACA_LEITOR1: leitor1, CATRACA_LEITOR2: leitor2, CATRACA_ACIONAMENTO1: acionamento1 } =
    config;
  if (leitor1 === undefined || leitor2 === undefined || acionamento1 === undefined) {
    return undefined;
  }
  return { leitor1, leitor2, acionamento1 };
}

async function montarCatracaReal(
  logger: Logger,
  invertida: boolean,
  tempoLiberadaS: number,
  configuracao: ConfiguracaoAcesso | undefined,
): Promise<TurnstileAdapter> {
  const ponte = PonteEasyInnerProcesso.lancar({ comando: CAMINHO_PONTE });
  const adapter = new TopdataInnerAdapter(ponte, logger, INNER_PADRAO, invertida, configuracao);

  await conectarComRetry({
    dispositivo: 'catraca',
    maxTentativas: MAX_TENTATIVAS,
    intervaloMs: INTERVALO_RETRY_MS,
    esperar,
    tentar: async () => {
      await adapter.conectar(PORTA_CATRACA, TEMPO_CONECTAR_CATRACA_S, tempoLiberadaS);

      const conectado = await adapter.testarConexao();
      if (!conectado) throw new Error('testarConexao devolveu false');
    },
  });

  // O sucesso tambem vira log (#406): na Arena Positiva a catraca conectou e
  // nada disse -- so dava para deduzir pelo facial ter subido depois dela.
  logger.info({ porta: PORTA_CATRACA }, 'catraca conectada');

  // Grava o modo de acesso no equipamento (#507) -- so se o .env pediu. Nao
  // derruba a partida: sem a gravacao a catraca segue com o que tinha.
  if (configuracao) await adapter.gravarConfiguracao();

  // A PARTIR DAQUI A CATRACA OBEDECE O ARENAHUB (#470). Sem o ping ela caia
  // para offline em 10 s e liberava pela lista propria. Parar o agente para
  // o ping, e a catraca volta sozinha ao modo offline -- o plano B.
  adapter.manterOnline();
  logger.info(
    { intervaloMs: INTERVALO_KEEP_ALIVE_MS },
    'catraca mantida online -- decisao de acesso e do ArenaHub',
  );

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
