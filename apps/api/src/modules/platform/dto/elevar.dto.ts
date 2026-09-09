import { z } from 'zod';

/**
 * A justificativa e o ato: sem ela, entrar num tenant alheio seria bypass
 * silencioso (INV-005). O minimo de 10 caracteres nao aceita "ok" nem ".".
 */
export const esquemaDeElevacao = z.object({
  reason: z.string().trim().min(10).max(500),
});
