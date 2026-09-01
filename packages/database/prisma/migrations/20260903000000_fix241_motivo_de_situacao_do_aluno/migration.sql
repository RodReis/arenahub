-- issue #241 -- MOTIVO da situacao do aluno.
--
-- Escrita a mao, e nao gerada por `prisma migrate diff`: o diff contra o banco
-- de desenvolvimento trouxe junto deriva que NAO e desta entrega -- recriacao
-- das FKs de `public_profiles`, remocao de `DEFAULT` de meia duzia de `id` e
-- renomeacao de dois indices de `student_attendance_sessions`. Deixar isso
-- entrar aqui daria a esta migracao o poder de desfazer o trabalho de outra.
--
-- O que esta entrega precisa e so o que segue: um enum novo e duas colunas
-- anulaveis. Nenhuma linha existente muda -- as 1.926 do Pacto inclusive.

-- CreateEnum
CREATE TYPE "student_status_reason" AS ENUM ('DELINQUENCY', 'STUDENT_REQUEST', 'MEDICAL', 'CONDUCT');

-- AlterTable
--
-- Anulaveis e sem default: aluno ATIVO nao tem motivo, e um valor plantado
-- ("NONE", string vazia) obrigaria toda leitura a saber distinguir "sem
-- motivo porque esta ativo" de "bloqueado e ninguem preencheu". Nulo ja diz
-- as duas coisas, e o `CHECK` abaixo garante a segunda nunca acontecer.
ALTER TABLE "students" ADD COLUMN     "status_reason" "student_status_reason",
ADD COLUMN     "status_reason_note" TEXT;

-- A INVARIANTE MORA NO BANCO, e nao so na aplicacao.
--
-- Regra: motivo existe se, e somente se, o aluno esta SUSPENDED ou BLOCKED.
--
-- Os dois lados importam. Sem o primeiro, um bloqueio sem motivo entra por
-- qualquer caminho que nao passe pelo caso de uso -- import, correcao manual,
-- script -- e a grid mostra "Bloqueado" sem dizer por que, que e exatamente o
-- defeito que esta entrega existe para corrigir. Sem o segundo, o motivo
-- SOBREVIVE a volta para `ACTIVE`: o aluno volta a treinar carregando
-- "inadimplencia" no cadastro, e a proxima pessoa que abrir a ficha le um
-- motivo que nao vale mais.
--
-- `NOT VALID` seria mais barato, mas nao ha o que validar: a coluna nasce
-- nula em todas as linhas, entao a checagem completa e trivial agora e cara
-- depois.
ALTER TABLE "students" ADD CONSTRAINT "students_motivo_so_com_situacao_que_o_pede"
  CHECK (
    ("status_reason" IS NULL AND "status_reason_note" IS NULL)
    OR "status" IN ('SUSPENDED', 'BLOCKED')
  );
