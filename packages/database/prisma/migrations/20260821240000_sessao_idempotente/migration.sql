-- F-multiarquivo -- confirmacao unica e idempotente da sessao de revisao
-- (Task 5, ADR-038).
--
-- 1. Coluna para o dado do APARELHO que o extrator separa em `atributos`
--    (Task 6): achado de ECG, tags, duracao, serial/modelo quando o laudo
--    informa. Precisa sobreviver entre a EXTRACAO (por arquivo) e a
--    CONFIRMACAO (que cria a avaliacao com `device_report`/`device_model`/
--    `device_serial`) -- os dois momentos nao coincidem numa sessao com
--    varios arquivos. `Json?` e nao coluna por atributo: o mapa e OPACO de
--    proposito (ADR-035), ninguem interpreta o conteudo.
ALTER TABLE "assessment_imports"
  ADD COLUMN "extracted_attributes" JSONB;

-- 2. A GARANTIA DE IDEMPOTENCIA E DO BANCO, NUNCA DE UM `if` NA APLICACAO.
--
-- Duas confirmacoes concorrentes da MESMA sessao passam pela mesma checagem
-- de "sessao pode confirmar?" antes de qualquer uma escrever -- e a que
-- checa por ultimo nao sabe que a outra ja decidiu. Sem o indice, as duas
-- criam rascunho, publicam e marcam os imports como CONFIRMED: duas
-- avaliacoes para uma medicao so, contagem dobrada -- mesma classe do bug
-- que ja cobrou aluno em dobro no modulo de billing deste repo
-- (`idempotencia-derivada-de-contagem`).
--
-- O indice e PARCIAL (`WHERE assessment_id IS NOT NULL AND review_session_id
-- IS NOT NULL`): so se aplica a import JA CONFIRMADO (com `assessment_id`
-- preenchido). Toda importacao ganha `review_session_id` desde a Task 5 --
-- mesmo o import avulso da F19, numa sessao de UM arquivo so -- entao o
-- `review_session_id IS NOT NULL` do predicado e sempre verdadeiro na
-- pratica; ele fica explicito para o indice nunca colidir se um dia existir
-- import sem sessao. O que a parcialidade realmente exclui e a importacao
-- AINDA EM REVISAO (`assessment_id` nulo): uma sessao com tres arquivos
-- pendentes ja tem tres linhas com o mesmo `review_session_id` antes de
-- qualquer confirmacao, e exigir unicidade sobre isso impediria a propria
-- fatia de existir.
--
-- A segunda transacao que tentar `UPDATE ... SET assessment_id = ...` para
-- um `review_session_id` ja confirmado leva `P2002` do Postgres -- e a
-- aplicacao traduz isso em 409 de dominio (`SESSION_ALREADY_CONFIRMED`),
-- nunca deixa o erro cru vazar para o cliente.
CREATE UNIQUE INDEX "assessment_imports_session_assessment_uq"
  ON "assessment_imports" ("review_session_id")
  WHERE "assessment_id" IS NOT NULL AND "review_session_id" IS NOT NULL;
