import type { Logger } from 'pino';

import type { SignedCloudClient } from '../cloud/signed-client.js';
import type { EventoReconhecimento } from '../domain/facial-device.js';

/**
 * Leva para a nuvem a passagem que a catraca decidiu sozinha, offline -- #477.
 *
 * Decisao do PI (30/09/2026): o backlog que o leitor guarda enquanto o
 * ArenaHub esta fora CONTA COMO FREQUENCIA. O Edge relata o FATO -- leitor,
 * numero e horario do equipamento -- e nunca o outcome: quem decidiu foi a
 * catraca. A nuvem grava `ALLOW / OFFLINE_DEVICE_DECISION`, sem passar pelo
 * motor. A catraca NUNCA e acionada daqui (#476).
 *
 * Uma tentativa so, sem fila local: fila duravel e reconciliacao sao a
 * operacao offline plena, que o ADR-012 deixou para o MVP 1.5. Se a nuvem
 * nao responder, a passagem fica no log -- e o leitor, que ja recebeu o ack,
 * nao a reenvia.
 */
export async function registrarPassagemOffline(deps: {
  cliente: SignedCloudClient;
  logger: Logger;
  evento: EventoReconhecimento & { serialDoDispositivo: string };
  correlationId: string;
}): Promise<void> {
  const { cliente, logger, evento, correlationId } = deps;

  // Sem horario do equipamento nao ha fato a registrar: carimbar com o
  // recebimento inventaria a hora da passagem.
  if (Number.isNaN(evento.ocorridoEm.getTime())) {
    logger.warn(
      { correlationId, enrollid: evento.externalEnrollId, leitor: evento.serialDoDispositivo },
      'passagem antiga sem horario legivel -- nao registrada',
    );
    return;
  }

  const ocorridoEm = evento.ocorridoEm.toISOString();

  // A MESMA passagem fisica tem de gerar a MESMA chave: o leitor reenvia o
  // lote se o ack se perder, e a nuvem deduplica por ela (regra no 4). O id
  // do registro no leitor quando existe; senao, o que identifica a passagem.
  const recognitionId =
    evento.idExternoDoEvento ?? `${evento.externalEnrollId}@${ocorridoEm}`;
  const idempotencyKey = `offline:${evento.serialDoDispositivo}:${recognitionId}`;

  const resposta = await cliente.post<{ accessEventId: string }>(
    '/api/v1/edge/offline-passages',
    {
      deviceSerial: evento.serialDoDispositivo,
      externalUserId: evento.externalEnrollId,
      recognitionId,
      occurredAt: ocorridoEm,
      idempotencyKey,
    },
  );

  if (!resposta.ok || !resposta.body) {
    logger.warn(
      {
        correlationId,
        enrollid: evento.externalEnrollId,
        leitor: evento.serialDoDispositivo,
        ocorridoEm,
        status: resposta.status,
      },
      'passagem antiga nao chegou na nuvem -- frequencia sem este registro',
    );
    return;
  }

  logger.info(
    {
      correlationId,
      enrollid: evento.externalEnrollId,
      leitor: evento.serialDoDispositivo,
      ocorridoEm,
      accessEventId: resposta.body.accessEventId,
    },
    'passagem antiga registrada como frequencia',
  );
}
