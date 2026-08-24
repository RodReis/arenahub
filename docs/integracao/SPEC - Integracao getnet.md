# Especificação de Integração — Getnet (Cartão, PIX e Assinatura)

**Projeto:** Sistema de gestão de academia (API NestJS + admin-web + kiosk + mobile + edge-agent)
**Data:** 2026-08-23
**Status:** Proposta para validação técnica e comercial
**Fontes:** docs.globalgetnet.com (Global API / SEP), getstore.getnet.com.br (Get Smart), developers.getnet.com.br

---

## 1. Sumário executivo

Integração de pagamentos com a Getnet cobrindo três modalidades — **cartão de crédito/débito online**, **PIX (QR Code dinâmico)** e **assinatura recorrente de mensalidade** — consumidas por três canais de frontend (admin-web, mobile, totem), todos orquestrados exclusivamente pelo backend NestJS (`apps/api`).

Decisões já tomadas (validadas com o time em 23/08/2026):

| Decisão | Escolha |
|---|---|
| Pagamento no totem | Totem genérico (PWA). **Somente PIX QR Code** exibido na tela; sem captura de cartão presente no totem |
| Assinatura | Mensalidade recorrente dos alunos via **Subscriptions Engine da Getnet** (cartão tokenizado, ciclo mensal) |
| Situação comercial | A academia possui maquininha Getnet ativa (adquirência presencial) |

> **⚠️ Correção de premissa importante:** ter a maquininha ativa **não** significa que a credencial de e-commerce existe. A adquirência presencial (POS) e a Plataforma Digital/e-commerce são **produtos contratuais distintos** na Getnet. Não é "só gerar key/token no site": é preciso solicitar a habilitação do produto de pagamentos online ao time comercial/Suporte de Integração da Getnet para receber `client_id`, `client_secret` e `seller_id` de sandbox e produção. A própria documentação oficial diz: *"Create your account by contacting the Integration Support team to get your API credentials client_id and client_secret"*. Esse é o **primeiro item do roteiro** (Seção 12) e é bloqueante para tudo.

### 1.1 Sobre os links do portal Get Smart que motivaram esta análise

Os quatro links fornecidos (getstore.getnet.com.br) documentam **outro produto**: desenvolvimento de aplicativos Android que rodam **dentro do terminal POS da Getnet (Get Smart)**, integrando por deeplinks locais (`getnet://pagamento/v3/payment`) e SDK de hardware. Eles **não se aplicam** a este projeto porque:

1. O deeplink só é invocável por um app Android instalado no próprio terminal Getnet — uma PWA Next.js num totem genérico não tem como chamá-lo (o deeplink exige `Intent` Android com extras em `Bundle`).
2. O "Plano de Assinatura" daquele portal é **licenciamento de app para lojistas na Get Store** (cobrança mensal do lojista pelo uso do app), não recorrência de cobrança de clientes finais.

O Anexo A resume o que seria necessário caso, no futuro, vocês decidam colocar um app próprio rodando no terminal Get Smart (cenário de totem = POS Android da Getnet).

---

## 2. Qual API da Getnet usar

A Getnet reorganizou sua documentação. O portal antigo (`developers.getnet.com.br/api`) foi descontinuado e hoje a integração online é documentada como **Global API (Single Entry Point — SEP)** em `docs.globalgetnet.com`, com sandbox em `https://api-sbx.globalgetnet.com`. Ela cobre exatamente o escopo deste projeto:

| Necessidade | Recurso da Global API |
|---|---|
| Cartão crédito/débito online | `POST /dpm/payments-gwproxy/v2/payments` (single-step) |
| Tokenização de cartão | `POST /dpm/cofre-gw-proxy/v1/tokens/card` |
| Cliente (cadastro p/ recorrência) | `POST /dpm/customers-gwproxy/v1/customers` |
| Plano de recorrência | `POST /rpy/be-plan/v1/plans` |
| Assinatura | `POST /rpy/be-subscription/v1/subscriptions` |
| Cobranças da assinatura | `GET /rpy/be-subscription/v1/charges?subscription_id=...` |
| PIX QR dinâmico | Endpoint PIX (APM Brasil) — retorna `qr_code`, `payment_id`, `status`, `generated_at`, `expires_at` |
| Notificações | Webhook Management API (eventos `APPROVED_TRANSACTIONS`, `PIX_UPDATED_TRANSACTIONS`, etc.) |
| Estorno | Refund a Payment (`payment_id`) |

