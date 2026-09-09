import { SetMetadata } from '@nestjs/common';

export const ROTA_DE_PLATAFORMA = 'ROTA_DE_PLATAFORMA';

/** Marca a rota como exclusiva do dono do SaaS. Ver `PlatformGuard`. */
export const PlatformRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ROTA_DE_PLATAFORMA, true);
