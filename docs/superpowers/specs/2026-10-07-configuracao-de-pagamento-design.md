# Configuração > Pagamento: dia de gerar, vencimento e bloqueio configuráveis

- **Data:** 07/10/2026
- **Origem:** pedido do PI na conversa de 07/10/2026 (brainstorming), depois da F88
- **Status:** desenho aprovado pelo PI em 07/10/2026; spec aguardando revisão
- **Fatia:** `F89` / `SPEC-089`. Número conferido por grep em 07/10/2026: último alocado é `F88`/`SPEC-088`.
- **MVP:** MVP2 (cobrança)
- **Card:** #624

## 1. Problema

A F88 deixou três parâmetros do ciclo de cobrança fixos para todo mundo:

| Parâmetro | Hoje | Onde mora |
|---|---|---|
| Dia de gerar a parcela do mês | 01 | cron `5 0 1 * *` no código (`gerar-faturas-do-mes-scheduler.service.ts`) |
| Dia do vencimento | 10 | `BillingSettings.dueDay` (já existe, por tenant) |
| Dias de bloqueio após o vencimento | 5 | `BillingSettings.graceDays` (já existe, por tenant) |

O dono da academia não consegue mudar nenhum deles. `dueDay` e `graceDays` só mudam por SQL ou script. O dia de
gerar nem é configuração: é a expressão do cron.

**Sucesso:** o dono abre **Configuração > Pagamento**, vê os valores do job atual (1, 10, 5), muda o que quiser e as
**próximas** parcelas nascem, vencem e bloqueiam conforme o novo valor. Nenhuma parcela já aberta é tocada.

## 2. Decisões do PI (07/10/2026)

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | Quais parâmetros | Dia de gerar (inteiro), dia do vencimento (inteiro) e dias de bloqueio após o vencimento (inteiro). |
| 2 | Onde fica | Menu **Configuração**, aba **Pagamento**. |
| 3 | Valores iniciais | Os do job atual: gerar dia 1, vencer dia 10, bloquear 5 dias depois. O exemplo "3 dias" do pedido foi só exemplo. |
| 4 | Efeito sobre parcelas já abertas | **Só parcelas futuras.** Parcela aberta mantém vencimento e `blockAt` com que nasceu. |

## 3. Decisões técnicas (minhas, a corrigir se erradas)

| # | Decisão | Por quê | Custo se errada |
|---|---------|---------|-----------------|
| R1 | Limites: gerar e vencer entre 1 e 28; bloqueio entre 1 e 30. | Dia 29–31 não existe em todo mês. Bloqueio 0 bloquearia à meia-noite do próprio dia do vencimento. | Mudar a constante e o `CHECK`. |
| R2 | Dia de gerar ≤ dia de vencer. | Senão a parcela nasce já vencida. | Remover um `CHECK`. |
| R3 | Escopo por **tenant**, não por unidade. | `BillingSettings` já é por tenant. | Migration nova. |
| R4 | Permissão nova `billing.settings.manage`, só do OWNER (fora do MANAGER). | O Financeiro tem `billing.manage` e não deve mudar a regra de cobrança da academia. | Mover a permissão de papel. |
| R5 | O cron do gerador roda **todo dia** às 00:05 de Brasília e cada tenant só gera se o dia de hoje for o seu `invoiceGenerationDay`. Continua sem recuperar dia perdido. | Mantém a regra "todo dia X" literal, sem gerar fatura retroativa. A rota manual `POST billing/monthly-invoices/run` cobre a falha. | Trocar `==` por `>=` e já recupera. |
| R6 | Rótulo da UI: "Dias de bloqueio após o vencimento". | `graceDays` do **contrato da plataforma** é outra coisa (suspensão do tenant) e confunde. | Só texto. |
| R7 | O `CHECK` de banco de `grace_days` é `BETWEEN 0 AND 30`; o mínimo de 1 vale na API. | Há teste de integração com tenant sem carência (`graceDays: 0`) e o domínio já aceita 0. | Apertar o `CHECK` numa migration nova. |

## 4. Desenho

### 4.1 Dados

