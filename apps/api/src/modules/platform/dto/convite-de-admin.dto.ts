import { z } from 'zod';

/**
 * Convite do Admin do tenant -- F79.
 *
 * `email` OPCIONAL porque a mesma rota faz tres coisas que terminam no mesmo
 * lugar: criar o convite, reenvia-lo e corrigir o endereco. Ausente significa
 * "mande de novo para onde ja ia" -- o caso mais comum, e o que nao pede que
 * quem reenvia redigite um e-mail que a tela ja mostra.
 *
 * Mesmas restricoes de `responsavelEmail` em `criar-tenant.dto.ts`: o destino
 * do convite e o mesmo campo, so que corrigido depois.
 */
export const esquemaDeConviteDeAdmin = z.object({
  email: z.string().trim().toLowerCase().email().max(320).optional(),
});

/**
 * Revogacao do convite do Admin -- F79.
 *
 * O motivo e o ato: revogar tira o acesso e nao se desfaz, e a justificativa
 * vai para a auditoria. Mesmo minimo da elevacao de suporte -- 10 caracteres
 * nao aceitam "ok" nem ".".
 */
export const esquemaDeRevogacaoDeConvite = z.object({
  reason: z.string().trim().min(10).max(500),
});
