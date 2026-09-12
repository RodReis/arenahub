import { z } from 'zod';

/**
 * Contrato de entrada do canal mobile.
 *
 * `.strict()` em todos: campo desconhecido e ERRO, nao silencio. Aceitar
 * extra deixa o cliente mandar `{ senha, tenantId }` e alguem, um dia,
 * passar a ler o tenant do corpo -- exatamente o que a regra de arquitetura
 * no 2 proibe.
 */

/** Piso de 10 caracteres -- a politica esta no servico; aqui e so formato. */
const senha = z.string().min(1).max(200);

export const ativarDto = z
  .object({
    token: z.string().min(1),
    senha,
  })
  .strict();

export const loginDto = z
  .object({
    /**
     * O tenant entra POR SLUG, e nao por id.
     *
     * Isto nao contraria a regra no 2: aqui ainda NAO existe identidade
     * autenticada -- e o login que a cria. O slug diz "qual academia", como o
     * subdominio faz na web. A partir do token emitido, o tenant sai SEMPRE
     * dos claims, e nunca mais do corpo.
     */
    tenantSlug: z.string().min(1).max(120),
    identificador: z.string().min(1).max(320),
    senha,
    /** Rotulo do aparelho, para a lista de sessoes. Opaco, nunca IMEI. */
    deviceLabel: z.string().max(60).optional(),
  })
  .strict();

export const refreshDto = z
  .object({
    refreshToken: z.string().min(1),
  })
  .strict();

export const recuperacaoDto = z
  .object({
    tenantSlug: z.string().min(1).max(120),
    identificador: z.string().min(1).max(320),
  })
  .strict();

export const confirmarRecuperacaoDto = z
  .object({
    token: z.string().min(1),
    senha,
  })
  .strict();

export const reautenticarDto = z
  .object({
    senha,
  })
  .strict();

export type AtivarEntrada = z.infer<typeof ativarDto>;
export type LoginEntrada = z.infer<typeof loginDto>;
export type RefreshEntrada = z.infer<typeof refreshDto>;
export type RecuperacaoEntrada = z.infer<typeof recuperacaoDto>;
export type ConfirmarRecuperacaoEntrada = z.infer<typeof confirmarRecuperacaoDto>;
export type ReautenticarEntrada = z.infer<typeof reautenticarDto>;
