-- F14 -- passo 2 de 3: backfill de `provider_accounts.capability`.
--
-- TODA conta que existe hoje e de PIX. Isso nao e suposicao: a unica fatia
-- que criou conta de provedor foi a F13 (Slice 2.2, PIX e webhook), e cartao
-- entra AGORA, nesta fatia. Nao ha linha de cartao para classificar errado.
--
-- Idempotente: `WHERE capability IS NULL` faz a re-execucao nao mexer em quem
-- ja foi classificado. Rodar duas vezes tem o mesmo efeito de rodar uma.
--
-- Nao inventa nem perde conta: `UPDATE` nao cria nem apaga linha, e o passo 3
-- falha alto se alguma tiver sobrado sem capacidade.

UPDATE "provider_accounts"
SET "capability" = 'PIX'
WHERE "capability" IS NULL;
