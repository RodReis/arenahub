# SPEC-054 — Painel financeiro gerencial (KPIs)

| campo | valor |
|---|---|
| **Fatia** | F54 |
| **MVP** | 3 *(posição na fila)* — conteúdo é `MVP-02` |
| **Slice do PRD** | não há. Herda do `MVP-02` §7 (Slice 2.5), §16 e §18 |
| **Recorte** | [`notes/2026-08-23-pagamento-nas-tres-superficies.md`](../notes/2026-08-23-pagamento-nas-tres-superficies.md) §5 |
| **Superfície** | `admin-web` · `docs/design/DS-PAINEL.md` |
| **Card** | [#157](https://github.com/RodReis/arenahub/issues/157) |
| **Status** | `implementada` — escrita em 23/08/2026; pergunta 3 da §8 respondida pelo PI em 25/08/2026 |
| **Depende de** | nada além do que já está no banco. **Não depende da F55** |

---

## 1. O que esta fatia entrega

Uma tela de **leitura** que responde três perguntas do dono: *quanto entrou*, *quanto falta
entrar* e *quanto está vencido* — por período, com a composição da dívida e a quebra por forma
de pagamento.

---

## 2. Decisões do PI — 23/08/2026

| # | decisão | consequência |
|---|---|---|
| 1 | **Painel gerencial de KPI**, não esteira de cobrança | régua de contato, promessa de pagamento e histórico de quem falou com quem continuam na **F38** (MVP 6) |
| 2 | **Superfície:** `admin-web`, no MVP 3 | o totem segue no MVP 3.5 com as F49–F52. **KPI financeiro não aparece no totem** — a área pública é do patrocinador e do evento, e valor em aberto é proibido lá (`M4-BR-007`, `DS-TOTEM` §11) |
| 3 | **Base de cálculo vem do plano em que o aluno está matriculado** | receita esperada = soma do `PlanPrice` vigente das assinaturas ativas, **não** a soma das invoices emitidas |
| 4 | **Permissão: `admin`** | ver §4 — no ArenaHub permissão é capacidade nomeada, não papel |

---

## 3. Escopo

### 3.1 Backend — `GET /api/v1/billing/summary?from&to`

Uma chamada, agregação **no banco** (não em memória do Node):

| indicador | como sai |
|---|---|
| recebido no período | `payments` com `status = CONFIRMED` e `paidAt` na janela |
| **receita esperada** | soma do `PlanPrice` vigente das assinaturas `ACTIVE` — **decisão 3** |
| a receber | invoices `OPEN` com `dueAt` na janela |
| vencido | invoices `OVERDUE`, com faixas de atraso |
| taxa de inadimplência | alunos com invoice vencida ÷ **alunos ativos com plano** |
| ticket médio | recebido ÷ pagamentos confirmados |
| quebra por método | `MANUAL` / `PIX` / `CARD` |
| série por competência | por `billingPeriod`, não por data de pagamento |

**Janela fechada** (`ate` exclusivo), pelo mesmo motivo da conciliação da F16: período em curso
produz número que muda embaixo de quem está lendo.

### 3.2 Tela `/billing`

- Cartões de KPI, composição da dívida por faixa de atraso, evolução por competência.
- Cor por **severidade**, não por variedade — o mesmo critério que a tela de inadimplência já usa.
- `tabular-nums` obrigatório (`DS-PAINEL` §3).

---

## 4. Permissão — o ponto que o PI precisa fechar

O PI pediu *"permissão `admin` do painel gerencial"*. **No ArenaHub não existe checagem por papel
no controller**: existe `@RequirePermissions('...')` com capacidades nomeadas
(`billing.read`, `billing.manage`, `billing.refund`, `reconciliation.resolve`…), e papel é um
agrupamento de capacidades em `roles`/`role_permissions`. Amarrar uma tela ao papel `admin`
contraria o desenho que as F12–F16 seguiram.

**Proposta desta spec:** criar a capacidade **`billing.dashboard`** e concedê-la, no seed, aos
papéis que hoje agrupam gestão financeira (proprietário e gerente). Motivo de ser capacidade nova
e não `billing.read`: `billing.read` é o que a **recepcionista** precisa para atender no balcão —
dar a ela o consolidado do tenant inteiro entrega faturamento, ticket médio e inadimplência a
quem só precisava achar uma fatura.

**Decisão do PI, não minha.** Se ele preferir reusar `billing.manage`, é uma linha.

---

## 5. O risco que esta fatia tem de tratar

O `STATUS.md` de 19/08 já registrou, sobre a F15: *"não há evolução mensal no gráfico: o sistema
tem um mês de dado, e uma linha com um ponto mentiria"*. Num painel que existe para comparar
períodos, isso piora:

1. **Série com menos de três pontos não vira linha** — vira estado explícito de dado insuficiente.
2. **Base em formação.** Os ~340 alunos ativados da base do Pacto (F48) e os 1.926 importados como
   `CANCELLED` (ADR-033) distorcem qualquer percentual. A tela **diz sobre que base calcula**.
3. **Ausência de dado nunca é zero** — `DS-PAINEL` §7 e o `—` que o painel já usa.

---

## 6. Escopo negativo

| o quê | para onde foi |
|---|---|
| Qualquer ação sobre invoice | **F53** — esta tela é leitura |
| Esteira de cobrança e histórico de contato | **F38** (MVP 6) |
| KPI no totem ou no app | fora; ver decisão 2 |
| Exportação contábil, DRE, regime de competência fiscal | fora do MVP 2 inteiro (`MVP-02` §6) |

---

## 7. Aceite operacional

O gestor abre o painel, escolhe o período e lê quanto entrou, quanto falta e quanto está vencido —
com **ausência de dado aparecendo como ausência, nunca como zero**, e com a base de cálculo
declarada na tela. Um usuário sem a permissão da §4 **não vê o item no menu nem alcança a rota**.

---

## 8. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | KPI gerencial ou esteira de cobrança? | **KPI gerencial** | 23/08/2026 |
| 2 | Base de cálculo | **o plano em que o aluno está matriculado** | 23/08/2026 |
| 3 | `billing.dashboard` nova ou reusar `billing.manage`? | **`billing.dashboard` nova** — a proposta da §4 | 25/08/2026 |

---

## 9. Antes de codificar, confirme

- [x] O PI aceitou esta spec
- [x] A pergunta 3 da §8 está respondida — `billing.dashboard`, 25/08/2026

---

## 10. Divergências da implementação, e por quê

Registradas aqui porque a spec continua sendo o ponteiro da fatia.

| o quê | a spec dizia | ficou | motivo |
|---|---|---|---|
| Nome dos parâmetros | `?from&to` | `?de&ate` | As rotas vizinhas do mesmo controller usam português (`vencendoDe`, `pagina`, `tamanho`). Quebrar a convenção da API inteira por dois nomes não paga o que custa. |
| Faixas de atraso | herdadas da F15 | `Até 15 / 16–30 / 31–60 / Mais de 60` | A F15 separa **"em carência"**, que é sobre ACESSO — quem ainda entra na academia. Aqui a pergunta é sobre DINHEIRO, e dinheiro atrasado é atrasado independente de o aluno passar na catraca. Os cortes de 15 e 30 são os mesmos; 60 foi acrescentado porque sem teto a última faixa engoliria dívida de qualquer idade. |
| Série por competência | não especificado o formato | tabela, não gráfico | Com menos de três pontos a série não vira linha (§5.1) — e a base real nasce com um mês. Tabela informa nos dois casos; gráfico só no terceiro mês. O `SerieDeMedidas` do DS plota **uma** medida, e esta série tem duas (faturado e recebido). |
| `DS-PAINEL.md` | citado como contrato da superfície | **não existe** | `docs/design/` só contém PNGs. A implementação seguiu o padrão real da tela de inadimplência, que é código vivo. |

**Acréscimo ao escopo da §3.1:** `estornadoMinor`. O recebido é **líquido** — estorno parcial
deixa o `Payment` em `CONFIRMED` com o valor cheio (de propósito, porque parte do dinheiro
entrou), e somar `CONFIRMED` sem descontar faria o painel afirmar uma entrada que foi devolvida.
