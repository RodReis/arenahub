-- F18 -- meta de composicao corporal do aluno (`M3-FR-012`).
--
-- A meta e um alvo AO LADO da serie, nunca um ponto dentro dela: ela nao
-- edita avaliacao nenhuma (Slice 3.4 -- "progresso calculado, sem editar
-- avaliacoes"). O comparativo le a meta ativa e mede a distancia ate o alvo.
--
-- `baseline_value` fica CONGELADO junto do alvo de proposito: a avaliacao
-- que serviu de ponto de partida pode ser corrigida depois (INV-102), e uma
-- meta que recalculasse o proprio ponto de partida mudaria de significado
-- sozinha, sem ninguem ter combinado nada.
--
-- `DECIMAL(10,4)` e nao `double`, pela mesma razao de `body_measurements`: o
-- progresso subtrai numeros proximos, que e onde o erro binario aparece.

-- CreateTable
CREATE TABLE "health_goals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "body_measurement_type" NOT NULL,
    "baseline_value" DECIMAL(10,4) NOT NULL,
    "target_value" DECIMAL(10,4) NOT NULL,
    "unit" "measurement_unit",
    "deadline" DATE NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "achieved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_goals_tenant_id_student_id_type_idx" ON "health_goals"("tenant_id", "student_id", "type");

-- AddForeignKey
ALTER TABLE "health_goals" ADD CONSTRAINT "health_goals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_goals" ADD CONSTRAINT "health_goals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_goals" ADD CONSTRAINT "health_goals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- UMA META ATIVA POR TIPO E POR ALUNO.
--
-- Escrito a mao porque o Prisma nao modela indice PARCIAL -- ele nao aparece
-- no schema.prisma e um `prisma migrate dev` futuro vai propor apaga-lo.
-- NAO ACEITE (mesma armadilha documentada na F17).
--
-- A garantia tem de estar NO BANCO, nao num `findFirst` + `if` no servico:
-- duas requisicoes concorrentes -- dois cliques, ou o retry do navegador --
-- leem as duas "nao existe meta ativa" e as duas criam. A janela entre a
-- leitura e a escrita e exatamente o que a guarda deveria fechar, e ela
-- perde essa corrida por construcao (foi assim na F14 e na F17).
--
-- Com duas metas ativas do mesmo tipo, o comparativo passa a ter dois alvos
-- sem criterio de desempate -- e a tela mostra um deles por acidente de
-- ordenacao.
--
-- Parcial em `closed_at IS NULL` porque meta ENCERRADA nao disputa nada.
-- Exigir unicidade sobre ela impediria o aluno de ter uma meta nova de peso
-- depois de bater a anterior, que e o caso comum, nao a excecao.
CREATE UNIQUE INDEX "health_goals_uma_meta_ativa_por_tipo"
  ON "health_goals" ("tenant_id", "student_id", "type")
  WHERE "closed_at" IS NULL;
