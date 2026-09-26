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

  const { ArmazenamentoDeCredencialWindows, CredencialIlegivelError } = await import(
    './producao/armazenamento-de-credencial.js'
  );
  const { resolverCredencial, CredencialAusenteError } = await import(
    './producao/resolver-credencial.js'
  );
  const { PareamentoRecusadoError, PareamentoSemRedeError } = await import(
    './producao/pareamento.js'
  );

  // %LOCALAPPDATA% ja e restrito ao perfil da conta Windows atual (nao
  // world-readable) -- resolve a SUPOSICAO de ACL documentada em
  // armazenamento-de-credencial.ts sem aplicar ACL propria. O risco de
  // escopo DPAPI (pareamento e servico rodando sob contas diferentes,
  // Task 13) permanece em aberto: ver comentario de classe.
  const caminhoDaCredencial = join(
    process.env['LOCALAPPDATA'] ?? process.cwd(),
    'ArenaHub',
    'edge-agent',
    'credencial.dat',
  );
  const armazenamento = new ArmazenamentoDeCredencialWindows(caminhoDaCredencial);

  let credencial;
  try {
    credencial = await resolverCredencial({
      cloudApiUrl: config.CLOUD_API_URL,
      keyIdDoEnv: config.CLOUD_EDGE_KEY_ID,
      secretDoEnv: config.CLOUD_EDGE_SECRET,
      codigoDePareamento: config.EDGE_PAIRING_CODE,
      armazenamento,
    });
  } catch (erro: unknown) {
    /*
     * Erro de instalacao NUNCA sobe como stack crua: o servico reinicia a
     * cada 5s (`sc.exe failure`), e stack repetida esconde a linha que diz o
     * que fazer. `PareamentoRecusadoError` e `PareamentoSemRedeError` entram
     * aqui pela issue #406 -- antes, a recusa da nuvem virava "defina
     * EDGE_PAIRING_CODE" para uma variavel que estava definida.
     */
    if (
      erro instanceof CredencialIlegivelError ||
      erro instanceof PareamentoRecusadoError ||
      erro instanceof PareamentoSemRedeError
    ) {
      // So a mensagem, nunca a `cause` (stack do PowerShell embutido) -- e
      // isso que impede o loop de restart do sc.exe de logar o mesmo bloco
      // criptico a cada 5s (F59, achado de revisao 3).
      logger.error(erro.message);
      process.exit(1);
    }
    throw erro;
  }

  if (!credencial) {
    logger.error(new CredencialAusenteError().message);
    process.exit(1);
  }

  // Um unico cliente assinado, construido com a credencial RESOLVIDA (nao o
  // valor cru de config.CLOUD_EDGE_KEY_ID/SECRET) -- compartilhado entre a
  // composicao (decisao de acesso) e o laco de heartbeat, para os dois
  // falarem com a nuvem com a mesma identidade.
  const clienteNuvem = new SignedCloudClient({
    baseUrl: config.CLOUD_API_URL ?? '',
    keyId: credencial.keyId,
    secret: credencial.secret,
  });

  const composto = await compor(config, logger, { cliente: clienteNuvem });

  // DECISAO REGISTRADA (revisao final de branch F59, achado 1): `devices`
  // vai vazio de proposito. O heartbeat so teria como preencher `serial` real
  // se `montarDispositivos`/`TopdataInnerAdapter`/`TopdataFacialAdapter`
  // expusessem o serial do fabricante de volta ate aqui -- hoje eles nao
  // expoem, e simular um serial sintetico (ex.: `${EDGE_AGENT_ID}-catraca`)
  // NAO bateria com o `Device.serial` cadastrado no painel, entao nao
  // resolveria o alerta abaixo, so esconderia que ele nao foi resolvido.
  //
  // CONSEQUENCIA CONHECIDA: `avaliarDispositivo`
  // (apps/api/.../operations/domain/alert-rules.ts) trata
  // `Device.lastHeartbeat === null` como silencio infinito e dispara
  // DEVICE_OFFLINE (CRITICAL) permanente para catraca e facial reais, mesmo
  // com o agente funcionando -- porque `EdgeController.heartbeat` so
  // atualiza `Device.lastHeartbeat` iterando `dados.devices`. O heartbeat do
  // proprio Edge (`EdgeNode.lastHeartbeat`) continua correto, entao o Edge
  // aparece "Respondendo" no painel; so o alerta por DISPOSITIVO fica falso.
  //
  // Corrigir de verdade exige threading do serial real dos adapters Topdata
  // ate aqui (Task futura, fora do escopo desta correcao pontual) ou uma
  // decisao do PI sobre como popular `Device.serial` a partir do Edge.
  const pararHeartbeat = iniciarLacoDeHeartbeat({
    cliente: clienteNuvem,
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
