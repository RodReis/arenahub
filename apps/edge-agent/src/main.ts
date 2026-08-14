import { carregarConfig, descreverConfig, ConfigInvalidaError } from './config/env.js';
import { componenteProcesso, montarHeartbeat } from './health/health-check.js';
import { criarLogger, loggerDaTentativa } from './observability/logger.js';

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
