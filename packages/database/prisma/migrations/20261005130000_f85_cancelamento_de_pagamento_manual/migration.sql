-- F85: cancelamento de pagamento manual lancado por engano (decisao do PI,
-- 05/10/2026). So colunas NULAS em `payments`: nenhuma linha existente muda e
-- nao ha backfill. `PaymentStatus.CANCELLED` ja existe no enum.
ALTER TABLE "payments"
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_by_user_id" UUID,
  ADD COLUMN "cancel_reason" TEXT;
