import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const CABECALHO_DE_CORRELACAO = 'x-correlation-id';

/**
 * Da a cada requisicao um identificador que atravessa log, erro e evento.
 *
 * Sem ele, investigar incidente vira arqueologia: dez requisicoes
 * simultaneas produzem linhas de log intercaladas e nao ha como saber quais
 * pertencem a mesma historia. `M1-NFR-004` exige que o `correlationId`
 * atravesse a composicao inteira.
 *
 * Reaproveita o valor que chegou pelo cabecalho, se houver: quem chamou pode
 * ja estar rastreando a operacao de mais acima.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(requisicao: Request, resposta: Response, seguir: NextFunction): void {
    const recebido = requisicao.headers[CABECALHO_DE_CORRELACAO];
    const correlationId = typeof recebido === 'string' && recebido ? recebido : randomUUID();

    requisicao.correlationId = correlationId;
    resposta.setHeader(CABECALHO_DE_CORRELACAO, correlationId);

    seguir();
  }
}
