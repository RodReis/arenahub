-- F19 -- upload e revisao de arquivo (Slice 3.3, `M3-FR-009` a `M3-FR-011`).
--
-- A IMPORTACAO NAO E UMA AVALIACAO. Ela vira uma, depois de revisada.
--
-- Tabela separada de `body_assessments` porque `M3-BR-006` e INV-103 exigem
-- confirmacao humana ANTES de o dado existir como historico. Gravar direto na
-- avaliacao com um flag "revisada" faria o valor do OCR ja estar no grafico
-- esperando alguem desmarcar -- e um esquecimento viraria dado oficial.

CREATE TYPE "assessment_import_status" AS ENUM (
  'RECEIVED', 'INFECTED', 'EXTRACTED', 'FAILED', 'CONFIRMED', 'DISCARDED'
);

CREATE TYPE "imported_field_state" AS ENUM (
  'PENDING', 'CONFIRMED', 'CORRECTED', 'DISCARDED'
);

CREATE TABLE "assessment_imports" (
  "id"                  UUID                       NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"           UUID                       NOT NULL,
  "student_id"          UUID                       NOT NULL,
  "status"              "assessment_import_status" NOT NULL DEFAULT 'RECEIVED',
  -- Nome que o arquivo tinha no computador de quem enviou. Guardado para a
  -- tela; NUNCA usado para decidir tipo -- extensao e controlada por quem
  -- envia.
  "original_filename"   TEXT                       NOT NULL,
  -- Tipo REAL, decidido pela assinatura nos primeiros bytes.
  "file_type"           TEXT                       NOT NULL,
  "file_size_bytes"     INTEGER                    NOT NULL,
  -- Fica NULA quando o arquivo e expurgado apos a confirmacao, sem que a
  -- linha morra: o historico de que houve importacao e o que a auditoria
  -- consulta.
  "object_key"          TEXT,
  "scan_result"         TEXT,
  "extractor"           TEXT,
  "failure_reason"      TEXT,
  "uploaded_by_user_id" UUID                       NOT NULL,
  -- Quem confirmou a revisao. NULO ate a confirmacao -- e o registro de que
  -- um HUMANO decidiu (INV-103).
  "reviewed_by_user_id" UUID,
  "reviewed_at"         TIMESTAMP(3),
  -- A avaliacao que nasceu desta importacao. Nula ate a confirmacao.
  "assessment_id"       UUID,
  "created_at"          TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3)               NOT NULL,

  CONSTRAINT "assessment_imports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assessment_imports_assessment_id_key"
  ON "assessment_imports" ("assessment_id");
CREATE INDEX "assessment_imports_tenant_id_student_id_created_at_idx"
  ON "assessment_imports" ("tenant_id", "student_id", "created_at");
-- O indice que o painel da F22 usa: importacoes pendentes e falhas por tenant.
CREATE INDEX "assessment_imports_tenant_id_status_created_at_idx"
  ON "assessment_imports" ("tenant_id", "status", "created_at");

CREATE TABLE "imported_fields" (
  "id"              UUID                   NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"       UUID                   NOT NULL,
  "import_id"       UUID                   NOT NULL,
  "type"            "body_measurement_type" NOT NULL,
  "state"           "imported_field_state" NOT NULL DEFAULT 'PENDING',
  -- O que a MAQUINA leu. Nunca sobrescrito -- e a proveniencia que o aceite
  -- da Slice 3.3 exige ("a proveniencia permanece visivel").
  "extracted_value" DECIMAL(10,4),
  "extracted_unit"  "measurement_unit",
  -- 0..1 quando o extrator informa. NULO quando ele nao mede confianca
  -- (parser de CSV) -- e `null` NAO e zero.
  "confidence"      DECIMAL(5,4),
  "source_location" TEXT,
  -- O que o HUMANO decidiu. Preenchido quando `CORRECTED`.
  "reviewed_value"  DECIMAL(10,4),
  "reviewed_unit"   "measurement_unit",
  "created_at"      TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3)           NOT NULL,

  CONSTRAINT "imported_fields_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "imported_fields_import_id_state_idx"
  ON "imported_fields" ("import_id", "state");

