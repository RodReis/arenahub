import { join } from 'node:path';

import { config as carregarEnv } from 'dotenv';

// O `.env` vive na raiz do monorepo -- mesma fonte que o docker-compose e a
// API. Em producao o agente roda como servico no Windows, com as variaveis
// vindo do ambiente; `dotenv` ignora a ausencia do arquivo em silencio, que
// e o comportamento certo aqui.
//
// ORDEM IMPORTA: antes de qualquer import que leia `process.env`. Sem esta
// linha o agente subia lendo so o ambiente do shell e morria no arranque
// reclamando de EDGE_AGENT_ID -- com o valor sentado no `.env` ao lado.
carregarEnv({ path: join(process.cwd(), '../../.env') });

const { carregarConfig, descreverConfig, ConfigInvalidaError } = await import('./config/env.js');
const { criarLogger, loggerDaTentativa } = await import('./observability/logger.js');
const { compor } = await import('./producao/compor-agente.js');
const { SignedCloudClient } = await import('./cloud/signed-client.js');
const { iniciarLacoDeHeartbeat } = await import('./producao/laco-de-heartbeat.js');

/**
 * Ponto de entrada de PRODUCAO do edge-agent (F59).
 *
 * Sobe a composicao real (Task 5), inicia o laco de heartbeat HTTP para a
 * nuvem (F11/AC-8) e encerra graciosamente. `USE_SIMULATOR` deu lugar a
 * `FACIAL_MODE`/`CATRACA_MODE` (F59, Task 1) -- cada dispositivo escolhe
 * real ou simulador de forma independente.
 */

const INTERVALO_HEARTBEAT_MS = 30_000;
const VERSAO_DO_AGENTE = process.env['npm_package_version'] ?? '0.0.0';

async function main(): Promise<void> {
  let config;
  try {
    config = carregarConfig();
  } catch (erro: unknown) {
    if (erro instanceof ConfigInvalidaError) {
      // Sem logger ainda: a config e o que o configura. Falhar em stderr com
      // a lista inteira e melhor que subir meio configurado.
      console.error(erro.message);
      process.exit(1);
    }
    throw erro;
  }

  const logger = criarLogger(config);

  logger.info({ config: descreverConfig(config) }, 'edge-agent iniciando');

  if (config.FACIAL_MODE === 'simulador' || config.CATRACA_MODE === 'simulador') {
    logger.warn(
      { facial: config.FACIAL_MODE, catraca: config.CATRACA_MODE },
      'modo simulador ativo para ao menos um dispositivo (M0-NFR-006)',
    );
  }

  const composto = await compor(config, logger);

  const clienteHeartbeat = new SignedCloudClient({
    baseUrl: config.CLOUD_API_URL ?? '',
    keyId: config.CLOUD_EDGE_KEY_ID ?? '',
    secret: config.CLOUD_EDGE_SECRET ?? '',
  });

  const pararHeartbeat = iniciarLacoDeHeartbeat({
    cliente: clienteHeartbeat,
    intervaloMs: INTERVALO_HEARTBEAT_MS,
    montarCorpo: () => ({
      agentVersion: VERSAO_DO_AGENTE,
      localTimeMs: Date.now(),
      queueDepth: 0,
      devices: [],
    }),
    aoFalhar: (erro) => {
      loggerDaTentativa(logger).warn({ erro }, 'heartbeat nao chegou na nuvem');
    },
  });

  logger.info('edge-agent pronto');

  let encerrando = false;

  const encerrar = (sinal: string): void => {
    if (encerrando) return;
    encerrando = true;

    logger.info({ sinal }, 'encerrando');
    pararHeartbeat();

    void composto
      .encerrar()
      .catch((erro: unknown) => {
        logger.error({ erro: erro instanceof Error ? erro.message : erro }, 'erro ao encerrar');
      })
      .finally(() => process.exit(0));
  };

  process.once('SIGINT', () => encerrar('SIGINT'));
  process.once('SIGTERM', () => encerrar('SIGTERM'));
}

main().catch((erro: unknown) => {
  console.error('edge-agent falhou ao iniciar:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
