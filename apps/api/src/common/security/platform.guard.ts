import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ROTA_DE_PLATAFORMA } from './platform-route.decorator.js';

/**
 * 403, e nao o 404 habitual de recurso alheio.
 *
 * O padrao do projeto e devolver 404 para recurso de outro tenant, porque
 * 403 confirmaria que ele existe. Aqui nao ha recurso a esconder: `/platform`
 * e uma superficie inteira, e a existencia dela nao e segredo.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const exige = this.reflector.getAllAndOverride<boolean>(ROTA_DE_PLATAFORMA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!exige) return true;

    const requisicao = contexto.switchToHttp().getRequest<Request>();

    if (!requisicao.platformContext) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }

    return true;
  }
}
