import { describe, expect, it, jest } from '@jest/globals';

import { TrocaDeSenhaEmSuporteError } from '../../common/http/erro-de-dominio.js';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

/**
 * Sessao de suporte nao troca senha -- SPEC-084 AC-8.
 *
 * Unitario e nao integracao: montar uma elevacao viva pela rota exige Super
 * Admin, tenant e `ElevarUseCase` (ver `platform-elevacao.int-spec.ts`), e a
 * regra aqui e uma linha no controller. O que importa provar e que a troca
 * NUNCA chega ao servico.
 */
describe('AuthController.trocarSenha', () => {
  it('recusa sessao de suporte sem chamar o servico', async () => {
    const trocarSenha = jest.fn<AuthService['trocarSenha']>();
    const controller = new AuthController(
      { trocarSenha } as unknown as AuthService,
      {} as never,
      {
        require: () => ({
          tenantId: 't',
          actorId: 'u',
          sessionId: 's',
          permissions: new Set<string>(),
          allowedUnitIds: 'ALL' as const,
          supportElevation: { reason: 'suporte', expiresAt: new Date() },
        }),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.trocarSenha({ currentPassword: 'a', newPassword: 'bbbbbbbb' }, {} as never),
    ).rejects.toBeInstanceOf(TrocaDeSenhaEmSuporteError);
    expect(trocarSenha).not.toHaveBeenCalled();
  });
});
