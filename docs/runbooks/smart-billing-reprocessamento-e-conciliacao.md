# Reprocessamento seguro e conciliação — Smart Billing

> **Documento operacional.** Escrito para ser seguido com o problema acontecendo — não para ser
> lido antes. Cada passo diz **o que fazer**, **o que esperar** e **o que fazer quando não for
> isso**.
>
> **Data:** 19/08/2026 · **Dono:** Claude Code · **Fatia:** F16 (`SPEC-016`), Slice 2.5
>
> Contrato de domínio em `docs/CONVENTION.md` §4.10–§4.11. Escopo em
> `docs/prd/academia/MVP-02-smart-billing.md` §7.

---

## 0. A regra que este runbook existe para tornar desnecessária

🔴 **Nenhum passo daqui manda escrever SQL.** Não é preferência de estilo: o aceite da Slice 2.5 é
*"operador resolve divergência sem editar banco e sem duplicar efeito financeiro"*. Um `UPDATE` na
tabela de pagamento contorna a cadeia `Pagamento → Invoice → Subscription → Entitlement` (regra de
arquitetura nº 1) — o dinheiro fica certo na tela e o aluno continua barrado na catraca, porque o
entitlement não foi tocado.

Se você chegou num caso que só se resolve por SQL, **o caso é um bug e vira issue `[FIX]`** — não
um comando no psql.

---

## 1. "O aluno pagou e continua bloqueado"

O sintoma mais comum, e o que o alerta `WEBHOOK_BACKLOG` acusa.

### 1.1 Verificar se o evento chegou

Painel → **Operação**. Procure alerta com recurso `BILLING`.

| o que você vê | o que significa | vá para |
|---|---|---|
| `WEBHOOK_BACKLOG` | o evento chegou e **não foi aplicado** | §1.2 |
| `WEBHOOK_SILENCIOSO` | nenhum evento chega há 2 dias | §3 |
| nenhum alerta de billing | o evento pode nunca ter chegado | §1.3 |

### 1.2 Reprocessar o evento guardado

1. Painel → **Conciliação**.
2. Rode uma conciliação do período que contém o pagamento (§2).
3. Localize a linha com situação **"Ausente no ArenaHub"** (`MISSING_INTERNAL`).
4. Clique **"Reprocessar evento do provedor"**, escreva o motivo e confirme.

**O que esperar:** a linha vira "Resolvido" e o entitlement do aluno é ativado pela mesma cadeia do
webhook normal.

**Se o botão não aparecer:** a divergência não é `MISSING_INTERNAL`. Só ela aceita reprocessamento
— nas outras não existe evento guardado para reprocessar.

**Se der `PROVIDER_EVENT_NOT_FOUND`:** o evento realmente nunca chegou. O provedor tem o dinheiro e
nós não temos o aviso. Vá para §1.3.

> **Reprocessar é seguro, sempre.** O caminho é o mesmo do webhook, com a mesma idempotência
> (INV-076, INV-086): se o evento já tiver sido aplicado, nada muda. Não existe "reprocessar demais".

### 1.3 Quando o evento nunca chegou

1. Confirme o pagamento no painel do **provedor**, pelo id externo.
2. Use `GET /api/v1/payments/:id/status` — a consulta ativa (INV-083) pergunta ao provedor e aplica
   o resultado pelo mesmo caminho idempotente.
3. Se o provedor também não reconhece o pagamento, **não force nada aqui**: o problema é do lado
   dele, e inventar o pagamento no ArenaHub cria dinheiro que não existe.

---

## 2. Conciliar um período

Painel → **Conciliação** → informe conta do provedor e o intervalo.

**O período tem de estar FECHADO.** A API recusa (`RECONCILIATION_INVALID_WINDOW`) intervalo que
alcança o presente — e a recusa é proteção, não obstáculo: o provedor leva minutos a horas para
publicar no extrato, e conciliar "até agora" acusaria como divergência todo pagamento recente.

**Regra prática:** concilie ontem ou antes. Para fechamento mensal, rode no dia 1º do mês seguinte.

### O que cada situação significa

| situação | o que aconteceu | o que fazer |
|---|---|---|
| **Conciliado** | os dois lados batem | nada |
| **Ausente no ArenaHub** | provedor tem, nós não | §1.2 — reprocessar |
| **Ausente no provedor** | nós temos, provedor não reporta | §2.1 |
| **Valor divergente** | mesmo movimento, valores diferentes | §2.2 |

### 2.1 "Ausente no provedor"

