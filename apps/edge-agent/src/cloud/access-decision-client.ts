import type { DepsAcessoOnline, RespostaDeDecisao } from '../application/orquestrar-acesso-online.js';
import type { SignedCloudClient } from './signed-client.js';

interface RespostaDePassagemHttp {
  accessEventId: string;
  state: string;
}

/**
 * Implementa `pedirDecisao` sobre `POST /api/v1/edge/access-decisions`
 * (F9). Erro de rede ou recusa da nuvem viram `null` -- quem chama
 * (`orquestrar-acesso-online.ts`) trata `null` como DENY explicito, nunca
 * como ALLOW por omissao (regra nova da F9).
 */
export function criarPedirDecisao(cliente: SignedCloudClient): DepsAcessoOnline['pedirDecisao'] {
  return async (entrada) => {
    const resposta = await cliente.post<RespostaDeDecisao>('/api/v1/edge/access-decisions', {
      deviceId: entrada.deviceId,
      externalUserId: entrada.externalUserId,
      recognitionId: entrada.recognitionId,
      recognizedAt: entrada.recognizedAt.toISOString(),
      idempotencyKey: entrada.idempotencyKey,
    });

    if (!resposta.ok || !resposta.body) return null;

    return {
      accessEventId: resposta.body.accessEventId,
      outcome: resposta.body.outcome,
      reason: resposta.body.reason,
      validUntil: resposta.body.validUntil,
    };
  };
}

/**
 * Implementa `reportarPassagem` sobre
 * `POST /api/v1/edge/access-events/:id/passage`. Falha aqui NAO desfaz o
 * giro fisico -- ver comentario em `orquestrar-acesso-online.ts`.
 */
export function criarReportarPassagem(
  cliente: SignedCloudClient,
): DepsAcessoOnline['reportarPassagem'] {
  return async (accessEventId, estado, commandId, reportedAt) => {
    const resposta = await cliente.post<RespostaDePassagemHttp>(
      `/api/v1/edge/access-events/${accessEventId}/passage`,
      { state: estado, commandId, reportedAt: reportedAt.toISOString() },
    );

    return resposta.ok;
  };
}
