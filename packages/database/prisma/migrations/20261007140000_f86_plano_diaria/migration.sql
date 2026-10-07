-- F86: modalidade DIARIA (diaria avulsa no balcao).
--
-- So ACRESCENTA um valor ao enum: nenhum plano existente muda de modalidade, e
-- nenhuma linha usa o valor novo dentro desta mesma migration (o Postgres nao
-- deixa USAR um valor de enum na transacao que o criou).
ALTER TYPE "plan_billing_mode" ADD VALUE 'DIARIA';
