-- AlterEnum
-- Permuta-Tacio e Permuta-Douglas: pessoas liberadas na catraca e sem cobranca,
-- como o professor. Perfil NAO decide acesso (regra de arquitetura no 1): quem
-- libera e o Entitlement. Valor novo so e usado por codigo em transacoes
-- seguintes, nunca nesta.
ALTER TYPE "student_profile" ADD VALUE 'PERMUTA_TACIO';
ALTER TYPE "student_profile" ADD VALUE 'PERMUTA_DOUGLAS';
