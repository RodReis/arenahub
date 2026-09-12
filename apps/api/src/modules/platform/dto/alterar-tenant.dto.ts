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
    /*
     * Qualificacao para o contrato -- F70 (ADR-055 §6). Divida antiga da
     * Especificacao §9, paga agora porque `TenantContractUseCase.ativar`
     * passa a exigir os quatro para ativar (ver `camposFaltandoParaContrato`).
     */
    addressLine: z.string().trim().min(1).max(200).optional(),
    addressCity: z.string().trim().min(1).max(120).optional(),
    addressState: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'use a sigla de 2 letras da UF')
      .optional(),
    addressZip: z
      .string()
      .trim()
      .regex(/^\d{8}$/, 'CEP deve ter 8 dígitos')
      .optional(),
    phone: z.string().trim().min(8).max(20).optional(),
    responsavelCpf: z
      .string()
      .trim()
      .regex(/^\d{11}$/, 'CPF deve ter 11 dígitos')
      .optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
    /*
     * Missao e diferenciais (F62) -- TEXTO, nunca HTML.
     *
     * Nao ha sanitizacao aqui de proposito: o React escapa por padrao ao
     * renderizar, e o unico jeito de isto virar HTML na tela seria alguem
     * escrever `dangerouslySetInnerHTML`. Sanitizar no boundary daria a falsa
     * impressao de que injetar o campo em HTML cru passou a ser seguro.
     *
     * `''` e aceito e significa APAGAR o texto -- e por isso o `.min(1)` que
     * os outros campos tem nao entra aqui: sem o vazio, quem escreveu a
     * missao por engano nao teria como remove-la.
     */
    missionText: z.string().trim().max(280).optional(),
    highlightsText: z.string().trim().max(500).optional(),
    /*
     * F65 -- liga/desliga a suspensao automatica por inadimplencia. Preferencia
     * de cobranca, nao ato que tira o tenant de operacao: por isso nao entra no
     * `.refine` de motivo obrigatorio abaixo.
     */
    autoSuspend: z.boolean().optional(),
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