**Ponto a confirmar no onboarding (risco conhecido):** a API legada do Brasil (`api.getnet.com.br`, docs antigas da "Plataforma Digital") ainda opera e alguns contratos brasileiros são provisionados nela (`/v1/payments/credit`, `/v1/payments/qrcode/pix`, `/v1/plans`, `/v1/subscriptions`). Os *paths* mudam, mas os **conceitos e o desenho deste documento são os mesmos** (token → pagamento/assinatura → webhook). Na conversa comercial, pergunte explicitamente: *"o credenciamento e-commerce será na Global API (globalgetnet.com) ou na API Brasil legada (api.getnet.com.br)?"* — e trate os paths desta especificação como configuráveis (Seção 6.4).

### 2.1 Autenticação

- OAuth2 `client_credentials`: `client_id` + `client_secret` → `access_token` Bearer (validade ~3600 s; não existe refresh token — gere outro).
- Headers por requisição transacional: `Authorization: Bearer <token>`, `x-seller-id: <seller_id>`, `content-type: application/json` (e `x-transaction-channel-entry` quando exigido).
- Escopos (`scope`) e canal (`channel`) são definidos no credenciamento; chamada fora de escopo → `403`.
- Erros de auth: `401` = token expirado/credencial errada (renovar e repetir 1x), `403` = escopo, `400` = header ausente.
- **Credenciais nunca saem do backend.** Nenhum app (web, mobile, totem) recebe `client_id`/`client_secret` ou token Getnet.

---

## 3. Arquitetura da integração

```
 admin-web (Next.js)      mobile (RN/Expo)        kiosk (PWA totem)
        │                       │                        │
        └───────────── REST /api/v1 (JWT próprio) ───────┘
                                │
                     ┌──────────▼──────────┐
                     │  apps/api (NestJS)  │
                     │  módulo `billing`   │
                     │  ┌───────────────┐  │        ┌─────────────────────┐
                     │  │ GetnetClient  │──┼── TLS ─►  Getnet Global API  │
                     │  └───────────────┘  │        │  api-sbx / produção │
                     │  Postgres + fila    ◄────────┤  Webhooks (POST)    │
                     └──────────┬──────────┘        └─────────────────────┘
                                │ sync (status catraca/acesso)
                     ┌──────────▼──────────┐
                     │ edge-agent (SQLite) │  ← não participa do pagamento;
                     └─────────────────────┘    só recebe status de adimplência
```

Princípios:

1. **Só o NestJS fala com a Getnet.** Frontends chamam a API interna; a API traduz para a Getnet. Isso centraliza credenciais, idempotência, logs e conciliação.
2. **Webhook é a fonte de verdade do status final**; polling é fallback (`GET` de transação). Nenhum canal marca pagamento como pago por conta própria.
3. **Totem nunca vê dado de cartão.** Exibe QR PIX e acompanha status via SSE/polling da API interna.
4. **Edge-agent fora do fluxo de pagamento.** Ele apenas sincroniza o resultado (aluno adimplente/inadimplente) para liberar catraca offline.

### 3.1 PCI DSS — onde o PAN transita

Na Global API a tokenização é server-side: o PAN (número do cartão) passa pelo seu backend até o endpoint de tokenização. Consequências e mitigação:

- O PAN **nunca é persistido nem logado** (nem em log de request, nem em APM/tracing — mascarar interceptors do Nest).
- Fluxo: frontend envia PAN via TLS → NestJS chama `/tokens/card` imediatamente → armazena apenas `number_token`, `brand`, `last4`, `expiration`. O PAN vive só em memória durante a requisição.
- Isso ainda coloca o backend em escopo PCI (SAQ D). Se quiserem reduzir escopo no futuro, a Getnet oferece **Checkout Iframe** (captura no iframe hospedado, o PAN não toca seu servidor) — fica registrado como alternativa, não como decisão.
- CVV: usado apenas na transação/criação de assinatura, **nunca armazenado** (proibido pelo PCI mesmo criptografado).

---

## 4. Modelagem no NestJS (monólito modular)

Novo módulo `billing` (ou `payments`) em `apps/api`:

