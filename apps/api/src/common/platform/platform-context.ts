/**
 * Contexto do ator de PLATAFORMA -- o dono do SaaS.
 *
 * Separado de `TenantContext` de proposito: aquele exige `tenantId` e o
 * `require()` dele LANCA quando nao ha tenant. Afrouxa-lo para caber a
 * plataforma faria o Prisma listar tudo quando alguem esquecesse o filtro,
 * que e exatamente o que INV-003 impede.
 */
export interface PlatformContext {
  actorId: string;
  sessionId: string;
  platformAdminId: string;
}
