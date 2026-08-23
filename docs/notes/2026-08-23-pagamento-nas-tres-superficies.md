# Pagamento do aluno nas três superfícies — recorte de 23/08/2026

> **Nota de planejamento do Cowork.** Escopo pedido pelo PI em 23/08/2026: controle de pagamento
> no `admin-web` (recepção e gestão), no `kiosk` (totem) e no `mobile` (app do aluno).
> **Não é contrato**: onde divergir do PRD, do `CONVENTION.md` ou de ADR aceito, eles vencem.
> As fatias que este documento cria estão no *Índice Fatia ↔ SPEC* do `docs/STATUS.md`.

---

## 1. O pedido, e por que ele não é uma fatia

O PI pediu, textualmente: *"analise e planeje a parte de pagamento dos alunos na academia
(frontend acho!), através do Web-admin (recepcionista), totem (aluno) e mobile (aluno)"* — com
pagamento por cartão (Getnet) e PIX (Sicoob), controle de inadimplentes, dashboard de pagamentos
para o admin e notificação de vencimento e atraso nas três telas.

**Três das quatro coisas pedidas não são frontend**, e é isso que muda o tamanho do trabalho:

| pedido | o que existe hoje | o que falta, e de quem é |
|---|---|---|
| pagamento por PIX e cartão | backend inteiro do MVP 2 entregue (F12–F16) | **os adapters reais de Sicoob e Getnet não existem** — tudo roda contra `FakePaymentProvider` |
| controle de inadimplentes | `/billing/delinquency` entregue na F15, com aging, badge de acesso e link `wa.me` | quase nada; ver §5 |
| dashboard de pagamentos | nada | endpoint de agregação **novo** + tela |
| notificação de vencimento e atraso | nada | módulo de notificação **inteiro**: sem tabela, sem preferência, sem provedor, sem job |

**Nenhuma superfície de aluno existe.** `apps/mobile` e `apps/kiosk` são pastas vazias — sem app
Expo, sem PWA, sem login de aluno, sem sessão. "A tela de pagamento do totem" não é uma tela: é a
quarta fatia de uma superfície que ainda não tem a primeira.

---

## 2. Decisões do PI em 23/08/2026

Quatro perguntas apresentadas, quatro respostas:

1. **Escopo agora:** `admin-web` na fila do MVP 3 e **totem no MVP 3.5** (F49–F52, já alocadas).
   Mobile fica no MVP 4.
2. **Dashboard:** **painel financeiro gerencial (KPIs)** — leitura, sem ação. A esteira de
   cobrança (régua de contato, promessa de pagamento, histórico de quem falou com quem) **não
   entra**: é CRM de verdade e pertence à F38, no MVP 6.
3. **Cartão:** **totem só PIX; cartão fica no mobile.** Isto **confirma** o `MVP-04` §7 Slice 4.6
   — que já previa apenas PIX e QR — em vez de emendá-lo. Nada a mudar no PRD.
4. **Notificação:** **aviso in-app agora, WhatsApp na cobrança.** Push nativo não entra.

---

## 3. O que já está pronto e não vai ser refeito

- **Ficha financeira do aluno** (`/students/[id]/billing`) — invoices, itens, pagamentos,
  gerar PIX, baixa manual, entitlement.
- **Inadimplência** (`/billing/delinquency`) — resumo, faixas de atraso, chips de motivo, badge
  de acesso com *liberação vence bloqueio*, link `wa.me` com mensagem pronta.
- **Conciliação** (`/billing/reconciliation`) — fila de divergência e resolução auditada.
- **API do MVP 2** — PIX, cartão tokenizado, recorrência com retry D+0/D+3/D+7, inadimplência,
  estorno, conciliação, recibo, webhook idempotente.

**O WhatsApp que o PI pediu já existe**, e existe do jeito certo: `linkDeCobranca` abre o
WhatsApp *do operador*, com texto curto e **sem valor em reais** — decisão do PI em 19/08. API
oficial exigiria provedor, template homologado e consentimento de contato; continua sendo fatia
própria e continua fora.

---

## 4. F53 — Pagamentos e cobrança no balcão (`admin-web`)

**Problema.** Hoje o dinheiro só é visível **por aluno**. A recepcionista que atende alguém no
balcão precisa saber o nome antes de saber que existe uma fatura; e não há tela nenhuma que
responda *"o que entrou hoje"* ou *"o que vence esta semana"*.

**Escopo.**

- **Backend:** `GET /api/v1/invoices` — lista do tenant com filtro por status, período, unidade,
  aluno e método, ordenação e paginação. O `MVP-02` §13 **já prevê este endpoint** e ele nunca
  foi implementado: existem só `GET /students/:id/invoices` e `GET /invoices/:id`.