- `BillingSettings` ganha `invoiceGenerationDay Int @default(1) @map("invoice_generation_day")`.
- Migration aditiva. Backfill automático pelo `DEFAULT 1`: toda linha existente fica com 1, e produção já tem
  `due_day = 10` e `grace_days = 5`. A tela abre exatamente com os valores do job atual.
- `CHECK` no banco para R1 e R2:
  `invoice_generation_day BETWEEN 1 AND 28`, `due_day BETWEEN 1 AND 28`, `grace_days BETWEEN 0 AND 30`,
  `invoice_generation_day <= due_day`. A migration confere antes que nenhuma linha existente viola (produção
  não viola; um teste de migração cobre).

### 4.2 API

- `GET /api/v1/billing/settings` (`billing.read`) devolve `{ invoiceGenerationDay, dueDay, graceDays }`.
- `PUT /api/v1/billing/settings` (`billing.settings.manage`) recebe os três inteiros.
  - Zod no boundary com R1 e R2; erro de validação sai como `application/problem+json` com código estável.
  - Grava `audit_log` `billing.settings_updated` com valor antigo e novo.
  - **Não toca em nenhuma `Invoice`.** O `blockAt` continua congelado na abertura.
- `OpenAPI` atualizado e o snapshot regenerado.

### 4.3 Cron

- `GerarFaturasDoMesScheduler`: `@Cron('5 0 * * *', { timeZone: 'America/Sao_Paulo' })`, por tenant, dentro de
  `comContexto`. Lê `invoiceGenerationDay` e só chama o caso de uso se o dia de hoje (Brasília) for igual.
- O caso de uso `GerarFaturasDoMesUseCase` não muda, só o gatilho.
- Inadimplência (`10 0 * * *`) não muda: já lê `graceDays` por tenant.
- Log por tenant continua `criadas`, `jaExistiam`, `falhas`.

### 4.4 Admin-web

- Item **Configuração** na navegação do painel, com rota `/configuracao` e abas. Só **Pagamento** nesta fatia.
- Aba Pagamento: três campos numéricos, texto de ajuda e **exemplo ao vivo** (com a configuração digitada):
  "Parcela de nov/26: gerada em 01/11, vence em 10/11, catraca bloqueia em 15/11 às 00:00".
- Salvar com Server Action; sucesso e erro em **toast** (nunca `alert`); erro de validação inline por campo.
- Quem não tem `billing.settings.manage` vê os valores em leitura, sem botão de salvar.
- Segue `docs/design/DS-PAINEL.md`: tokens, sem hex literal.

## 5. Efeito em produção

- Nenhuma mudança de comportamento no deploy: os valores iniciais são os do job atual (1, 10, 5).
- A mudança do dono vale a partir da **próxima** parcela gerada. Parcelas abertas (hoje 339) seguem como estão.
- O gerador deixa de depender do dia 01 fixo do cron, mas com default 1 o resultado é o mesmo.

## 6. Documentação

`CONVENTION.md` (INV-164 emendada: dia de gerar, vencimento e bloqueio configuráveis por tenant), `STATUS.md`
(índice F89), `DEVELOPMENT.md`, `TESTING.md`/`TESTS.md`.

## 7. Testes

- **Unit:** validação (limites e `gerar ≤ vencer`); decisão "hoje é o dia de gerar do tenant?" com o "agora"
  por parâmetro, incluindo dia 28 e virada de mês.
- **Integração:** `PUT` exige a permissão; recusa valor fora do limite e `gerar > vencer`; grava auditoria com
  antigo e novo; **fatura aberta não muda** depois de salvar; o gerador de dois tenants com dias diferentes cria só
  no dia certo de cada um; os `CHECK` do banco recusam escrita direta inválida.
- **E2E:** abrir Configuração > Pagamento, ver 1/10/5, mudar e salvar, ver o toast e o exemplo atualizado.

## 8. Fora do escopo

- Reaplicar a nova configuração às parcelas já abertas (decisão #4).
- Configuração por unidade ou por plano.
- Outras abas de Configuração (só a estrutura de abas nasce aqui).
- Dia útil / feriado no vencimento (ADR-019: sem adiar por feriado).
