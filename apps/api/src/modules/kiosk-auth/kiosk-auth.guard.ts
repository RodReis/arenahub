import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CABECALHOS_DO_KIOSK } from '@arenahub/api-contracts';
import type { Request } from 'express';

import { KioskAuthService, type ContextoDoKiosk } from './kiosk-auth.service.js';

/** Marca a rota como autenticada por assinatura de totem. */
export const ROTA_DE_KIOSK = 'rota-de-kiosk';

/**
 * Reexportado, nao redefinido: os nomes moram em `@arenahub/api-contracts`,
 * ao lado do `assinar` que os acompanha, para que o totem (que assina) e a
 * API (que verifica) leiam a MESMA lista. O reexport mantem os imports que
 * ja apontavam para ca.
 */
export { CABECALHOS_DO_KIOSK };

declare module 'express' {
  interface Request {
    /** Preenchido pelo `KioskAuthGuard`. Ausente em rota de usuario. */
    kioskContext?: ContextoDoKiosk;
  }
}

/**
 * Autentica o totem por assinatura HMAC.
 *
 * Rota de totem NAO usa cookie de sessao: o dispositivo e um processo, nao
 * uma pessoa. Por isso ela e `@Public()` para o `AuthGuard` (que so entende
 * cookie) e protegida por este guard, que entende assinatura.
 *
 * O corpo cru vem de `request.rawBody`, capturado pelo mesmo parser do
 * Edge (`aplicarParserComCorpoCru`): `JSON.parse` seguido de
 * `JSON.stringify` reordena chaves e o hash deixa de bater.
 */
@Injectable()
export class KioskAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly kiosk: KioskAuthService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const exigeKiosk = this.reflector.getAllAndOverride<boolean>(ROTA_DE_KIOSK, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!exigeKiosk) return true;

    const requisicao = contexto.switchToHttp().getRequest<Request>();

    const resultado = await this.kiosk.verificar(
      {
        keyId: this.cabecalho(requisicao, CABECALHOS_DO_KIOSK.keyId),
        timestamp: this.cabecalho(requisicao, CABECALHOS_DO_KIOSK.timestamp),
        nonce: this.cabecalho(requisicao, CABECALHOS_DO_KIOSK.nonce),
        signature: this.cabecalho(requisicao, CABECALHOS_DO_KIOSK.signature),
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

    requisicao.kioskContext = resultado.contexto;

    return true;
  }

  private cabecalho(requisicao: Request, nome: string): string {
    const valor = requisicao.headers[nome];

    return typeof valor === 'string' ? valor : '';
  }
}
