-- F14 -- passo 1 de 3: `provider_accounts.capability`, ainda anulavel.
--
-- POR QUE ESTA COLUNA EXISTE (ADR-032): sao dois provedores -- Sicoob para
-- PIX, Getnet para cartao. Antes dela o codigo resolvia a conta com
-- `findFirst({ active: true })`, que devolve QUALQUER conta ativa do tenant:
-- com os dois cadastrados, a cobranca PIX sairia pela conta de cartao
-- dependendo da ordem de insercao, sem erro e sem log.
--
-- Anulavel neste passo porque o passo 2 preenche e o 3 exige. Criar ja como
-- NOT NULL quebraria em qualquer base com linha existente.

CREATE TYPE "provider_capability" AS ENUM ('PIX', 'CARD');

ALTER TABLE "provider_accounts" ADD COLUMN "capability" "provider_capability";
