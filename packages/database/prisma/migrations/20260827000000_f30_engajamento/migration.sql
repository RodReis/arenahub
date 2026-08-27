-- F30 -- Preferencias e identidade publica (ADR-046).
--
-- Duas coisas: quatro finalidades novas de consentimento (regime OPT-OUT,
-- ao contrario da biometria) e a tabela de identidade publica.

-- As finalidades de engajamento. Aditivo puro: `ALTER TYPE ... ADD VALUE`
-- nao toca em linha existente.
ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'RANKING';
ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'CHALLENGE';
ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'ENGAGEMENT_PUSH';
ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'PHYSICAL_EVOLUTION_RANKING';

CREATE TYPE "public_profile_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN');
CREATE TYPE "public_identity_choice" AS ENUM ('PRIMEIRO_NOME', 'APELIDO', 'ANONIMO');
CREATE TYPE "alias_rejection_reason" AS ENUM (
  'OFENSIVO', 'CONTEM_PII', 'IMPERSONACAO', 'SPAM_OU_PROPAGANDA', 'ILEGIVEL'
);

CREATE TABLE "public_profiles" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid NOT NULL,
  "student_id"        uuid NOT NULL,
  "identity_choice"   "public_identity_choice" NOT NULL DEFAULT 'PRIMEIRO_NOME',
  "alias"             text,
  "alias_normalized"  text,
  "status"            "public_profile_status" NOT NULL DEFAULT 'PENDING',
  "screening_signals" text[] NOT NULL DEFAULT '{}',
  "rejection_reason"  "alias_rejection_reason",
  "moderated_by"      uuid,
  "moderated_at"      timestamp(3),
  "version"           integer NOT NULL DEFAULT 1,
  "created_at"        timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        timestamp(3) NOT NULL,

  CONSTRAINT "public_profiles_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "public_profiles_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE,
  CONSTRAINT "public_profiles_moderated_by_fkey"
    FOREIGN KEY ("moderated_by") REFERENCES "users"("id")
);

-- Um perfil por aluno.
CREATE UNIQUE INDEX "public_profiles_tenant_id_student_id_key"
  ON "public_profiles" ("tenant_id", "student_id");

-- Unico em student_id sozinho: exigencia do Prisma para a relacao um-para-um
-- com Student.publicProfile. Nao adiciona regra nova -- aluno pertence a um
-- so tenant, entao esta unicidade e implicada pela de cima.
CREATE UNIQUE INDEX "public_profiles_student_id_key"
  ON "public_profiles" ("student_id");

-- A fila de moderacao le por aqui.
CREATE INDEX "public_profiles_tenant_id_status_created_at_idx"
  ON "public_profiles" ("tenant_id", "status", "created_at");

-- ALIAS UNICO SO ENTRE OS APROVADOS, e o WHERE e o ponto todo.
--
-- Indice TOTAL recusaria o segundo aluno que PEDIU o mesmo apelido, antes
-- de qualquer moderador olhar -- negando um pedido legitimo pelo motivo
-- errado. Dois PENDING iguais convivem; so um chega a APPROVED, e e ai que
-- a colisao importa, porque e ai que o nome aparece na tela.
CREATE UNIQUE INDEX "public_profiles_alias_aprovado_unico"
  ON "public_profiles" ("tenant_id", "alias_normalized")
  WHERE "status" = 'APPROVED' AND "alias_normalized" IS NOT NULL;
