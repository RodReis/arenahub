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

const { carregarConfig, descreverConfig, ConfigInvalidaError } = await import(
  './config/env.js'
);
const { componenteProcesso, montarHeartbeat } = await import('./health/health-check.js');
const { criarLogger, loggerDaTentativa } = await import('./observability/logger.js');

/**
 * Ponto de entrada do edge-agent.
 *
 * `M0-NFR-007`: inicia sem interface grafica e encerra graciosamente. Roda
 * como servico no Windows -- nao ha console para responder a prompt, e
 * encerramento abrupto perde evento que o SQLite ainda nao confirmou.
 *
 * Hoje o agente so sobe, valida configuracao e emite heartbeat. Adapter de
 * dispositivo, fila e reconciliacao sao das fatias seguintes: F2 em diante.
 */

const INTERVALO_HEARTBEAT_MS = 30_000;

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

  logger.info(
    { config: descreverConfig(config) },
    'edge-agent iniciando',
  );

  if (config.USE_SIMULATOR) {
    logger.warn(
      'modo simulador: nenhum equipamento real sera contatado (M0-NFR-006)',
    );
  }

  const timer = setInterval(() => {
    const heartbeat = montarHeartbeat(config, [componenteProcesso(config)], new Date());
    loggerDaTentativa(logger).info({ heartbeat }, 'heartbeat');
  }, INTERVALO_HEARTBEAT_MS);

  // Primeiro heartbeat imediato: esperar 30 s para saber se o agente subiu
  // torna o runbook lento e faz parecer travado.
  const inicial = montarHeartbeat(config, [componenteProcesso(config)], new Date());
  loggerDaTentativa(logger).info({ heartbeat: inicial }, 'heartbeat');

  /** Encerramento gracioso -- `M0-NFR-007`. */
  const encerrar = (sinal: string): void => {
    logger.info({ sinal }, 'encerrando');
    clearInterval(timer);
    // Aqui entram, nas fatias seguintes: drenar a fila, fechar o SQLite e
    // desconectar os adapters. Hoje nao ha nenhum dos tres.
    process.exit(0);
  };

  process.once('SIGINT', () => encerrar('SIGINT'));
  process.once('SIGTERM', () => encerrar('SIGTERM'));

  await Promise.resolve();
}

main().catch((erro: unknown) => {
  console.error('edge-agent falhou ao iniciar:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