- **Tela `/billing/invoices`:** lista com busca por aluno, filtros persistentes na URL, badge de
  estado pelo dicionário do `DS-PAINEL` §7, valores em `tabular-nums`.
- **Cobrança no balcão:** a partir da linha — gerar PIX (QR na tela do painel, aluno lê com o
  próprio celular), copia-e-cola, registrar pagamento manual, abrir o recibo, disparar o link
  `wa.me`. Todas as ações já têm endpoint; o que falta é o caminho de uma tela só.
- **Recibo:** `POST /payments/:id/receipt` e `GET /receipts/:id` existem e **nenhuma tela os
  chama**. Entra a visualização e a impressão.
- **Aviso in-app de vencimento e atraso:** faixa na ficha do aluno e marca na lista, derivada de
  `dueAt`, `blockAt` e `status` — dado que já está na resposta. **Sem infra nova, sem tabela.**

**Fora do escopo.** Estorno em massa, edição de invoice paga (proibida por `M2-BR-002`),
qualquer registro de contato com o aluno.

**Aceite.** A recepcionista atende alguém que chegou sem saber o próprio status: acha a fatura
pela busca, gera o PIX, vê a confirmação chegar e imprime o recibo — **sem abrir a ficha do
aluno e sem editar banco**.

---

## 5. F54 — Painel financeiro gerencial (KPIs)

**Escopo.**

- **Backend:** `GET /api/v1/billing/summary?from&to` — recebido no período, a receber, vencido,
  taxa de inadimplência, ticket médio, quebra por método (PIX / cartão / manual) e série por
  período de competência. Agregação no banco, **não em memória do Node**.
- **Tela `/billing`:** cartões de KPI, composição da dívida por faixa de atraso e evolução.
- **Permissão:** proposta de reusar **`billing.manage`** — quem configura o financeiro é quem vê
  o consolidado do tenant. **Não invento permissão nova sem o PI**; se ele quiser separar leitura
  gerencial de configuração, vira `billing.dashboard` e é decisão dele.

**O risco que esta fatia tem de tratar, e que já derrubou um gráfico antes.** O `STATUS.md` de
19/08 registra, sobre a F15: *"não há evolução mensal no gráfico: o sistema tem um mês de dado, e
uma linha com um ponto mentiria"*. Continua valendo — e piora num painel que existe para comparar
períodos. **Série com menos de três pontos não vira linha**: vira estado explícito de "dado
insuficiente". O mesmo para taxa de inadimplência sobre uma base de 340 alunos ativos recém
importados: percentual sobre base em formação é número bonito e falso.

**Aceite.** O gestor abre o painel, escolhe o período e lê quanto entrou, quanto falta e quanto
está vencido — com **ausência de dado aparecendo como ausência**, nunca como zero.

---

## 6. Totem — nada novo, e a ordem não muda

O pagamento no totem **já é a F52** (`SPEC-052`, MVP 3.5), aprovada pelo PI em 22/08. A ordem do
ADR-042 é obrigatória e não é burocracia:

```
F49 (kiosk seguro, sessão efêmera)  →  F50 (KioskConfig e publicação)  →  F51 e F52 em paralelo
```

Sem a F49 não há sessão que apague o dado do aluno anterior; sem a F50 não há configuração que a
F52 leia — e a **Decisão 0 do ADR-042** manda que nenhuma tela do `kiosk` nasça com valor fixo.
Fazer a tela de pagamento antes disso é exatamente o retrabalho que o ADR foi escrito para evitar.

**O que a decisão de hoje acrescenta à F52**, sem mudar o escopo dela:

- **PIX apenas.** Nada de cartão, nada de teclado numérico de PAN em área pública.
- **Aviso de vencimento respeita o `DS-TOTEM` §10 regra 1:** a etapa de situação diz que **há**
  pendência e o que fazer; **valor e detalhe só depois de ação deliberada do aluno**. Na tela
  pública (hero), pendência financeira não aparece de forma nenhuma — `M4-BR-007` e
  `DS-TOTEM` §11.
- **Confirmação vem do backend**, nunca do retorno visual do checkout (`M2-BR-004`).

---

## 7. Mobile — fora, e por quê

Cartão do aluno é a **F25** (`SPEC-025`, Slice 4.3), que depende da **F23** (shell e login) e da
**F24**. Nada disso existe: `apps/mobile` está vazia. Planejar a tela de pagamento do app hoje
seria escrever spec para uma superfície sem identidade — o mesmo erro que produziu onze telas do
painel sem design system (F42 e F46).

---

## 8. O risco que atravessa tudo, e não é frontend

