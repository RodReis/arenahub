-- F20 -- sessoes de frequencia (`M3-FR-013`, `M3-BR-008`, Slice 3.4).
--
-- PROJECAO sobre as passagens confirmadas do MVP 1. A verdade continua sendo
-- `access_events` + `access_passages`, que esta tabela NUNCA altera nem apaga:
-- `M3-BR-008` manda agrupar "sem apagar eventos brutos". Apagar as linhas de
-- uma `policy_version` e reprojetar a partir das passagens tem de devolver
-- exatamente o mesmo resultado.
--
-- SEM `ended_at` E SEM DURACAO, e a ausencia e o ponto: a Slice 3.4 proibe
-- inferir duracao "quando nao houver saida confiavel", e hoje nao ha -- a
-- catraca opera liberada nos dois sentidos (ADR-029) e ninguem registra saida.
-- `first_passage_at`/`last_passage_at` servem para auditar o agrupamento;
-- subtrair um do outro produziria um numero com cara de medida que na verdade
-- e a distancia entre duas ENTRADAS.
--
-- `session_date` e DATE e nao TIMESTAMP porque a sessao E o dia local da
-- unidade. Guardar instante convidaria a reconverter fuso na leitura, e
-- aplicar o fuso duas vezes e o erro classico deste tipo de tabela.

CREATE TABLE "student_attendance_sessions" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"        UUID         NOT NULL,
  "student_id"       UUID         NOT NULL,
  "gym_unit_id"      UUID         NOT NULL,
  "session_date"     DATE         NOT NULL,
  "first_passage_at" TIMESTAMP(3) NOT NULL,
  "last_passage_at"  TIMESTAMP(3) NOT NULL,
  "passage_count"    INTEGER      NOT NULL,
  "passage_ids"      UUID[]       NOT NULL,
  "policy_version"   TEXT         NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "student_attendance_sessions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "student_attendance_sessions"
  ADD CONSTRAINT "student_attendance_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "student_attendance_sessions"
  ADD CONSTRAINT "student_attendance_sessions_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "student_attendance_sessions"
  ADD CONSTRAINT "student_attendance_sessions_gym_unit_id_fkey"
  FOREIGN KEY ("gym_unit_id") REFERENCES "gym_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- IDEMPOTENCIA DA REPROJECAO, no banco e nao num `if`.
--
-- Rodar o projetor duas vezes sobre as mesmas passagens NAO pode dobrar a
-- frequencia do aluno. Guarda que le antes de escrever perde a corrida por
-- construcao -- e a mesma licao da F14 (cobranca em dobro), da F17 (dois
-- fatores ativos) e da F18 (duas metas ativas). A garantia mora aqui.
--
-- `policy_version` entra na chave de proposito: duas versoes da politica
-- podem COEXISTIR enquanto se compara uma com a outra, e o leitor filtra pela
-- vigente. Sem ela na chave, reprojetar numa politica nova exigiria apagar a
-- antiga antes -- perdendo a comparacao no exato momento em que ela importa.
CREATE UNIQUE INDEX "student_attendance_sessions_uma_por_dia_unidade_politica"
  ON "student_attendance_sessions"
  ("tenant_id", "student_id", "session_date", "gym_unit_id", "policy_version");

CREATE INDEX "student_attendance_sessions_tenant_id_student_id_session_date_idx"
  ON "student_attendance_sessions" ("tenant_id", "student_id", "session_date");

-- Uma sessao existe porque houve passagem: zero passagem nao e sessao, e a
-- linha com contagem 0 seria um dia treinado que ninguem treinou.
ALTER TABLE "student_attendance_sessions"
  ADD CONSTRAINT "student_attendance_sessions_passage_count_positivo"
  CHECK ("passage_count" >= 1);

-- A contagem tem de bater com os ids guardados. Sem isto, um bug de projecao
-- gravaria "3 passagens" com um id so, e o numero da tela deixaria de ser
-- auditavel justamente pela lista que existe para audita-lo.
ALTER TABLE "student_attendance_sessions"
  ADD CONSTRAINT "student_attendance_sessions_contagem_bate_com_ids"
  CHECK ("passage_count" = cardinality("passage_ids"));

-- Extremos coerentes: a ultima passagem do dia nunca precede a primeira.
ALTER TABLE "student_attendance_sessions"
  ADD CONSTRAINT "student_attendance_sessions_extremos_coerentes"
  CHECK ("last_passage_at" >= "first_passage_at");
