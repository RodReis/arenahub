# Trocar plano de assinatura ativa preservando histórico

- **Data:** 30/09/2026
- **Origem:** issue #420, decisão do PI em 27/09/2026
- **Status:** rascunho, brainstorming com o Code em 30/09/2026
- **Fatia/SPEC:** `F82` / `SPEC-082` — issue #420

## 1. Problema

O caminho correto para trocar o plano de uma assinatura `ACTIVE` hoje é manual e **não atômico**:
cancelar (`POST /subscriptions/:id/actions` com `action: CANCEL`) e depois criar (`POST
/subscriptions`), duas chamadas HTTP separadas. O comentário em `apps/admin-web/app/actions/membership.ts`
(linhas 357-404) já documenta o risco: se a segunda falhar, o aluno fica **sem plano** até a
recepção tentar de novo — erro visível, mas não inexistente.

Três casos reais de cadastro de plano errado (Maria Jose Clemente, Julio Cesar de Toledo Junior,
Mercedes Maria de Queiroz — achados do levantamento de 26/09/2026) esperam por esse caminho.

**Sucesso:** trocar o plano de uma assinatura ativa numa operação atômica só, sem janela em que o
aluno fica sem direito de acesso, preservando a timeline e sem script ad-hoc contra produção.

## 2. Decisão do PI (27/09/2026)

Fatia única com o fluxo completo: trocar plano de assinatura ativa preservando histórico. Cobre os
3 casos concretos e o que a tela vai precisar toda vez que o cadastro de plano estiver errado.

## 3. Contexto do código atual

- `MembershipRepository.alterarAssinatura` (linha 818) já tem o padrão de referência: trava
  otimista por `version` (INV-061), transação única, propaga o estado da `Subscription` para o
  `Entitlement`, grava `StudentTimelineEvent` + `AuditLog` + `OutboxEvent`.
- `MembershipRepository.ativarAssinatura` (linha 653) mostra como o `Entitlement` nasce: `encontrarPlano`
  valida o plano e suas janelas de acesso, `montarSnapshotDePolitica` monta o snapshot copiado
  (regra de arquitetura nº1 — o entitlement nunca lê o plano ao vivo depois de criado).
- `POST /subscriptions/:id/actions` com `CANCEL` já revoga o `Entitlement` associado na mesma
  transação — não existe risco de acesso "sobrevivendo" à assinatura cancelada.
- A UI atual (`atribuir-plano.tsx` + `membership.ts` linha 357-438) já implementa a troca como
  duas chamadas sequenciais, com o risco de falha parcial documentado em comentário. Esta fatia
  substitui esse caminho.
- `InvoiceStatus` já tem `CANCELLED` (schema.prisma linha 3380) — cancelar a invoice pendente da
  assinatura antiga não exige estado novo, só uma transição de campo.

## 4. API e domínio

### 4.1 Escrita — `POST /api/v1/subscriptions/:id/trocar-plano`

```ts
{
  planId: string        // plano destino
  version: number        // versão esperada da Subscription atual (concorrência otimista)
  reason: string          // min 3, max 300 — mesma regra de `esquemaDeAlteracao`
}
```

Resposta: `{ subscriptionId: string; entitlement: EntitlementDto }` — mesmo formato de
`ativarAssinatura`, para a ficha reusar o parser que já tem.

### 4.2 Caso de uso — `trocarPlanoDaAssinatura`

Uma `$transaction` só:

1. `updateMany` da `Subscription` atual, `where: { id, tenantId, version: versaoEsperada, status: 'ACTIVE' }`
   → `status: 'CANCELLED'`. `count === 0` → `ConflitoDeVersaoError` (mesmo padrão de `alterarAssinatura`).
   Só aceita origem `ACTIVE` — trocar uma assinatura já `PAUSED`/`CANCELLED` não é este caso de uso.
2. `encontrarPlano` do plano destino + `montarSnapshotDePolitica` (mesmo de `ativarAssinatura`).
   Falha aqui (plano não existe, sem janela) reverte a transação inteira — a assinatura antiga
   nunca fica cancelada sem substituta.
3. Cria `Subscription` nova: mesmo `studentId`, `planId` destino, `status: 'ACTIVE'`,
   `startsAt: agora`, `endsAt` herdado da assinatura antiga (mesma vigência — trocar plano não
   estende nem encurta o contrato).
