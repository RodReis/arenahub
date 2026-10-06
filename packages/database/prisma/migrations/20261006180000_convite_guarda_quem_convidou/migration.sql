-- #598: quem emitiu o convite, para revogar os pendentes de quem perde o acesso.
-- Coluna nula e aditiva: convites anteriores ficam sem emissor conhecido.
ALTER TABLE "invitations" ADD COLUMN "invited_by_id" UUID;
