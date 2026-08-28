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
  /** Obrigatoria, como na F11: toque duplo no totem devolve o mesmo
   * resultado em vez de gravar decisao nova. */
  idempotencyKey: z.string().min(8).max(120),
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

/**
 * Contestacao aberta pelo aluno no totem (`M5-FR-016`, F35).
 *
 * O `studentId` NAO esta aqui de proposito: quem contesta e quem esta logado
 * na sessao do totem, e o servidor o tira dali. Aceita-lo no corpo deixaria um
 * aluno abrir contestacao em nome de outro.
 *
 * Os limites espelham `DESCRICAO_MIN`/`DESCRICAO_MAX` do dominio -- a
 * validacao do servidor continua sendo a autoridade; esta aqui existe para a
 * tela avisar antes de mandar, nao para substitui-la.
 */
export const contestacaoSchema = z
  .object({
    subject: z.enum(['XP', 'CONQUISTA', 'CONSISTENCIA', 'RANKING', 'DESAFIO']),
    descricao: z.string().trim().min(5).max(500),
  })
  .strict();

export type ContestacaoDoTotem = z.infer<typeof contestacaoSchema>;
