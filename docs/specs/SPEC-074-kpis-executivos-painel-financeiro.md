# SPEC-074 — KPIs executivos no painel financeiro (§64/§117)

| campo | valor |
|---|---|
| **Fatia** | F74 |
| **MVP** | 1 *(posição na fila)* — decisão do PI, não Slice de PRD |
| **Slice do PRD** | não há. Nasce da auditoria de cobertura — ver #340 |
| **Superfície** | `admin-web` · tela `/billing` (F54, já existe) |
| **Card** | [#357](https://github.com/RodReis/arenahub/issues/357) |
| **Status** | `aprovada-pi` — decisões tomadas em 17/09/2026, ver §2 |
| **Depende de** | F54 (painel financeiro), F37 (score de retenção) |

---

## 1. O que esta fatia entrega

Fecha a lacuna que #340 apontou: a Especificação (§64/§117) previa nove KPIs no painel do dono, e
a F54 entregou seis (recebido, receita esperada, a receber, vencido, taxa de inadimplência, ticket
médio). Faltam **alunos ativos**, **novos alunos**, **cancelamentos**, **churn** e **LTV**. Esta
fatia adiciona os cinco à mesma tela — não cria tela nova.

---

## 2. Decisões do PI — 17/09/2026

| # | decisão | consequência |
|---|---|---|
| 1 | **Não é tela nova.** É faixa de KPI dentro do `/billing` existente (F54) | reusa a rota `GET /api/v1/billing/summary`, a permissão e a janela já implementadas |
| 2 | **Todos os 9 KPIs entram na v1** | nenhum KPI fica de fora por falta de definição — LTV ganha fórmula abaixo |
| 3 | **Público: só o dono** | reusa `billing.dashboard` (capacidade criada pela F54) — **nenhuma capacidade nova** |
| 4 | **LTV = ticket médio × vida média observada** | vida média = tempo real de assinatura dos alunos com `SUBSCRIPTION_CANCELLED` na timeline (não o status corrente) |

---

## 3. Por que não dá para contar pelo `Student.status`/`Subscription.status`

O status é **estado corrente**, sem data de transição própria — dois alunos com `CANCELLED` hoje
podem ter cancelado em datas completamente diferentes, e a coluna não distingue. Isso já é
documentado (`schema-guarda-historico-em-datas`): quem tem a data real do evento é
`StudentTimelineEvent.occurredAt`.

Isso importa especialmente aqui porque os **1.926 registros do import do Pacto entraram como
`CANCELLED` sem evento de timeline correspondente** (ADR-033) — não há `occurredAt` real para
eles, só o status congelado no momento do import. Contá-los como "cancelamento no período" seria
inventar uma data que ninguém registrou.

**Regra desta fatia:** todo KPI de período (novos, cancelamentos, churn, LTV) conta **apenas
eventos de timeline reais** (`SUBSCRIPTION_CREATED`, `SUBSCRIPTION_CANCELLED`) com `occurredAt` na
janela. Os registros do import do Pacto, sem evento, **não entram** em nenhuma contagem por
período — e a tela declara isso, mesma disciplina da F54 §5.2 ("a base sobre a qual a tela
calcula").

---

## 4. Escopo

### 4.1 Backend — extensão de `GET /api/v1/billing/summary?de&ate`

Mesma rota, mesmo `ResumoFinanceiro`, cinco campos novos:

| indicador | como sai |
|---|---|
| alunos ativos | contagem de `Student` com assinatura `ACTIVE`/`PAST_DUE` — **snapshot de agora**, não da janela (é "quantos há", não "quantos ficaram") |
| novos alunos | `StudentTimelineEvent` tipo `SUBSCRIPTION_CREATED`, `occurredAt` na janela |
| cancelamentos | `StudentTimelineEvent` tipo `SUBSCRIPTION_CANCELLED`, `occurredAt` na janela |
| taxa de churn | cancelamentos no período ÷ alunos pagantes no **início** do período — `null` sem base |
| LTV | `ticketMedioMinor × vidaMediaEmMeses`; `null` se não houver cancelamento com evento de timeline |

`vidaMediaEmMeses`: média de `(occurredAt do SUBSCRIPTION_CANCELLED) − (occurredAt do
SUBSCRIPTION_CREATED correspondente)` sobre os cancelamentos **com os dois eventos presentes**.
Sem os dois eventos, o par não entra na média (mesma regra do §3 — sem inventar data).

### 4.2 Tela `/billing`

Nova faixa de cartões, acima ou ao lado dos seis já existentes. Mesmo padrão visual (`DS-PAINEL`,
`tabular-nums`, cor por severidade). Onde o número depender de amostra pequena de cancelamentos
com timeline completa (`< 3`, mesmo piso da série de competência), a tela mostra estado de dado
insuficiente em vez de LTV/churn calculado sobre amostra que não sustenta média.

**Nota da base:** o card de LTV e o de churn trazem selo "calculado sobre N cancelamentos com
histórico completo — X registros importados sem data de saída não entram nesta conta", nos moldes
do que a F54 §5.2 já faz para a taxa de inadimplência.

---

## 5. Escopo negativo

| o quê | para onde foi |
|---|---|
| Tela separada / permissão nova | recusado pelo PI (decisões 1 e 3) |
| Reclassificar os 1.926 `CANCELLED` do Pacto com data estimada | fora — inventar data contraria o §3 e o CLAUDE.md ("sem dado inventado no caminho de produção") |
| Score de risco de churn por aluno | já existe, é a F37 (`GET /retention/scores`) — esta fatia é sobre a **taxa agregada**, não o score individual |
| Modelo preditivo de LTV | fora — fórmula é a decisão 4, não estimativa por cohort ou ML |

---

## 6. Aceite operacional

O dono abre `/billing`, e ao lado do que a F54 já mostra, vê: alunos ativos agora, novos alunos e
cancelamentos no período escolhido, taxa de churn do período e LTV — cada um com a limitação da
base declarada quando aplicável. Um usuário sem `billing.dashboard` não vê os cartões novos (mesma
guarda da F54, nenhuma mudança de permissão).
