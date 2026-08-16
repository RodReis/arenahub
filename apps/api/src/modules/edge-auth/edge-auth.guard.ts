import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CABECALHOS } from '@arenahub/api-contracts';
import type { Request } from 'express';

import { EdgeAuthService, type ContextoDoEdge } from './edge-auth.service.js';

/** Marca a rota como autenticada por assinatura de Edge. */
export const ROTA_DE_EDGE = 'rota-de-edge';

declare module 'express' {
  interface Request {
    /** Preenchido pelo `EdgeAuthGuard`. Ausente em rota de usuario. */
    edgeContext?: ContextoDoEdge;
  }
}

/**
 * Autentica o Edge por assinatura HMAC.
 *
 * Rota de Edge NAO usa cookie de sessao: o agente e um processo, nao uma
 * pessoa. Por isso ela e `@Public()` para o `AuthGuard` (que so entende
 * cookie) e protegida por este guard, que entende assinatura.
 *
 * O corpo cru e lido de `request.rawBody`, capturado pelo middleware -- o
 * `body` ja parseado pelo Express nao serve: `JSON.parse` seguido de
 * `JSON.stringify` reordena chaves e muda espacos, e o hash deixa de bater.
 */
@Injectable()
export class EdgeAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly edge: EdgeAuthService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const exigeEdge = this.reflector.getAllAndOverride<boolean>(ROTA_DE_EDGE, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!exigeEdge) return true;

    const requisicao = contexto.switchToHttp().getRequest<Request>();

    const resultado = await this.edge.verificar(
      {
        keyId: this.cabecalho(requisicao, CABECALHOS.keyId),
        timestamp: this.cabecalho(requisicao, CABECALHOS.timestamp),
        nonce: this.cabecalho(requisicao, CABECALHOS.nonce),
        signature: this.cabecalho(requisicao, CABECALHOS.signature),
        method: requisicao.method,
        pathAndQuery: requisicao.originalUrl,
        body: requisicao.rawBody ?? '',
      },
      new Date(),
    );

    if (!resultado.ok) {
      // O codigo distingue os casos para quem OPERA (relogio torto e chave
      // revogada pedem acoes diferentes), mas nunca diz qual segredo falhou
      // nem ecoa a assinatura recebida.
      throw new UnauthorizedException({ code: resultado.motivo });
    }

    requisicao.edgeContext = resultado.contexto;

    return true;
  }

  private cabecalho(requisicao: Request, nome: string): string {
    const valor = requisicao.headers[nome];

    return typeof valor === 'string' ? valor : '';
  }
}
