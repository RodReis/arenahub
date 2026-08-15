import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../http/erro-de-dominio.js';
import type { TenantContext } from './tenant-context.js';

/**
 * Entrega o `TenantContext` da requisicao em curso.
 *
 * `require()` LANCA quando nao ha contexto, em vez de devolver `undefined`.
 * A diferenca e o INV-003: se devolvesse `undefined`, um repositorio poderia
 * seguir com `tenantId: undefined` e o Prisma listaria tudo -- vazamento
 * entre tenants por omissao, silencioso, sem ninguem ter escrito uma linha
 * errada de proposito.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  constructor(@Inject(REQUEST) private readonly requisicao: Request) {}

  require(): TenantContext {
    const contexto = this.requisicao.tenantContext;

    if (!contexto) throw new NaoAutenticadoError();

    return contexto;
  }

  /** Para quem legitimamente aceita rota publica e protegida. */
  opcional(): TenantContext | undefined {
    return this.requisicao.tenantContext;
  }
}
