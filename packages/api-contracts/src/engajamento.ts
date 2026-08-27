import { z } from 'zod';

/**
 * So `RANKING` na API desta fatia.
 *
 * `CHALLENGE`, `ENGAGEMENT_PUSH` e `PHYSICAL_EVOLUTION_RANKING` existem no
 * banco (para F31-F35 nao precisarem de migration) mas NAO no contrato:
 * aceitar aqui criaria consentimento que nenhuma tela mostra e nenhum
 * consumidor le. Cada uma entra junto com quem a consome.
 */
export const finalidadeExpostaSchema = z.literal('RANKING');

export const preferenciasSchema = z.object({
  finalidade: finalidadeExpostaSchema,
  participa: z.boolean(),
});

export type PreferenciasDoTotem = z.infer<typeof preferenciasSchema>;

export const aliasPublicoSchema = z
  .object({
    identityChoice: z.enum(['PRIMEIRO_NOME', 'APELIDO', 'ANONIMO']),
    alias: z.string().trim().min(1).max(64).nullable(),
    /** Versao lida pelo cliente. `null` na primeira gravacao. */
    version: z.number().int().positive().nullable(),
  })
  .refine((v) => v.identityChoice !== 'APELIDO' || (v.alias !== null && v.alias.length > 0), {
    message: 'apelido e obrigatorio quando a identidade escolhida e APELIDO',
    path: ['alias'],
  });

export type PerfilPublicoDoTotem = z.infer<typeof aliasPublicoSchema>;
