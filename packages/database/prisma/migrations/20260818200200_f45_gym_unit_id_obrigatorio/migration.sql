-- F45 -- passo 3 de 3: `students.gym_unit_id` passa a ser obrigatorio.
--
-- Se o backfill do passo 2 tiver deixado alguem para tras -- tenant sem
-- nenhuma unidade ATIVA, por exemplo -- este `SET NOT NULL` FALHA e a
-- migration para. E o comportamento desejado: aluno sem unidade e dado
-- quebrado, e descobrir isso aqui custa menos que descobrir na recepcao.

ALTER TABLE "students"
  ALTER COLUMN "gym_unit_id" SET NOT NULL;
