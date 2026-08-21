-- #129 -- o eixo de `day_of_week` passa a ser UM SO: 0 = domingo ... 6 = sabado.
--
-- O DEFEITO: quem gravava (API, `plan.ts`, o Zod do controller, o comentario
-- deste schema) usava ISO-8601 `1..7`; quem DECIDE se a porta abre
-- (`packages/access-policy`, via `Date.getDay()`) le `0..6`. De segunda a
-- sabado os dois eixos coincidem -- `1..6` existe nos dois -- entao a semana
-- funcionava por coincidencia. No DOMINGO o motor calcula `0`, a linha
-- gravada dizia `7`, nenhuma janela casava, e todo aluno cadastrado pelo
-- caminho normal da API era negado com `OUTSIDE_SCHEDULE`.
--
-- POR QUE 0..6 GANHOU, e nao ISO: e o motor que decide o acesso, e o eixo
-- dele nao e escolha nossa -- vem de `Date.getDay()` e do `Intl` em
-- `local-time.ts`. Mudar o motor para ISO significaria converter em toda
-- decisao de catraca, no caminho mais quente e menos perdoavel do produto.
--
-- SEM CONVERSAO DE DADO, e isso foi medido antes de escrever a migration:
-- `plan_access_windows` esta VAZIA (nenhum plano cadastrado pela API ainda) e
-- as 2.219 linhas de `entitlement_unit_windows` ja estao em `0..6` -- vieram
-- todas da F48, que seguiu o motor de proposito. A tabela nunca chegou a ter
-- os dois eixos convivendo: o defeito era latente, nao materializado.
-- O `CHECK` abaixo prova isso na aplicacao da migration: se existisse uma
-- unica linha em `7`, ele falharia aqui em vez de negar alguem num domingo.
--
-- A TRAVA e o ponto principal desta migration. Comentario de schema nao
-- impede ninguem de gravar `7` -- o comentario, alias, apontava para o eixo
-- ERRADO e foi assim que o defeito nasceu. O banco impede.

ALTER TABLE "plan_access_windows"
  ADD CONSTRAINT "plan_access_windows_day_of_week_eixo_do_motor"
  CHECK ("day_of_week" BETWEEN 0 AND 6);

ALTER TABLE "entitlement_unit_windows"
  ADD CONSTRAINT "entitlement_unit_windows_day_of_week_eixo_do_motor"
  CHECK ("day_of_week" BETWEEN 0 AND 6);
