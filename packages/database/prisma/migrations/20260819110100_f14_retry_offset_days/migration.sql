-- F14 -- offsets de nova tentativa de cobranca, por tenant.
--
-- 3 tentativas em D+0, D+3 e D+7 a partir do vencimento: decisao do PI em
-- 19/08/2026. Fica em `billing_settings` e nao em constante do codigo para
-- que uma academia ajuste sem deploy -- o mesmo criterio de `grace_days`.
--
-- DEFAULT preenche as linhas existentes na propria instrucao, entao nao ha
-- passo de backfill: nenhuma linha fica sem valor em momento algum.
--
-- O TAMANHO DA LISTA e o maximo de tentativas. Lista vazia desliga a cobranca
-- automatica, o que e diferente de "tentar para sempre" -- e por isso nao ha
-- coluna `max_attempts` que possa divergir dela.

ALTER TABLE "billing_settings"
  ADD COLUMN "retry_offset_days" INTEGER[] NOT NULL DEFAULT ARRAY[0, 3, 7];
