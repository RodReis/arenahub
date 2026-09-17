# SPEC-075 — Job diário do pipeline de retenção + `/retention/overview` (§67/§68)

| campo | valor |
|---|---|
| **Fatia** | F75 |
| **MVP** | 6 *(posição na fila)* — decisão do PI, não Slice de PRD |
| **Slice do PRD** | não há. Nasce da auditoria de cobertura — ver #341 |
| **Superfície** | `apps/api` (job novo) + `admin-web` (tela `/retention/overview`, nova) |
| **Card** | #341 |
| **Status** | `aprovada-pi` — decisões tomadas em 17/09/2026, ver §2 |
| **Depende de** | F36 (snapshot), F37 (score), F38 (fila), F39 (experimento), F41 (monitoramento) |

---

## 1. O que esta fatia entrega

Cinco fatias (F36–F41) implementam o pipeline de retenção — snapshot de features, score
explicável, fila de tarefas, experimento e monitoramento — mas nenhuma tem job que as execute.
`docs/STATUS.md` já registra isso como "lacuna que não tem card". Sem execução diária, o histórico
de 6 meses exigido pelo gate `M6-ML-01` (ADR-050) nunca começa a contar.

Esta fatia entrega o job cron que fecha snapshot → score → fila todo dia, e a tela
`/retention/overview` (§13 do MVP-06) para o dono acompanhar.

---

## 2. Decisões do PI — 17/09/2026 (#341)

| # | decisão | consequência |
|---|---|---|
| 1 | **Fatia nova**, não `[INFRA]` | job novo com contrato próprio — número reservado no Índice Fatia ↔ SPEC |
| 2 | **Fuso**: mesma regra de dia civil local já usada no pipeline (INV-089/ADR-019 — fuso vem de `gym_units.timezone`, nunca fixo em código) | nenhuma constante de timezone nova; reusa o padrão `mesLocal` (`Intl.DateTimeFormat` com `timeZone` da unidade) |
| 3 | **Tela `/retention/overview` entra junto** com o job, na mesma fatia | não fica só alimentando a fila da F38 — o dono vê a visão agregada nesta entrega |

---

## 3. Escopo

### 3.1 Job — `RetentionSchedulerService`

Novo provider em `apps/api/src/modules/retention/`, seguindo o precedente de
`EngagementRankingSchedulerService` (F31/F35):

- `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'pipeline-diario-de-retencao' })`.
- Trava de reentrância no processo (`private executando = false`) — não substitui idempotência do
  banco, só evita que uma execução lenta seja atropelada pelo próximo tick.
- `agora` injetado como parâmetro de `executarCiclo(agora: Date)` — nunca lido do relógio dentro do
  método, para o teste não depender de esperar um dia real.
- Falha isolada por tenant/unidade: um tenant com dado inconsistente não impede o fechamento dos
  demais. `try/catch` por unidade dentro do loop, contando falhas e logando sem o erro cru.
- Sem controller, sem export — só `provider` no módulo, mesmo padrão do engagement.

Sequência por unidade, no dia civil local dela (fuso de `gym_units.timezone`, calculado como
`mesLocal` já faz para engagement):

1. `RetentionSnapshotsService.elegiveis(contexto, observadoEm)` → lista de `studentId`.
2. Para cada elegível: `RetentionSnapshotsService.calcular(contexto, studentId, recorte, versoes)`.
   Falha de um aluno não interrompe os demais da mesma unidade (mesmo padrão de isolamento).
3. `RetentionScoresService.pontuarDia(contexto, observadoEm)` — já opera em lote, sem mudança de
   assinatura.
4. `RetentionTasksService.gerarFila(contexto, agora)` — já opera em lote, sem mudança de
   assinatura.

Nenhum passo novo de idempotência no domínio: `calcular`, `pontuarDia` e `gerarFila` já são
idempotentes por construção (chave única / kill switch existentes das F36–F38). O job só precisa
ser idempotente na sua própria reentrância (item acima).

**Kill switch**: `RetentionMonitoringService.scoringLigado(contexto)` já é checado dentro de
`pontuarDia` — o job não duplica essa checagem, só a herda.

### 3.2 Tela `/retention/overview` (`admin-web`)

Tela nova, sem precedente de UI dentro do módulo — segue o padrão visual de `DS-PAINEL` (mesmo
usado em `/billing`, F54/F57/F74).

Conteúdo mínimo (§13 do MVP-06):

- Fila de risco agregada: contagem de alunos por banda (`BAIXO|MEDIO|ALTO|CRITICO`), lida de
  `GET /api/v1/retention/scores`.
- Estado do pipeline: quando o job rodou pela última vez (`NUNCA_RODOU` até a primeira execução),
  usando o mesmo mecanismo de `freshness`/`notice: 'ESTIMATIVA_NAO_E_FATO'` que o DTO de score já
  carrega — a tela não inventa um novo indicador de frescor.
- Fila de tarefas do dia: contagem por estado, lida do endpoint de leitura da F38
  (`retention-tasks.controller.ts`).

Permissão: reusa `retention.read` (já existe, F37) — nenhuma capacidade nova.

---

## 4. Escopo negativo

| o quê | para onde foi |
|---|---|
| Modelo supervisionado de churn (F40) | continua não executado — ADR-050 segue valendo; esta fatia é o pré-requisito nº 1 que o próprio ADR lista para reavaliar `M6-ML-01`, não a reavaliação em si |
| Método de lote novo em `RetentionSnapshotsService` | fora — o job itera `elegiveis()` e chama `calcular` aluno a aluno; não há necessidade de mudar a assinatura do service existente para esta fatia |
| Configuração de horário por tenant | fora — mesma regra de dia civil local de todos os jobs diários existentes (meia-noite do fuso da unidade), nenhum agendamento configurável novo |
| Reclassificação dos 1.926 `CANCELLED` sem timeline (ADR-033) | fora, mesma razão do SPEC-074 §3 — sem dado inventado |

---

## 5. Aceite operacional

Job roda uma vez por dia sem intervenção manual e sem derrubar o processo se uma unidade falhar.
`docs/STATUS.md` deixa de acusar `NUNCA_RODOU` depois da primeira execução em produção. O dono abre
`/retention/overview` e vê a fila de risco agregada, o estado do pipeline e a fila de tarefas do
dia — sem capacidade nova, reusando `retention.read`.
