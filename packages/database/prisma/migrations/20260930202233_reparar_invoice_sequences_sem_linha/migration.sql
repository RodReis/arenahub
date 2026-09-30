-- Repara `invoice_sequences` para tenant com invoice gravada sem passar por
-- `proximoNumero` (seed, import) -- a sequencia nao acompanhou, e a proxima
-- invoice aberta pela API colidia com `number` ja existente (issue #462).
--
-- So AVANCA a sequencia, nunca reduz: GREATEST preserva o `next_value` de
-- tenant ja consistente (nada muda) e so corrige quem estava atras do maior
-- `number` real. Seguro reexecutar.
INSERT INTO invoice_sequences (tenant_id, next_value, updated_at)
SELECT tenant_id, MAX(number) + 1, now()
FROM invoices
GROUP BY tenant_id
ON CONFLICT (tenant_id) DO UPDATE
SET next_value = GREATEST(invoice_sequences.next_value, EXCLUDED.next_value),
    updated_at = now();
