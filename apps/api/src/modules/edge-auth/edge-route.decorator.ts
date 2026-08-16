import { SetMetadata, applyDecorators } from '@nestjs/common';

import { Public } from '../../common/security/public.decorator.js';
import { ROTA_DE_EDGE } from './edge-auth.guard.js';

/**
 * Rota autenticada por assinatura de Edge, nao por cookie.
 *
 * Combina `@Public()` com a marca de Edge porque os dois guards globais
 * respondem perguntas diferentes: o `AuthGuard` so entende cookie de sessao
 * e recusaria o agente; o `EdgeAuthGuard` so olha rota marcada.
 *
 * Marcar `@Public()` sozinho abriria a rota para qualquer um -- por isso os
 * dois andam juntos num decorator so, e nao soltos no controller onde
 * alguem esqueceria um deles.
 */
export const EdgeRoute = (): MethodDecorator & ClassDecorator =>
  applyDecorators(Public(), SetMetadata(ROTA_DE_EDGE, true));
