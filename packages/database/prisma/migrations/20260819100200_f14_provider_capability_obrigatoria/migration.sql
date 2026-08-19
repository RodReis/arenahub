-- F14 -- passo 3 de 3: `capability` obrigatoria e unicidade por tenant.
--
-- O `SET NOT NULL` E A GUARDA: se o passo 2 tiver deixado alguma conta para
-- tras, a migration PARA aqui, em vez de deixar viva uma conta que o
-- resolvedor nunca encontraria -- falha silenciosa no caminho do dinheiro.
--
-- A unicidade parcial garante NO BANCO o que o resolvedor assume: "quem faz
-- PIX neste tenant?" tem exatamente UMA resposta. Duas contas ativas da mesma
-- capacidade devolveriam a escolha para a ordem de insercao, que e o defeito
-- que esta coluna veio consertar -- resolve-lo so no codigo seria repetir o
-- erro num lugar mais dificil de ver.
--
-- Parcial (`WHERE active`) de proposito: conta DESATIVADA nao disputa
-- roteamento, e exigir unicidade sobre ela impediria trocar de PSP -- a conta
-- antiga precisa continuar existindo, inativa, para os eventos historicos
-- dela seguirem resolviveis.

ALTER TABLE "provider_accounts" ALTER COLUMN "capability" SET NOT NULL;

CREATE UNIQUE INDEX "provider_accounts_tenant_id_capability_active_key"
  ON "provider_accounts" ("tenant_id", "capability")
  WHERE "active";
