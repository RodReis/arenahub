-- F45 -- passo 2 de 3: backfill de `students.gym_unit_id`.
--
-- Cada aluno recebe uma unidade ATIVA DO PROPRIO TENANT. O `tenant_id` no
-- JOIN nao e decoracao: sem ele um aluno herdaria unidade de outra academia,
-- que e o vazamento que a regra de arquitetura no 2 existe para impedir.
--
-- Desempate por `(created_at, id)`: com mais de uma unidade ativa, escolhe a
-- mais antiga -- deterministico, e portanto reproduzivel em homologacao e em
-- producao. `id` desempata unidades criadas no mesmo instante.
--
-- Idempotente: o `WHERE gym_unit_id IS NULL` faz a re-execucao nao mexer em
-- quem ja tem unidade. Rodar duas vezes tem o mesmo efeito de rodar uma.
--
-- Nao inventa nem perde aluno: `UPDATE` nao cria nem apaga linha, e o passo
-- 3 falha alto se algum aluno tiver sobrado sem unidade.

UPDATE "students" AS s
SET "gym_unit_id" = (
  SELECT u."id"
  FROM "gym_units" AS u
  WHERE u."tenant_id" = s."tenant_id"
    AND u."status" = 'ACTIVE'
  ORDER BY u."created_at" ASC, u."id" ASC
  LIMIT 1
)
WHERE s."gym_unit_id" IS NULL;
