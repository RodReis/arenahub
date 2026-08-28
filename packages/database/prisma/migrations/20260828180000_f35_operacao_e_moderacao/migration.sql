-- F35 -- Operacao, moderacao e experimento (Slice 5.6, ADR-049)
--
-- Escrita A MAO, nao gerada por `migrate dev`. Motivo: a migration da F21 foi
-- alterada depois de aplicada, entao o `migrate dev` exige resetar o banco de
-- desenvolvimento. O SQL abaixo veio de `migrate diff` contra um shadow
-- temporario, com a divida PRE-EXISTENTE removida a mao -- `DROP DEFAULT` em
-- 6 tabelas, FKs de `public_profiles` e dois renames de indice da F24 que o
-- diff arrastava. Uma migration chamada "F35" nao deve mexer em perfil
-- publico nem em sessao de frequencia. Mesmo procedimento da F34.

-- ---------------------------------------------------------------------------
-- 1. Categoria de ranking (ADR-049, Decisao 4)
-- ---------------------------------------------------------------------------

CREATE TYPE "ranking_category" AS ENUM ('XP_DO_MES', 'FREQUENCIA', 'CONSISTENCIA');

-- `DEFAULT 'XP_DO_MES'` NAO e conveniencia: e o que todo snapshot existente
-- sempre mediu. A coluna da nome ao criterio que ja estava la, entao a linha
-- antiga nasce classificada corretamente sem backfill.
ALTER TABLE "ranking_snapshots"
  ADD COLUMN "category" "ranking_category" NOT NULL DEFAULT 'XP_DO_MES';

-- A chave unica ANTIGA cabia um placar por unidade e mes. Com categoria, o
-- ranking de frequencia de agosto colidiria com o de XP de agosto -- nao por
-- conflito real, mas porque a chave nao sabia que existiam dois criterios.
DROP INDEX "ranking_snapshots_tenant_id_gym_unit_id_local_month_key";

CREATE UNIQUE INDEX "ranking_snapshots_tenant_id_gym_unit_id_local_month_categor_key"
  ON "ranking_snapshots"("tenant_id", "gym_unit_id", "local_month", "category");

-- ---------------------------------------------------------------------------
-- 2. Flags e teto de correcao, por tenant (ADR-049, Decisoes 2 e 3)
-- ---------------------------------------------------------------------------
--
-- Colunas em `tenants`, ao lado de `ranking_minimum_cohort`, que ja e config
-- de engajamento por tenant. Tabela nova so para tres booleanos seria tabela
-- para procurar depois.
--
-- `DEFAULT true` nas tres: a fatia NAO desliga nada de quem ja esta rodando.
-- Ligado e o estado que as F31, F32 e F34 entregaram; a flag existe para
-- poder desligar, nao para exigir que alguem ligue.

ALTER TABLE "tenants"
  ADD COLUMN "engagement_ranking_enabled"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "engagement_challenges_enabled"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "engagement_achievements_enabled" BOOLEAN NOT NULL DEFAULT true,
  -- Nulo = sem teto. RECUSA acima do teto, nunca enfileira para aprovacao.
  ADD COLUMN "engagement_correction_limit_points" INTEGER;

-- ---------------------------------------------------------------------------
-- 3. Contestacoes (`M5-FR-016`)
-- ---------------------------------------------------------------------------

CREATE TYPE "engagement_dispute_subject" AS ENUM ('XP', 'CONQUISTA', 'CONSISTENCIA', 'RANKING', 'DESAFIO');

CREATE TYPE "engagement_dispute_status" AS ENUM ('ABERTA', 'CORRIGIDA', 'IMPROCEDENTE');

CREATE TABLE "engagement_disputes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subject" "engagement_dispute_subject" NOT NULL,
    "descricao" TEXT NOT NULL,
    "status" "engagement_dispute_status" NOT NULL DEFAULT 'ABERTA',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolucao" TEXT,
    -- Aponta para o movimento que corrigiu, nao copia o valor: duas verdades
    -- sobre quantos pontos foram devolvidos divergem na primeira mudanca.
    "correction_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_disputes_pkey" PRIMARY KEY ("id")
);

-- A fila do painel le por aqui: por status, mais antigas primeiro.
CREATE INDEX "engagement_disputes_tenant_id_status_created_at_idx"
  ON "engagement_disputes"("tenant_id", "status", "created_at");

-- O totem le por aqui: as contestacoes do proprio aluno.
CREATE INDEX "engagement_disputes_tenant_id_student_id_created_at_idx"
  ON "engagement_disputes"("tenant_id", "student_id", "created_at");

ALTER TABLE "engagement_disputes" ADD CONSTRAINT "engagement_disputes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "engagement_disputes" ADD CONSTRAINT "engagement_disputes_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL e nao CASCADE: preserva a contestacao mesmo se quem resolveu sair
-- da academia. Apagar o desfecho junto com o funcionario apagaria a trilha.
ALTER TABLE "engagement_disputes" ADD CONSTRAINT "engagement_disputes_resolved_by_fkey"
  FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "engagement_disputes" ADD CONSTRAINT "engagement_disputes_correction_entry_id_fkey"
  FOREIGN KEY ("correction_entry_id") REFERENCES "xp_ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
