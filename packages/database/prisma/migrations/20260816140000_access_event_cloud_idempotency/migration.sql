-- ---------------------------------------------------------------------------
-- Idempotencia do evento de acesso nascido NA NUVEM (override manual)
--
-- Migration escrita A MAO: o Prisma nao gera indice parcial, entao este
-- arquivo nao tem contraparte declarativa no `schema.prisma`. Ver a nota no
-- modelo `AccessEvent`.
--
-- POR QUE EXISTE. A migration anterior criou
-- `@@unique([edge_node_id, idempotency_key])`, que cobre o evento vindo do
-- Edge. Mas o override manual nasce na nuvem, com `edge_node_id` NULO -- e em
-- Postgres NULL nunca e igual a NULL. Duas linhas `(NULL, 'chave-x')` NAO
-- colidem naquele indice.
--
-- Na pratica isso e a catraca girando duas vezes: recepcionista com internet
-- ruim clica no botao duas vezes, o cliente reenvia a MESMA chave de
-- idempotencia, e nada no banco impede o segundo evento. O `M1-FR-023` e a
-- regra de arquitetura no 4 (todo efeito externo e idempotente) dependem
-- deste indice para valer no caminho de override.
--
-- Escopado por `tenant_id` porque a chave e gerada pelo cliente: nao ha razao
-- para que dois tenants disputem o mesmo espaco de chaves.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "access_events_cloud_idempotency_key"
  ON "access_events" ("tenant_id", "idempotency_key")
  WHERE "edge_node_id" IS NULL;
