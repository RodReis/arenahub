import { z } from 'zod';

/**
 * `slug` e identificador publico usado em URL (F62 fara login por ele).
 * Minusculas, numeros e hifen -- nada que precise de escape.
 */
export const esquemaDeCriacaoDeTenant = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(48)
      .regex(/^[a-z0-9-]+$/, 'slug aceita apenas minusculas, numeros e hifen'),
    legalName: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(120),
    cnpj: z.string().trim().regex(/^\d{14}$/, 'CNPJ deve ter 14 digitos'),
    timezone: z.string().min(1),
    responsavelNome: z.string().trim().min(1).max(120),
    responsavelEmail: z.string().trim().toLowerCase().email().max(320),
    unidade: z
      .object({
        code: z.string().trim().min(1).max(32),
        name: z.string().trim().min(1).max(120),
        timezone: z.string().min(1),
      })
      .strict(),
  })
  .strict();
