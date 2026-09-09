import { z } from 'zod';

/**
 * PATCH de tenant: dado cadastral e situacao.
 *
 * `slug` NAO entra: e identificador publico usado em URL (F62 fara login por
 * ele), e trocar identificador em rota de edicao quebraria link ja distribuido.
 *
 * `.strict()`: `id` no corpo e recusado, nao ignorado -- o tenant alvo vem da
 * rota.
 */
export const esquemaDeAlteracaoDeTenant = z
  .object({
    legalName: z.string().trim().min(1).max(200).optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    cnpj: z
      .string()
      .trim()
      .regex(/^\d{14}$/, 'CNPJ deve ter 14 digitos')
      .optional(),
    timezone: z.string().min(1).optional(),
    responsavelNome: z.string().trim().min(1).max(120).optional(),
    responsavelEmail: z.string().trim().toLowerCase().email().max(320).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
    /*
     * Motivo do ATO, nao do tenant: vai para o `metadata` do
     * `PlatformAuditLog` e nao vira coluna. Minimo de 10 caracteres pelo mesmo
     * criterio do motivo de inativacao de unidade -- "ok" nao e motivo.
     */
    reason: z.string().trim().min(10).max(500).optional(),
  })
  .strict()
  /*
   * TIRAR DE OPERACAO EXIGE MOTIVO. Reativar e renomear nao: a exigencia
   * protege a acao que tira o tenant de operacao, e pedir justificativa para
   * trocar um nome so ensinaria a digitar "." no campo.
   */
  .refine(
    (dados) =>
      (dados.status !== 'INACTIVE' && dados.status !== 'SUSPENDED') || dados.reason !== undefined,
    { message: 'Tirar o tenant de operacao exige motivo', path: ['reason'] },
  );
