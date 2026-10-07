-- Corrige a data dos pagamentos que entraram por script (importacao e
-- reconciliacao de setembro/2026, issues #386 e #450).
--
-- DEFEITO: o script gravava `paid_at` na MEIA-NOITE UTC do dia do relatorio. O
-- painel mostra no fuso da unidade (UTC-3), entao o pagamento de 02/09 aparecia
-- como "01/09/2026, 21:00" -- um dia antes. A baixa pela tela nao tem o
-- problema: `instanteDoPagamento` grava meio-dia UTC (09h no Brasil).
--
-- CORRECAO 1 -- `paid_at` (pagamento e invoice) passa a meio-dia UTC, o MESMO
-- instante que a baixa pela tela grava. O DIA do relatorio nao muda.
--
-- CORRECAO 2 -- `due_at` da invoice paga vira data do pagamento + 30 dias
-- (decisao do PI, 07/10/2026: cada mes pago cobre 30 dias a partir do
-- pagamento, a mesma contagem da baixa em lote -- que, la, ancora a PROXIMA
-- fatura; aqui so se corrige o que a ficha mostra na linha paga). Antes ficava
-- no dia 10 da competencia, antes ou depois do pagamento sem relacao com ele.
-- `block_at` acompanha: vencimento + carencia do tenant. Invoice PAID nao entra
-- em inadimplencia, entao nenhum acesso muda por causa desta linha. Custo
-- conhecido: o atraso historico da fatura paga (`due_at` < `paid_at`) deixa de
-- constar para a retencao.
--
-- ALCANCE: pagamento MANUAL sem lote, com `paid_at` exatamente a meia-noite UTC
-- (00:00:00.000). A baixa pela tela grava o instante de agora ou meio-dia UTC, e
-- o lote grava `batch_id`; so os scripts gravam a hora zerada. Nao serve de
-- filtro o canal (`received_via`): o import gravou DINHEIRO em parte das
-- linhas e deixou nulo em outras. Em 07/10/2026, 262 linhas em producao.
-- Repetir a migration nao acha mais nada (as linhas corrigidas ja estao ao
-- meio-dia).
WITH alvo AS (
  SELECT p.id AS payment_id,
         p.invoice_id,
         p.paid_at AS pago_em_antigo,
         p.paid_at + INTERVAL '12 hours' AS pago_em_novo
  FROM payments p
  WHERE p.method = 'MANUAL'
    AND p.status = 'CONFIRMED'
    AND p.batch_id IS NULL
    AND p.paid_at::time = TIME '00:00:00'
),
fatura AS (
  UPDATE invoices i
  SET paid_at = a.pago_em_novo,
      due_at = date_trunc('day', a.pago_em_novo) + INTERVAL '30 days',
      block_at = date_trunc('day', a.pago_em_novo) + INTERVAL '30 days' + make_interval(days => bs.grace_days),
      updated_at = now(),
      version = i.version + 1
  FROM alvo a, billing_settings bs
  WHERE i.id = a.invoice_id
    AND bs.tenant_id = i.tenant_id
    AND i.status = 'PAID'
    AND i.paid_at = a.pago_em_antigo
  RETURNING i.id
)
-- O pagamento so muda se a fatura dele mudou: pagamento e fatura nunca ficam
-- com `paid_at` diferentes (fatura sem `billing_settings` ou que nao casa fica
-- como esta, inteira, e a migration pode ser reexecutada depois).
UPDATE payments p
SET paid_at = a.pago_em_novo,
    updated_at = now()
FROM alvo a
WHERE p.id = a.payment_id
  AND a.invoice_id IN (SELECT id FROM fatura);