```
src/modules/billing/
├── billing.module.ts
├── config/getnet.config.ts            # urls, credenciais, sellerId, flags por ambiente
├── infra/
│   ├── getnet/
│   │   ├── getnet-auth.service.ts     # cache de access_token (renova antes de expirar)
│   │   ├── getnet-http.service.ts     # axios/fetch + retry + timeout + mascaramento de logs
│   │   ├── getnet-payments.client.ts  # cartão, pix, refund, get transaction
│   │   ├── getnet-vault.client.ts     # tokenização / cofre
│   │   └── getnet-subscriptions.client.ts  # customers, plans, subscriptions, charges
│   └── persistence/ (repositórios TypeORM/Prisma)
├── domain/
│   ├── entities/  (payment, subscription, plan-mapping, webhook-event, saved-card)
│   └── enums/     (payment-status, payment-method, channel)
├── application/
│   ├── create-card-payment.usecase.ts
│   ├── create-pix-payment.usecase.ts
│   ├── refund-payment.usecase.ts
│   ├── enroll-subscription.usecase.ts # customer + token + subscription
│   ├── cancel-subscription.usecase.ts
│   ├── sync-charges.usecase.ts        # conciliação diária das cobranças de assinatura
│   └── process-webhook.usecase.ts
└── api/
    ├── payments.controller.ts         # /api/v1/payments...
    ├── subscriptions.controller.ts    # /api/v1/subscriptions...
    └── getnet-webhook.controller.ts   # /api/v1/webhooks/getnet (público, autenticado à parte)
```

### 4.1 Tabelas (Postgres)

```sql
-- pagamentos avulsos (diária, plano avulso, loja, totem)
payment (
  id uuid PK, order_id text UNIQUE,          -- gerado por nós, vai à Getnet p/ conciliação
  member_id uuid NULL, channel text,          -- 'admin' | 'mobile' | 'kiosk'
  method text,                                -- 'credit' | 'debit' | 'pix'
  amount_cents int, currency char(3) DEFAULT 'BRL',
  status text,                                -- máquina de estados (4.2)
  getnet_payment_id text UNIQUE NULL,
  idempotency_key uuid UNIQUE,                -- enviado à Getnet
  qr_code text NULL, qr_expires_at timestamptz NULL,   -- PIX
  authorization_code text NULL, brand text NULL, last4 text NULL,
  failure_code text NULL, failure_message text NULL,
  created_at, updated_at
)

-- cartões salvos (apenas token — nunca PAN/CVV)
saved_card (
  id uuid PK, member_id uuid, getnet_customer_id text,
  number_token text, brand text, last4 text,
  expiration_month char(2), expiration_year char(2),
  cardholder_name text, is_default bool, created_at
)

-- espelho local dos planos Getnet (criados pelo admin)
plan_mapping (
  id uuid PK, local_plan_id uuid,             -- plano comercial do sistema
  getnet_plan_id text UNIQUE, amount_cents int,
  period_type text, billing_cycles int, status text, created_at
)

subscription (
  id uuid PK, member_id uuid, plan_mapping_id uuid,
  getnet_subscription_id text UNIQUE, getnet_customer_id text,
  saved_card_id uuid, status text,            -- created|scheduled|active|past_due|canceled
  installment_start_date date, next_charge_expected date NULL,
  canceled_at timestamptz NULL, created_at, updated_at
)

-- cobranças geradas pelo engine da Getnet (conciliação)
subscription_charge (
  id uuid PK, subscription_id uuid, getnet_charge_id text UNIQUE,
  amount_cents int, status text, charged_at timestamptz NULL,
  payment_id_getnet text NULL, raw jsonb, created_at
)

-- inbox de webhooks (idempotência + auditoria + reprocessamento)
webhook_event (
  id uuid PK, event_type text, getnet_payment_id text NULL,
  dedup_key text UNIQUE,                      -- payment_id+event_type+status (ver 8.3)
  payload jsonb, received_at timestamptz,
  processed_at timestamptz NULL, process_error text NULL
)
```

### 4.2 Máquina de estados de `payment.status`

```
created ──► sent ──► pending ──► approved ──► refunded
              │          │           └──────► partially_refunded (se aplicável)
              │          ├─────────► rejected
              │          └─────────► expired          (PIX não pago no prazo)
              └────────────────────► failed           (erro técnico antes da Getnet aceitar)
```

