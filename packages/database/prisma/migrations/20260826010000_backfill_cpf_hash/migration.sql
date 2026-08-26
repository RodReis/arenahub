-- Preenche `cpf_hash` de quem tem `cpf` e nao tem hash (F52).
--
-- O QUE O DEFEITO CUSTAVA: a identificacao do totem busca o aluno por
-- `cpf_hash` escopado por tenant (F49) -- e da que sai o isolamento entre
-- tenants, porque o totem de um nao consegue nem FORMULAR a pergunta sobre o
-- aluno de outro. Quem foi importado antes do campo existir ficou com o CPF
-- em texto e o hash vazio, e portanto NAO CONSEGUE ENTRAR NO TOTEM. Na base
-- de desenvolvimento eram 1932 de 1967 alunos.
--
-- NAO E DADO NOVO: o hash e DERIVADO do `cpf` que ja esta gravado. Esta
-- migracao nao inventa nada e nao le nada de fora -- ela recalcula o que a
-- aplicacao ja calcularia se o aluno fosse cadastrado hoje.
--
-- A FORMULA E A MESMA de `calcularHashDeCpf` em
-- `apps/api/src/modules/students/domain/identificacao.ts`:
--
--     sha256(`${tenantId}:${cpf.replace(/\D/g, '')}`)
--
-- `regexp_replace(...,'[^0-9]','','g')` e o `normalizarCpf` do dominio: CPF
-- gravado como `123.456.789-01` e o mesmo aluno de `12345678901`, e hashear
-- o texto cru produziria um hash que nenhuma busca alcanca. Conferido contra
-- as linhas que JA tinham hash antes desta migracao -- as duas formulas
-- produzem o mesmo digest.
--
-- IDEMPOTENTE: `WHERE cpf_hash IS NULL` deixa intacto o hash de quem ja tem.
-- Reprocessar e seguro, e nenhum hash existente e reescrito -- se um deles
-- divergisse da formula, esta migracao NAO e o lugar de descobrir isso.
--
-- `cpf` continua em texto: o ADR-034 decidiu que o numero completo e
-- persistido e devolvido pela API. O hash existe para BUSCA escopada por
-- tenant, nao para ocultar o CPF -- as duas colunas convivem de proposito.
UPDATE students
   SET cpf_hash = encode(
         sha256(
           (tenant_id::text || ':' || regexp_replace(cpf, '[^0-9]', '', 'g'))::bytea
         ),
         'hex'
       )
 WHERE cpf IS NOT NULL
   AND cpf_hash IS NULL;
