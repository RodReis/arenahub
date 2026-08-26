-- No maximo UM rascunho por camada (ADR-042, Decisao 8 + F50).
--
-- Rascunho e a linha com `published_at IS NULL`. Sem esta garantia,
-- "Descartar" fica ambiguo (qual rascunho?) e "Publicar" nao sabe qual
-- linha promover.
--
-- COALESCE e obrigatorio: `gym_unit_id` e `kiosk_device_id` sao NULL de
-- proposito na camada de tenant e de unidade, e NULL nao colide com NULL
-- em indice unico comum -- a camada de tenant aceitaria N rascunhos.
CREATE UNIQUE INDEX kiosk_configurations_rascunho_unico
  ON kiosk_configurations (
    tenant_id,
    COALESCE(gym_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(kiosk_device_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE published_at IS NULL;