Regras: transições só via casos de uso; webhook e polling convergem para o mesmo handler (`applyGetnetStatus`), que é idempotente (aplicar o mesmo status duas vezes não tem efeito). Status Getnet→interno: `APPROVED→approved`, `PENDING/PROCESSING→pending`, `REJECTED/FAILED→rejected/failed`, `EXPIRED→expired`, `REFUNDED→refunded`, `CANCELLED→rejected` (ou `canceled` se preferirem distinguir).

---

## 5. Endpoints internos (REST /api/v1)

Todos autenticados pelo JWT do próprio sistema, exceto o webhook. OpenAPI anotado via decorators do Nest.

```
POST   /api/v1/payments/card              # pagamento avulso com cartão
POST   /api/v1/payments/pix               # cria cobrança PIX (retorna qr_code + expires_at)
GET    /api/v1/payments/:id               # status (usado por polling dos fronts)
GET    /api/v1/payments/:id/events        # SSE de status (totem/mobile)
POST   /api/v1/payments/:id/refund        # estorno (role: admin)

POST   /api/v1/members/:id/cards          # tokeniza e salva cartão (retorna last4/brand)
GET    /api/v1/members/:id/cards
DELETE /api/v1/members/:id/cards/:cardId

POST   /api/v1/plans/:id/getnet           # publica plano local na Getnet (role: admin)
POST   /api/v1/members/:id/subscriptions  # adesão: cria assinatura no engine
DELETE /api/v1/subscriptions/:id          # cancelamento
GET    /api/v1/subscriptions/:id/charges  # histórico de cobranças

POST   /api/v1/webhooks/getnet            # receptor de webhooks (Seção 8)
```

Contratos de exemplo:

```jsonc
// POST /api/v1/payments/pix  (kiosk, mobile, admin)
// req
{ "memberId": "…opcional…", "amountCents": 3500, "description": "Diária 23/08" }
// res 201
{ "paymentId": "…", "qrCode": "000201…br.gov.bcb.pix…", "expiresAt": "2026-08-23T18:15:00Z", "status": "pending" }

// POST /api/v1/payments/card  (mobile, admin — nunca kiosk)
// req — PAN transita, não persiste (ver 3.1)
{
  "memberId": "…", "amountCents": 12990, "installments": 1,
  "card": { "number": "…", "expirationMonth": "09", "expirationYear": "30",
            "cardholderName": "FULANO", "securityCode": "123" },
  "saveCard": true,
  "device": { "ipAddress": "auto", "deviceId": "uuid-v4", "fingerPrint": "hash-antifraude" }
}
// res 201
{ "paymentId": "…", "status": "approved", "brand": "MASTERCARD", "last4": "0000", "authorizationCode": "204050" }

// POST /api/v1/members/:id/subscriptions
{ "planId": "plano-local-uuid", "savedCardId": "…", "startDate": "2026-09-01" }
```

---

## 6. Fluxos detalhados

### 6.1 Cartão avulso (mobile / admin-web)

```
Front → API: POST /payments/card (PAN + device fingerprint)
API   → cria `payment` (created) + idempotency_key
API   → Getnet: POST /dpm/payments-gwproxy/v2/payments
        { idempotency_key, order_id, data: { amount, currency:"BRL",
          customer{nome,email,CPF,endereço}, payment{ payment_method:"CREDIT"|"DEBIT",
          transaction_type:"FULL"|"INSTALL_NO_INTEREST"|"INSTALL_WITH_INTEREST",
          number_installments, card{...} | card{number_token}},
          additional_data.device{ip_address, device_id, finger_print} } }
Getnet→ resposta síncrona: status APPROVED/REJECTED/PENDING + payment_id
API   → aplica status, responde ao front
Webhook APPROVED_/REJECTED_TRANSACTIONS confirma/atualiza depois (async)
```

Pontos obrigatórios (documentados pela Getnet):

