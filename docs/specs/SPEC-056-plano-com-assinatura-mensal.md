# SPEC-056 — Plano com assinatura mensal

| campo | valor |
|---|---|
| **Fatia** | F56 |
| **MVP** | 3 *(posição na fila)* — conteúdo é `MVP-02` |
| **Slice do PRD** | não há. Nasce do **ADR-043, Decisão 2** |
| **Superfície** | `api` + `admin-web` · depois `mobile` (F25) e `kiosk` (F52) |
| **Status** | `em-revisao` — escrita em 23/08/2026, aguardando o aceite do PI |
| **Depende de** | **F55** — sem adapter real, a adesão não cobra ninguém. E da **Decisão 5** do ADR-043, que separa cobrança pontual de recorrência |

---

## 1. O que esta fatia entrega

Hoje todo plano é **avulso**: o ArenaHub gera a invoice do período e alguém precisa cobrar — a
recepção no balcão, ou o aluno pelo totem. A fatia acrescenta a modalidade **assinatura**: o aluno
adere **uma vez**, com cartão salvo, e as mensalidades seguintes são cobradas sem que ele precise
agir.

**O que ela deliberadamente NÃO faz:** terceirizar o ciclo de cobrança. O calendário, o valor, a
carência e o bloqueio continuam do ArenaHub — ADR-043, Decisão 2. A Getnet executa a cobrança;
não decide quando nem quanto.

| modalidade | quem gera a invoice | quem dispara a cobrança |
|---|---|---|
| **avulsa** (existe) | ArenaHub, por período | uma pessoa — recepção ou o próprio aluno |
| **assinatura** (nova) | ArenaHub, por período | o próprio ArenaHub, no cartão salvo, com o retry do tenant |

---

## 2. Escopo

### 2.1 Plano

- `Plan` ganha **modalidade** (`AVULSO` | `ASSINATURA`). Plano de assinatura exige `PlanPrice`
  vigente — não se assina o que não tem preço.
- **O preço continua versionado por `PlanPrice.validFrom`.** Reajuste **não** altera assinatura em
  curso: vale a partir do período seguinte, e o aluno é avisado. É exatamente o que o engine da
  Getnet impediria, e o motivo de a Decisão 2 tê-lo recusado.

### 2.2 Adesão

- Exige **método de pagamento ativo** (`payment_methods`) e **consentimento explícito de
  recorrência**: valor, dia da cobrança e como cancelar, na tela, antes do aceite. Sem isso é
  débito surpresa — e é o que gera contestação.
- A adesão instala a recorrência **uma vez** (`createTokenizedSubscription`), e o
  `externalSubscriptionId` é persistido **na `Subscription`** — hoje ele fica em
  `payment_attempts.external_payment_id`, que é onde a Decisão 5 mostrou que ele não devia estar.
- Aluno sem CPF **não adere** (ADR-043, Decisão 3): o antifraude recusa.

### 2.3 Ciclo e falha

- A cobrança do período usa **`chargeTokenizedPayment`** e a política de retry do tenant
  (`retryOffsetDays`, hoje `[0,3,7]`). **Nada disso muda** — a assinatura reusa o motor da F14.
- Falha permanente (cartão cancelado, sem limite recorrente) **não** vira três tentativas: o
  `failureIsPermanent` já existe e já para.
- Cartão vencendo: aviso ao aluno **antes** do vencimento. Sem isso, a assinatura morre em
  silêncio e vira inadimplência que ninguém entendeu.

### 2.4 Cancelamento

- Pelo aluno e pela recepção, **sem fricção** — cancelar é uma ação visível, não um formulário
  escondido.
- Cancelar a recorrência **não cancela o acesso já pago**: vale até o fim do período pago, como o
  `refundAccessPolicy = KEEP_UNTIL_PERIOD_END` já decidiu para o estorno.
- Cancela também **no provedor** (`cancelSubscription`); recorrência viva no provedor após
  cancelamento aqui é cobrança que ninguém autorizou.

---

## 3. Escopo negativo

| o quê | para onde foi |
|---|---|
| Subscriptions Engine da Getnet como motor do ciclo | **recusado** — ADR-043, Decisão 2 |
| Adesão pelo app | **F25** (MVP 4) |
| Adesão pelo totem | **F52** — e provavelmente não deveria existir: aderir a recorrência num terminal público, em pé, com fila atrás, é decisão financeira tomada com pressa |
| Cobrança de multa ou fidelidade | fora do MVP 2 inteiro |

---

## 4. Invariantes e regras

- **INV-076** — idempotência por `(provider_account_id, external_payment_id)`; a adesão é um efeito
  externo como qualquer outro.
- **`M2-BR-002`** — invoice paga não volta a aberta.
- **`M2-BR-007`** — bloqueio no primeiro instante após vencimento + carência, no timezone da
  unidade. A assinatura **não** cria calendário próprio.
- **Regra de arquitetura 1** — a catraca continua sem saber o que é assinatura ou invoice.

---

## 5. Aceite operacional

1. O gestor cria um plano na modalidade **assinatura**, com preço vigente.
2. O aluno adere no balcão, com cartão salvo e **aceite explícito de recorrência na tela**.
3. Virado o período, a invoice é gerada e cobrada **sem ninguém tocar em nada**.
4. Cobrança recusada segue o retry do tenant e, esgotado, cai na régua de inadimplência da F15 —
   **sem caminho novo**.
5. O cancelamento encerra a recorrência **aqui e no provedor**, e o acesso vale até o fim do
   período pago.
6. Reajuste de preço **não** altera o valor da assinatura em curso.

---

## 6. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Assinatura é modalidade de plano ou motor de cobrança terceirizado? | **Modalidade de plano**; o ciclo fica no ArenaHub | 23/08/2026 |
| 2 | Adesão no totem entra? | **em aberto** — recomendação: não, ver §3 | — |
| 3 | Reajuste avisa o aluno por qual canal? | **em aberto** — hoje só existe aviso in-app e `wa.me` do operador | — |

---

## 7. Antes de codificar, confirme

- [ ] O PI aceitou esta spec
- [ ] A **F55** entregou o adapter real **e** a separação da Decisão 5 do ADR-043
- [ ] As perguntas 2 e 3 da §6 estão respondidas
