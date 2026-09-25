-- ISSUE #400: a analise de IA passou a pedir o formato por structured outputs
-- (`output_config.format`), e o JSON Schema enviado virou metade do pedido.
-- Sem esta coluna, reproduzir uma analise publicada (`M3-FR-016`) so
-- recuperaria o texto do prompt, nao o schema que moldou a resposta.
--
-- Nullable: as versoes ate `analise-de-saude@3` pediam o formato na propria
-- prosa e nao tem schema separado.
ALTER TABLE "ai_prompt_versions" ADD COLUMN "output_schema" JSONB;
