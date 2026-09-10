# F65 — Gate de tenant no motor de decisão

**Data:** 09/09/2026 · **Fatia:** F65 · **SPEC-065** · **Card:** [#288](https://github.com/RodReis/arenahub/issues/288)
**Origem:** ADR-053, mais três decisões do PI tomadas em 09/09/2026 no brainstorming desta fatia.

---

## 1. O problema

Hoje **nada** em `access`, `device-sync` ou `edge-agent` lê `Tenant.status`. Suspender um tenant
trava o painel e mais nada: a catraca continua abrindo. O `graceDays` existe no contrato desde a
F63, é validado de 0 a 180 e sai impresso no PDF — e nenhuma linha de código o consome.

Esta fatia liga as duas pontas: fatura da plataforma vencida, carência esgotada, a catraca fecha.

---

## 2. O que o ADR-053 já fixou

1. Carência de **15 dias após o vencimento**, padrão global, configurável por tenant.
2. Vencida a carência, o tenant vai para `SUSPENDED` e a catraca **nega todo mundo** — aluno,
   funcionário, personal — com razão **`TENANT_SUSPENDED`**.
3. É **gate**, não revogação de Entitlement (§2). Regularizou, o gate cai e ninguém é recadastrado.
4. A regra de arquitetura nº 1 continua de pé (§3): "pagamento não controla acesso" fala do
   pagamento **do aluno**; este é o **contratante**, outro ator, outra cadeia.
5. Snapshot do Edge carrega `tenantGateAt` (§4).
6. Desde o vencimento, o `OWNER` vê contagem regressiva e valor em aberto (§5).
7. Pagamento registrado derruba o gate na hora (§6).

## 3. As três decisões novas do PI (09/09/2026)

O ADR-053 não fechava estas; foram decididas no brainstorming desta fatia.

| # | Decisão | Por quê |
|---|---|---|
| **D1** | O aviso vai nos **três** lugares: grid do Super Admin, faixa no painel do dono e grid de faturas do tenant | O §5 dizia só "no painel". O dono do SaaS precisa ver quem vai fechar; o dono da academia precisa ser avisado sem procurar; a tela de faturas precisa da contagem ao lado do valor |
| **D2** | Automático/manual é **por tenant**, em coluna do próprio `Tenant` — não no contrato | Contrato ativo é **imutável** (F63). Pôr a chave lá exigiria contrato novo com PDF novo para virar uma chave operacional, ou abrir a primeira exceção à imutabilidade. Suspender ou não é decisão operacional do PI, não cláusula negociada |
| **D3** | No automático, a suspensão efetiva **às 6h locais do dia seguinte**, não no instante em que a carência esgota | Sem regra de feriado, uma janela fixa, testável. Fechar às 3h de domingo prenderia gente do lado de fora com a recepção fechada |

---

## 4. Escopo negativo — e a parte bloqueada

Não bloqueia login do painel na carência (o dono precisa ver a fatura para pagar). Não apaga nada.
Não toca em `Entitlement`, `Subscription` nem `Invoice` **do aluno**.

**O `tenantGateAt` do snapshot (ADR-053 §4) fica de fora, por impedimento real.** O snapshot
assinado **não existe**: é a F10 (`SPEC-010`, operação offline), no backlog do MVP 1.5. Não há
builder, não há TTL, não há schema em `packages/api-contracts`, e `AccessMode.OFFLINE` é valor de
enum reservado sem produtor. Não se implementa campo de um snapshot que não foi construído.

O que esta fatia entrega no lugar: **o campo no contrato do motor**
(`AccessPolicyInput.tenant.gateActive`), que é exatamente o que a F10 vai serializar. O motor puro
já roda no Edge por construção; quando o snapshot existir, ele carrega o `tenantGateAt`, o Edge
resolve a data em booleano com o próprio relógio e chama o mesmo `evaluateAccess`.

Consequência aceita, a mesma que o ADR-053 §4 já aceitava: **edge offline antes da suspensão só
fecha quando o snapshot expirar** — e hoje, sem snapshot, o edge offline não fecha nesta fatia.

---

## 5. Arquitetura

### 5.1 O gate no motor puro

`packages/access-policy` ganha a razão `TENANT_SUSPENDED` e o campo
`AccessPolicyInput.tenant.gateActive`. A checagem entra **antes de todas as outras**, inclusive do
bloqueio administrativo:

```
0. tenant.gateActive        → DENY TENANT_SUSPENDED   ← NOVO
1. adminBlock.active        → DENY ADMIN_BLOCK
2. student.status BLOCKED   → DENY STUDENT_BLOCKED
3. student.status ≠ ACTIVE  → DENY STUDENT_INACTIVE
...
```

**A ordem é a regra.** O gate nega a academia inteira; perguntar antes por esta pessoa em
particular responderia "o aluno X está bloqueado" quando a verdade é "a academia está suspensa", e
a recepção agiria sobre a pessoa errada.

**`gateActive` é booleano, não a data da suspensão.** O motor é puro e não tem relógio. Comparar
`gateAt <= agora` dentro dele daria a um Edge com relógio atrasado o poder de reabrir a catraca.
Quem resolve data em booleano é a projeção, na nuvem — e será o Edge, na F10, com o `tenantGateAt`.

**Razão própria e não reuso de `ADMIN_BLOCK`:** as duas negam, mas quem resolve é outra pessoa.
`ADMIN_BLOCK` manda a recepção falar com a gerência; `TENANT_SUSPENDED` manda o **dono** pagar a
fatura da plataforma, e a recepção não tem o que fazer com ela.

### 5.2 A versão da política sobe para 2.0.0 — major

Era `1.1.0`. **Major, ao contrário da 1.1.0:** com o gate ativo, entrada que a 1.1.0 concedia vira
`DENY`. É a primeira vez que uma versão do motor **muda o desfecho**, e não só a explicação —
reprocessar um evento de 1.1.0 com esta regra pode negar quem de fato passou. O número é o que
avisa quem for reconciliar histórico de que as duas versões não são intercambiáveis.

### 5.3 `gateActive` é derivado, nunca coluna

Na nuvem, `gateActive := tenant.status === 'SUSPENDED'`, resolvido na
`AccessProjectionRepository`. Uma coluna `gate_active` seria um **segundo lugar onde a verdade
mora**, e o primeiro caminho que escrevesse um sem o outro deixaria a catraca discordando do painel.

**`INACTIVE` não fecha a catraca.** O ADR-052 §4 diz que `INACTIVE` é o dono do SaaS desligando o
cliente; o ADR-053 fala só de inadimplência. Colapsar os dois faria um desligamento administrativo
negar com a razão "suspensa por dívida" — mentira gravada em fato imutável.

A leitura usa `findUniqueOrThrow`. Tenant que sumiu no meio da requisição não pode virar `null` e
cair num `?? false`, porque `false` aqui significa **abrir a catraca**. Falhar alto é a única
leitura segura de "não sei o estado do tenant".

### 5.4 A liberação manual da recepção também recusa

ADR-053 §1 diz "nega todo mundo". Sem checar o gate no `ManualOverrideUseCase`, ele teria porta
lateral: a recepção nega na catraca e libera na tela, e a suspensão viraria sugestão. A liberação
manual responde por decisão da **operação** sobre uma pessoa; ela não alcança a dívida da academia
com o ArenaHub, que só o dono resolve pagando.

A checagem vem **antes** das buscas de dispositivo e aluno: suspenso, a resposta é a mesma para
todo mundo, e vasculhar o cadastro primeiro só diria a quem sondasse quais UUIDs existem numa
academia que nem deveria estar respondendo.

A **liberação financeira** (F15) já está segura sem mudança: ela só converte `PAYMENT_OVERDUE`, e o
gate devolve `TENANT_SUSPENDED`.

### 5.5 Suspensão automática — coluna, job e janela

`Tenant` ganha `autoSuspend Boolean @default(false)`. Padrão **desligado**: uma coluna nova que
nasce ligada fecharia catraca de tenant inadimplente no primeiro deploy, sem ninguém ter decidido
isso por aquele cliente.

O `PlatformInvoiceSchedulerService` já roda diariamente e já chama `marcarVencidas`. O ciclo ganha
um terceiro passo, **depois** de emitir e marcar vencidas: suspender quem passou da carência.

**Um tenant é candidato quando**, para alguma fatura sua:

- `status = 'OVERDUE'`; e
- `dueAt + graceDays` (do contrato vigente) já passou; e
- o tenant está em `autoSuspend`; e
- o tenant está `ACTIVE` (não se suspende quem já está suspenso nem quem foi desligado).

**A janela das 6h locais (D3).** A suspensão só efetiva quando são 6h ou mais no fuso da academia,
no dia seguinte ao esgotamento. O job roda diariamente e reavalia; quem não passou na janela de
hoje passa amanhã.

**A carência conta do `dueAt` da fatura**, não de data informada à mão. O ADR-053 §1 previa data
manual porque a fatura automática não existia — ela existe desde a F64, então o vencimento real é a
âncora. A suspensão **manual** pelo painel continua disponível a qualquer momento, com motivo
obrigatório, como já é hoje pelo `AlterarTenantUseCase`.

Falha de um tenant não derruba os outros: vira log e o laço segue, como já é na emissão.

### 5.6 Pagamento derruba o gate na hora

`registrarPagamento` passa a, **na mesma transação**, voltar o tenant para `ACTIVE` quando ele
estava `SUSPENDED` e não sobrou nenhuma outra fatura vencida além da que acabou de ser paga.

Duas sutilezas:

- **Só levanta quem o gate derrubou.** Um tenant `SUSPENDED` porque o PI suspendeu à mão por outro
  motivo não pode ser reaberto por um pagamento. A auditoria da suspensão diz qual foi o caso, e só
  a suspensão automática é revertida automaticamente.
- **Nenhuma outra fatura vencida.** Pagar a de janeiro com a de fevereiro vencida não reabre a
  academia.

---

## 6. Os três avisos (D1)

Um cálculo só, em função pura, reusado nas três telas: dias restantes até a suspensão e valor em
aberto. Duplicar a conta em três lugares faria as telas discordarem sobre quando a catraca fecha.

| Onde | O que mostra |
|---|---|
| **Grid do Super Admin** (lista de academias) | Estado de cobrança: em dia · vencida com N dias restantes · suspensa. Mais o valor em aberto |
| **Faixa no painel do dono** | Slot de banner que já existe (o da faixa de sessão elevada), não dispensável, desde o vencimento: dias restantes e valor em aberto |
| **Grid de faturas do tenant** | Contagem regressiva na linha da fatura vencida, ao lado do valor |

**Suspenso, os três trocam a contagem por "acesso bloqueado".** Contagem regressiva que chegou a
zero e continua contando é pior que nenhuma.

O dado chega ao painel pelo `/auth/me`, que já é a fonte da faixa de sessão elevada — mesmo
precedente, mesma forma.

---

## 7. Invariantes e regras de arquitetura

- **Regra nº 1** (pagamento não controla acesso) — **preservada**. `gateActive` não passa por
  `Invoice` nem `Subscription` do aluno; é o contratante, outra cadeia (ADR-053 §3).
- **Regra nº 2** (`tenant_id` em toda entidade) — o tenant vem da identidade autenticada e do
  contexto do Edge, nunca do corpo.
- **Regra nº 5** (evento na mesma transação) — a suspensão e sua auditoria commitam juntas, como já
  faz o `AlterarTenantUseCase`.
- **INV-001 a INV-008** (multi-tenant e identidade).

---

## 8. Testes

| O que prova | Como |
|---|---|
| Motor nega com gate ativo | Unitário do `evaluateAccess`: aluno perfeitamente regular, `gateActive: true` → `DENY TENANT_SUSPENDED` |
| O gate precede tudo | Aluno `BLOCKED` **com** gate ativo devolve `TENANT_SUSPENDED`, não `STUDENT_BLOCKED` |
| Volta a permitir ao levantar | Mesma entrada com `gateActive: false` → `ALLOW` |
| **Entitlements idênticos antes e depois** | Integração: snapshot das linhas de `Entitlement` antes e depois do ciclo de suspensão, comparado campo a campo |
| Override não fura o gate | Integração: `POST` de liberação manual com tenant `SUSPENDED` → 400 `TENANT_SUSPENDED` |
| `INACTIVE` não fecha a catraca | Tenant `INACTIVE` decide normalmente |
| Job suspende só na janela | `agora` injetado: 5h locais não suspende, 6h suspende |
| Job respeita `autoSuspend` | Mesma carência esgotada, `autoSuspend: false` → segue `ACTIVE` |
| Pagamento levanta o gate | Integração: suspende pelo job, registra pagamento, tenant volta a `ACTIVE` e a catraca abre |
| Pagamento não reabre com outra vencida | Duas faturas vencidas, paga uma → segue `SUSPENDED` |
| Enum não diverge | O guard existente passa a exigir **oito** razões de `DENY` |

O canário de cada guarda tem de derrubar o teste nos dois estados — a lição registrada em
`canario-passa-por-guarda-anterior`: verde não prova nada se outra guarda recusa o caso antes.

---

## 9. Migration

Uma, com dois efeitos: `ALTER TYPE access_reason ADD VALUE 'TENANT_SUSPENDED'` e
`ALTER TABLE tenants ADD COLUMN auto_suspend BOOLEAN NOT NULL DEFAULT false`.

As duas cabem no mesmo arquivo: a migration `20260816111545_biometrics_devices` já faz
`ALTER TYPE ... ADD VALUE` ao lado de outro DDL, e é o precedente do repositório. A restrição do
Postgres é sobre **ler** o valor novo na mesma transação que o cria, e nenhuma das duas o lê.