4. Cria `Entitlement` novo com o snapshot do plano destino (igual `ativarAssinatura`).
5. Revoga o `Entitlement` da assinatura antiga: `status: 'REVOKED'`, `revokedAt: agora` —
   `updateMany where subscriptionId: antiga, status notIn [REVOKED, EXPIRED]` (mesmo filtro de
   `alterarAssinatura`).
6. Cancela a invoice pendente da assinatura antiga, se houver: `updateMany where subscriptionId:
   antiga, status in [OPEN, OVERDUE]` → `status: 'CANCELLED'`. **Sem reemissão automática** — a
   próxima cobrança sai do ciclo normal, já no plano novo, na competência seguinte.
7. `StudentTimelineEvent` (`SUBSCRIPTION_PLAN_CHANGED`, payload com `fromSubscriptionId`,
   `toSubscriptionId`, `fromPlanId`, `toPlanId`), `AuditLog` (`subscription.plan_changed`),
   `OutboxEvent` (`SubscriptionPlanChanged`, mesma forma dos outros eventos de assinatura).

### 4.3 Por que não reaproveitar `alterarAssinatura`

`alterarAssinatura` muda o **estado** da mesma assinatura (PAUSE/RESUME/CANCEL). Trocar plano
**cria uma assinatura nova** — `planId` é imutável numa `Subscription` existente (decisão
implícita do schema atual: não há `update` de `planId` em nenhum caminho hoje). Forçar isso em
`alterarAssinatura` misturaria dois conceitos (transição de estado vs. substituição de entidade)
no mesmo método, e o `action` enum teria que virar `'PAUSE' | 'RESUME' | 'CANCEL' | 'CHANGE_PLAN'`
com uma forma de corpo totalmente diferente (`planId` só faz sentido em `CHANGE_PLAN`). Caso de
uso separado, mesmo padrão interno.

## 5. Frontend

- `atribuir-plano.tsx` ganha o modo "trocar plano": quando a ficha já tem assinatura `ACTIVE`, a
  ação vira uma chamada só a `POST /subscriptions/:id/trocar-plano`, no lugar das duas chamadas
  atuais (CANCEL + POST).
- `membership.ts`: a função que hoje faz `substituiSubscriptionId` como duas chamadas passa a
  fazer uma. O comentário de risco (linhas 357-404) é removido — o risco que ele documenta deixa
  de existir.
- Tela: "Trocar plano" ao lado de Pausar/Retomar/Cancelar na ficha da assinatura (pedido da
  issue) — fora de escopo desta fatia se a ficha de ações (Pausar/Retomar/Cancelar) ainda não
  tiver UI própria; neste caso o fluxo de troca entra só pelo formulário de atribuição de plano
  que já existe, reusando o modo "trocar" que `atribuir-plano.tsx` já implementa.

## 6. Fora de escopo

- Migração retroativa em massa de assinaturas com plano errado (é conciliação de dado, issue #421/#419).
- Proporcionalidade ou desconto na troca — preço cheio do plano novo a partir de `agora`.
- Mudar `startsAt`/`endsAt` da vigência contratual — só o plano muda.
- Reemitir automaticamente a invoice cancelada no valor do plano novo — a próxima cobrança segue
  o ciclo normal (`rodar-ciclo-de-assinaturas.use-case.ts`).

## 7. Critérios de aceite

- [ ] Trocar plano de assinatura `ACTIVE` sem perder histórico — timeline registra
      `SUBSCRIPTION_PLAN_CHANGED` com `fromSubscriptionId`/`toSubscriptionId`.
- [ ] Entitlement pós-troca reflete o plano novo (snapshot, `source: SUBSCRIPTION`).
- [ ] Entitlement antigo revogado na mesma transação — nunca coexiste com o novo.
- [ ] Invoice pendente da assinatura antiga cancelada, sem ficar órfã.
- [ ] Conflito de versão (`version` desatualizada) recusa com o mesmo erro de `alterarAssinatura`.
- [ ] Trocar plano de assinatura que não está `ACTIVE` (`PAUSED`, `CANCELLED`) recusa.
- [ ] Os 3 casos concretos (Maria Jose Clemente, Julio Cesar, Mercedes Maria de Queiroz)
      corrigíveis pela tela, sem script ad-hoc.
- [ ] Tela `atribuir-plano.tsx` usa a rota nova no lugar das duas chamadas atuais.