- `idempotency_key` único por tentativa de cobrança — protege contra duplicidade em retry de rede.
- **Antifraude é obrigatório em produção**: `customer` completo (nome, e-mail, telefone, CPF, endereço de cobrança) + `additional_data.device` (`ip_address`, `device_id` UUIDv4 de sessão, `finger_print` gerado pelo script antifraude da Getnet no frontend). Transação sem isso é **bloqueada automaticamente**. O script/SDK de fingerprint é fornecido no onboarding — incluir no mobile e admin-web.
- Parcelamento: `transaction_type: INSTALL_NO_INTEREST` + `number_installments`.
- `save_card_data` / tokenização: para salvar cartão, tokenizar via `/tokens/card` e guardar só o token (Seção 3.1).
- **Débito online**: em geral exige 3DS (autenticação do portador). Tratar como fase 2; confirmar com a Getnet a exigência de 3DS para débito no seu MCC. Crédito não exige 3DS no Brasil (mas 3DS reduz chargeback — opcional).
- `soft_descriptor`: enviar (ex.: `ACADEMIA*MENSALIDADE`) para reduzir contestação.

### 6.2 PIX (totem, mobile, admin-web)

```
Front → API: POST /payments/pix { amountCents, memberId? }
API   → Getnet: cria cobrança PIX  → { payment_id, qr_code, status, generated_at, expires_at }
API   → grava payment(pending) e devolve qr_code/copia-e-cola + expires_at
Totem → renderiza QR + contador regressivo; abre SSE GET /payments/:id/events
Pagador paga no app do banco
Getnet→ Webhook PIX_UPDATED_TRANSACTIONS → API aplica approved → SSE notifica totem
Totem → tela de sucesso → libera o fluxo (ex.: matrícula/diária/catraca)
```

Regras de resiliência (aprendidas da própria doc Getnet):

- QR tem validade; **pode ser pago mesmo depois de sair da tela** ou de "cancelado" no cliente. Por isso: ao expirar sem webhook, agendar polling de verificação por N minutos antes de marcar `expired`; se o webhook de aprovação chegar depois de `expired`, reverter para `approved` e tratar o pedido (crédito ao aluno / aviso ao operador).
- Timeout de exibição no totem ≠ status final. O status final vem **sempre** da Getnet (webhook ou consulta).
- Fallback sem webhook (ex.: sandbox): job de polling a cada 15–30 s enquanto `pending` e não expirado.

### 6.3 Assinatura de mensalidade (Subscriptions Engine)

Provisionamento (admin-web, uma vez por plano comercial):

```
Admin cria/edita plano local → POST /plans/:id/getnet
API → POST /rpy/be-plan/v1/plans
      { seller_id, name, amount (centavos), currency:"BRL",
        payment_types:["credit_card"], period:{ type:"monthly", billing_cycle: 12 },
        product_type:"service" }
API ← { plan_id, status:"active" } → grava plan_mapping
```

Adesão do aluno (mobile ou admin-web):

```
1. API → POST /dpm/customers-gwproxy/v1/customers   (nome, CPF, email, telefone)
2. API → POST /dpm/cofre-gw-proxy/v1/tokens/card    ({card_number, customer_id} → number_token)
3. API → POST /rpy/be-subscription/v1/subscriptions
        { seller_id, customer_id, plan_id, installment_start_date:"2026-09-01",
          subscription:{ payment_type:{ credit:{ transaction_type:"FULL",
            number_installments:1, card:{ number_token, brand, cardholder_name,
            expiration_month, expiration_year, security_code } } } } }
4. API ← { subscription_id, status:"created", next_scheduled_date, order_id }
5. Engine da Getnet cobra automaticamente todo ciclo (inclui retries de negada)
```

Operação contínua:

- **Conciliação diária** (cron no Nest): `GET /rpy/be-subscription/v1/charges?subscription_id=…` para cada assinatura ativa → upsert em `subscription_charge` → atualizar adimplência do aluno → sync para edge-agent (catraca).
- Cobrança negada: o engine tem retry próprio; a doc manda observações: *"charges em retry com pagamento negado são desconsideradas na validação do período"* e *"o engine só processa assinaturas ativas"*. Nossa régua de inadimplência (bloqueio de catraca, avisos) é disparada pelos status das charges, não por suposição de data.
- Troca de cartão: novo token → atualizar assinatura (endpoint de update — confirmar na API Reference; se não houver, cancelar + recriar com `installment_start_date` preservando o ciclo).
- Cancelamento: `DELETE`/cancel na assinatura + marcar localmente com data-fim.
- Alteração de valor do plano: planos Getnet são imutáveis no valor → criar novo plano + migrar assinaturas (registrar isso na UI do admin para não surpreender).
- Eventos `CARD_UPDATE`/`CARD_UPDATED_TRANSACTIONS` (Account Updater/Network Token): atualizar `saved_card` quando o emissor troca o cartão — reduz churn involuntário.

