-- F21 -- analise assistiva por IA (Slice 3.5, ADR-035/036/037).

-- 1. O ACEITE DA F21: tipo proprio, e nao versao do documento de saude.
--
ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'AI_ANALYSIS';

CREATE TYPE "consent_signer_role" AS ENUM ('STUDENT_CONSENT', 'PROFESSIONAL_ENDORSEMENT');

-- `DEFAULT` preserva o significado do historico: toda linha anterior a F21 e
-- consentimento do titular, e nenhuma precisa ser reescrita.
ALTER TABLE "consent_records"
  ADD COLUMN "signer_role" "consent_signer_role" NOT NULL DEFAULT 'STUDENT_CONSENT';

-- 3. PROMPT VERSIONADO (`M3-FR-016`).
--
-- Tabela propria e nao string solta na analise: reproduzir uma analise de tres
-- meses atras exige o TEXTO que a gerou, nao o nome dele.
CREATE TABLE "ai_prompt_versions" (
  "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
  "name"           TEXT         NOT NULL,
  "content"        TEXT         NOT NULL,
  "content_sha256" TEXT         NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retired_at"     TIMESTAMP(3),

  CONSTRAINT "ai_prompt_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_prompt_versions_name_key" ON "ai_prompt_versions" ("name");

-- 4. AS ANALISES.
CREATE TYPE "ai_analysis_status" AS ENUM ('PUBLISHED', 'REJECTED', 'FAILED');

CREATE TABLE "ai_analyses" (
  "id"                   UUID                 NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"            UUID                 NOT NULL,
  "student_id"           UUID                 NOT NULL,
  "status"               "ai_analysis_status" NOT NULL,
  "analysis_ref"         TEXT                 NOT NULL,
  -- O payload PSEUDONIMIZADO, exatamente como foi enviado. Guardar o enviado
  -- e o que torna a analise reproduzivel: sem ele, "por que a IA disse isso"
  -- nao tem resposta. O vinculo com o aluno mora na coluna `student_id`, NAO
  -- dentro deste JSON -- e a separacao que permite auditar de quem e a
  -- analise sem que o provedor jamais tenha sabido.
  "snapshot"             JSONB                NOT NULL,
  -- Nulo quando REJECTED ou FAILED: saida recusada nao vira conteudo, nem
  -- "para consulta".
  "output"               JSONB,
  "rejection_reason"     TEXT,
  "rejection_detail"     TEXT,
  "prompt_version_id"    UUID                 NOT NULL,
  "model"                TEXT                 NOT NULL,
  -- Inteiro pela regra de arquitetura no 6: `float` acumula erro, e o teto de
  -- gasto por tenant (`M3-NFR-005`) soma milhares destes valores.
  "cost_micros"          INTEGER              NOT NULL,
  "latency_ms"           INTEGER              NOT NULL,
  "input_tokens"         INTEGER              NOT NULL,
  "output_tokens"        INTEGER              NOT NULL,
  "requested_by_user_id" UUID                 NOT NULL,
  "created_at"           TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_analyses_analysis_ref_key" ON "ai_analyses" ("analysis_ref");
CREATE INDEX "ai_analyses_tenant_id_student_id_created_at_idx"
  ON "ai_analyses" ("tenant_id", "student_id", "created_at");
CREATE INDEX "ai_analyses_tenant_id_created_at_idx"
  ON "ai_analyses" ("tenant_id", "created_at");

ALTER TABLE "ai_analyses"
  ADD CONSTRAINT "ai_analyses_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_analyses"
  ADD CONSTRAINT "ai_analyses_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `RESTRICT` e nao `CASCADE`: apagar a versao de prompt destruiria a
-- reprodutibilidade de toda analise que ela gerou.
ALTER TABLE "ai_analyses"
  ADD CONSTRAINT "ai_analyses_prompt_version_id_fkey"
  FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_analyses"
  ADD CONSTRAINT "ai_analyses_requested_by_user_id_fkey"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- SAIDA SO EXISTE EM ANALISE PUBLICADA, e recusada SEMPRE diz por que.
--
-- Sem estas duas, um bug gravaria texto de IA numa linha rejeitada -- e a
-- tela, que filtra por status, poderia um dia passar a ler o campo e mostrar
-- exatamente o conteudo que a regra no 8 recusou.
ALTER TABLE "ai_analyses"
  ADD CONSTRAINT "ai_analyses_saida_so_em_publicada"
  CHECK (("status" = 'PUBLISHED' AND "output" IS NOT NULL)
      OR ("status" <> 'PUBLISHED' AND "output" IS NULL));

ALTER TABLE "ai_analyses"
  ADD CONSTRAINT "ai_analyses_rejeitada_tem_motivo"
  CHECK ("status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL);

-- Custo e latencia nao sao negativos. Guarda barata contra unidade trocada
-- (segundo no lugar de milissegundo vira negativo em subtracao errada).
ALTER TABLE "ai_analyses"
  ADD CONSTRAINT "ai_analyses_medidas_nao_negativas"
  CHECK ("cost_micros" >= 0 AND "latency_ms" >= 0
     AND "input_tokens" >= 0 AND "output_tokens" >= 0);
