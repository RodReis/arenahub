-- F61 -- Super Admin e ciclo de vida do tenant (ADR-052).
--
-- Tres tabelas novas e tres alteracoes. Nenhuma delas apaga dado: `INACTIVE`
-- entra no enum sem tocar nas linhas existentes, as quatro colunas de
-- `tenants` nascem NULL (os tenants que ja existem nasceram sem elas) e o
-- `sessions.tenant_id` so AFROUXA -- toda sessao gravada continua valida.

-- 1. `INACTIVE` no enum de situacao do tenant.
--
-- INACTIVE = desligado pelo dono do SaaS, ato administrativo.
-- SUSPENDED = inadimplencia, e quem escreve e a F65 (ADR-053).
-- O efeito e o mesmo hoje; o que a coluna guarda e a RAZAO, que a auditoria
-- precisa distinguir depois.
ALTER TYPE "tenant_status" ADD VALUE 'INACTIVE';

-- 2. Dados cadastrais do contrato, pedidos pelo cadastro de tenant do painel.
--
-- Todas anulaveis: sao quatro colunas novas numa tabela com linhas em
-- producao, e nao existe valor correto a inventar para os tenants antigos.
ALTER TABLE "tenants" ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "responsavel_email" TEXT,
ADD COLUMN     "responsavel_nome" TEXT,
ADD COLUMN     "timezone" TEXT;

-- 3. Sessao SEM tenant.
--
-- E a alteracao de maior alcance da fatia: passa a existir um caminho -- e so
-- um -- em que a sessao nao esta em tenant nenhum, o do Super Admin. Toda
-- rota de tenant o rejeita, porque `TenantContextService.require()` continua
-- lancando quando nao ha tenant (INV-003).
ALTER TABLE "sessions" ALTER COLUMN "tenant_id" DROP NOT NULL;

-- 4. Dono do SaaS.
--
-- Tabela propria, fora de `roles`/`permissions`: `Role` e unico por
-- `(tenant_id, name)`, e afrouxar isso para caber um papel global poria papel
-- de plataforma e papel de tenant na mesma query de autorizacao -- um bug de
-- filtro ali vira vazamento entre tenants.
--
-- `revoked_at` em vez de DELETE: o rastro de quem foi dono do SaaS nao some.
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "granted_by_user_id" UUID,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- 5. Uma entrada de suporte num tenant.
--
-- Viva = `ended_at IS NULL AND expires_at > agora`. O indice
-- `(session_id, expires_at)` e o que o AuthGuard consulta a cada requisicao
-- elevada, entao ele nao e enfeite.
CREATE TABLE "support_elevations" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "platform_admin_user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "ended_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_elevations_pkey" PRIMARY KEY ("id")
);

-- 6. Auditoria de ato de PLATAFORMA.
--
-- Separada de `audit_logs` porque aquela exige `tenant_id` NOT NULL com FK --
-- e "criou o tenant X" nao tem tenant dono no momento do ato.
--
-- `tenant_id` aqui e UUID SEM foreign key de proposito: e referencia
-- historica e precisa sobreviver ao tenant que descreve. Sem `updated_at`,
-- mesma razao de `audit_logs`: registro de auditoria nao se edita.
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "target_id" TEXT,
    "tenant_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_user_id_key" ON "platform_admins"("user_id");

-- CreateIndex
CREATE INDEX "support_elevations_session_id_expires_at_idx" ON "support_elevations"("session_id", "expires_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_occurred_at_idx" ON "platform_audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_correlation_id_idx" ON "platform_audit_logs"("correlation_id");

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_elevations" ADD CONSTRAINT "support_elevations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_elevations" ADD CONSTRAINT "support_elevations_platform_admin_user_id_fkey" FOREIGN KEY ("platform_admin_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_elevations" ADD CONSTRAINT "support_elevations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
