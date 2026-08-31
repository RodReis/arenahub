# SPEC-036 — Contrato de dados e baseline analítica

| campo | valor |
|---|---|
| **Fatia** | F36 |
| **MVP** | 6 |
| **Slice do PRD** | **6.1** — `docs/prd/academia/MVP-06-retention-ai.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-06-*` (índice + planos por slice) |
| **Status** | `em execução` (31/08/2026) |
| **ADRs que bloqueiam** | nenhum |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M6-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 6.1. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> **Destravada em 31/08/2026 por decisão do PI.** O gate do MVP 6 (≥ 6 meses de histórico)
> **não alcança esta fatia**: ele existe para o *score* (F37+), e sem o snapshot as-of os seis
> meses nunca começam a contar — o histórico só passa a ser reconstruível depois que alguém
> grava o contrato de dados.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-06-retention-ai.md` §7, Slice 6.1, e o plano de apoio acima.

## 2. Decisões específicas desta fatia

**1. Aceite relaxado — decisão do PI, 31/08/2026.**
Perguntei ao PI se implementava só a fundação as-of, a fatia inteira reconstruindo o passado do
estado atual, ou se adiava. O PI escolheu **a fatia inteira**. Levantei que reconstruir do estado
corrente envenena o treino da F40 (`M6-FR-003`: a feature carrega o futuro, acerta no backtest e
erra em produção); o PI reafirmou, e a decisão vale.

**Como isso foi mitigado sem contrariar a decisão:** ao investigar as fontes, **doze das treze
features saem as-of de verdade** — o schema guarda mais história do que a leitura superficial de
`Invoice.status`/`Subscription.status` sugere:

| origem imutável | features |
|---|---|
| `AccessEvent.occurredAt` / `StudentAttendanceSession` | as 5 de frequência |
| `Invoice.dueAt` / `paidAt` / `createdAt` | `past_due_invoice_count`, `days_past_due` |
| `Subscription.startsAt` / `endsAt` | `subscription_age_days`, `days_to_subscription_end` |
| `StudentTimelineEvent` (append-only) | `pause_count_180d` |
| `BodyAssessment.publishedAt` | `days_since_last_published_assessment` |
| `XpLedgerEntry` / `ConsentRecord` | `engagement_opt_in_activity_30d` |

Sobra **uma**: `payment_failure_count_90d`, que depende de `PaymentAttempt.status` — mutável e sem
trilha da transição. Ela é calculada assim mesmo e sai **marcada `ESTADO_CORRENTE`** na coluna
`provenance`. A marca custa uma coluna e permite à F40 excluí-la do treino com um filtro, em vez de
refazer esta fatia para descobrir em quais features confiar.

**2. Dois instantes por fato, não um.** Todo fato carrega `ocorreuEm` **e** `conhecidoEm`. Filtrar
só por `ocorreuEm` faria a passagem sincronizada tarde (catraca offline, webhook atrasado) entrar
retroativamente num snapshot que não podia conhecê-la — o leakage de `M6-FR-003`, que **não tem
sintoma visível** até o modelo errar em produção.

**3. Sem `packages/retention-domain`.** O plano de apoio previa pacote próprio; o domínio puro vive
em `apps/api/src/modules/retention/domain/`, como o da F31/F32. Pacote separado só se justifica
quando há um segundo consumidor (é o caso de `@arenahub/access-policy`, compartilhado com o Edge) —
aqui só a API calcula.

**4. Sem inbox de eventos.** O plano previa `RetentionEventInbox` preservando o primeiro recebimento
de cada evento de domínio. Os 7 eventos do PRD §14 **não existem no código** (zero ocorrências), e
`createdAt`/`occurredAt` das tabelas de estado já dão o instante de conhecimento. Uma inbox seria
uma segunda fonte de verdade a manter em sincronia sem nenhum consumidor hoje.

## 3. Escopo negativo

- **Score, faixas e fatores** — F37 (Slice 6.2). Esta fatia entrega o insumo, não o número.
- **Dashboard de cobertura** — o PRD §7 o lista na Slice 6.1, mas ele lê agregado de snapshot e a
  base ainda está vazia; a tela entra com a F37, junto do `GET /api/v1/retention/overview`.
- **Label histórico maduro** (`M6-FR-003`, maturação após o horizonte) — depende de 60 dias de
  snapshot acumulado, que só existirão em novembro/2026. As tabelas de versão já guardam
  `predictionDays`/`confirmationDays` para quando isso ocorrer.
- **Worker diário / BullMQ** — o cálculo e a gravação estão prontos e testados; quem os agenda
  entra quando houver população que justifique (`CLAUDE.md`: fila só quando comprovadamente
  necessária).
- **Nenhuma rota HTTP.** Expor score por aluno antes da baseline mostraria um número que ainda não
  significa nada.

## 4. Invariantes que esta fatia precisa preservar

| invariante | como é testado |
|---|---|
| **INV-006** — isolamento de tenant | `retencao-snapshot-point-in-time.int-spec.ts`, "não enxerga aluno de outro tenant"; e o `tenantId` entra no texto canônico do checksum, então dois tenants nunca colidem |
| `M6-BR-002` — ausente ≠ zero | `valor-de-feature.spec.ts` e `features.spec.ts`; **canário: colapsar ausente em zero derruba 7 testes** |
| `M6-FR-003` — sem informação futura | `janela-as-of.spec.ts` (fato conhecido depois do corte) + o caso da catraca offline na integração; **canário: remover a condição de conhecimento derruba 3 testes** |
| `M6-FR-006` — supressão por opt-out | `features.spec.ts` e `service.spec.ts`: devolve `SUPRIMIDA`, nunca zero |
| PRD §9 — features proibidas | nenhuma função de `features.ts` recebe o aluno inteiro, só fatos datados; `diasDesdeUltimaAvaliacao` recebe `Date`, nunca medida corporal |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | O gate de ≥6 meses bloqueia a F36? Implemento só a fundação as-of, a fatia inteira com aceite relaxado, ou adio? | **F36 inteira, aceite relaxado** | 31/08/2026 |

## 6. Antes de codificar, confirme

- [x] Decisão do PI registrada (§5, 31/08/2026) — o gate `aprovada-pi` morreu em 18/08 (`CLAUDE.md`)
- [x] Nenhum ADR bloqueia
- [x] O gate do MVP 6 **não alcança esta fatia** — decisão do PI de 31/08/2026, registrada no
      `STATUS.md`
