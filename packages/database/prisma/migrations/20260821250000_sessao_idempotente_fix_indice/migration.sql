-- F-multiarquivo -- CORRIGE o indice de idempotencia da Task 5 (fix round 2,
-- achado ao rodar contra Postgres real pela primeira vez).
--
-- ---------------------------------------------------------------------------
-- POR QUE O INDICE ANTERIOR ESTAVA ERRADO
-- ---------------------------------------------------------------------------
--
-- `assessment_imports_session_assessment_uq` (migration
-- `20260821240000_sessao_idempotente`) foi escrito como:
--
--     CREATE UNIQUE INDEX ... ON assessment_imports (review_session_id)
--       WHERE assessment_id IS NOT NULL AND review_session_id IS NOT NULL;
--
-- Isso diz "no maximo UMA LINHA de assessment_imports pode ter este
-- review_session_id com assessment_id preenchido" -- mas uma sessao de TRES
-- arquivos tem TRES linhas que precisam, TODAS, ser marcadas com o MESMO
-- assessment_id na confirmacao. A segunda linha a receber o UPDATE já viola
-- o indice contra a PRIMEIRA linha da MESMA transacao, mesmo sem nenhuma
-- corrida real -- a primeira confirmacao de uma sessao com mais de um
-- arquivo SEMPRE falhava com P2002, traduzido (erradamente) em
-- `SessaoJaConfirmadaError` mesmo sem nenhuma segunda tentativa.
--
-- O sintoma so apareceu ao rodar contra Postgres de verdade (Docker estava
-- parado nos rounds anteriores) -- exatamente o tipo de defeito que so um
-- indice PARCIAL, com sua UNIQUE-por-linha, esconde de qualquer teste que
-- rode em memoria ou mockado.
--
-- ---------------------------------------------------------------------------
-- O QUE A GARANTIA PRECISA DIZER, DE VERDADE
-- ---------------------------------------------------------------------------
--
-- "Uma sessao, uma vez confirmada, aponta para NO MAXIMO UMA avaliacao" --
-- nao "no maximo uma LINHA de assessment_imports por sessao". A garantia
-- certa e sobre `body_assessments`, nao sobre `assessment_imports`: cada
-- CHAMADA de `confirmarSessao` cria EXATAMENTE UMA `body_assessments` (o
-- rascunho), e e essa linha, unica por chamada, que a unicidade precisa
-- proteger -- nao as N linhas de import que apontam para ela depois.
--
-- `source_reference` guarda o `reviewSessionId` (sessao) OU o `importId`
-- (import avulso, F19) -- os dois vem do mesmo espaco de UUID e nunca
-- colidem entre si. Um indice parcial unico em
-- `(source_reference) WHERE source = 'IMPORT'` diz exatamente "nenhuma
-- sessao E nenhum import avulso pode ter DUAS avaliacoes IMPORT apontando
-- para o mesmo id de origem" -- a garantia certa, numa tabela onde ela e
-- estruturalmente 1 linha por tentativa de confirmacao.
DROP INDEX "assessment_imports_session_assessment_uq";

CREATE UNIQUE INDEX "body_assessments_import_source_reference_uq"
  ON "body_assessments" ("source_reference")
  WHERE "source" = 'IMPORT' AND "source_reference" IS NOT NULL;
