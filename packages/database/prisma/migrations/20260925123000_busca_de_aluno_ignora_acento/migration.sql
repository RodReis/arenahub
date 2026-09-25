-- ISSUE #398: busca de aluno (/students) nao ignorava acento -- "Julio
-- Cesar" nao achava "Julio César". 179 de 1995 alunos do tenant de bancada
-- tem acento no nome; qualquer um deles so aparece na busca se o operador
-- digitar o acento exato.
--
-- `unaccent` e extensao padrao do Postgres, nao third-party.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- IMMUTABLE: `unaccent()` builtin e STABLE (depende de configuracao de
-- dicionario), e indice funcional exige IMMUTABLE. Wrapper fixando o
-- dicionario 'unaccent' resolve -- padrao documentado do proprio Postgres.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$
  SELECT public.unaccent($1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- Indice funcional sobre o nome sem acento: sem ele, toda busca por nome
-- vira sequential scan (a condicao `immutable_unaccent(full_name) ILIKE ...`
-- nao usa nenhum indice existente).
CREATE INDEX IF NOT EXISTS students_full_name_unaccent_idx
  ON students (immutable_unaccent(full_name) text_pattern_ops);
