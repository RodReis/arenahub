-- FIX #272 -- uma assinatura vigente por aluno.
--
-- Visto pelo PI no Painel Financeiro de producao em 04/09/2026: R$ 92.550
-- esperados para "341 assinatura(s)". Com o plano a R$ 150 a conta nao fecha
-- -- 92.550 / 150 = 617 LINHAS somadas, contra os 341 alunos anunciados ao
-- lado. Medido em producao: 617 vigentes, 341 alunos distintos, 161 alunos
-- com duas ou mais no prazo, 116 vencidas ainda `ACTIVE`.
--
-- CAUSA: a idempotencia do import e por `(tenant, aluno, plano, startsAt)` e
-- trata `startsAt` diferente como RENOVACAO -- cria a linha nova sem encerrar
-- a anterior, e as duas ficam `ACTIVE`. Duas geracoes convivem: as de agosto,
-- com as datas originais do Pacto, e as de 01/09/2026, da rodada com data
-- forcada.
--
-- A ORDEM DESTE ARQUIVO E OBRIGATORIA: limpar o dado ANTES de criar o indice.
-- Invertido, o `CREATE UNIQUE INDEX` falha na primeira duplicata e a migration
-- inteira reverte.

-- 1. VENCIDA NAO E VIGENTE.
--
-- `ends_at` no passado com status `ACTIVE` e contradicao: a assinatura acabou
-- e ninguem a expirou. Elas entram no esperado do painel e na base da taxa de
-- inadimplencia, inflando os dois.
--
-- `EXPIRED`, e nao `CANCELLED`: cancelar afirma que alguem decidiu encerrar, e
-- ninguem decidiu -- o prazo simplesmente acabou. O enum ja distingue os dois.
UPDATE "subscriptions"
SET "status" = 'EXPIRED', "updated_at" = CURRENT_TIMESTAMP
WHERE "status" IN ('ACTIVE', 'PAST_DUE')
  AND "ends_at" IS NOT NULL
  AND "ends_at" < CURRENT_TIMESTAMP;

-- 2. UMA POR ALUNO -- a MAIS ANTIGA vence.
--
-- Decisao do PI (04/09/2026): manter a mais antiga preserva o historico de
-- QUANDO cada pessoa entrou. Manter a mais recente jogaria a data de entrada
-- de 161 alunos para 01/09/2026, apagando meses de vinculo real.
--
-- `starts_at ASC, created_at ASC, id ASC` -- os tres, nesta ordem. `starts_at`
-- sozinho empata (centenas de assinaturas comecam no mesmo 01/09),
-- `created_at` desempata pela gravacao, e `id` fecha: sem criterio total, duas
-- execucoes escolheriam vencedores diferentes e a migration deixaria de ser
-- deterministica.
--
-- IDEMPOTENTE: rodar de novo nao encontra segunda linha vigente por aluno --
-- a primeira execucao ja as encerrou --, entao o UPDATE afeta zero linhas.
WITH ordenadas AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "tenant_id", "student_id"
      ORDER BY "starts_at" ASC, "created_at" ASC, "id" ASC
    ) AS posicao
  FROM "subscriptions"
  WHERE "status" IN ('ACTIVE', 'PAST_DUE')
)
UPDATE "subscriptions" s
SET
  "status" = 'EXPIRED',
  "updated_at" = CURRENT_TIMESTAMP,
  -- POR QUE esta linha foi encerrada, no lugar que a ficha ja le. Sem isto a
  -- recepcao veria uma assinatura `EXPIRED` sem explicacao e abriria chamado.
  "last_reason" = 'Encerrada por duplicidade (issue #272): o aluno ja tinha assinatura vigente mais antiga'
FROM ordenadas o
WHERE s."id" = o."id" AND o.posicao > 1;

-- 3. O BANCO PASSA A RECUSAR A SEGUNDA.
--
-- PARCIAL, so sobre o que esta vigente: `CANCELLED` e `EXPIRED` acumulam ao
-- longo do tempo (o aluno que sai e volta), e um unique total impediria o
-- historico legitimo.
--
-- NAO INCLUI `plan_id`: a regra do PI e "1 aluno, 1 plano vigente", nao "um
-- por plano" -- incluir o plano deixaria a mesma pessoa vigente em dois planos
-- diferentes, que e exatamente o caso que se quer barrar.
CREATE UNIQUE INDEX "subscriptions_uma_vigente_por_aluno"
ON "subscriptions" ("tenant_id", "student_id")
WHERE "status" IN ('ACTIVE', 'PAST_DUE');
