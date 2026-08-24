-- Um checkout de cartao EM VOO por invoice -- inclusive o que ainda esta em
-- `CREATED`.
--
-- O indice da F14 (`20260819120000_f14_uma_cobranca_em_voo`) cobre apenas
-- `status = 'PROCESSING'`, e o checkout hospedado nasce em `CREATED`: o aluno
-- ainda nem abriu o link. Medido antes de escrever esta linha -- duas
-- requisicoes concorrentes gravaram DUAS tentativas de cartao para a mesma
-- invoice, que e o defeito da F14 chegando por outra porta.
--
-- PARCIAL, e nao `@@unique` cheio: tentativa que ja terminou (SUCCEEDED,
-- FAILED, CANCELLED) nao pode bloquear a proxima cobranca da mesma invoice --
-- o aluno cujo cartao foi recusado tem de poder tentar de novo.
--
-- NAO ACEITE `prisma migrate dev` propondo apagar este indice: o Prisma nao
-- modela unicidade condicional e nao o enxerga no schema.
CREATE UNIQUE INDEX "payment_attempts_um_checkout_em_voo"
  ON "payment_attempts" ("tenant_id", "invoice_id")
  WHERE "method" = 'CARD' AND "status" IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING');