**Nenhum dos dois provedores está integrado.** O `STATUS.md` de 19/08 registra: *"os adapters
reais não foram escritos: dependem de credencial e sandbox"* e *"a assinatura de webhook não está
confirmada em nenhum dos dois — não bloqueia F14, bloqueia dinheiro real em produção"*.

Consequência prática: **F53, F54 e F52 podem ser construídas e testadas inteiras contra o
`FakePaymentProvider`** — e nenhuma delas coloca um centavo real na conta da Arena Positiva. O
que separa a tela do dinheiro é credencial de Sicoob e Getnet, sandbox e assinatura de webhook
verificada. **Isso é insumo do PI, não código**, e é o único item desta lista que ninguém pode
começar sem ele.

---

## 9. O que ainda depende do PI

1. **Token de MVP das fatias novas.** O PI respondeu *"Web-admin MVP 3"* — que é **posição na
   fila**, não conteúdo: F53 e F54 são Smart Billing (`MVP-02` §7). Os cards vão nascer com
   `[MVP3]` conforme a resposta; se ele quiser `[MVP2]`, é um rename de título.
2. **Permissão do painel gerencial** — reusar `billing.manage` ou criar `billing.dashboard`.
3. **Credenciais de Sicoob e Getnet** — §8.

---

## 10. Emenda de 23/08/2026 — segunda rodada com o PI

O PI revisou o recorte no mesmo dia. **O que muda em relação às §4 a §7 acima:**

| # | decisão | efeito |
|---|---|---|
| 1 | **No balcão o aluno escolhe: dinheiro, PIX ou cartão** | a §4 falava de PIX e baixa manual; cartão entra |
| 2 | **Cartão no balcão é checkout hospedado da Getnet**, digitado no celular do aluno | nenhum campo de cartão no painel; INV-098 preservado sem esforço |
| 3 | **Cartão no totem, por QR de checkout no celular do aluno** | **inverte** a decisão 3 da §2 (*"totem só PIX"*) |
| 4 | **No totem não há baixa manual nem `wa.me`** — a baixa é automática por webhook | não há operador no totem; a §6 fica assim |
| 5 | **Base de cálculo do painel gerencial: o plano em que o aluno está matriculado** | `PlanPrice` das assinaturas `ACTIVE`, não a soma das invoices |
| 6 | **Permissão do painel gerencial: `admin`** | ver `SPEC-054` §4 — no ArenaHub permissão é capacidade nomeada, e a spec propõe `billing.dashboard` |
| 7 | **Adapters reais de Sicoob e Getnet, e as chaves em `Configuração → Pagamento`** | vira a **F55**, separada da F53 |
| 8 | **`docs/specs/` reaberto** | `SPEC-053`, `SPEC-054` e `SPEC-055` escritas; `CLAUDE.md` e `docs/specs/README.md` emendados |

### 10.1 Duas coisas registradas contra o pedido

**"Nada de fakePay" não é executável ao pé da letra.** O `FakePaymentProvider` é dublê de
boundary exigido pelo **ADR-017** e pelo `TESTING.md` §3 — é ele que permite testar webhook
duplicado, evento fora de ordem, falha do provedor e estorno assíncrono sem depender da rede de um
banco. Apagá-lo derruba a suíte que protege o financeiro. **O que muda é a seleção:** o `useClass`
fixo de `billing.module.ts` vira roteamento por `ProviderAccount.capability` (`PIX` → Sicoob,
`CARD` → Getnet), e o fake fica em teste e em ambiente sem credencial. Detalhe na `SPEC-055` §2.

**Cartão no totem amplia o `MVP-04` §7 Slice 4.6**, que prevê apenas PIX e QR. A emenda de PRD que
isso exige **não é do Cowork**: o ADR-021 só autoriza materializar decisão já registrada em ADR
aceito, e esta não está. Ou vira ADR, ou o texto do PRD é escrito pelo Code/PI. **Enquanto isso, a
decisão vive aqui e no `STATUS.md`** — e a F52 não pode ser executada com duas versões da mesma
Slice em circulação.

### 10.2 O que a decisão 3 exige do totem, e que a `SPEC-052` vai ter de honrar

- **Nenhum número de cartão é digitado na tela do totem.** O QR leva o aluno ao checkout
  hospedado, no celular dele.
- **Valor continua escondido até a ação deliberada** (`DS-TOTEM` §10 regra 1); na tela pública
  (hero), pendência financeira não aparece de forma nenhuma (`M4-BR-007`).
- **O totem acompanha a confirmação sem prolongar a sessão** — e a sessão encerra limpando tudo
  (`DS-TOTEM` §11 regra 11).
