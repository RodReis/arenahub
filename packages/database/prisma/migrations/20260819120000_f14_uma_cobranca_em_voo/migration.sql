-- F14 -- no maximo UMA cobranca de cartao em voo por invoice.
--
-- O DEFEITO QUE ISTO FECHA, achado sondando a fatia antes do PR: a chave de
-- idempotencia era `card:<invoice>:<tentativas ja feitas>`, derivada de uma
-- CONTAGEM. Duas requisicoes concorrentes para a mesma invoice leem
-- contagens diferentes (0 e 1), montam chaves diferentes (`:0` e `:1`), e a
-- constraint `(tenant_id, idempotency_key)` NUNCA dispara -- as duas cobrancas
-- passam e o aluno paga em dobro.
--
-- Contagem nao serve como chave de idempotencia: ela muda entre a leitura e a
-- escrita, que e exatamente a janela que a idempotencia existe para fechar.
--
-- A guarda tem de estar NO BANCO, nao no codigo: um `if (jaExiste)` perde a
-- corrida entre duas requisicoes: e a mesma tese do inbox de webhook da F13
-- (INV-076).
--
-- Parcial em `PROCESSING`: tentativa que ja terminou (SUCCEEDED, FAILED) nao
-- disputa nada, e exigir unicidade sobre ela impediria a SEGUNDA tentativa
-- legitima da politica de retry -- que e o D+3 do PI.

CREATE UNIQUE INDEX "payment_attempts_uma_cobranca_de_cartao_em_voo"
  ON "payment_attempts" ("tenant_id", "invoice_id")
  WHERE "method" = 'CARD' AND "status" = 'PROCESSING';
