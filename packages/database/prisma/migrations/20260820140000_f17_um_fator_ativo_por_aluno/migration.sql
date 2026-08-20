-- F17 -- no maximo UM registro ATIVO de cada fator de contexto por aluno.
--
-- O DEFEITO QUE ISTO FECHA, achado na revisao da propria fatia: `ativarFator`
-- decidia por `findFirst` + `if (jaAtivo) return`. Duas requisicoes
-- concorrentes -- dois cliques, ou o retry do navegador -- leem as duas
-- `null`, e as duas criam. O teste que existia so cobria o caso SEQUENCIAL,
-- onde a leitura ja enxerga o commit da anterior.
--
-- E a mesma classe do bug da F14: guarda que le antes de escrever perde a
-- corrida por construcao, porque a janela entre a leitura e a escrita e
-- exatamente o que ela deveria fechar. A garantia tem de estar NO BANCO.
--
-- Parcial em `deactivated_at IS NULL` de proposito: fator DESATIVADO nao
-- disputa nada, e exigir unicidade sobre ele impediria reativar um fator que
-- o aluno teve no passado -- gestante que engravida de novo, atleta que volta
-- a competir. O historico precisa poder repetir.

CREATE UNIQUE INDEX "student_health_context_um_fator_ativo_por_aluno"
  ON "student_health_context" ("tenant_id", "student_id", "factor")
  WHERE "deactivated_at" IS NULL;