### 6.4 Configuração por ambiente

```env
GETNET_BASE_URL=https://api-sbx.globalgetnet.com        # prod: fornecida no onboarding
GETNET_AUTH_URL=...                                     # confirmar no onboarding
GETNET_CLIENT_ID=...
GETNET_CLIENT_SECRET=...
GETNET_SELLER_ID=...
GETNET_WEBHOOK_AUTH_MODE=user_credentials|oauth|token
GETNET_PIX_EXPIRATION_SECONDS=900
```

Os paths dos clients ficam em `getnet.config.ts` — se o credenciamento sair na API Brasil legada (Seção 2), muda-se config, não caso de uso.

---

## 7. Especificação por canal

### 7.1 admin-web (Next.js, App Router)

- **Casos de uso:** matrícula com adesão de assinatura; cobrança avulsa (cartão digitado pelo atendente ou PIX QR exibido ao aluno no balcão); estorno; gestão de planos (publicar na Getnet); painel de inadimplência e cobranças; reprocessamento/consulta de webhooks.
- Formulário de cartão: componente client-side, `autocomplete="cc-*"`, máscara, validação Luhn local; POST direto à API interna (nunca à Getnet). Incluir script de fingerprint antifraude e enviar `device` junto.
- Server Components para listagens (pagamentos, charges); mutações via route handlers/actions chamando a API NestJS.
- Estorno com confirmação e motivo; RBAC (só perfil financeiro/gestor).

### 7.2 mobile (React Native + Expo)

- **Casos de uso:** aluno paga mensalidade atrasada, adere ao plano (assinatura), compra avulsos; vê histórico; troca cartão da assinatura.
- Cartão: tela própria; enviar à API interna via TLS; não usar bibliotecas que loguem o payload (cuidado com interceptors de debug); certificate pinning é desejável.
- PIX: exibir QR + botão "copiar código copia-e-cola" (`Clipboard`), polling/SSE do status, deep link de retorno.
- Fingerprint antifraude: SDK/script da Getnet ou, no mínimo, `device_id` UUIDv4 persistido por instalação + IP coletado no backend.

### 7.3 kiosk (PWA no totem)

- **Somente PIX.** Fluxo: identificação (CPF/matrícula/QR do app) → valor (diária, renovação, débito em aberto) → `POST /payments/pix` → tela de QR com contador (usar `expires_at`) → SSE até `approved`/`expired` → recibo na tela (e-mail/push opcional).
- Sem teclado de cartão, sem dados sensíveis: nada de PCI no totem.
- Modo quiosque do totem é responsabilidade do dispositivo/navegador (fullscreen/kiosk do Chrome ou launcher); não confundir com o "Modo Quiosque" do POS Getnet (Anexo A).
- Resiliência: se SSE cair, degradar para polling de 5 s; se a API cair, exibir indisponibilidade e instruir pagamento na recepção — o totem não guarda estado de pagamento.

### 7.4 edge-agent (Node no PC da academia)

- **Não participa do pagamento.** Recebe da API, via sync já existente, o snapshot de adimplência/validade de plano por aluno (SQLite) para decidir catraca offline.
- Ao processar webhook que muda adimplência (mensalidade aprovada, assinatura cancelada, charge negada após retries), a API marca o aluno para o próximo sync — a latência da catraca vira "minutos", não "dia seguinte".

---

## 8. Webhooks Getnet

### 8.1 Endpoint e registro

- `POST /api/v1/webhooks/getnet` — HTTPS válido, responde **204** rapidamente (enfileira e processa async; meta < 500 ms).
- Registro via **Webhook Management API** (criar/listar/excluir subscriptions, ver histórico, reenviar eventos). Uma subscription por ambiente, apontando para stage/prod distintos.
- Eventos a assinar: `APPROVED_`, `REJECTED_`, `PENDING_`, `PROCESSING_`, `FAILED_`, `EXPIRED_`, `CANCELLED_`, `REFUNDED_`, `PIX_UPDATED_TRANSACTIONS`, `CARD_UPDATE`, `CARD_UPDATED_TRANSACTIONS`.

### 8.2 Autenticação do webhook

