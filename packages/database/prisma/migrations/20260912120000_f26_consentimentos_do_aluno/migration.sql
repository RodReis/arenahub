-- F26 (SPEC-026), Slice 4.4: o aluno gere os proprios consentimentos pelo app.
--
-- Tres tipos novos, decisao do PI em 12/09/2026: o app precisa exibir e
-- revogar aceite de termo de uso, politica de privacidade e comunicacao de
-- marketing -- nenhum deles existia no enum, que nasceu servindo so a
-- biometria e a saude.
--
-- ALTER TYPE ... ADD VALUE e aditivo: nenhuma linha existente muda de
-- significado, e nenhum consumidor atual le estes valores. O Postgres exige
-- que cada ADD VALUE esteja fora de bloco transacional -- o Prisma executa
-- cada statement deste arquivo por conta, entao vao em comandos separados.

ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'TERMS';

ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'PRIVACY';

ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'MARKETING';

-- Evento de timeline para consentimento decidido pelo PROPRIO aluno, de
-- qualquer tipo nao-biometrico. O tipo do termo vai no `payload`; um valor de
-- enum por termo faria o enum crescer a cada documento novo que a academia
-- publicar.

ALTER TYPE "student_timeline_event_type" ADD VALUE IF NOT EXISTS 'CONSENT_ACCEPTED';

ALTER TYPE "student_timeline_event_type" ADD VALUE IF NOT EXISTS 'CONSENT_REVOKED';
