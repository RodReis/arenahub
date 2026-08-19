# MVP 2 — Matriz de homologação de provedor de pagamento

> **Artefato do gate do `MVP-02` §5 e do ADR-013.** Data: **19/08/2026.**
>
> **Natureza deste documento: verificação, não competição.** O PI escolheu
> **Sicoob para PIX e Getnet (Santander) para cartão** por conhecimento do
> negócio — a academia já recebe pela Sicoob. Este documento existe para
> responder uma pergunta só: **os dois escolhidos passam nos critérios
> obrigatórios?** Se algum falhasse, a escolha teria de voltar à mesa.
>
> ⚠️ **Limite de confiança.** O levantamento é de **documentação pública e
> fontes secundárias**, feito por pesquisa web. Os portais de desenvolvedor dos
> dois provedores exigem credencial (`developers.sicoob.com.br` é SPA;
> `developers.getnet.com.br` devolve **403** a cliente automatizado), então
> **nada aqui foi verificado em sandbox**. Todo item marcado ❓ precisa de
> confirmação com credencial real antes de virar código.

---

## 1. Decisão registrada

| papel | provedor | por quê |
|---|---|---|
| **PIX** | **Sicoob** | a Arena Positiva **já recebe pela Sicoob** hoje. O dinheiro cai direto na conta que a academia opera, sem repasse de intermediário |
| **Cartão tokenizado e recorrência** | **Getnet (Santander)** | o Sicoob **não oferece** cartão tokenizado nem recorrência — ver §3 |

**Confirmado pelo PI em 19/08/2026.** O gate deixou de ser competição entre
marcas e passou a ser esta verificação.

---

## 2. Os sete critérios do ADR-013

| critério | Sicoob (PIX) | Getnet (cartão) | veredito |
|---|---|---|---|
| **PIX cobrança** | ✅ API Pix com escopos `cob`, `cobv`, `lotecobv`, `pix`; cobrança imediata e com vencimento | n/a | **atende** |
| **Cartão tokenizado, tokenização hospedada** (INV-098) | ❌ não oferece | ✅ **Cofre** (vault) + **Get Checkout** / iframe; a própria Getnet recomenda o Web Checkout a quem não tem PCI attestation | **atende via Getnet** — ver §4, é o item que precisa de cuidado |
| **Recorrência** | ❌ não oferece | ✅ **Motor de Recorrência Flexível**, com alteração de data e valor de plano já cadastrado | **atende via Getnet** |
| **Estorno total e parcial** | ❓ não confirmado | ❓ documentação pública menciona cancelamento; **parcial não confirmado** | **verificar** — é F16, não bloqueia F14 |
| **Webhook assinado (HMAC)** (INV-077) | ⚠️ webhook existe (notifica todo PIX com `TransactionId`); **assinatura não confirmada** | ❓ não confirmado | 🔴 **bloqueia — ver §5** |
| **Chave estável de evento externo** (INV-076) | ❓ `TransactionId`/`txid` é candidato, não confirmado como id de **evento** | ❓ | **verificar** |
| **Entrega fora de ordem** (INV-079) | ❓ | ❓ | **verificar** — a porta já resolve por `occurredAt` |
| **Taxa efetiva** | fora do escopo técnico — **dado do PI** | idem | — |

---

## 3. O que fecha o caso do Sicoob no cartão

O Sicoob é **banco, não adquirente**. As APIs públicas cobrem **Pix recebimentos**,
**cobrança bancária/boleto** e **pagamentos/transferências**. Não há, na
documentação pública, API de cartão de crédito, cofre de tokens nem assinatura.

O `MVP-02` §5 é literal: *"PIX, cartão tokenizado e recorrência são capacidades
obrigatórias do gate. Provedor que não suporte uma delas não pode ser homologado
como único adapter deste MVP."* — **por isso são dois provedores, e não um.**

---

## 4. O ponto que exige cuidado de implementação (INV-098)

A API da Getnet tem **dois caminhos** de tokenização, e só um satisfaz o INV-098:

- 🔴 **`POST /v1/tokens/card` chamado pelo backend.** Recebe `card_number` **cru**.
  Se o ArenaHub chamar isso, **o PAN passa pelo nosso servidor** — viola o
  INV-098 diretamente e joga o backend para dentro do escopo PCI DSS.