A Getnet suporta três modos — escolher **`user_credentials` (Basic Auth)** pela simplicidade: geramos um par usuário/senha exclusivo, a Getnet envia `Authorization: Basic …`, o Nest valida com guard próprio (fora do JWT). `oauth`/`token` ficam documentados como alternativa se a política interna exigir Bearer.

### 8.3 Processamento (inbox pattern)

```
Receber → validar auth → gravar em webhook_event (dedup_key = payment_id+event_type+status)
       → 204 imediato → worker processa: applyGetnetStatus + efeitos (SSE, adimplência, sync edge)
```

- **Idempotência**: `dedup_key` UNIQUE; a Getnet **faz retry** de entregas sem 204 — duplicatas são esperadas.
- **Ordem não garantida**: nunca regredir status (ex.: `PENDING` chegando após `APPROVED` é ignorado pela máquina de estados).
- Falha de processamento: `process_error` preenchido + fila com retry/backoff + alerta; reprocessável pelo admin.
- Certificado TLS do endpoint monitorado (a doc avisa: certificado expirado ⇒ entregas param silenciosamente).

---

## 9. Segurança

- Segredos via secret manager/variáveis por ambiente; jamais em repositório; rotação documentada.
- Logs com mascaramento estrutural: `card.number`, `security_code`, `number_token` (interceptor global no Nest + sanitização no client HTTP).
- Rate limiting nos endpoints de pagamento (evitar card testing no formulário do admin/mobile) + bloqueio após N falhas por membro/IP.
- Auditoria: toda ação financeira (estorno, cancelamento de assinatura, republicação de plano) grava ator, timestamp e motivo.
- TLS ≥ 1.2 fim a fim; webhook atrás de WAF/allowlist se a Getnet publicar ranges de IP (perguntar no onboarding).

## 10. Idempotência e conciliação

- **Saída**: `idempotency_key` UUID por tentativa; retry de rede reutiliza a mesma chave; nova cobrança = nova chave. A Getnet também oferece uma Idempotency API dedicada — avaliar no onboarding se cobre os fluxos contratados.
- **`order_id` nosso em tudo** (pagamentos e assinaturas geram `order_id`): é a chave de conciliação com relatórios/extrato Getnet.
- **Conciliação diária** (cron): comparar `payment`/`subscription_charge` locais vs consultas Getnet; divergência gera alerta. Fase 2: consumir relatórios/extrato para conciliação financeira (taxas, agenda de recebíveis).

## 11. Ambientes, testes e observabilidade

- **Sandbox**: `api-sbx.globalgetnet.com`; a Getnet fornece **Postman Collection** e **cartões de teste** para cenários (aprovada, negada, etc.). PIX em sandbox é simulado — validar como o ambiente simula a confirmação (às vezes via endpoint de "pagar" fake ou aprovação automática).
- **Testes automatizados**: unit nos casos de uso com client Getnet mockado (nock/msw); contrato do webhook com payloads reais gravados; e2e em sandbox no CI (smoke: token → pix → polling; cartão de teste → approved; assinatura → created).
- **Métricas/alertas**: taxa de aprovação por método, latência Getnet, webhooks com erro, fila atrasada, assinaturas `past_due`, QRs expirados sem pagamento.

## 12. Roteiro de implementação

| Fase | Entrega | Dependências |
|---|---|---|
| **0. Comercial** | Solicitar habilitação e-commerce à Getnet (Suporte de Integração): credenciais sandbox+prod (`client_id`, `client_secret`, `seller_id`), definição Global API vs API Brasil, chave PIX vinculada, script antifraude, ranges de IP de webhook | — |
| **1. Fundação** | Módulo `billing`, config, `GetnetAuthService` (cache de token), client HTTP com retry/mascaramento, tabelas, máquina de estados | Fase 0 (sandbox) |
| **2. PIX** | `POST /payments/pix`, SSE/polling, webhook receiver + inbox, expiração/reversão | Fase 1 |
| **3. Totem** | Fluxo completo do kiosk (identificação → QR → confirmação), sync de adimplência p/ edge-agent | Fase 2 |
| **4. Cartão avulso** | Tokenização, pagamento crédito (à vista/parcelado), estorno, antifraude/fingerprint no admin e mobile | Fase 1 |
| **5. Assinaturas** | Publicação de planos, adesão (customer+token+subscription), conciliação de charges, régua de inadimplência, cancelamento/troca de cartão | Fase 4 |
| **6. Certificação/Go-live** | Checklist Getnet de produção, testes com cartão real de baixo valor, monitoração, runbook de incidentes | Todas |