ALTER TABLE "assessment_imports"
  ADD CONSTRAINT "assessment_imports_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assessment_imports"
  ADD CONSTRAINT "assessment_imports_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assessment_imports"
  ADD CONSTRAINT "assessment_imports_uploaded_by_user_id_fkey"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assessment_imports"
  ADD CONSTRAINT "assessment_imports_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assessment_imports"
  ADD CONSTRAINT "assessment_imports_assessment_id_fkey"
  FOREIGN KEY ("assessment_id") REFERENCES "body_assessments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "imported_fields"
  ADD CONSTRAINT "imported_fields_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "imported_fields"
  ADD CONSTRAINT "imported_fields_import_id_fkey"
  FOREIGN KEY ("import_id") REFERENCES "assessment_imports"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- INV-103 NO BANCO: importacao CONFIRMADA exige revisor e instante.
--
-- Este e o invariante mais importante da fatia, e por isso ele nao mora so no
-- codigo: `CONFIRMED` sem `reviewed_by_user_id` seria exatamente "o OCR
-- publicou sozinho". Um bug de servico que esquecesse de preencher o revisor
-- produziria dado oficial sem dono, e a auditoria nao teria a quem perguntar.
ALTER TABLE "assessment_imports"
  ADD CONSTRAINT "assessment_imports_confirmada_tem_revisor"
  CHECK ("status" <> 'CONFIRMED'
      OR ("reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL));

-- Confirmada tem avaliacao; nao-confirmada nao tem.
--
-- A segunda metade e a que pega o bug silencioso: uma importacao ainda em
-- revisao apontando para avaliacao significaria que o dado ja entrou no
-- grafico antes de alguem decidir sobre ele.
ALTER TABLE "assessment_imports"
  ADD CONSTRAINT "assessment_imports_avaliacao_so_em_confirmada"
  CHECK (("status" = 'CONFIRMED' AND "assessment_id" IS NOT NULL)
      OR ("status" <> 'CONFIRMED' AND "assessment_id" IS NULL));

-- Recusada pelo antivirus ou falha de extracao SEMPRE dizem por que.
ALTER TABLE "assessment_imports"
  ADD CONSTRAINT "assessment_imports_falha_tem_motivo"
  CHECK ("status" NOT IN ('INFECTED', 'FAILED') OR "failure_reason" IS NOT NULL);

-- Arquivo infectado NAO fica no storage. A coluna nula e a prova de que foi
-- removido -- e a constraint impede que alguem "conserte" isso guardando o
-- arquivo para analisar depois.
ALTER TABLE "assessment_imports"
  ADD CONSTRAINT "assessment_imports_infectada_sem_arquivo"
  CHECK ("status" <> 'INFECTED' OR "object_key" IS NULL);

ALTER TABLE "assessment_imports"
  ADD CONSTRAINT "assessment_imports_tamanho_positivo"
  CHECK ("file_size_bytes" > 0);

-- Campo CORRIGIDO tem valor novo; os outros estados nao tem.
--
-- Sem a segunda metade, um campo `DISCARDED` poderia carregar
-- `reviewed_value` e alguem, um dia, leria esse valor achando que vale.
ALTER TABLE "imported_fields"
  ADD CONSTRAINT "imported_fields_corrigido_tem_valor"
  CHECK (("state" = 'CORRECTED' AND "reviewed_value" IS NOT NULL)
      OR ("state" <> 'CORRECTED' AND "reviewed_value" IS NULL));

-- Confianca e proporcao, quando existe.
ALTER TABLE "imported_fields"
  ADD CONSTRAINT "imported_fields_confianca_e_proporcao"
  CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
