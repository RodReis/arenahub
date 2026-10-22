/**
 * O que a identidade autenticada carrega, e de onde o tenant vem.
 *
 * Regra de arquitetura no 2 (`CLAUDE.md`) e INV-003 (`docs/CONVENTION.md`):
 * repositorio recebe `TenantContext` obrigatorio, e o tenant vem DAQUI --
 * nunca do corpo da requisicao nem do payload de webhook.
 *
 * `ARCHITECTURE.md` linha 112 e ainda mais forte: "query sem contexto nao
 * compila". Este tipo e o que torna isso verificavel pelo compilador.
 */
export interface TenantContext {
  tenantId: string;
  actorId: string;
  sessionId: string;
  permissions: ReadonlySet<string>;
  /**
   * Nomes dos papeis nesta academia (`OWNER`, `RECEPTION`...) -- issue #666.
   *
   * So para o MENU decidir o que oferecer; quem barra continua sendo
   * `permissions`. Ausente na elevacao de suporte, que nao tem papel proprio.
   */
  roles?: ReadonlySet<string>;
  /**
   * `'ALL'` = papel vale no tenant inteiro. Conjunto = escopo restrito
   * aquelas unidades.
   */
  allowedUnitIds: 'ALL' | ReadonlySet<string>;
  /** Presente so durante elevacao de suporte, que expira (Task 5). */
  supportElevation?: { reason: string; expiresAt: Date };
}