**Ordem deliberada:** PIX primeiro — é o fluxo do totem (maior valor de negócio imediato), não exige antifraude/3DS e valida toda a fundação (auth, webhook, estados) com menos risco.

## 13. Riscos e pontos em aberto

1. **Produto contratual indefinido** (Global API vs API Brasil legada) — bloqueia paths finais; mitigado por config (6.4). Resolver na fase 0.
2. **Débito online provavelmente exige 3DS** — deixado para fase posterior; crédito + PIX cobrem o negócio no início.
3. **Antifraude obrigatório em produção** para cartão — sem fingerprint correto, transações são bloqueadas; validar o script no onboarding.
4. **Detalhes do endpoint PIX na Global API** (path exato, campos do request) — a página pública resume só o response; confirmar na API Reference/Postman ao receber acesso.
5. **Update de cartão em assinatura ativa** — confirmar se existe endpoint de update ou se o fluxo é cancelar+recriar.
6. **Sandbox de PIX** — mecânica de simulação de pagamento a confirmar.
7. **Migração de alunos atuais** (se hoje a mensalidade é cobrada na maquininha/dinheiro): plano de migração para assinatura digital é projeto à parte (comunicação + recadastro de cartões — não há como importar cartões sem os portadores).

---

## Anexo A — Cenário descartado: app no terminal Get Smart (referência futura)

Se um dia o totem for um **POS Android da Getnet** (ou houver app próprio na maquininha):

- Integração por **deeplinks** no dispositivo: `getnet://pagamento/v3/payment` (crédito/débito/PIX), `v2/pre-authorization`, `v1/refund`, `v1/reprint`, `v1/getinfos`, `v1/checkstatus`. Parâmetros via `Bundle` (strings): `paymentType` (`credit|debit|voucher|pix`), `amount` (12 dígitos, 2 decimais), `callerId` (UUID obrigatório no v3, usado no Consulta Status), `orderId` (conciliação), retornos `result`, `nsu`, `cvNumber`, `authorizationCode`, `brand`, `inputType`, `pixPayloadResponse` etc.
- Exige app **Android nativo/React Native** (não PWA), SDK de hardware obrigatório (`libposdigital` .aar + service .apk por fabricante — TecToy Sunmi P2/P3, Ingenico DX8000, Gertec GPOS 790s), simulador "Rebatedor" para dev, certificação obrigatória em **todos** os modelos de terminal, publicação via Get Store com Plano de Assinatura (licença do lojista, com comissão Getnet).
- O terminal tem "Modo Quiosque" nativo (`<meta-data android:name="kiosk_mode" android:value="1"/>`): um único app, tela sempre ativa, protegido por senha — é isso que a Getnet oferece para totens de autoatendimento com cartão presente.
- PIX no POS: somente via deeplink Pagamento v3 (integrações PIX por fora são reprovadas na certificação).

## Anexo B — Referências

- Global API (SEP), visão geral: https://docs.globalgetnet.com/pt/products/online-payments/regional-api
- Single-Step Payment: …/regional-api?doc=create-single-step-payment
- Subscriptions Engine: …/regional-api?doc=recurring-payments-engine
- PIX (Brasil): …/regional-api?doc=pix-payment
- Webhooks: …/regional-api?doc=webhook-how-it-works
- Portal do Desenvolvedor (novo): https://developers.getnet.com.br — Plataforma Digital: Link de Pagamento, Checkout Iframe, Idempotência, Marketplace
- Get Smart (POS) — visão geral pagamento: https://getstore.getnet.com.br/docs/integracao-pagamento/visao-geral/
- Get Smart — deeplinks: https://getstore.getnet.com.br/docs/integracao-pagamento/como-realizar-integracao/ e …/pagamento-deeplink/
- Get Smart — hardware/SDK: https://getstore.getnet.com.br/docs/integracao-hardware/visao-geral/
- Get Smart — Planos de Assinatura (licença de app): https://getstore.getnet.com.br/docs/portal-desenvolvedor/plano-assinatura/
- Get Smart — PIX no POS: https://getstore.getnet.com.br/docs/integracao-pagamento/pix/ · Modo Quiosque: …/modo-quiosque/