Quase sempre é **liquidação fora da janela**: o pagamento das 23h50 do dia 31 aparece no extrato do
dia 1º.

1. Confira a data de liquidação no painel do provedor.
2. Se caiu no período seguinte: **Aceitar diferença documentada**, com o motivo dizendo isso.
3. Se o provedor não conhece o pagamento **de jeito nenhum**: isso é dinheiro que registramos e não
   entrou. Não resolva — abra issue `[FIX]` e escale.

### 2.2 "Valor divergente"

Quase sempre é **tarifa ou retenção do provedor**: cobramos R$ 120,00 e o extrato mostra R$ 116,40.

1. Confira a tarifa contratada.
2. Se a diferença é a tarifa: **Aceitar diferença documentada**, com o valor da tarifa no motivo.
3. Se a diferença **não** se explica pela tarifa: não aceite. Abra issue `[FIX]`.

> **Aceitar não move dinheiro.** O comando registra que alguém olhou, decidiu e assinou — o valor
> continua exatamente como está nas duas pontas. Aceitar o que você não entendeu não conserta nada;
> só apaga o rastro de que havia algo a entender.

---

## 3. `WEBHOOK_SILENCIOSO` — a falha que não parece falha

**Este é o alerta mais perigoso do painel**, e a razão é que ele não produz erro nenhum: nada fica
vermelho, nenhuma requisição falha, e enquanto isso nenhum pagamento é reconhecido. A academia
descobre pela recepção, quando um aluno adimplente é barrado.

1. No painel do **provedor**, confira se a URL do webhook segue cadastrada e ativa.
2. Confira se o segredo de assinatura não foi rotacionado sem atualizar `provider_accounts`.
3. Concilie os últimos períodos (§2) — tudo que faltou vira `MISSING_INTERNAL` e sai por §1.2.

**Atenção aos dois provedores (ADR-032):** PIX é Sicoob e cartão é Getnet, contas separadas. O
alerta é **por conta** — um pode estar mudo com o outro funcionando. Verifique a conta que o alerta
nomeia, não "o provedor".

---

## 4. Estorno

### 4.1 Quem pode

Permissão `billing.refund` **mais** confirmação do código do aplicativo autenticador na própria
requisição (step-up, INV-074). Quem administra cobrança não estorna por padrão — é permissão
separada, pelo mesmo critério do pagamento manual e do override de acesso.

### 4.2 O que acontece com o acesso

**`KEEP_UNTIL_PERIOD_END`** (padrão, decidido pelo PI em 19/08/2026): o aluno estornado **continua
entrando** até o fim do período que já estava pago.

Isso é deliberado, não uma frouxidão: quem decide acesso é o entitlement, nunca o pagamento (regra
de arquitetura nº 1). E nenhuma das duas políticas é retroativa (INV-094) — entrada que já
aconteceu aconteceu.

Para mudar: `billing_settings.refund_access_policy` do tenant. **É decisão do PI**, não operacional.

### 4.3 O que NÃO é estornável

**Pagamento manual.** Dinheiro reconhecido na recepção não tem provedor que o devolva — a API
recusa com `BILLING_MANUAL_PAYMENT_NOT_REFUNDABLE` (ADR-027). A devolução física acontece fora do
sistema e entra como contra-lançamento auditado, que não é desta fatia.

### 4.4 Erros comuns

| código | o que fazer |
|---|---|
| `BILLING_REFUND_ALREADY_IN_FLIGHT` | já há um estorno deste pagamento em andamento. **Aguarde** — não clique de novo |
| `BILLING_REFUND_LIMIT_EXCEEDED` | o valor passa do teto do tenant. Só o PI muda o teto |
| `BILLING_STEP_UP_REQUIRED` | o código do autenticador não confere. Gere um novo |
| `BILLING_INVALID_REFUND` | pagamento não confirmado, valor acima do disponível, ou razão ausente |

---

## 5. O que este runbook proíbe

1. **`UPDATE`, `INSERT` ou `DELETE` manual em tabela financeira.** Sem exceção. Se parece a única
   saída, é bug — abra `[FIX]`.
2. **Aceitar diferença que você não explicou.** O comando existe para registrar decisão, não para
   esvaziar a fila.
3. **Repetir estorno que deu `ALREADY_IN_FLIGHT`.** Foi assim que a F14 cobrou um aluno em dobro,
   do outro lado da operação.
4. **Conciliar período em curso** para "adiantar o fechamento". Produz divergência que não existe e
   ensina a operação a ignorar a fila.
