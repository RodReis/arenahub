import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import type { Config } from '../config/env.js';
import { montarDispositivos, type DispositivosMontados } from './montar-dispositivos.js';
import { SignedCloudClient } from '../cloud/signed-client.js';
import { criarPedirDecisao, criarReportarPassagem } from '../cloud/access-decision-client.js';
import { iniciarPoller } from '../cloud/command-poller.js';
import { MaquinaDeAcesso } from '../persistence/maquina-de-acesso.js';
import { CommandInbox } from '../persistence/command-inbox.js';
import { DeviceUserRepository } from '../persistence/device-user-repository.js';
import {
  criarProcessadorDeAcessoOnline,
  retomarPendentes,
  type ReconhecimentoComOrigem,
} from '../application/orquestrar-acesso-online.js';
import type { EventoReconhecimento } from '../domain/facial-device.js';
import { ehPassagemAoVivo } from '../domain/passagem-ao-vivo.js';
import { registrarPassagemOffline } from './passagem-offline.js';
import { ligarVinculoLegado } from './vinculo-legado.js';
import { motivoLegivel } from './motivo-legivel.js';

export interface AgenteComposto {
  /** Exposto para o heartbeat (#461) montar `devices` com o serial real. */
  dispositivos: DispositivosMontados;
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
  const inbox = new CommandInbox(config.SQLITE_PATH);
  const deviceUsers = new DeviceUserRepository(config.SQLITE_PATH);

  const pedirDecisao = criarPedirDecisao(cliente);
  const reportarPassagem = criarReportarPassagem(cliente);

  // O agente espera o giro um pouco MAIS que o tempo destravado: quem manda
  // no prazo e a catraca (Origem 5 = tempo acabou), e desistir antes dela
  // registraria "nao passou" de quem ainda podia passar.
  const processar = criarProcessadorDeAcessoOnline(
    {
      maquina,
      catraca: dispositivos.catraca,
      pedirDecisao,
      reportarPassagem,
      agoraMonotonicoMs: () => performance.now(),
    },
    (config.CATRACA_TEMPO_LIBERADA_S + 3) * 1_000,
  );

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

  // A base do leitor vai para a nuvem vincular os alunos legados e os
  // cadastros feitos direto no equipamento (#468). Antes do `aoReconhecer`:
  // o registro do leitor pode chegar a qualquer momento depois daqui.
  const vinculoLegado = ligarVinculoLegado({ facial: dispositivos.facial, cliente, logger });

  // Sincronismo ArenaHub -> leitor (F8, #469): o worker ja existia e tinha
  // teste, mas nada o chamava no agente de producao -- cadastro feito no
  // painel nunca chegava ao equipamento. So liga com CLOUD_API_URL presente:
  // ausente e modo bancada, sem fila de comando (mesma condicao do cliente
  // de nuvem acima).
  const pararPoller =
    config.CLOUD_API_URL === undefined
      ? undefined
      : iniciarPoller({
          cliente,
          worker: {
            repo: deviceUsers,
            dispositivo: dispositivos.facial,
            registrarExecucao: (commandId, sucesso) =>
              inbox.registrarExecucao(commandId, sucesso),
            jaExecutado: (commandId) => inbox.jaExecutado(commandId),
          },
          estado: { ultimaSequencia: 0n },
          intervaloMs: config.SYNC_POLL_INTERVAL_MS,
          aoCiclo: (resultado) => {
            if (resultado.erro) {
              logger.warn({ erro: resultado.erro }, 'ciclo de sincronismo com erro');
              return;
            }
            if (resultado.executados > 0) {
              logger.info(resultado, 'comandos de sincronismo executados');
            }
          },
        });

  // AO RECONHECER POR ULTIMO: registrar o ouvinte "liga a chave" -- tudo a
  // jusante (maquina, processador, catraca) ja esta pronto acima.
  dispositivos.facial.aoReconhecer((evento: EventoReconhecimento) => {
    const correlationId = randomUUID();

    // O leitor pelo SERIAL, nunca pelo `EDGE_AGENT_ID`: a nuvem acha o
    // `Device` por ele. Mandar o id do Edge fazia a validacao recusar e
    // nenhum evento chegar ao painel (#467). Sem serial nao ha o que
    // perguntar -- e isso precisa aparecer, nao virar DENY calado.
    if (evento.serialDoDispositivo === undefined) {
      logger.warn(
        { correlationId, enrollid: evento.externalEnrollId },
        'reconhecimento sem serial do leitor -- ignorado',
      );
      return;
    }

    // Backlog do leitor (passagens guardadas enquanto o ArenaHub estava
    // fora) nao e pessoa na frente da catraca: nao pede decisao e nunca
    // gira nada (#476). Vai para a nuvem como frequencia (#477).
    if (!ehPassagemAoVivo(evento.ocorridoEm, evento.recebidoEm)) {
      logger.info(
        {
          correlationId,
          enrollid: evento.externalEnrollId,
          leitor: evento.serialDoDispositivo,
          ocorridoEm: Number.isNaN(evento.ocorridoEm.getTime())
            ? 'invalido'
            : evento.ocorridoEm.toISOString(),
        },
        'passagem antiga do leitor -- nao aciona a catraca',
      );

      void registrarPassagemOffline({
        cliente,
        logger,
        evento: { ...evento, serialDoDispositivo: evento.serialDoDispositivo },
        correlationId,
      }).catch((erro: unknown) => {
        logger.warn(
          { correlationId, erro: erro instanceof Error ? erro.message : erro },
          'falha ao registrar passagem antiga',
        );
      });
      return;
    }

    const reconhecimento: ReconhecimentoComOrigem = {
      externalEnrollId: evento.externalEnrollId,
      deviceSerial: evento.serialDoDispositivo,
      recognitionId: evento.idExternoDoEvento ?? randomUUID(),
      ocorridoEm: evento.ocorridoEm,
    };

    processar(reconhecimento, correlationId, new Date())
      .then((r) => {
        // Toda decisao vira linha de log (#467): antes so a EXCECAO aparecia,
        // e um DENY por `CLOUD_UNAVAILABLE` era indistinguivel de nada ter
        // acontecido. Nunca nome nem foto -- so o enrollid do leitor.
        logger.info(
          {
            correlationId,
            enrollid: evento.externalEnrollId,
            leitor: evento.serialDoDispositivo,
            outcome: r.outcome,
            reason: r.reason,
            motivo: motivoLegivel(r.reason),
            estado: r.estado,
            latenciaDecisaoMs: r.latenciaDecisaoMs,
            duracaoPassagemMs: r.duracaoPassagemMs,
          },
          'decisao de acesso',
        );
      })
      .catch((erro: unknown) => {
        logger.error(
          { correlationId, erro: erro instanceof Error ? erro.message : erro },
          'falha ao processar reconhecimento',
        );
      });
  });

  return {
    dispositivos,
    encerrar: async () => {
      pararPoller?.();
      vinculoLegado.encerrar();
      await dispositivos.encerrar();
      maquina.fechar();
      inbox.fechar();
      deviceUsers.fechar();
    },
  };
}
