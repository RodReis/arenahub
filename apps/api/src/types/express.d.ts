import type { PlatformContext } from '../common/platform/platform-context.js';
import type { TenantContext } from '../common/tenant/tenant-context.js';

declare global {
  namespace Express {
    interface Request {
      /** Posto pelo `CorrelationIdMiddleware`, presente em toda requisicao. */
      correlationId?: string;
      /**
       * Posto pelo `AuthGuard` depois de validar a credencial.
       *
       * Opcional no tipo porque rota publica nao tem contexto -- quem precisa
       * dele usa `TenantContextService.require()`, que falha alto em vez de
       * deixar seguir sem tenant.
       */
      tenantContext?: TenantContext;
      /**
       * Posto pelo `AuthGuard` quando o token vem SEM tenant -- a sessao do
       * dono do SaaS. Excludente do `tenantContext`: nunca os dois juntos.
       */
      platformContext?: PlatformContext;
    }
  }
}

export {};
