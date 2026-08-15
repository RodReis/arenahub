import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../http/erro-de-dominio.js';
import { PERMISSOES_EXIGIDAS } from './permissions.decorator.js';

/**
 * Autorizacao, depois da autenticacao.
 *
 * Roda apos o `AuthGuard`, que ja pos o `TenantContext` na requisicao. A
 * separacao importa: "quem e voce" e "o que voce pode" sao perguntas
 * diferentes, e junta-las produz o guard que autoriza porque autenticou.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const exigidas = this.reflector.getAllAndOverride<string[]>(PERMISSOES_EXIGIDAS, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!exigidas || exigidas.length === 0) return true;

    const requisicao = contexto.switchToHttp().getRequest<Request>();
    const tenantContext = requisicao.tenantContext;

    if (!tenantContext) throw new NaoAutenticadoError();

    // TODAS, nao alguma: ver o comentario do decorator.
    const temTodas = exigidas.every((codigo) => tenantContext.permissions.has(codigo));

    if (!temTodas) throw new ForbiddenException({ code: 'FORBIDDEN' });

    return true;
  }
}
