# SPEC-040 — Modelo supervisionado (condicionado a `M6-ML-01`)

| campo | valor |
|---|---|
| **Fatia** | F40 |
| **MVP** | 6 |
| **Slice do PRD** | **6.5** — `docs/prd/academia/MVP-06-retention-ai.md` §8 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-06-05-supervised-ml-optional.md` |
| **Status** | **`não executada`** — gate `M6-ML-01` não atingido (ADR-050). PR [#228](https://github.com/RodReis/arenahub/pull/228), mergeado em 31/08/2026 |
| **ADRs** | **ADR-050** decide a não-execução |

> **Esta fatia não foi implementada, e isso é um resultado — não uma pendência.** A issue
> [#40](https://github.com/RodReis/arenahub/issues/40) já dizia: *"fatia condicional, pode não
> acontecer, e isso é resultado válido"*. A medição abaixo mostra que o gate não fecha, e por uma
> margem que não é questão de esperar mais um pouco.

---

## 1. O que esta fatia entregaria

Ver `docs/prd/academia/MVP-06-retention-ai.md` §8, Slice 6.5: pipeline offline versionado, split
temporal sem leakage, comparação com baseline, shadow mode e fallback.

**Nada disso foi construído.** Ver §2 e ADR-050.

## 2. A medição — 31/08/2026

Contra o banco de desenvolvimento (`arenahub`), tenant `arena-positiva`, o único que existe.

```sql
SELECT
  (SELECT count(*) FROM student_feature_snapshots)                              AS snapshots,
  (SELECT count(*) FROM retention_scores)                                       AS scores,
  (SELECT count(*) FROM student_timeline_events
     WHERE type = 'SUBSCRIPTION_CANCELLED')                                     AS churns_datados,
  (SELECT count(*) FROM subscriptions WHERE status IN ('CANCELLED','EXPIRED'))  AS status_encerrado;
```

| exigência do `M6-ML-01` | mínimo | medido |
|---|---|---|
| snapshots elegíveis por tenant | 1.000 | **0** |
| churns positivos por tenant | 200 | **1** |
| histórico confiável | ≥ 6 meses | **3 dias** |

**Profundidade real do histórico:**

```sql
SELECT 'sessoes' AS fonte, count(*), min(created_at)::date, max(created_at)::date
  FROM student_attendance_sessions
UNION ALL SELECT 'invoices', count(*), min(created_at)::date, max(created_at)::date FROM invoices
UNION ALL SELECT 'timeline', count(*), min(occurred_at)::date, max(occurred_at)::date
  FROM student_timeline_events;
```

| fonte | linhas | de | até |
|---|---|---|---|
| sessões de treino | 3 | 27/08/2026 | 27/08/2026 |
| invoices | 888 | 25/08/2026 | 27/08/2026 |
| eventos de timeline | 13 | 24/08/2026 | 25/08/2026 |

### Por que 1.907 cancelamentos não são 1.907 churns

`Subscription.status = CANCELLED` aparece 1.907 vezes, e é tentador ler isso como amostra farta. Não
é: é o **status atual** de linhas importadas em bloco entre 19 e 26/08/2026 — os 1.967 alunos
entraram numa carga única.

Status corrente **não tem data de transição**. A F36 documentou exatamente essa armadilha ao
construir as features as-of: *"a invoice estava vencida em D" é aritmética sobre datas imutáveis,
não consulta de status*. Sem saber **quando** o aluno saiu, não há label temporal — e sem label
temporal o treino não aprende churn, memoriza o presente.

O caminho certo existe: `StudentTimelineEvent` é append-only e tem `occurredAt`. Hoje ele tem **um**
`SUBSCRIPTION_CANCELLED`.

## 3. Por que não construir "já que é barato"

Detalhado em ADR-050. Em resumo:

1. **O modelo não poderia ser promovido** — o aceite exige superar a baseline em teste temporal
   congelado, e com 1 churn datado não há conjunto de teste. Nasceria com o kill switch acionado.
2. **Custo de manutenção real, benefício zero** — migrations, providers, testes no CI a cada push e
   dependências Python que ninguém exercita.
3. **Modelo ruim é pior que regra clara** — treinado em 3 dias, aprenderia a data de importação. E
   substituiria regras que a recepção entende por um número que ela não pode contestar, invertendo a
   ordem que o MVP escolheu de propósito (*"explicável vem antes de modelo"*).

## 4. Escopo negativo

Tudo. Sem pipeline de treino, sem runner Python, sem `model_versions`/`model_evaluations`, sem
shadow mode, sem migration, sem dependência nova.

A porta segue aberta **sem custo**: a F37 já deixou `RetentionScoreProvider` como ponto de extensão
e `calibratedProbability` como coluna nula. Quando o gate fechar, a F40 encaixa sem refazer nada.

## 5. O que precisa acontecer para reabrir

Em ordem de dependência:

1. **O pipeline precisa rodar diariamente.** Snapshot → score → fila → alocação existem e são
   testados, mas **nenhuma das fatias F36–F39 tem job**. Sem execução recorrente,
   `student_feature_snapshots` continua vazia e os seis meses nunca começam a contar. **É a única
   dependência dura, e hoje não tem card.**
2. **Churn precisa virar evento datado em volume** — o caminho (`StudentTimelineEvent`) já existe.
3. **Seis meses de operação real** a partir do dia em que (1) começar.
4. **Refazer a medição da §2.** Fecha o gate? Reabre-se a decisão.

**Critério objetivo de reabertura:** ≥ 1.000 snapshots **e** ≥ 200 churns datados no mesmo tenant.

## 6. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | O gate não fecha (0 snapshots, 1 churn, 3 dias de histórico). Construir mesmo assim, fazer só a infraestrutura, ou registrar a não-execução? | **Registrar a não-execução com a medição.** | 31/08/2026 |
