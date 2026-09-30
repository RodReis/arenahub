import { Body, Controller, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { EdgeRoute } from '../edge-auth/edge-route.decorator.js';
import { AccessEventRepository } from './access-event.repository.js';
import {
  DecideOnlineAccessUseCase,
  type DecisaoRespondida,
} from './decide-online-access.use-case.js';
import {
  RecordOfflinePassageUseCase,
  type OfflinePassageRegistrada,
} from './record-offline-passage.use-case.js';

/**
 * Decisao de acesso pedida pelo Edge -- `M1` §12.
 *
 * `.strict()` pelo mesmo motivo do heartbeat: `tenantId` ou `gymUnitId` no
 * corpo sao RECUSADOS. A identidade vem da assinatura HMAC (regra de
 * arquitetura no 2), e aceitar os campos "so para conferir" criaria duvida
 * sobre qual dos dois manda.
 */
const esquemaDeDecisao = z
  .object({
    /**
     * O leitor, por UUID do `Device` OU por serial do fabricante -- exatamente
     * um dos dois. O Edge so conhece o serial (`sn` do `reg`); o UUID segue
     * aceito para nao quebrar Edge ainda nao atualizado (#467).
     */
    deviceId: z.string().uuid().optional(),
    deviceSerial: z.string().min(1).max(64).optional(),
    /** O `enrollid` que o leitor informou. String porque cada fabricante formata do seu jeito. */
    externalUserId: z.string().min(1).max(64),
    /** Id do reconhecimento no equipamento, para casar log fisico com o nosso. */
    recognitionId: z.string().min(1).max(80),
    recognizedAt: z.string().datetime(),
    /** 0..1. Opcional: nem todo modelo informa. */
    confidence: z.number().min(0).max(1).optional(),
    /** Dedupe (ADR-006). O Edge gera e repete em cada retry da MESMA tentativa. */
    idempotencyKey: z.string().min(8).max(120),
  })
  .strict()
  .refine((d) => (d.deviceId === undefined) !== (d.deviceSerial === undefined), {
    message: 'informe exatamente um entre deviceId e deviceSerial',
    path: ['deviceId'],
  });

/**
 * Desfecho fisico reportado pelo Edge.
 *
 * So `CONFIRMED` e `TIMED_OUT`: `PENDING` e estado interno do Edge e
 * `NOT_APPLICABLE` e consequencia de um `DENY`, que nunca gera comando.
 * Aceitar os quatro deixaria o Edge escrever estados que ele nao observa.
 */
const esquemaDePassagem = z
  .object({
    state: z.enum(['CONFIRMED', 'TIMED_OUT']),
    commandId: z.string().min(1).max(120),
    reportedAt: z.string().datetime(),
  })
  .strict();

/**
 * Passagem que a catraca JA DECIDIU sozinha, offline -- #477.
 *
 * `.strict()` pela mesma regra: `tenantId`/`gymUnitId` vem da assinatura.
 * `outcome` e `reason` NAO ENTRAM -- o Edge relata o fato, nunca decide; se
 * entrassem, um corpo malicioso ou um bug no Edge poderia gravar `DENY` para
 * uma passagem que a catraca liberou, ou inventar razao que o motor nunca
 * produziu.
 */
const esquemaDePassagemOffline = z
  .object({
    deviceSerial: z.string().min(1).max(64),
    externalUserId: z.string().min(1).max(64),
    recognitionId: z.string().min(1).max(80),
    /** Horario do EQUIPAMENTO -- o fato aconteceu ali, nao no recebimento. */
    occurredAt: z.string().datetime(),
    idempotencyKey: z.string().min(8).max(120),
  })
  .strict();

@Controller('api/v1/edge')
export class EdgeAccessController {
  constructor(
    private readonly decidir: DecideOnlineAccessUseCase,
    private readonly eventos: AccessEventRepository,
    private readonly offline: RecordOfflinePassageUseCase,
  ) {}

  /**
   * Devolve `ALLOW` ou `DENY` para um reconhecimento.
   *
   * **Negativa de dominio e 200, nao 4xx.** Um aluno sem direito nao e erro
   * de protocolo: a requisicao estava perfeita e a resposta e "nao entra".
   * Usar 403 aqui misturaria "voce nao tem permissao de chamar este
   * endpoint" com "esta pessoa nao pode passar da catraca" -- e o Edge, ao
   * tratar 4xx como falha de comunicacao, poderia retentar uma negativa
   * legitima como se fosse problema de rede.
   *
   * Falha de autenticacao, replay e corpo invalido continuam sendo 4xx, e
   * nesses casos NENHUM evento e gravado e NADA e comandado.
   */
  @Post('access-decisions')
  @EdgeRoute()
  async decidirAcesso(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<DecisaoRespondida> {
    const dados = esquemaDeDecisao.parse(corpo);

    // Garantido pelo guard: rota marcada sem contexto nao chega aqui.
    const edge = requisicao.edgeContext!;

    return this.decidir.executar(edge, {
      // O `refine` garante exatamente um dos dois.
      dispositivo:
        dados.deviceSerial !== undefined ? { serial: dados.deviceSerial } : { id: dados.deviceId! },
      externalUserId: dados.externalUserId,
      recognitionId: dados.recognitionId,
      recognizedAt: new Date(dados.recognizedAt),
      confidence: dados.confidence,
      idempotencyKey: dados.idempotencyKey,
      correlationId: requisicao.correlationId ?? 'sem-correlacao',
    });
  }

  /**
   * Registra o desfecho fisico da passagem -- `M1-FR-022`.
   *
   * Escreve em `AccessPassage`, **nunca no `AccessEvent`**: a decisao e fato
   * imutavel (`M1-BR-009`), e o giro e outro fato, posterior. Reportar o
   * mesmo desfecho de novo e inofensivo; reportar um desfecho DIFERENTE do
   * ja registrado e 409 -- a catraca nao pode ter girado e nao girado.
   *
   * O evento e buscado pelo tenant DA ASSINATURA. Um Edge nao fecha passagem
   * de evento de outra academia nem sabendo o UUID.
   */
  @Post('access-events/:id/passage')
  @EdgeRoute()
  async registrarPassagem(
    @Param('id') accessEventId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ accessEventId: string; state: string }> {
    const dados = esquemaDePassagem.parse(corpo);
    const edge = requisicao.edgeContext!;

    const evento = await this.eventos.encontrar(edge.tenantId, accessEventId);

    if (!evento) throw new NotFoundException({ code: 'ACCESS_EVENT_NOT_FOUND' });

    await this.eventos.registrarPassagem(
      evento.id,
      dados.state,
      dados.commandId,
      new Date(dados.reportedAt),
    );

    return { accessEventId: evento.id, state: dados.state };
  }

  /**
   * Registra passagem que o leitor guardou offline -- #477.
   *
   * ADR-012 deixou a operacao offline plena (cache, fila, decisao local) para
   * o MVP 1.5. Isto e mais estreito: o equipamento JA decidiu sozinho
   * (catraca em modo offline), e o ArenaHub so registra o que ja aconteceu --
   * nunca avalia entitlement, nunca comanda a catraca de novo.
   *
   * 201 sempre que o corpo e valido: a pessoa passou de fato, nao ha
   * "negativa de dominio" aqui como em `decidirAcesso`.
   */
  @Post('offline-passages')
  @EdgeRoute()
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      properties: {
        accessEventId: { type: 'string' },
        outcome: { type: 'string', enum: ['ALLOW'] },
        reason: { type: 'string', enum: ['OFFLINE_DEVICE_DECISION'] },
      },
      required: ['accessEventId', 'outcome', 'reason'],
    },
  })
  async registrarPassagemOffline(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<OfflinePassageRegistrada> {
    const dados = esquemaDePassagemOffline.parse(corpo);
    const edge = requisicao.edgeContext!;

    return this.offline.executar(edge, {
      deviceSerial: dados.deviceSerial,
      externalUserId: dados.externalUserId,
      recognitionId: dados.recognitionId,
      occurredAt: new Date(dados.occurredAt),
      idempotencyKey: dados.idempotencyKey,
      correlationId: requisicao.correlationId ?? 'sem-correlacao',
    });
  }
}
