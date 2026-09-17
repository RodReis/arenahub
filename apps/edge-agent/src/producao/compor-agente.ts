import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import type { Config } from '../config/env.js';
import { montarDispositivos, type DispositivosMontados } from './montar-dispositivos.js';
import { SignedCloudClient } from '../cloud/signed-client.js';
import { criarPedirDecisao, criarReportarPassagem } from '../cloud/access-decision-client.js';
import { MaquinaDeAcesso } from '../persistence/maquina-de-acesso.js';
import {
  criarProcessadorDeAcessoOnline,
  retomarPendentes,
  type ReconhecimentoComOrigem,
} from '../application/orquestrar-acesso-online.js';
import type { EventoReconhecimento } from '../domain/facial-device.js';

export interface AgenteComposto {
  encerrar: () => Promise<void>;
}

interface DepsInjetaveis {
  cliente?: SignedCloudClient;
  dispositivos?: DispositivosMontados;
}

/**
 * Composicao de producao (F59) -- liga leitor, decisao ONLINE (F9) e
 * catraca. Diferenca central para o `lab:run` (MVP 0): a decisao e da
 * NUVEM (`criarProcessadorDeAcessoOnline`), nunca local
 * (`criarProcessadorDePassagem`) -- regra de arquitetura no 1.
 *
 * `deps` e para teste: sem ele, monta tudo a partir da `Config` (caminho
 * real). Com ele, quem chama controla o cliente de nuvem e os
 * dispositivos, sem precisar de rede nem hardware.
 */
export async function compor(
  config: Config,
  logger: Logger,
  deps: DepsInjetaveis = {},
): Promise<AgenteComposto> {
  const dispositivos = deps.dispositivos ?? (await montarDispositivos(config, logger));

  const cliente =
    deps.cliente ??
    new SignedCloudClient({
      baseUrl: config.CLOUD_API_URL ?? '',
      keyId: config.CLOUD_EDGE_KEY_ID ?? '',
      secret: config.CLOUD_EDGE_SECRET ?? '',
    });

  const maquina = new MaquinaDeAcesso(config.SQLITE_PATH);

  const pedirDecisao = criarPedirDecisao(cliente);
  const reportarPassagem = criarReportarPassagem(cliente);

  const processar = criarProcessadorDeAcessoOnline({
    maquina,
    catraca: dispositivos.catraca,
    pedirDecisao,
    reportarPassagem,
    agoraMonotonicoMs: () => performance.now(),
  });

  // Fecha o ciclo de REGISTRO de tentativas presas de uma execucao anterior
  // -- nunca recomanda a catraca (ver comentario em retomarPendentes).
  const retomada = await retomarPendentes({
    maquina,
    catraca: dispositivos.catraca,
    pedirDecisao,
    reportarPassagem,
    agoraMonotonicoMs: () => performance.now(),
  });

  logger.info({ retomada }, 'tentativas pendentes retomadas no arranque');

  // AO RECONHECER POR ULTIMO: registrar o ouvinte "liga a chave" -- tudo a
  // jusante (maquina, processador, catraca) ja esta pronto acima.
  dispositivos.facial.aoReconhecer((evento: EventoReconhecimento) => {
    const reconhecimento: ReconhecimentoComOrigem = {
      externalEnrollId: evento.externalEnrollId,
      deviceId: config.EDGE_AGENT_ID,
      recognitionId: evento.idExternoDoEvento ?? randomUUID(),
      ocorridoEm: evento.ocorridoEm,
    };

    const correlationId = randomUUID();

    processar(reconhecimento, correlationId, new Date()).catch((erro: unknown) => {
      logger.error(
        { correlationId, erro: erro instanceof Error ? erro.message : erro },
        'falha ao processar reconhecimento',
      );
    });
  });

  return {
    encerrar: async () => {
      await dispositivos.encerrar();
      maquina.fechar();
    },
  };
}
