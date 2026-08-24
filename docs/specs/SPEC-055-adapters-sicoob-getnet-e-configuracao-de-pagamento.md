# SPEC-055 — Adapters reais (Sicoob e Getnet) e Configuração → Pagamento

| campo | valor |
|---|---|
| **Fatia** | F55 |
| **MVP** | 3 *(posição na fila)* — conteúdo é `MVP-02` |
| **Slice do PRD** | não há. Materializa o **ADR-032** e fecha o gate do `MVP-02` §5 |
| **Recorte** | [`notes/2026-08-23-pagamento-nas-tres-superficies.md`](../notes/2026-08-23-pagamento-nas-tres-superficies.md) |
| **Superfície** | `api` + `admin-web` (menu **Configuração**, aba **Pagamento**) |
| **Status** | `em-revisao` — escrita em 23/08/2026, aguardando o aceite do PI |
| **ADRs que alcança** | **ADR-032** (Sicoob PIX / Getnet cartão), ADR-013 (fecha o que sobrou), ADR-006 (idempotência) |
| **Bloqueada por** | **credenciais de produção e sandbox dos dois provedores — insumo do PI, não código** |

> **Por que esta fatia existe separada da F53.** O PI listou "adapters de verdade" e "configuração
> das keys" dentro da F53. Separei, e o motivo é operacional, não estético: **a F53 é construível
> hoje e esta não.** Sem credencial de Sicoob e de Getnet, esta fatia não escreve uma linha
> testável contra o provedor. Amarrar as duas faria a tela de balcão — que está pronta para ser
> feita — ficar parada esperando um e-mail de banco. **Se o PI quiser as duas num card só, é
> decisão dele e eu junto.**

---

## 1. O que esta fatia entrega

O dinheiro sai do simulador. Hoje `billing.module.ts` tem
`{ provide: PAYMENT_PROVIDER, useClass: FakePaymentProvider }` — **todo o MVP 2 roda contra um
dublê**, e nenhum centavo real entra na conta da Arena Positiva.

---

## 2. O mal-entendido que esta spec precisa desfazer

O PI escreveu: *"adapters de Sicoob e Getnet de verdade, nada de fakePay"*.

**O `FakePaymentProvider` não é removido — ele continua obrigatório.** O `docs/TESTING.md` §3 e o
**ADR-017** exigem dublê no boundary: é ele que permite testar webhook duplicado, evento fora de
ordem, falha do provedor e estorno assíncrono **sem depender da rede de terceiro**. Apagá-lo
derruba a suíte que hoje protege o financeiro.

**O que muda é a seleção:** o `useClass` fixo vira roteamento por `ProviderAccount.capability` —
`PIX` → Sicoob, `CARD` → Getnet — com o fake selecionado apenas em teste e em ambiente sem
credencial. A tabela `provider_accounts` **já foi desenhada para isso**: ela guarda *o que a conta
sabe fazer, não quem ela é*.

---

## 3. Escopo

### 3.1 Adapters

- **Sicoob — PIX:** `createPix`, `getPaymentStatus`, `verifyAndParseWebhook`, `listMovements`.
- **Getnet — cartão:** `createTokenizedSubscription`, `cancelSubscription`, `refundPayment`,
  `getRefundStatus`, `listMovements`, `verifyAndParseWebhook`, **e o `createHostedCheckout` que a
  F53 precisa** para a primeira cobrança no balcão e que a F52 usa no QR do totem.
- Erros do provedor traduzidos para códigos internos estáveis, classificados em **recuperável** ou
  **permanente** (`MVP-02` §12).
- **Nenhum dos dois faz PIX e cartão** — é o ponto inteiro do ADR-032: o Sicoob é banco, não
  adquirente.

### 3.2 Credenciais — `Configuração → Pagamento`

`provider_accounts` hoje guarda `externalAccountId` e `signingSecretEncrypted`. **Falta o que os
dois provedores exigem de fato:** `client_id`/`client_secret` com OAuth na Getnet e **certificado
mTLS** no PIX do Sicoob. Entram como material cifrado, por conta, com rotação.

