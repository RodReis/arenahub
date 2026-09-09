-- F62 -- Identidade visual do tenant (ADR-052 §9).
--
-- Quatro colunas novas em `tenants`, todas anulaveis. Nenhuma apaga nem
-- reescreve dado: os tenants que ja existem nasceram sem marca propria e
-- continuam caindo na marca ArenaHub enquanto ninguem enviar arquivo.
--
-- As duas primeiras guardam CHAVE DE OBJETO, nao URL: o bucket e privado, e
-- gravar URL assinada numa coluna produziria um link que expira -- a coluna
-- passaria a mentir sozinha em poucos minutos.
ALTER TABLE "tenants" ADD COLUMN     "logo_object_key" TEXT,
                      ADD COLUMN     "icon_object_key" TEXT,
                      ADD COLUMN     "mission_text" TEXT,
                      ADD COLUMN     "highlights_text" TEXT;
