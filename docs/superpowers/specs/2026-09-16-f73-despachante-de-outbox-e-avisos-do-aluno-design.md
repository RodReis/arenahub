# F73 — Despachante de outbox e os nove eventos de notificação da §70

| campo | valor |
|---|---|
| **Fatia** | F73 |
| **SPEC** | `SPEC-073` |
| **MVP** | 5 |
| **ADR desta fatia** | ADR-058 |
| **Card de origem** | issue [#343](https://github.com/RodReis/arenahub/issues/343) |
| **Data** | 16/09/2026 |

## 1. O que esta fatia entrega

A inbox do app (`GET /mobile/avisos`, F29) nasce vazia por construção — nada
escreve nela hoje. Esta fatia liga o que já existe: `OutboxEvent` (write-only
até aqui) e `student_notifications` (leitura pronta).

Três entregas:

1. **Despachante de outbox** — lê eventos pendentes, distribui para
   consumidores, registra recibo por `(consumidor, evento)`.
2. **Consumidor de inbox in-app** — grava `StudentNotification` a partir do
   evento, com `kind`/`action` mapeados por tipo.
3. **Oito dos nove produtores da §70** — um já existe como mutação
   (`InvoicePaid`), dois já existem sem consumidor (`AssessmentPublished`,
   `HealthGoalReached` — credita XP do MVP-05 §12), quatro nascem de prazo,
   não de mutação, e precisam de job (`InvoiceDueSoon`, `InvoiceOverdue`,
   `MembershipExpiringSoon`, `StudentAbsent`) e um de cron já existente
   (`RankingUpdated`, no `EngagementRankingSchedulerService`).
   **`MembershipRenewed` sai do escopo** (decisão do PI, 16/09/2026): não
   existe ação "renovar assinatura" no código — o plano continua ativo
   porque a próxima invoice foi paga, e isso já é `InvoicePaid`. Um segundo
   evento no mesmo instante seria aviso duplicado do mesmo fato.

Decisões do PI (ADR-058): os nove entram todos nesta fatia; despachante é
peça própria, não publicação direta por produtor; canal é só in-app, sem
WhatsApp/e-mail.

## 2. Despachante

### 2.1 Forma: `@Cron` + trava de reentrada, mesmo precedente de F64/F31

Espelha `PlatformInvoiceSchedulerService`/`EngagementRankingSchedulerService`
de propósito: `@Cron` do `@nestjs/schedule` (já ligado em `app.module.ts`),
flag de reentrada no processo, `agora` injetado no ciclo para o teste não
esperar o relógio, falha de um evento não derruba os demais.

Frequência: `EVERY_MINUTE`. Notificação não tem SLA de segundos — a inbox é
consultada quando o aluno abre o app, não em tempo real.

### 2.2 Ciclo

```
para cada OutboxEvent com publishedAt IS NULL, mais antigos primeiro, até um teto por ciclo:
  para cada consumidor registrado que trata esse eventType:
    tenta criar InboxReceipt (consumer, eventId) — único no banco
    se colidiu (unique violation): já processado por este consumidor, pula
    senão: roda o handler do consumidor; falha vira log, não interrompe os outros consumidores
  marca OutboxEvent.publishedAt = agora (só depois que TODOS os consumidores registrados tentaram)
```

A chave `(consumer, eventId)` do `InboxReceipt` — já no schema, regra de
arquitetura 4 — é o que torna reprocessar seguro, não uma esperança de
exactly-once do cron. Dois ciclos concorrentes tentando o mesmo evento: o
segundo bate no unique constraint e pula, sem duplicar aviso nem XP.

`eventosPendentes` filtra por `publishedAt IS NULL` de fato — **sem esse
filtro o ciclo nunca progride**: achado real no teste de integração fim a
fim (banco de teste compartilhado, outbox represado por outras suítes) —
sem o filtro, os `TETO_POR_CICLO` eventos mais antigos represam o
despachante para sempre, e eventos novos nunca são alcançados. A
idempotência de negócio (não duplicar aviso/XP) é do `InboxReceipt`, por
consumidor; `publishedAt IS NULL` só decide o que ainda falta processar por
QUALQUER consumidor registrado.

**Trade-off aceito**: um consumidor novo, registrado depois que um evento
já foi marcado `publishedAt`, não o verá — reprocessar histórico para um
consumidor novo é script pontual, não o ciclo normal.

### 2.3 Registro de consumidores

Lista fixa em código (não configuração de banco — mudar quem escuta o quê é
mudança de comportamento, entra por PR): `eventType → handler[]`. Cada
handler recebe o `OutboxEvent` e devolve sucesso/falha; é ele quem decide se
grava `StudentNotification`, credita XP, ou ambos.

## 3. Consumidor de inbox in-app

### 3.1 Mapeamento evento → aviso

| eventType | kind | action | expiresAt |
|---|---|---|---|
| `InvoicePaid` | `BILLING` | `OPEN_INVOICE` | nulo |
| `InvoiceDueSoon` | `BILLING` | `OPEN_INVOICE` | data de vencimento + 1 dia |
| `InvoiceOverdue` | `BILLING` | `OPEN_INVOICE` | nulo |
| `MembershipExpiringSoon` | `MEMBERSHIP` | `NONE` | data de vencimento do plano + 1 dia |
| `HealthGoalReached` | `GENERAL` | `OPEN_HEALTH` | nulo |
| `AssessmentPublished` | `ASSESSMENT` | `OPEN_HEALTH` | nulo |
| `RankingUpdated` | `GENERAL` | `NONE` | 30 dias (o próximo ranking substitui o interesse) |
| `StudentAbsent` | `GENERAL` | `OPEN_ATTENDANCE` | nulo |

Título/corpo: texto fixo por tipo, sem template dinâmico nesta fatia (nomes
de plano/valor formatados entram no corpo via interpolação simples, como já
faz `processar-webhook-de-pagamento` para outros textos do sistema).

### 3.2 Por que `StudentNotificationAction` não ganha valor novo

`RankingUpdated` e `MembershipExpiringSoon` usam `NONE` (a inbox informa,
não navega) em vez de criar `OPEN_RANKING`/`OPEN_MEMBERSHIP` — YAGNI:
adicionar uma tela de destino é decisão de produto que este card não pediu,
e o enum cresce quando a tela existir.

## 4. Produtores que faltam

### 4.1 Já existem, só falta consumidor

- `AssessmentPublished`, `HealthGoalReached`: produtor já grava
  `OutboxEvent`. O consumidor de XP (handler `eventType → creditar XP`,
  MVP-05 §12: +20 avaliação, +100 meta) é o que falta — mesma lista de
  handlers do despachante, chave `xp-por-evento`.

### 4.2 De prazo — job novo, não mutação

Um serviço `NotificationDeadlineSchedulerService`, `@Cron` diário (mesmo
horário do `PlatformInvoiceSchedulerService`, meia-noite), mesmo padrão de
trava de reentrada + `agora` injetado:

- `InvoiceDueSoon`: `Invoice` com `dueDate` em D+3 a partir de hoje, status
  `OPEN`, sem `OutboxEvent` deste tipo já emitido para aquela invoice —
  checagem por `aggregateId` + `eventType` no próprio outbox, não por nova
  coluna.
- `InvoiceOverdue`: `Invoice` que virou `OVERDUE` neste ciclo — reaproveita a
  mesma passada que `PlatformInvoiceSchedulerService.marcarVencidas` já faz;
  não duplica a query, o evento nasce junto com a transição de estado (então
  tecnicamente é mutação, e pode ir para `billing.repository.ts` em vez
  deste scheduler — decisão de implementação, sem impacto de produto).
- `MembershipExpiringSoon`: `Membership`/`Subscription` vencendo em D+3,
  mesmo padrão de idempotência por `aggregateId` + `eventType`.
- `StudentAbsent`: aluno ativo sem `StudentAttendanceSession` nos últimos 7
  dias corridos (decisão do PI, 16/09/2026), e sem `OutboxEvent` deste tipo
  emitido nos últimos 7 dias para o mesmo aluno (não repete o aviso todo dia
  enquanto a ausência continua).

### 4.3 Ranking — plugar no cron existente

`EngagementRankingSchedulerService` já publica o snapshot mensal; ganha uma
chamada a `publicarEvento('RankingUpdated', ...)` por aluno exposto no
ranking, na mesma transação da publicação.

## 5. Testes

- Despachante: dois ciclos concorrentes no mesmo evento não duplicam aviso
  (prova de idempotência via `InboxReceipt`); falha de um handler não impede
  os demais; evento sem consumidor registrado não trava o ciclo.
- Cada handler de inbox: mapeamento evento → `StudentNotification` correto,
  com o `kind`/`action`/`expiresAt` da tabela §3.1.
- Job de prazo: idempotência por `aggregateId`+`eventType` (não duplica
  `InvoiceDueSoon` se rodar duas vezes no mesmo dia); `StudentAbsent` não
  dispara para aluno com check-in há 6 dias, dispara para 7, não duplica
  enquanto a ausência persiste dentro da janela de 7 dias.
- XP: `AssessmentPublished`/`HealthGoalReached` creditam o valor do MVP-05
  §12 uma única vez por evento.

## 6. Fora de escopo (ADR-058)

Canal externo (WhatsApp/e-mail) — card separado quando o PI pedir.
`StudentNotificationAction` novo para ranking/membership — quando a tela de
destino existir.