- Tela nova: menu **Configuração** (que ainda não existe no painel) com a aba **Pagamento** —
  conta por capacidade, ambiente (sandbox/produção), estado da conexão, teste de credencial.
- **Segredo nunca volta em resposta de API, nunca aparece em log, nunca aparece na tela depois de
  salvo** — só o sufixo e a data de rotação. É a regra que a coluna `signingSecretEncrypted` já
  declara e que a tela não pode furar.
- Permissão `billing.configure` (`MVP-02` §4). Ação sensível: `SensitiveAction` do `DS-PAINEL` §8.3.

### 3.3 Webhook

⚠️ **Achado aberto desde 19/08:** *"a assinatura de webhook não está confirmada em nenhum dos
dois"*. É **esta** fatia que fecha isso — sem verificação de assinatura, `M2-FR-007` não é
cumprido e o endpoint aceita evento forjado. **Nenhum tráfego de produção antes disso.**

---

## 4. Escopo negativo

| o quê | para onde foi |
|---|---|
| Telas de cobrança no balcão | **F53** |
| Painel de KPI | **F54** |
| Segundo provedor por capacidade | fora — `MVP-02` §5 |
| Maquininha física / TEF | descartado em 23/08 |
| Split, antecipação, nota fiscal | fora do MVP 2 (`MVP-02` §6) |

---

## 5. Invariantes e requisitos que esta fatia honra

- **INV-076 / `M2-FR-008`** — uma transição lógica por evento externo.
- **INV-078** — o webhook **não confia no tenant do payload**; a conta do provedor resolve o tenant.
- **INV-098 / `M2-AC-011`** — nenhum PAN, CVV, token real ou segredo de webhook em log ou teste.
- **`M2-FR-007`** — assinatura e origem verificadas antes de processar.
- **`M2-NFR-008`** — provedor fora do ar não derruba a leitura de invoice já armazenada.

---

## 6. Aceite operacional

1. Em **sandbox**, um PIX real do Sicoob é gerado, pago e **confirma o entitlement pelo webhook**.
2. Em **sandbox**, um cartão real da Getnet paga por checkout hospedado e a recorrência é criada.
3. Webhook com **assinatura inválida é recusado** e gera sinal operacional (`M2-AC-003`).
4. A credencial é trocada pela tela **sem deploy**, e o segredo não reaparece em lugar nenhum.
5. A suíte inteira continua verde **com o `FakePaymentProvider`** — §2.

---

## 7. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Fatia separada da F53? | **em aberto** — proposta e motivo na abertura desta spec | — |
| 2 | Credenciais de sandbox e produção dos dois provedores | **em aberto — insumo do PI** | — |
| 3 | CNPJ/conta recebedora e modelo de conta (`MVP-02` §5) já definidos? | **em aberto** | — |

---

## 8. Antes de codificar, confirme

- [ ] O PI aceitou esta spec
- [ ] Credenciais de sandbox dos dois provedores em mãos
- [ ] A matriz do gate (`reports/MVP-02-matriz-de-homologacao-de-provedor.md`) foi atualizada com o que a sandbox confirmou

---

## 9. O que os documentos de `docs/integracao/` acrescentam — 23/08/2026

O PI trouxe quatro documentos de integração Getnet. A análise completa está em
[`notes/2026-08-23-analise-integracao-getnet.md`](../notes/2026-08-23-analise-integracao-getnet.md);
aqui fica só o que **esta fatia** precisa honrar. Os documentos são **material de fornecedor**, no
mesmo estatuto de `docs/vendor/topdata/` — não são spec, e onde conflitarem com PRD, ADR ou código
entregue, perdem.

### 9.1 Fase 0 — o bloqueio, agora com nome

**Ter maquininha Getnet ativa não dá credencial de e-commerce.** Adquirência presencial (POS) e
Plataforma Digital são **produtos contratuais distintos**: `client_id`, `client_secret` e
`seller_id` saem do time de Integração da Getnet, mediante solicitação. É isto que a §1 desta spec
chamava de "insumo do PI" — e é o primeiro item, bloqueante de todo o resto.

