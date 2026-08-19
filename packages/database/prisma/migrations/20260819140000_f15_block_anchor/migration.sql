-- F15 -- ancora de bloqueio por inadimplencia (ADR-019 2).
--
-- "Nao e constante, e CONFIGURACAO": o PI muda por academia sem tocar em
-- codigo. Regra comercial que vive dentro de um `if` e regra que ninguem
-- encontra depois.
--
-- Ha um valor so hoje, e isso e deliberado. O enum existe para que uma segunda
-- politica -- adiar por feriado, por exemplo, que o ADR-019 4 deixou de fora
-- desta versao -- entre como valor NOVO, e nao como excecao escondida no meio
-- do job de vencimento.
--
-- DEFAULT preenche as linhas existentes na propria instrucao: nenhuma fica sem
-- valor em momento algum, e por isso nao ha passo de backfill.

CREATE TYPE "block_anchor" AS ENUM ('DUE_PLUS_GRACE');

ALTER TABLE "billing_settings"
  ADD COLUMN "block_anchor" "block_anchor" NOT NULL DEFAULT 'DUE_PLUS_GRACE';
