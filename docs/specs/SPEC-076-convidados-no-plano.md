# SPEC-076 — Convidados no plano: passe mensal com nome e CPF

| campo | valor |
|---|---|
| **Fatia** | F76 |
| **MVP** | 1 *(posição na fila)* — decisão do PI, não Slice de PRD |
| **Slice do PRD** | não há. Nasce do [ADR-059](../DECISIONS.md#adr-059)/[ADR-060](../DECISIONS.md#adr-060) — auditoria de cobertura, issue #339 |
| **Superfície** | `apps/api` (campo em `Plan`, registro de uso do convidado). UI de cadastro do plano e de registro do convidado (recepção/totem): a critério do Code — não é decisão de produto pendente |
| **Card** | [#366](https://github.com/RodReis/arenahub/issues/366) |
| **Status** | `aprovada-pi` — decisões tomadas em 18/09/2026, ver §2 |
| **Depende de** | nenhuma — `Plan` e `Entitlement.source=visitante` já existem |

---

## 1. O que esta fatia entrega

Fecha, para "convidados", um dos seis buracos que a issue #339 (auditoria de cobertura de
15/09/2026) apontou na Especificação §34: hoje `Plan` não tem nenhum campo sobre convidados, e
nada impede ou registra quem um aluno leva como visita.

Esta fatia dá a `Plan` um limite mensal de convidados e registra, a cada uso, quem foi o
convidado — sem criar caminho de acesso novo: o convidado entra pela catraca como já existe hoje
(`Entitlement.source = visitante`, INV-064).

---

## 2. Decisões do PI — 18/09/2026 (ADR-059 e ADR-060)

| # | decisão | consequência |
|---|---|---|
| 1 | Convidados entram no MVP1 (ADR-059) | `Plan` ganha o benefício |
| 2 | Nº de passes por mês, **com nome e CPF do convidado registrados** a cada uso (ADR-060) | não é um contador solto — cada uso grava quem entrou, quando e sob qual assinatura |
| 3 | Acesso do convidado na catraca reaproveita `Entitlement.source = visitante` (ADR-060) | motor de decisão de acesso não muda; nenhuma tabela de decisão nova |

---

## 3. Escopo

- `Plan` ganha o limite mensal de convidados (nome e tipo do campo: decisão de implementação do
  Code — `CLAUDE.md`, *O que pode bloquear o desenvolvimento*).
- Novo registro de uso por convidado, vinculado à `Subscription`/`Student` titular: nome, CPF
  (mesma máscara/validação já usada para CPF de aluno — `CLAUDE.md`, *Convenções de código*), e
  data do uso. É o que permite auditar quem usou o benefício e recusar acima do limite.
- Consumo do limite é **por assinatura**, não por plano agregando todos os alunos daquele plano —
  mesma relação que `Plan → Subscription` já tem para todo o resto do entitlement.
- O convidado passa pela catraca pelo caminho que já existe hoje para `visitante`
  (`Entitlement.source`, INV-064) — esta fatia não cria decisão de acesso nova, só a razão de
  existir mais visitantes.

### 3.1 Em aberto — não decidido aqui, o Code pergunta antes de implementar

O PI decidiu "por mês", não **qual mês**: mês-calendário (reseta todo dia 1) ou ciclo de cobrança
da assinatura (reseta no dia de renovação, que varia por aluno). Isso muda o comportamento visível
para o aluno — não é detalhe de nome de campo, é regra de negócio. Fica registrado aqui para não
virar suposição do Code na implementação; volta a ser pergunta ao PI se não estiver decidido até
lá.

---

## 4. Escopo negativo

| o quê | para onde foi |
|---|---|
| Entidade `Class`/agenda para convidado assistir aula específica | não é isto — convidado aqui é benefício do plano (visita), não vínculo com aula. Ver ADR-060, "aulas inclusas" |
| Cadastro completo do convidado (conta, matrícula, biometria) | fora — convidado não é aluno; nome + CPF bastam para o registro de uso |
| Consentimento/base legal específica para o CPF do convidado | fora do escopo desta fatia e do ADR-060 — `CLAUDE.md` veda o Cowork de inventar exigência de LGPD/consentimento sem decisão explícita do PI, e nenhuma foi pedida |
| Limite compartilhado entre unidades (multiunidade) | fora — ADR-059 não decidiu multiunidade; esta fatia assume o mesmo alcance de unidade que o resto do `Plan` já tem |

---

## 5. Aceite operacional

A recepção (ou quem cadastra o plano) vê o limite de convidados do plano do aluno; ao registrar um
convidado, informa nome e CPF, e o sistema recusa quando o limite do mês já foi usado. O convidado
passa pela catraca como visitante, do mesmo jeito que já passa hoje. O histórico de convidados por
assinatura fica consultável — quem, quando, sob qual aluno.