Perguntas a fazer no mesmo contato, porque cada uma muda código:

1. **Global API (`docs.globalgetnet.com`, sandbox `api-sbx.globalgetnet.com`) ou API Brasil legada
   (`api.getnet.com.br`)?** Os conceitos são os mesmos; os *paths* não. Ficam em configuração.
2. **Checkout hospedado / Iframe** — o produto que atende a decisão do PI de 23/08 e mantém o PAN
   fora do nosso servidor.
3. **Modo de autenticação do webhook** — HMAC ou mTLS antes de Basic (§9.4).
4. **Ranges de IP do webhook**, para allowlist.
5. **Script de fingerprint antifraude** e o que ele exige de `customer`.

### 9.2 Contrato técnico que entra no adapter da Getnet

- OAuth2 `client_credentials` → `access_token` Bearer, validade ~3600 s, **sem refresh token**:
  cache com renovação antecipada, e `401` reautentica e repete **uma** vez.
- Header `x-seller-id` **por `ProviderAccount`, nunca em variável de ambiente** — env única
  quebraria multi-tenant e a INV-078.
- `idempotency_key` por tentativa de cobrança; retry de rede reutiliza a chave, cobrança nova gera
  outra. Casa com o índice parcial que a F14 já usa.
- `soft_descriptor` (ex.: `ARENA*MENSALIDADE`) reduz contestação.
- **Antifraude é obrigatório em produção**: `customer` completo (nome, e-mail, telefone, **CPF**,
  endereço de cobrança) + `additional_data.device` (`ip_address`, `device_id`, `finger_print`).
  Sem isso a transação é **bloqueada**, com mensagem genérica. Efeito colateral no cadastro em
  §9.5.
- **Monitorar o certificado TLS do nosso endpoint de webhook**: a Getnet para de entregar em
  silêncio quando ele vence.

### 9.3 PIX — conflito aberto com o ADR-032

Os documentos assumem **PIX pela Getnet**; o **ADR-032 decidiu Sicoob**, porque o dinheiro cai
direto na conta da academia. Getnet simplifica a construção (um adapter, um webhook, um extrato) e
encarrega o adquirente do dinheiro; Sicoob é o inverso, e exige mTLS com certificado — **que não
está estudado em lugar nenhum do repositório**.

**Esta fatia não decide isso.** Se mudar, o ADR-032 é reaberto — ADR aceito não se contradiz por
nota nem por spec.

### 9.4 Webhook — Basic Auth não basta sozinho

Os documentos escolhem `user_credentials` (Basic) "pela simplicidade". Basic autentica o
**remetente**, não o **corpo**, e o `MVP-02` §15 exige proteção contra replay. Ordem de
preferência: HMAC (que a coluna `signingSecretEncrypted` já espera) → mTLS → Basic. **Se Basic for
o único modo oferecido**, a compensação é parte do aceite desta fatia: dedup por
`(provider_account_id, external_event_id)` — já existe — **mais `getPaymentStatus` antes de
aplicar qualquer efeito financeiro**.

### 9.5 O que isto obriga fora desta fatia

- **CPF e endereço de cobrança** viram condição para pagar com cartão em produção — e o ArenaHub
  decidiu **CPF opcional** (INV-009/011, F45). A saída proposta é pedir na hora do pagamento, não
  no cadastro: quem paga em espécie ou PIX nunca é incomodado. Detalhe na `SPEC-053` §9.
- **Recorrência:** os documentos propõem o Subscriptions Engine da Getnet no lugar do ciclo que a
  **F14 já entregou**. Custo admitido pelos próprios documentos: **preço de plano imutável**,
  retry da Getnet no lugar do `[0,3,7]` do PI, e uma segunda fonte de verdade de assinatura.
  Recomendação: manter o ciclo no ArenaHub e usar a Getnet como executor de cobrança tokenizada.
  **Decisão do PI; se ele escolher o engine, a F14 é parcialmente refeita e isso exige ADR.**
- **Get Smart / POS Android:** descartado com fundamento (deeplink só é invocável por app Android
  dentro do terminal). Fica no Anexo A dos documentos como cenário futuro.
