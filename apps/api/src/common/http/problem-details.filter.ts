import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

import { ErroDeDominio } from './erro-de-dominio.js';

interface ProblemDetails {
  type: string;
  title: string;
  /** `HttpStatus`, e nao `number`: o lint exige enum compartilhado nas comparacoes. */
  status: HttpStatus;
  code: string;
  correlationId: string;
}

/**
 * Converte qualquer excecao em `application/problem+json` (RFC 9457).
 *
 * DUAS GARANTIAS, e a segunda e a que importa:
 *
 * 1. formato unico -- cliente trata erro de um jeito so;
 * 2. nada de dentro vaza para fora. Erro nao previsto vira 500 generico:
 *    stack trace em resposta HTTP entrega estrutura de diretorio, versao de
 *    biblioteca e, com alguma sorte do atacante, string de conexao. O
 *    detalhe vai para o log do servidor, com o `correlationId` ligando os
 *    dois.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(excecao: unknown, host: ArgumentsHost): void {
    const contexto = host.switchToHttp();
    const resposta = contexto.getResponse<Response>();
    const requisicao = contexto.getRequest<Request>();
    const correlationId = requisicao.correlationId ?? 'sem-correlacao';

    const problema = this.traduzir(excecao, correlationId);

    if (problema.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // So o log recebe o erro cru. Nunca a resposta.
      this.logger.error(`[${correlationId}] ${String(excecao)}`);
    }

    resposta.status(problema.status).type('application/problem+json').json(problema);
  }

  private traduzir(excecao: unknown, correlationId: string): ProblemDetails {
    if (excecao instanceof ErroDeDominio) {
      return {
        type: `https://arenahub.dev/errors/${excecao.code.toLowerCase()}`,
        title: excecao.title,
        status: excecao.status,
        code: excecao.code,
        correlationId,
      };
    }

    if (excecao instanceof ZodError) {
      // Entrada invalida e erro do cliente, nao do servidor. Sem esta
      // traducao, o Zod cairia no catch-all e viraria 500 -- e um e-mail
      // malformado passaria a parecer defeito nosso.
      //
      // A resposta nao carrega QUAL campo falhou: nas rotas de auth, dizer
      // "e-mail invalido" versus "senha invalida" ja e distinguir estados
      // que o login nao deve distinguir.
      return {
        type: 'https://arenahub.dev/errors/validation_failed',
        title: 'Requisicao invalida',
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_FAILED',
        correlationId,
      };
    }

    if (excecao instanceof HttpException) {
      // `getStatus()` devolve `number`; o estreitamento para `HttpStatus`
      // e o que deixa as comparacoes abaixo compartilharem o enum.
      const status: HttpStatus = excecao.getStatus();
      const corpo: unknown = excecao.getResponse();

      // Erro do proprio Nest (validacao, 404 de rota) ja traz corpo util;
      // aproveitamos o codigo quando ele existe.
      const code =
        typeof corpo === 'object' && corpo !== null && 'code' in corpo
          ? String(corpo.code)
          : this.codigoPadrao(status);

      return {
        type: `https://arenahub.dev/errors/${code.toLowerCase()}`,
        title: excecao.message,
        status,
        code,
        correlationId,
      };
    }

    return {
      type: 'https://arenahub.dev/errors/internal_error',
      title: 'Erro interno',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      correlationId,
    };
  }

  private codigoPadrao(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_FAILED';
      case HttpStatus.UNAUTHORIZED:
        return 'AUTH_REQUIRED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
