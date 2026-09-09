-- FIX #292 -- alinhar o banco ao `schema.prisma`.
--
-- Nada aqui altera dado ou comportamento: sao 11 divergencias que o
-- `migrate diff` acusava entre o banco e o schema, todas herdadas de
-- migrations escritas a mao. Enquanto elas existirem, TODO `migrate diff` de
-- fatia nova vem contaminado, e quem escrever a proxima migration precisa
-- limpar o SQL alheio a mao -- ou commita divida de outra fatia sem perceber.
-- O `migrate dev` tambem recusa rodar enquanto ha drift (quer resetar o banco).

-- 1. `DROP DEFAULT` no `id` de seis tabelas.
--
-- O banco tem `gen_random_uuid()`; o schema declara `@default(uuid())`, que no
-- Prisma 7 e gerado NA APLICACAO. O default do banco portanto nunca e
-- exercido: todo INSERT ja chega com o `id` preenchido pelo client, e nao ha
-- INSERT cru nestas tabelas em lugar nenhum do codigo. Remover o default
-- alinha o banco ao que o schema descreve, sem tocar em linha existente.
ALTER TABLE "ai_analyses" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "ai_prompt_versions" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "assessment_imports" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "imported_fields" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "public_profiles" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "student_attendance_sessions" ALTER COLUMN "id" DROP DEFAULT;

-- 2. `ON UPDATE CASCADE` nas tres FKs de `public_profiles`.
--
-- NAO e recriacao identica, como parecia no diff. A migration da F30 foi
-- escrita a mao e omitiu o `ON UPDATE`, entao as tres herdaram o `NO ACTION`
-- do Postgres -- e sao as UNICAS assim no banco inteiro: 235 FKs estao em
-- CASCADE, tres em NO ACTION, todas aqui.
--
-- O efeito pratico hoje e nulo, porque a chave referenciada e sempre um UUID
-- de chave primaria, que nunca e atualizado. O que se corrige e a excecao
-- destoante: uma tabela que se comporta diferente das outras 200 e uma
-- armadilha para quem escrever a proxima migration olhando o vizinho errado.
ALTER TABLE "public_profiles" DROP CONSTRAINT "public_profiles_tenant_id_fkey";
ALTER TABLE "public_profiles" ADD CONSTRAINT "public_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public_profiles" DROP CONSTRAINT "public_profiles_student_id_fkey";
ALTER TABLE "public_profiles" ADD CONSTRAINT "public_profiles_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public_profiles" DROP CONSTRAINT "public_profiles_moderated_by_fkey";
ALTER TABLE "public_profiles" ADD CONSTRAINT "public_profiles_moderated_by_fkey" FOREIGN KEY ("moderated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Dois renames de indice em `student_attendance_sessions`.
--
-- A migration da F20 pediu `..._session_date_idx` (65 caracteres) e o POSTGRES
-- TRUNCOU em 63, virando `..._session_date_i`. O Prisma calcula o nome ja
-- truncado no lugar certo (`..._session_da_idx`), e por isso os dois nunca
-- coincidiram. Os tres nomes cabem em 63 caracteres, entao o rename e final --
-- nao vai truncar de novo.
--
-- O nome semantico `uma_por_dia_unidade_politica` se perde, e e uma perda
-- real de legibilidade: ele dizia POR QUE o indice existe (uma sessao por
-- aluno/dia/unidade/politica, a guarda de idempotencia da F20). Mas o schema
-- declara `@@unique([...])` sem `map:`, entao o nome calculado pelo Prisma e a
-- fonte da verdade; manter o nome exigiria `map:` no schema, que e mudanca de
-- schema e nao de banco. A razao continua escrita na migration da F20.
-- Nenhum codigo referencia qualquer um dos dois nomes.
ALTER INDEX "student_attendance_sessions_tenant_id_student_id_session_date_i" RENAME TO "student_attendance_sessions_tenant_id_student_id_session_da_idx";
ALTER INDEX "student_attendance_sessions_uma_por_dia_unidade_politica" RENAME TO "student_attendance_sessions_tenant_id_student_id_session_da_key";
