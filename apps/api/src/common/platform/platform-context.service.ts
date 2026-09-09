import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../http/erro-de-dominio.js';
import type { PlatformContext } from './platform-context.js';

/**
 * Entrega o `PlatformContext` da requisicao em curso.
 *
 * Espelha o `TenantContextService`: `require()` LANCA em vez de devolver
 * `undefined`, para que caso de uso de plataforma nunca siga sem ator.
 */
@Injectable({ scope: Scope.REQUEST })
export class PlatformContextService {
  constructor(@Inject(REQUEST) private readonly requisicao: Request) {}

  require(): PlatformContext {
    const contexto = this.requisicao.platformContext;

    if (!contexto) throw new NaoAutenticadoError();

    return contexto;
  }

  opcional(): PlatformContext | undefined {
    return this.requisicao.platformContext;
  }
}