- ✅ **Get Checkout / iframe / SDK do cliente.** O dado do cartão vai do
  navegador do aluno direto para a Getnet; o backend recebe **só o token**.

**Regra para a fatia:** o ArenaHub implementa **exclusivamente** o segundo
caminho. Se em algum momento existir uma variável com `cardNumber`, `pan` ou
`cvv` no `apps/api`, é defeito de PCI, não campo faltando — a mesma redação que
já está no `payment-provider.port.ts`.

---

## 5. O único achado que pode voltar à mesa

**A assinatura de webhook não está confirmada em nenhum dos dois.** O ADR-013 é
categórico: *"sem HMAC verificável, o provedor está fora"*, e o INV-077 exige
verificar assinatura e origem **antes** de qualquer processamento.

Isso **não bloqueia a F14** (cartão e recorrência), porque a F14 cria e cancela
assinatura — a confirmação de pagamento por webhook é caminho da F13 e da F15.
Mas **bloqueia colocar dinheiro real em produção** em qualquer fatia, e precisa
ser respondido com credencial em mãos.

Se um dos dois **não** assinar webhook, a saída não é aceitar: é **consulta ativa**
(`getPaymentStatus`) como fonte de verdade, tratando o webhook apenas como
gatilho não confiável. O `FakePaymentProvider` e o caso de uso já suportam essa
forma — a F13 implementou `consultar-status-de-pagamento.use-case.ts`.

---

## 6. Consequência estrutural: a porta comporta dois

O F13 acertou a forma sem saber que seriam dois provedores:

- `ProviderAccount` tem coluna **`provider`** com `@@unique([provider, externalAccountId])`;
- a rota de webhook já é **`/api/v1/webhooks/payments/:provider`**;
- `PaymentProvider` é injetado por **token** (`PAYMENT_PROVIDER`), não por classe.

O que muda: a escolha do adapter deixa de ser **por ambiente** e passa a ser
**por método** — `createPix` → Sicoob, `createTokenizedSubscription` e
`cancelSubscription` → Getnet. Decisão técnica de roteamento, registrada no PR
da fatia que a implementar.

---

## 7. O que este documento NÃO decide

- **Taxa efetiva por método** — dado comercial, do PI.
- **As duas políticas do `M2-COMPLIANCE-01`** (`KEEP_UNTIL_PERIOD_END` vs
  `SUSPEND_ON_CONFIRMATION` no refund; limites de desconto e pagamento manual).
  Continuam abertas no ADR-013 e são decisão de produto.
- **Pix Automático.** O `LANDSCAPE.md` §4.2 registra adoção acelerando e a
  Resolução BCB 478/2025; **não foi confirmado se o Sicoob o oferece**. Não é
  necessário para o MVP 2 — a recorrência vem do cartão, pela Getnet — mas muda
  o cálculo de custo no futuro, e a consequência de modelagem (`autorização
  revogada` ≠ `pagamento falhou`) permanece registrada no ADR-013.

---

## 8. Fontes

Documentação pública e fontes secundárias, consultadas em 19/08/2026:

- Portal de desenvolvedores Sicoob — `developers.sicoob.com.br` (exige credencial)
- *Sicoob Pix — Manual para utilização da API Pix* (PDF público, v2.2.1)
- Integração Sicoob Pix Cobrança — documentação IXC
- `github.com/SavioCaetano/api-pix-sicoob` — escopos e webhook
- Portal de desenvolvedores Getnet — `developers.getnet.com.br/api` (**403** a cliente automatizado)
- *Recorrência* e *Get Checkout* — `site.getnet.com.br`
- *Produto: Recorrência Flexível* (PDF público Getnet)
- `docs.globalgetnet.com` — tokenização e `number_token`

> **Relato que vale registrar sobre a documentação do Sicoob:** há registro
> público de desenvolvedores a quem o suporte respondeu que *"não há documentação,
> trabalhem por tentativa e erro"*. Contra o critério *"sandbox e qualidade da
> documentação"* do ADR-013, isso é dado ruim — e é a razão de este documento
> marcar tanto item como ❓ em vez de assumir paridade com um gateway maduro.
