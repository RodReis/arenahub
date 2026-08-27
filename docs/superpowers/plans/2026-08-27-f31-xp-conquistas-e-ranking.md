# F31 — XP, conquistas e ranking mensal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conceder XP por sessão de treino confirmada, desbloquear conquistas de marco e publicar um placar mensal por unidade — sem duplicar ponto, sem reescrever placar publicado e sem expor quem pediu para sair.

**Architecture:** Ledger append-only com idempotência garantida por chave única no Postgres; saldo e conquistas são projeções reconstruíveis a partir dele. O fato que origina o XP é `StudentAttendanceSession` (F24), que já deduplica sessão por dia local da unidade. Projeção sob demanda, como a F24 — sem fila, sem worker. O placar publicado congela pontuação; quem aparece é decidido em toda leitura por `resolverExposicao()` (F30).

**Tech Stack:** NestJS, Prisma/PostgreSQL, Zod, Jest (unit + integração contra Postgres real), Next.js (kiosk e admin-web), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-27-f31-xp-conquistas-e-ranking-design.md` · **ADR:** ADR-047

## Global Constraints

- **Idioma:** identificadores e domínio em inglês nos nomes de tabela/coluna Prisma; **nomes de arquivo, tipos de domínio e comentários em português**, como todo o módulo `engagement` já faz (`exposicao.ts`, `participacao.ts`, `triagem-de-alias.ts`). Texto de interface em pt-BR.
- **`tenantId` em toda entidade**; `gymUnitId` quando o dado é físico. O repositório recebe `TenantContext` como **primeiro argumento de todo método** (INV-003, regra de arquitetura 2).
- **Funções de domínio são puras:** sem banco, sem rede, sem relógio. O "agora" entra por parâmetro.
- **Idempotência em índice, nunca em `if`.** Violação de unicidade é tratada como sucesso, não como erro.
- **Nunca `Intl.NumberFormat`/`DateTimeFormat` direto** — a lint da Regra 5 cobre `Intl` inteiro; a exceção é nominal (`TenantDateTime`/`Money`).
- **Proibido `any` implícito**; `unknown` antes de validar dado externo; Zod no boundary.
- **Sem hardcode de cor** nas telas — token do design system (`DS-TOTEM.md`, `DS-PAINEL.md`).
- **Toast, nunca `Alert`**, para info/warn/error.
- **Commits em português**, formato `<tipo>: <descrição>`.
- **Coorte mínima do ranking: 5** (ADR-047, Decisão 2), configurável por tenant — nunca constante espalhada no cálculo.
- **Catálogo v1:** `treino-diario@1` = 10 XP por `SESSAO_CONFIRMADA`; conquistas em 1, 10, 50 e 100 sessões acumuladas.

---

## Estrutura de arquivos

**Domínio puro** — `apps/api/src/modules/engagement/domain/`:

| arquivo | responsabilidade |
|---|---|
| `regra-de-xp.ts` | resolve a versão de regra vigente em `occurredAt`; avalia gatilho declarativo |
| `movimento-de-xp.ts` | monta `GRANT`/`ADJUSTMENT`/`REVERSAL`; exige origem e versão |
| `conquista.ts` | avalia critério declarativo contra evidência acumulada |
| `classificacao.ts` | ordena e desempata o placar de forma determinística |
| `exposicao.ts` | **já existe (F30)** — reuso, não reimplementação |

**Aplicação** — `apps/api/src/modules/engagement/`:

| arquivo | responsabilidade |
|---|---|
| `engagement-xp.repository.ts` | porta + Prisma: ledger, saldo, conquistas |
| `engagement-xp.service.ts` | concede XP, avalia conquistas, reconstrói projeção |
| `engagement-ranking.repository.ts` | porta + Prisma: snapshot e entradas |
| `engagement-ranking.service.ts` | gera, publica, retém e lê placar |
| `engagement-xp.controller.ts` | painel: publicar snapshot, ajustar XP |

**Ponte do totem** — `apps/api/src/modules/kiosk/kiosk-xp.service.ts` (o kiosk nunca lê tabela de engajamento direto).

**Telas** — `apps/kiosk/components/xp.tsx`, bloco `RANKING` em `apps/kiosk/components/blocos-publicos.tsx`, painel em `apps/admin-web`.

---

### Task 1: Modelar o ledger, o catálogo e as projeções

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260827000000_f31_xp_e_ranking/migration.sql`
- Modify: `packages/database/prisma/seed.ts`

**Interfaces:**
- Consumes: `StudentAttendanceSession` (F24), `Student`, `GymUnit`, `Tenant`, `OutboxEvent` — todos já existentes.
- Produces: modelos `XpRuleVersion`, `XpLedgerEntry`, `StudentXpBalance`, `AchievementDefinitionVersion`, `StudentAchievement`, `RankingSnapshot`, `RankingEntry`; enums `XpTrigger`, `XpEntryType`, `AchievementCriterionKind`, `AchievementStatus`, `RankingSnapshotStatus`.

- [ ] **Step 1: Escrever o teste do schema — a unicidade que garante `M5-AC-002`**

Crie `apps/api/test/integration/xp-e-ranking.int-spec.ts` com o primeiro caso. Siga o cabeçalho e os helpers de `engagement.int-spec.ts` (mesmo `beforeAll`, mesmo `PrismaService`).

```ts
it('recusa dois movimentos identicos para o mesmo fato', async () => {
  const chave = {
    tenantId,
    studentId,
    sourceKind: 'ATTENDANCE_SESSION' as const,
    sourceId: sessionId,
    ruleVersionId,
    type: 'GRANT' as const,
  };

  await db.xpLedgerEntry.create({
    data: { ...chave, points: 10, occurredAt: new Date('2026-08-10T12:00:00Z'), localMonth: '2026-08' },
  });

  await expect(
    db.xpLedgerEntry.create({
      data: { ...chave, points: 10, occurredAt: new Date('2026-08-10T12:00:00Z'), localMonth: '2026-08' },
    }),
  ).rejects.toMatchObject({ code: 'P2002' });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test:integration -- xp-e-ranking`
Expected: FAIL — `db.xpLedgerEntry` não existe no client.

- [ ] **Step 3: Adicionar os modelos ao schema**

Escreva no fim de `packages/database/prisma/schema.prisma`, seguindo o estilo dos modelos vizinhos (comentário `///` explicando o **porquê**, `@map` snake_case, `@db.Uuid`).

```prisma
enum XpTrigger {
  /// Uma sessao de treino confirmada no dia local da unidade. A unica do
  /// catalogo v1. Enum e nao string livre: e o que impede regra nova de
  /// chegar como expressao executavel (`M5-RULES-01`, item 4).
  SESSAO_CONFIRMADA

  @@map("xp_trigger")
}

enum XpEntryType {
  GRANT
  ADJUSTMENT
  REVERSAL

  @@map("xp_entry_type")
}

enum XpRuleStatus {
  DRAFT
  APPROVED

  @@map("xp_rule_status")
}

/// Uma versao do catalogo de XP.
///
/// Regra alterada e LINHA NOVA (`M5-BR-009`). A resolucao usa `occurredAt`
/// do FATO, nunca o relogio do processo: evento atrasado e pontuado pela
/// regra que valia quando o aluno treinou.
model XpRuleVersion {
  id            String       @id @default(uuid()) @db.Uuid
  tenantId      String       @map("tenant_id") @db.Uuid
  /// Identificador estavel da regra atraves das versoes (`treino-diario`).
  code          String
  version       Int
  trigger       XpTrigger
  /// INTEIRO. XP nao e dinheiro, mas a mesma razao vale: fracao acumulada
  /// diverge entre a soma e a projecao.
  points        Int
  status        XpRuleStatus @default(APPROVED)
  effectiveFrom DateTime     @map("effective_from")
  /// `null` = vigente. Fechar uma versao e preencher isto, nunca apagar.
  effectiveTo   DateTime?    @map("effective_to")
  createdAt     DateTime     @default(now()) @map("created_at")

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  entries XpLedgerEntry[]

  @@unique([tenantId, code, version])
  @@index([tenantId, trigger, effectiveFrom])
  @@map("xp_rule_versions")
}

/// Origem de um movimento de XP.
enum XpSourceKind {
  /// `StudentAttendanceSession.id` -- a projecao da F24, que ja deduplica
  /// sessao por dia local da unidade.
  ATTENDANCE_SESSION
  /// Ajuste manual do operador. `sourceId` e a chave de idempotencia que o
  /// painel envia.
  MANUAL_ADJUSTMENT

  @@map("xp_source_kind")
}

/// Movimento de XP -- APPEND-ONLY.
///
/// Nunca `UPDATE`, nunca `DELETE`. Correcao e movimento COMPENSATORIO
/// vinculado por `reversesEntryId`, como `AccessEventCorrection` ja faz no
/// MVP 1 (`M1-BR-009`, `M5-FR-007`).
model XpLedgerEntry {
  id              String       @id @default(uuid()) @db.Uuid
  tenantId        String       @map("tenant_id") @db.Uuid
  studentId       String       @map("student_id") @db.Uuid
  type            XpEntryType
  /// Positivo concede, negativo estorna. A soma do ledger E o saldo.
  points          Int
  ruleVersionId   String       @map("rule_version_id") @db.Uuid
  sourceKind      XpSourceKind @map("source_kind")
  /// Id do fato que originou o movimento, no dominio de `sourceKind`.
  sourceId        String       @map("source_id") @db.Uuid
  /// Preenchido so em `REVERSAL`: o movimento que este compensa.
  reversesEntryId String?      @map("reverses_entry_id") @db.Uuid
  /// Data do FATO, nao da gravacao. E o que a resolucao de regra le.
  occurredAt      DateTime     @map("occurred_at")
  /// `AAAA-MM` do dia local DA UNIDADE, materializado na escrita.
  ///
  /// Materializado e nao derivado na leitura pelo mesmo motivo que a F24
  /// guarda `sessionDate` como `@db.Date`: reconverter fuso na leitura
  /// aplica o fuso duas vezes, e o placar de agosto ganharia treino de
  /// julho na virada.
  localMonth      String       @map("local_month")
  /// Motivo do ajuste ou da reversao. Obrigatorio para os dois; `null` em
  /// `GRANT`, que tem a regra como justificativa.
  reason          String?
  createdAt       DateTime     @default(now()) @map("created_at")

  tenant      Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  student     Student        @relation(fields: [studentId], references: [id], onDelete: Cascade)
  ruleVersion XpRuleVersion  @relation(fields: [ruleVersionId], references: [id])
  reverses    XpLedgerEntry? @relation("ReversaoDeXp", fields: [reversesEntryId], references: [id])
  revertidoPor XpLedgerEntry[] @relation("ReversaoDeXp")
  achievements StudentAchievement[]

  /// A CHAVE QUE GARANTE `M5-AC-002`.
  ///
  /// Cem replays do mesmo fato colidem nesta linha. A violacao e tratada
  /// como SUCESSO IDEMPOTENTE no service, nao como erro que alimenta
  /// retry infinito. Idempotencia em INDICE e nao em `if`: guarda que le
  /// antes de escrever perde a corrida por construcao -- foi o que a F14,
  /// a F17 e a F18 ja custaram nesta base.
  ///
  /// `type` entra na chave para que a REVERSAL do mesmo fato possa
  /// coexistir com a GRANT que ela compensa.
  @@unique([tenantId, studentId, sourceKind, sourceId, ruleVersionId, type])
  @@index([tenantId, studentId, localMonth])
  @@index([tenantId, localMonth])
  @@map("xp_ledger_entries")
}

/// Saldo do aluno no mes -- PROJECAO, reconstruivel.
///
/// Apagar esta tabela inteira e recalcular do ledger tem de produzir os
/// mesmos numeros (`M5-NFR-002`). Isso e teste, nao promessa.
model StudentXpBalance {
  id         String   @id @default(uuid()) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  studentId  String   @map("student_id") @db.Uuid
  localMonth String   @map("local_month")
  points     Int
  entryCount Int      @map("entry_count")
  /// Instante do ultimo movimento somado. E o criterio 2 do desempate.
  lastEntryAt DateTime @map("last_entry_at")
  rebuiltAt  DateTime @default(now()) @map("rebuilt_at")

  tenant  Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@unique([tenantId, studentId, localMonth])
  @@index([tenantId, localMonth, points])
  @@map("student_xp_balances")
}

enum AchievementCriterionKind {
  /// Numero de sessoes de treino acumuladas, de todos os tempos.
  SESSOES_ACUMULADAS

  @@map("achievement_criterion_kind")
}

enum AchievementStatus {
  UNLOCKED
  /// Revertida. A linha NAO some -- o desbloqueio original continua
  /// visivel com o motivo anexado (`M5-FR-007`).
  REVERSED

  @@map("achievement_status")
}

/// Uma versao da definicao de conquista.
model AchievementDefinitionVersion {
  id            String                   @id @default(uuid()) @db.Uuid
  tenantId      String                   @map("tenant_id") @db.Uuid
  code          String
  version       Int
  /// Texto exibido ao aluno, em pt-BR.
  title         String
  criterionKind AchievementCriterionKind @map("criterion_kind")
  /// Limiar do criterio (10 sessoes, 50 sessoes...).
  threshold     Int
  effectiveFrom DateTime                 @map("effective_from")
  effectiveTo   DateTime?                @map("effective_to")
  createdAt     DateTime                 @default(now()) @map("created_at")

  tenant   Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  unlocked StudentAchievement[]

  @@unique([tenantId, code, version])
  @@map("achievement_definition_versions")
}

/// Conquista desbloqueada por um aluno.
model StudentAchievement {
  id                  String            @id @default(uuid()) @db.Uuid
  tenantId            String            @map("tenant_id") @db.Uuid
  studentId           String            @map("student_id") @db.Uuid
  definitionVersionId String            @map("definition_version_id") @db.Uuid
  status              AchievementStatus @default(UNLOCKED)
  unlockedAt          DateTime          @map("unlocked_at")
  /// O MOVIMENTO DO LEDGER que provou o criterio.
  ///
  /// `M5-FR-006`: conquista sai de evidencia verificada, nunca de
  /// alegacao do cliente. Sem esta coluna, "desbloqueei" seria uma
  /// afirmacao sem lastro.
  evidenceEntryId     String            @map("evidence_entry_id") @db.Uuid
  reversedAt          DateTime?         @map("reversed_at")
  reversedReason      String?           @map("reversed_reason")

  tenant     Tenant                       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  student    Student                      @relation(fields: [studentId], references: [id], onDelete: Cascade)
  definition AchievementDefinitionVersion @relation(fields: [definitionVersionId], references: [id])
  evidence   XpLedgerEntry                @relation(fields: [evidenceEntryId], references: [id])

  @@unique([tenantId, studentId, definitionVersionId])
  @@index([tenantId, studentId, status])
  @@map("student_achievements")
}

enum RankingSnapshotStatus {
  DRAFT
  PUBLISHED
  /// Retido: coorte abaixo do minimo (`M5-BR-007`). Nao e erro, e a
  /// politica funcionando.
  WITHHELD

  @@map("ranking_snapshot_status")
}

/// Placar mensal de uma unidade -- IMUTAVEL depois de publicado.
///
/// `M5-AC-007`: regra alterada nao muda snapshot historico. O que este
/// snapshot congela e PONTUACAO E POSICAO; QUEM APARECE e decidido em toda
/// leitura por `resolverExposicao()`.
///
/// Se o nome publico fosse gravado aqui, um aluno que pedisse opt-out
/// depois da publicacao continuaria estampado num artefato imutavel -- e a
/// unica saida seria mutar o que o `M5-AC-007` proibe mutar.
model RankingSnapshot {
  id             String                @id @default(uuid()) @db.Uuid
  tenantId       String                @map("tenant_id") @db.Uuid
  gymUnitId      String                @map("gym_unit_id") @db.Uuid
  localMonth     String                @map("local_month")
  status         RankingSnapshotStatus  @default(DRAFT)
  /// Copiado da configuracao NO MOMENTO da geracao. Mudar a politica
  /// depois nao reescreve o que este snapshot decidiu.
  minimumCohort  Int                   @map("minimum_cohort")
  eligibleCount  Int                   @map("eligible_count")
  generatedAt    DateTime              @map("generated_at")
  publishedAt    DateTime?             @map("published_at")

  tenant  Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  gymUnit GymUnit       @relation(fields: [gymUnitId], references: [id], onDelete: Cascade)
  entries RankingEntry[]

  /// UM snapshot por unidade e mes. Regerar e substituir o DRAFT; o
  /// PUBLISHED nao se regera.
  @@unique([tenantId, gymUnitId, localMonth])
  @@map("ranking_snapshots")
}

/// Uma posicao no placar.
///
/// Guarda `studentId` para AUDITORIA. O DTO publico NUNCA o devolve, e o
/// nome nao mora aqui -- ver o comentario de `RankingSnapshot`.
model RankingEntry {
  id         String @id @default(uuid()) @db.Uuid
  snapshotId String @map("snapshot_id") @db.Uuid
  position   Int
  studentId  String @map("student_id") @db.Uuid
  points     Int
  /// Instante do ultimo movimento do aluno no mes -- criterio 2 do
  /// desempate, congelado junto com a posicao.
  lastEntryAt DateTime @map("last_entry_at")

  snapshot RankingSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  student  Student         @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@unique([snapshotId, studentId])
  @@unique([snapshotId, position])
  @@index([snapshotId, position])
  @@map("ranking_entries")
}
```

Acrescente os campos inversos em `Tenant`, `Student` e `GymUnit` (`xpLedgerEntries`, `xpBalances`, `achievements`, `rankingEntries`, `rankingSnapshots`, `xpRuleVersions`, `achievementDefinitions`) — o Prisma exige os dois lados.

Acrescente **um campo em `BillingSettings`-style não; o mínimo de coorte vive em `Tenant`**:

```prisma
  /// Minimo de participantes para publicar um placar (`M5-BR-007`).
  /// ADR-047: 5. Configuravel por tenant -- academia pequena e academia
  /// grande nao tem a mesma nocao de "poucos".
  rankingMinimumCohort Int @default(5) @map("ranking_minimum_cohort")
```

- [ ] **Step 4: Gerar a migration**

Run: `pnpm --filter @arenahub/database exec prisma migrate dev --name f31_xp_e_ranking --create-only`

Confira o SQL gerado. **Acrescente à mão** o bloqueio de `UPDATE`/`DELETE` no ledger — o append-only precisa de garantia no banco, não só de disciplina:

```sql
-- Append-only de verdade: o ledger nao aceita UPDATE nem DELETE.
--
-- Sem isto, "append-only" e uma promessa que a primeira correcao apressada
-- quebra sem deixar rastro. Manutencao emergencial usa role separada e
-- runbook, nao a credencial da aplicacao.
CREATE OR REPLACE FUNCTION arenahub_bloquear_mutacao_de_ledger()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'XP_LEDGER_APPEND_ONLY: % em xp_ledger_entries e proibido; use movimento compensatorio', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER xp_ledger_entries_append_only
BEFORE UPDATE OR DELETE ON xp_ledger_entries
FOR EACH ROW EXECUTE FUNCTION arenahub_bloquear_mutacao_de_ledger();
```

- [ ] **Step 5: Semear o catálogo v1**

Em `packages/database/prisma/seed.ts`, siga o padrão de seed já existente (idempotente por `upsert`). Semeie, para cada tenant semeado:

```ts
// Catalogo v1 de XP (ADR-047, Decisao 3). Numeros propostos pelo Code; o
// PI revisa depois, e revisar e CRIAR VERSAO NOVA -- nunca editar esta.
await db.xpRuleVersion.upsert({
  where: { tenantId_code_version: { tenantId, code: 'treino-diario', version: 1 } },
  update: {},
  create: {
    tenantId,
    code: 'treino-diario',
    version: 1,
    trigger: 'SESSAO_CONFIRMADA',
    points: 10,
    status: 'APPROVED',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  },
});

const MARCOS = [
  { code: 'primeiro-treino', titulo: 'Primeiro treino', limiar: 1 },
  { code: 'dez-treinos', titulo: '10 treinos', limiar: 10 },
  { code: 'cinquenta-treinos', titulo: '50 treinos', limiar: 50 },
  { code: 'cem-treinos', titulo: '100 treinos', limiar: 100 },
];

for (const marco of MARCOS) {
  await db.achievementDefinitionVersion.upsert({
    where: { tenantId_code_version: { tenantId, code: marco.code, version: 1 } },
    update: {},
    create: {
      tenantId,
      code: marco.code,
      version: 1,
      title: marco.titulo,
      criterionKind: 'SESSOES_ACUMULADAS',
      threshold: marco.limiar,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    },
  });
}
```

- [ ] **Step 6: Aplicar e executar o teste**

Run: `pnpm db:int && pnpm --filter api test:integration -- xp-e-ranking`
Expected: PASS — o segundo insert falha com `P2002`.

- [ ] **Step 7: Provar o append-only**

Acrescente ao mesmo arquivo de integração:

```ts
it('recusa UPDATE e DELETE no ledger', async () => {
  const entrada = await db.xpLedgerEntry.create({ data: { /* ...como acima... */ } });

  await expect(
    db.xpLedgerEntry.update({ where: { id: entrada.id }, data: { points: 999 } }),
  ).rejects.toThrow(/XP_LEDGER_APPEND_ONLY/u);

  await expect(
    db.xpLedgerEntry.delete({ where: { id: entrada.id } }),
  ).rejects.toThrow(/XP_LEDGER_APPEND_ONLY/u);
});
```

Run: `pnpm --filter api test:integration -- xp-e-ranking`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/database/prisma apps/api/test/integration/xp-e-ranking.int-spec.ts
git commit -m "feat(engagement): modela ledger de XP, conquistas e ranking

O ledger e append-only no BANCO, com trigger que recusa UPDATE e DELETE --
append-only por disciplina e uma promessa que a primeira correcao apressada
quebra. Correcao e movimento compensatorio vinculado.

A chave unica (tenant, aluno, origem, regra, tipo) e o que garante o
M5-AC-002: cem replays do mesmo fato colidem numa linha so."
```

---

### Task 2: Interpretador declarativo de regra

**Files:**
- Create: `apps/api/src/modules/engagement/domain/regra-de-xp.ts`
- Create: `apps/api/src/modules/engagement/domain/regra-de-xp.spec.ts`

**Interfaces:**
- Consumes: nada (domínio puro, primeira peça).
- Produces:
  - `type GatilhoDeXp = 'SESSAO_CONFIRMADA'`
  - `interface VersaoDeRegra { id: string; code: string; version: number; trigger: GatilhoDeXp; points: number; effectiveFrom: Date; effectiveTo: Date | null }`
  - `function resolverRegraVigente(regras: readonly VersaoDeRegra[], gatilho: GatilhoDeXp, quando: Date): VersaoDeRegra | null`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, expect, it } from '@jest/globals';

import { resolverRegraVigente, type VersaoDeRegra } from './regra-de-xp.js';

const v1: VersaoDeRegra = {
  id: 'r1',
  code: 'treino-diario',
  version: 1,
  trigger: 'SESSAO_CONFIRMADA',
  points: 10,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  effectiveTo: new Date('2026-06-01T00:00:00Z'),
};

const v2: VersaoDeRegra = {
  ...v1,
  id: 'r2',
  version: 2,
  points: 15,
  effectiveFrom: new Date('2026-06-01T00:00:00Z'),
  effectiveTo: null,
};

describe('resolverRegraVigente', () => {
  it('escolhe a versao vigente na data do FATO, nao a mais recente', () => {
    const fatoAntigo = new Date('2026-03-10T12:00:00Z');

    expect(resolverRegraVigente([v1, v2], 'SESSAO_CONFIRMADA', fatoAntigo)?.id).toBe('r1');
  });

  it('escolhe a versao aberta quando o fato e posterior', () => {
    expect(
      resolverRegraVigente([v1, v2], 'SESSAO_CONFIRMADA', new Date('2026-08-10T12:00:00Z'))?.id,
    ).toBe('r2');
  });

  it('nao encontra regra antes da primeira vigencia', () => {
    expect(
      resolverRegraVigente([v1, v2], 'SESSAO_CONFIRMADA', new Date('2025-12-31T23:59:59Z')),
    ).toBeNull();
  });

  /*
   * `effectiveTo` e EXCLUSIVO. As duas versoes se encostam em
   * 2026-06-01T00:00:00Z: se o limite fosse inclusivo, esse instante
   * pertenceria as duas, e a escolha viraria a ordem do array -- que e a
   * ordem que o banco devolveu, nao uma decisao.
   */
  it('no instante da virada, vale a versao nova', () => {
    const virada = new Date('2026-06-01T00:00:00Z');

    expect(resolverRegraVigente([v1, v2], 'SESSAO_CONFIRMADA', virada)?.id).toBe('r2');
  });

  it('ignora regra de outro gatilho', () => {
    const outro = { ...v2, trigger: 'OUTRO' as unknown as VersaoDeRegra['trigger'] };

    expect(
      resolverRegraVigente([outro], 'SESSAO_CONFIRMADA', new Date('2026-08-10T12:00:00Z')),
    ).toBeNull();
  });

  /*
   * A ordem de entrada nao pode decidir nada: o repositorio pode devolver
   * em qualquer ordem, e um `find` ingenuo escolheria a primeira que
   * casasse.
   */
  it('independe da ordem em que as versoes chegam', () => {
    const quando = new Date('2026-03-10T12:00:00Z');

    expect(resolverRegraVigente([v1, v2], 'SESSAO_CONFIRMADA', quando)?.id).toBe(
      resolverRegraVigente([v2, v1], 'SESSAO_CONFIRMADA', quando)?.id,
    );
  });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- regra-de-xp`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
/**
 * Resolucao de regra de XP -- DECLARATIVA, nunca executavel.
 *
 * Uma regra e DADO: gatilho de um enum fechado e um numero de pontos. Nao
 * ha expressao, nao ha `eval`, nao ha string interpretada. E o item 4 do
 * `M5-RULES-01`, fechado por construcao: nao existe caminho por onde uma
 * regra nova chegue como codigo, porque `trigger` nao aceita valor fora do
 * enum e `points` e inteiro.
 *
 * PURA: sem banco, sem relogio. O instante do fato entra por parametro.
 */

/** Os gatilhos que o catalogo aceita. Allowlist, nao validacao. */
export type GatilhoDeXp = 'SESSAO_CONFIRMADA';

export interface VersaoDeRegra {
  id: string;
  code: string;
  version: number;
  trigger: GatilhoDeXp;
  points: number;
  effectiveFrom: Date;
  /** `null` = vigente ate hoje. */
  effectiveTo: Date | null;
}

/**
 * A versao que valia QUANDO O FATO ACONTECEU.
 *
 * `quando` e o `occurredAt` do fato, nunca `new Date()`: um evento que
 * chega atrasado -- reprocessamento, fila represada, correcao de passagem
 * -- tem de ser pontuado pela regra da epoca. Resolver pelo relogio do
 * processo faria a mesma sessao valer valores diferentes conforme o dia em
 * que alguem apertasse o botao.
 *
 * `effectiveTo` e EXCLUSIVO: no instante exato da virada, vale a versao
 * nova. Sem isso duas versoes se sobrepoem por um instante e a escolha
 * passa a depender da ordem do array.
 */
export function resolverRegraVigente(
  regras: readonly VersaoDeRegra[],
  gatilho: GatilhoDeXp,
  quando: Date,
): VersaoDeRegra | null {
  const candidatas = regras.filter(
    (regra) =>
      regra.trigger === gatilho &&
      regra.effectiveFrom.getTime() <= quando.getTime() &&
      (regra.effectiveTo === null || quando.getTime() < regra.effectiveTo.getTime()),
  );

  if (candidatas.length === 0) return null;

  /*
   * Ordenar e pegar a maior versao -- e nao `candidatas[0]`. Vigencias bem
   * formadas nao se sobrepoem, mas dado mal semeado sobrepoe, e nesse caso
   * a resposta tem de ser DETERMINISTICA em vez de refletir a ordem que o
   * banco devolveu.
   */
  return candidatas.reduce((maior, atual) => (atual.version > maior.version ? atual : maior));
}
```

- [ ] **Step 4: Executar os testes**

Run: `pnpm --filter api test -- regra-de-xp`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement/domain/regra-de-xp.ts apps/api/src/modules/engagement/domain/regra-de-xp.spec.ts
git commit -m "feat(engagement): resolve versao de regra pela data do fato

Regra e dado, nunca expressao -- o gatilho e enum fechado e os pontos sao
inteiro, entao nao ha caminho por onde regra nova chegue como codigo
(M5-RULES-01, item 4).

A resolucao usa occurredAt do fato e nao o relogio do processo: evento
atrasado tem de valer o que valia quando o aluno treinou."
```

---

### Task 3: Movimento de XP e cálculo de saldo

**Files:**
- Create: `apps/api/src/modules/engagement/domain/movimento-de-xp.ts`
- Create: `apps/api/src/modules/engagement/domain/movimento-de-xp.spec.ts`

**Interfaces:**
- Consumes: `VersaoDeRegra` de `regra-de-xp.ts`.
- Produces:
  - `type TipoDeMovimento = 'GRANT' | 'ADJUSTMENT' | 'REVERSAL'`
  - `type OrigemDeMovimento = 'ATTENDANCE_SESSION' | 'MANUAL_ADJUSTMENT'`
  - `interface MovimentoDeXp { type; points; ruleVersionId; sourceKind; sourceId; reversesEntryId; occurredAt; localMonth; reason }`
  - `function mesLocal(quando: Date, fusoDaUnidade: string): string`
  - `function concederPorSessao(entrada): MovimentoDeXp`
  - `function reverter(original, motivo, agora): MovimentoDeXp`
  - `function somarSaldo(movimentos: readonly { points: number }[]): number`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, expect, it } from '@jest/globals';

import { concederPorSessao, mesLocal, reverter, somarSaldo } from './movimento-de-xp.js';
import type { VersaoDeRegra } from './regra-de-xp.js';

const regra: VersaoDeRegra = {
  id: 'r1',
  code: 'treino-diario',
  version: 1,
  trigger: 'SESSAO_CONFIRMADA',
  points: 10,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  effectiveTo: null,
};

describe('mesLocal', () => {
  it('usa o fuso da UNIDADE, nao o do processo', () => {
    // 01/09 03:00 UTC e ainda 31/08 em Sao Paulo (UTC-3).
    expect(mesLocal(new Date('2026-09-01T03:00:00Z'), 'America/Sao_Paulo')).toBe('2026-08');
  });

  it('vira o mes quando o fuso local ja virou', () => {
    expect(mesLocal(new Date('2026-09-01T04:00:00Z'), 'America/Sao_Paulo')).toBe('2026-09');
  });
});

describe('concederPorSessao', () => {
  it('carrega origem e versao de regra', () => {
    const movimento = concederPorSessao({
      regra,
      sessionId: 'sess-1',
      occurredAt: new Date('2026-08-10T12:00:00Z'),
      fusoDaUnidade: 'America/Sao_Paulo',
    });

    expect(movimento).toMatchObject({
      type: 'GRANT',
      points: 10,
      ruleVersionId: 'r1',
      sourceKind: 'ATTENDANCE_SESSION',
      sourceId: 'sess-1',
      reversesEntryId: null,
      localMonth: '2026-08',
    });
  });
});

describe('reverter', () => {
  it('compensa com sinal oposto e vincula o original', () => {
    const original = {
      id: 'e1',
      points: 10,
      ruleVersionId: 'r1',
      sourceKind: 'ATTENDANCE_SESSION' as const,
      sourceId: 'sess-1',
      occurredAt: new Date('2026-08-10T12:00:00Z'),
      localMonth: '2026-08',
    };

    expect(reverter(original, 'passagem corrigida', new Date('2026-08-20T09:00:00Z'))).toMatchObject({
      type: 'REVERSAL',
      points: -10,
      reversesEntryId: 'e1',
      reason: 'passagem corrigida',
      /* O mes do FATO ORIGINAL, nao o da correcao: senao o estorno cairia
       * em setembro e agosto ficaria com o ponto que nao vale mais. */
      localMonth: '2026-08',
    });
  });

  it('exige motivo', () => {
    const original = {
      id: 'e1',
      points: 10,
      ruleVersionId: 'r1',
      sourceKind: 'ATTENDANCE_SESSION' as const,
      sourceId: 'sess-1',
      occurredAt: new Date('2026-08-10T12:00:00Z'),
      localMonth: '2026-08',
    };

    expect(() => reverter(original, '  ', new Date())).toThrow('XP_MOTIVO_OBRIGATORIO');
  });
});

describe('somarSaldo', () => {
  it('soma concessao e estorno', () => {
    expect(somarSaldo([{ points: 10 }, { points: 10 }, { points: -10 }])).toBe(10);
  });

  it('lista vazia soma zero', () => {
    expect(somarSaldo([])).toBe(0);
  });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- movimento-de-xp`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import type { VersaoDeRegra } from './regra-de-xp.js';

/**
 * Movimentos do ledger de XP.
 *
 * PURO: sem banco, sem relogio. O "agora" da reversao entra por parametro.
 *
 * O ledger e APPEND-ONLY, e isso muda a forma das funcoes aqui: nao ha
 * `atualizarPontos`. Corrigir e CRIAR um movimento compensatorio que
 * aponta para o original -- `M5-FR-007` e a mesma disciplina que
 * `AccessEventCorrection` ja aplica no MVP 1.
 */

export type TipoDeMovimento = 'GRANT' | 'ADJUSTMENT' | 'REVERSAL';

export type OrigemDeMovimento = 'ATTENDANCE_SESSION' | 'MANUAL_ADJUSTMENT';

export interface MovimentoDeXp {
  type: TipoDeMovimento;
  points: number;
  ruleVersionId: string;
  sourceKind: OrigemDeMovimento;
  sourceId: string;
  reversesEntryId: string | null;
  occurredAt: Date;
  localMonth: string;
  reason: string | null;
}

/** O que `reverter` precisa saber do movimento original. */
export interface MovimentoOriginal {
  id: string;
  points: number;
  ruleVersionId: string;
  sourceKind: OrigemDeMovimento;
  sourceId: string;
  occurredAt: Date;
  localMonth: string;
}

export interface EntradaDeConcessao {
  regra: VersaoDeRegra;
  sessionId: string;
  occurredAt: Date;
  fusoDaUnidade: string;
}

/**
 * `AAAA-MM` do instante, no fuso DA UNIDADE.
 *
 * O fuso entra por parametro e nao sai de `process.env` nem do relogio do
 * servidor: a mesma API serve unidades em fusos diferentes, e um treino as
 * 21h em Manaus nao pertence ao mesmo mes que um treino as 21h em Recife
 * quando o mes vira.
 *
 * `en-CA` produz `AAAA-MM-DD`, que corta em 7 caracteres sem depender de
 * ordem de campo -- diferente de montar a string a partir de
 * `getMonth() + 1`, que exige preencher zero a mao e erra na virada do ano
 * se alguem trocar a ordem.
 */
export function mesLocal(quando: Date, fusoDaUnidade: string): string {
  const formatador = new Intl.DateTimeFormat('en-CA', {
    timeZone: fusoDaUnidade,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatador.format(quando).slice(0, 7);
}

/** Concessao por sessao de treino confirmada. */
export function concederPorSessao(entrada: EntradaDeConcessao): MovimentoDeXp {
  return {
    type: 'GRANT',
    points: entrada.regra.points,
    ruleVersionId: entrada.regra.id,
    sourceKind: 'ATTENDANCE_SESSION',
    sourceId: entrada.sessionId,
    reversesEntryId: null,
    occurredAt: entrada.occurredAt,
    localMonth: mesLocal(entrada.occurredAt, entrada.fusoDaUnidade),
    reason: null,
  };
}

/**
 * Movimento compensatorio.
 *
 * `localMonth` e `occurredAt` sao os DO FATO ORIGINAL, nao os da correcao.
 * Estornar em setembro um ponto concedido em agosto deixaria agosto com um
 * ponto que ja nao vale -- e o placar de agosto, que e imutavel, passaria a
 * discordar do ledger que o originou.
 */
export function reverter(
  original: MovimentoOriginal,
  motivo: string,
  agora: Date,
): MovimentoDeXp {
  if (motivo.trim().length === 0) {
    throw new Error('XP_MOTIVO_OBRIGATORIO');
  }

  void agora;

  return {
    type: 'REVERSAL',
    points: -original.points,
    ruleVersionId: original.ruleVersionId,
    sourceKind: original.sourceKind,
    sourceId: original.sourceId,
    reversesEntryId: original.id,
    occurredAt: original.occurredAt,
    localMonth: original.localMonth,
    reason: motivo.trim(),
  };
}

/** O saldo E a soma do ledger. Nao ha outra definicao. */
export function somarSaldo(movimentos: readonly { points: number }[]): number {
  return movimentos.reduce((total, movimento) => total + movimento.points, 0);
}
```

**Atenção à lint da Regra 5:** `Intl.DateTimeFormat` é usado aqui e a regra cobre `Intl` inteiro. Verifique como `TenantDateTime` está implementado (`grep -rn "TenantDateTime" apps/api/src packages`) e **use-o se ele já expuser o que `mesLocal` precisa**. Se não expuser, acrescente a exceção nominal para `mesLocal` no arquivo de configuração da lint, junto das que já existem — nunca desabilite a regra na linha.

- [ ] **Step 4: Executar os testes**

Run: `pnpm --filter api test -- movimento-de-xp && pnpm lint`
Expected: PASS nos 7 testes e lint verde.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement/domain/movimento-de-xp.ts apps/api/src/modules/engagement/domain/movimento-de-xp.spec.ts
git commit -m "feat(engagement): movimentos de XP e mes local da unidade

Nao ha funcao de atualizar pontos: o ledger e append-only, entao corrigir e
criar movimento compensatorio vinculado ao original.

O estorno herda occurredAt e localMonth DO FATO -- estornar em setembro um
ponto de agosto deixaria o placar de agosto, que e imutavel, discordando do
ledger que o originou."
```

---

### Task 4: Critério de conquista

**Files:**
- Create: `apps/api/src/modules/engagement/domain/conquista.ts`
- Create: `apps/api/src/modules/engagement/domain/conquista.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type CriterioDeConquista = 'SESSOES_ACUMULADAS'`
  - `interface DefinicaoDeConquista { id: string; code: string; version: number; title: string; criterionKind: CriterioDeConquista; threshold: number }`
  - `interface EvidenciaDeConquista { sessoesAcumuladas: number; ultimoMovimentoId: string }`
  - `function avaliarConquistas(definicoes, evidencia, jaDesbloqueadas: ReadonlySet<string>): readonly { definicao: DefinicaoDeConquista; evidenceEntryId: string }[]`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, expect, it } from '@jest/globals';

import { avaliarConquistas, type DefinicaoDeConquista } from './conquista.js';

const marcos: DefinicaoDeConquista[] = [
  { id: 'd1', code: 'primeiro-treino', version: 1, title: 'Primeiro treino', criterionKind: 'SESSOES_ACUMULADAS', threshold: 1 },
  { id: 'd2', code: 'dez-treinos', version: 1, title: '10 treinos', criterionKind: 'SESSOES_ACUMULADAS', threshold: 10 },
  { id: 'd3', code: 'cinquenta-treinos', version: 1, title: '50 treinos', criterionKind: 'SESSOES_ACUMULADAS', threshold: 50 },
];

describe('avaliarConquistas', () => {
  it('desbloqueia todos os marcos alcancados', () => {
    const desbloqueadas = avaliarConquistas(
      marcos,
      { sessoesAcumuladas: 12, ultimoMovimentoId: 'e42' },
      new Set(),
    );

    expect(desbloqueadas.map((d) => d.definicao.code)).toEqual([
      'primeiro-treino',
      'dez-treinos',
    ]);
  });

  it('anexa o movimento do ledger como evidencia', () => {
    const [primeira] = avaliarConquistas(
      marcos,
      { sessoesAcumuladas: 1, ultimoMovimentoId: 'e7' },
      new Set(),
    );

    expect(primeira?.evidenceEntryId).toBe('e7');
  });

  /*
   * O CASO QUE FAZ A FUNCAO EXISTIR. Sem ele, cada visita a tela tentaria
   * reinserir toda conquista ja obtida -- a chave unica seguraria, mas o
   * servico gastaria uma escrita recusada por conquista, por visita.
   */
  it('nao redesbloqueia o que ja esta desbloqueado', () => {
    const desbloqueadas = avaliarConquistas(
      marcos,
      { sessoesAcumuladas: 12, ultimoMovimentoId: 'e42' },
      new Set(['d1']),
    );

    expect(desbloqueadas.map((d) => d.definicao.code)).toEqual(['dez-treinos']);
  });

  it('nao desbloqueia marco nao alcancado', () => {
    expect(
      avaliarConquistas(marcos, { sessoesAcumuladas: 9, ultimoMovimentoId: 'e9' }, new Set()),
    ).toHaveLength(1);
  });

  it('sem sessao nenhuma, nada desbloqueia', () => {
    expect(
      avaliarConquistas(marcos, { sessoesAcumuladas: 0, ultimoMovimentoId: 'e0' }, new Set()),
    ).toEqual([]);
  });

  /*
   * Ordem por limiar crescente e nao pela ordem do array: o repositorio
   * devolve na ordem do banco, e a tela mostra a trajetoria do aluno.
   */
  it('devolve em ordem crescente de limiar', () => {
    const embaralhado = [marcos[2]!, marcos[0]!, marcos[1]!];

    expect(
      avaliarConquistas(
        embaralhado,
        { sessoesAcumuladas: 50, ultimoMovimentoId: 'e50' },
        new Set(),
      ).map((d) => d.definicao.threshold),
    ).toEqual([1, 10, 50]);
  });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- conquista`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
/**
 * Criterio de conquista -- DECLARATIVO, avaliado contra EVIDENCIA.
 *
 * `M5-FR-006`: conquista sai de fato verificado, nunca de alegacao do
 * cliente. A evidencia aqui e a contagem de sessoes ja materializada no
 * ledger, e cada desbloqueio carrega o id do movimento que a provou.
 *
 * PURA: sem banco, sem relogio.
 */

export type CriterioDeConquista = 'SESSOES_ACUMULADAS';

export interface DefinicaoDeConquista {
  id: string;
  code: string;
  version: number;
  title: string;
  criterionKind: CriterioDeConquista;
  threshold: number;
}

export interface EvidenciaDeConquista {
  sessoesAcumuladas: number;
  /** O movimento do ledger que levou o aluno a esta contagem. */
  ultimoMovimentoId: string;
}

export interface ConquistaADesbloquear {
  definicao: DefinicaoDeConquista;
  evidenceEntryId: string;
}

/**
 * As conquistas que este aluno acaba de alcancar.
 *
 * `jaDesbloqueadas` evita gastar uma escrita recusada por conquista a cada
 * visita a tela: a chave unica no banco seguraria de qualquer forma, mas
 * pagar o custo da recusa em toda leitura e desperdicio previsivel.
 *
 * Ordena por limiar CRESCENTE, nao pela ordem de entrada: o repositorio
 * devolve na ordem do banco, e a tela mostra a trajetoria do aluno.
 */
export function avaliarConquistas(
  definicoes: readonly DefinicaoDeConquista[],
  evidencia: EvidenciaDeConquista,
  jaDesbloqueadas: ReadonlySet<string>,
): readonly ConquistaADesbloquear[] {
  return definicoes
    .filter(
      (definicao) =>
        definicao.criterionKind === 'SESSOES_ACUMULADAS' &&
        !jaDesbloqueadas.has(definicao.id) &&
        evidencia.sessoesAcumuladas >= definicao.threshold,
    )
    .sort((a, b) => a.threshold - b.threshold)
    .map((definicao) => ({ definicao, evidenceEntryId: evidencia.ultimoMovimentoId }));
}
```

- [ ] **Step 4: Executar os testes**

Run: `pnpm --filter api test -- conquista`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement/domain/conquista.ts apps/api/src/modules/engagement/domain/conquista.spec.ts
git commit -m "feat(engagement): avalia conquista contra evidencia do ledger

Cada desbloqueio carrega o id do movimento que o provou -- M5-FR-006 exige
fato verificado, e sem essa coluna 'desbloqueei' seria afirmacao sem lastro."
```

---

### Task 5: Classificação determinística

**Files:**
- Create: `apps/api/src/modules/engagement/domain/classificacao.ts`
- Create: `apps/api/src/modules/engagement/domain/classificacao.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `interface SaldoParaClassificar { studentId: string; points: number; lastEntryAt: Date }`
  - `interface PosicaoNoPlacar { position: number; studentId: string; points: number; lastEntryAt: Date }`
  - `function classificar(saldos: readonly SaldoParaClassificar[]): readonly PosicaoNoPlacar[]`

- [ ] **Step 1: Escrever os testes**

```ts
import { describe, expect, it } from '@jest/globals';

import { classificar, type SaldoParaClassificar } from './classificacao.js';

const saldo = (
  studentId: string,
  points: number,
  iso: string,
): SaldoParaClassificar => ({ studentId, points, lastEntryAt: new Date(iso) });

describe('classificar', () => {
  it('ordena por XP decrescente', () => {
    const placar = classificar([
      saldo('b', 20, '2026-08-10T12:00:00Z'),
      saldo('a', 50, '2026-08-11T12:00:00Z'),
      saldo('c', 35, '2026-08-12T12:00:00Z'),
    ]);

    expect(placar.map((p) => p.studentId)).toEqual(['a', 'c', 'b']);
    expect(placar.map((p) => p.position)).toEqual([1, 2, 3]);
  });

  /*
   * Criterio 2: quem chegou primeiro ao mesmo total fica na frente. Premia
   * a consistencia e nao o acaso da ordem do banco.
   */
  it('empate em XP: quem atingiu primeiro fica na frente', () => {
    const placar = classificar([
      saldo('tarde', 30, '2026-08-20T12:00:00Z'),
      saldo('cedo', 30, '2026-08-05T12:00:00Z'),
    ]);

    expect(placar.map((p) => p.studentId)).toEqual(['cedo', 'tarde']);
  });

  /*
   * Criterio 3, o que fecha a porta do sorteio (`M5-BR-008`). Empate
   * TOTAL -- mesmo XP e mesmo instante -- ainda tem de produzir sempre a
   * mesma ordem.
   */
  it('empate total: desempata por studentId, de forma estavel', () => {
    const placar = classificar([
      saldo('zeta', 30, '2026-08-05T12:00:00Z'),
      saldo('alfa', 30, '2026-08-05T12:00:00Z'),
    ]);

    expect(placar.map((p) => p.studentId)).toEqual(['alfa', 'zeta']);
  });

  /*
   * O TESTE QUE PROVA O `M5-BR-008`. Rodar sobre a entrada embaralhada tem
   * de dar a mesma ordem -- a memoria `include-sem-orderby-embaralha`
   * registra que a ordem fisica do Postgres muda depois de um UPDATE, e um
   * sort instavel deixaria o placar mudar sozinho entre duas leituras.
   */
  it('produz a mesma ordem com a entrada embaralhada', () => {
    const entrada = [
      saldo('a', 30, '2026-08-05T12:00:00Z'),
      saldo('b', 30, '2026-08-05T12:00:00Z'),
      saldo('c', 30, '2026-08-05T12:00:00Z'),
      saldo('d', 50, '2026-08-05T12:00:00Z'),
    ];

    expect(classificar(entrada)).toEqual(classificar([...entrada].reverse()));
  });

  it('lista vazia devolve placar vazio', () => {
    expect(classificar([])).toEqual([]);
  });

  it('nao muta a lista de entrada', () => {
    const entrada = [saldo('b', 20, '2026-08-10T12:00:00Z'), saldo('a', 50, '2026-08-11T12:00:00Z')];

    classificar(entrada);

    expect(entrada.map((s) => s.studentId)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- classificacao`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
/**
 * Classificacao do placar -- DETERMINISTICA, nunca sorteio.
 *
 * `M5-BR-008`: "empate usa criterio estavel publicado; sorteio nao ocorre
 * silenciosamente". Os tres criterios, nesta ordem:
 *
 *   1. mais XP;
 *   2. quem atingiu primeiro (`lastEntryAt` ascendente) -- premia
 *      consistencia, nao o acaso;
 *   3. `studentId`, o unico criterio que nunca empata.
 *
 * O criterio 3 existe porque `Array.prototype.sort` so garante estabilidade
 * em relacao a ORDEM DE ENTRADA, e a ordem de entrada aqui e a ordem que o
 * Postgres devolveu -- que muda depois de um UPDATE. Sem ele, dois alunos
 * totalmente empatados trocariam de lugar entre duas leituras sem que nada
 * tivesse acontecido.
 *
 * PURA: sem banco, sem relogio. Nao muta a entrada.
 */

export interface SaldoParaClassificar {
  studentId: string;
  points: number;
  lastEntryAt: Date;
}

export interface PosicaoNoPlacar {
  position: number;
  studentId: string;
  points: number;
  lastEntryAt: Date;
}

export function classificar(
  saldos: readonly SaldoParaClassificar[],
): readonly PosicaoNoPlacar[] {
  return [...saldos]
    .sort((a, b) => {
      if (a.points !== b.points) return b.points - a.points;

      const tempo = a.lastEntryAt.getTime() - b.lastEntryAt.getTime();
      if (tempo !== 0) return tempo;

      return a.studentId.localeCompare(b.studentId);
    })
    .map((saldo, indice) => ({
      position: indice + 1,
      studentId: saldo.studentId,
      points: saldo.points,
      lastEntryAt: saldo.lastEntryAt,
    }));
}
```

- [ ] **Step 4: Executar os testes**

Run: `pnpm --filter api test -- classificacao`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement/domain/classificacao.ts apps/api/src/modules/engagement/domain/classificacao.spec.ts
git commit -m "feat(engagement): classifica placar sem sorteio

Tres criterios publicados: XP, quem atingiu primeiro, e studentId como
ultimo desempate estavel (M5-BR-008).

O terceiro nao e enfeite: sort() so e estavel em relacao a ordem de entrada,
e a ordem de entrada e a que o Postgres devolveu -- que muda depois de um
UPDATE. Sem ele o placar trocaria de ordem sozinho entre duas leituras."
```

---

### Task 6: Repositório e concessão idempotente de XP

**Files:**
- Create: `apps/api/src/modules/engagement/engagement-xp.repository.ts`
- Create: `apps/api/src/modules/engagement/engagement-xp.repository.fake.ts`
- Create: `apps/api/src/modules/engagement/engagement-xp.service.ts`
- Create: `apps/api/src/modules/engagement/engagement-xp.service.spec.ts`
- Modify: `apps/api/src/modules/engagement/engagement.module.ts`

**Interfaces:**
- Consumes: `resolverRegraVigente`, `concederPorSessao`, `somarSaldo`, `mesLocal`, `avaliarConquistas`; `TenantContext`; `PrismaService`.
- Produces:
  - `const PORTA_DE_XP: symbol`
  - `interface PortaDeXp` com `regrasDoTenant`, `sessoesSemMovimento`, `gravarConcessao`, `recalcularSaldo`, `definicoesDeConquista`, `conquistasDoAluno`, `gravarConquistas`, `saldoDoAluno`, `movimentosDoAluno`
  - `class EngagementXpService` com `sincronizarXp(contexto, studentId, agora): Promise<ResumoDeXp>` e `obterExtrato(contexto, studentId, mes): Promise<ExtratoDeXp>`
  - `interface ResumoDeXp { concedidos: number; saldoDoMes: number; conquistasNovas: readonly string[] }`

- [ ] **Step 1: Escrever os testes do serviço, com dublê**

Siga o padrão de `engagement.service.spec.ts` e **crie o dublê como classe instanciada por teste** — a memória `duble-com-estado-vaza-entre-testes` registra que instância compartilhada contamina o bloco seguinte.

```ts
import { beforeEach, describe, expect, it } from '@jest/globals';

import { EngagementXpService } from './engagement-xp.service.js';
import { FakePortaDeXp } from './engagement-xp.repository.fake.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

const contexto = { tenantId: 't1', actorId: 'u1' } as TenantContext;
const AGORA = new Date('2026-08-20T12:00:00Z');

describe('EngagementXpService.sincronizarXp', () => {
  let fake: FakePortaDeXp;
  let servico: EngagementXpService;

  beforeEach(() => {
    fake = new FakePortaDeXp();
    servico = new EngagementXpService(fake);
  });

  it('concede XP por sessao ainda nao pontuada', async () => {
    fake.comRegra({ points: 10 });
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);

    const resumo = await servico.sincronizarXp(contexto, 'aluno-1', AGORA);

    expect(resumo.concedidos).toBe(1);
    expect(resumo.saldoDoMes).toBe(10);
  });

  it('nao concede duas vezes pela mesma sessao', async () => {
    fake.comRegra({ points: 10 });
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);

    await servico.sincronizarXp(contexto, 'aluno-1', AGORA);
    const segunda = await servico.sincronizarXp(contexto, 'aluno-1', AGORA);

    expect(segunda.concedidos).toBe(0);
    expect(segunda.saldoDoMes).toBe(10);
  });

  /*
   * A colisao de unicidade e SUCESSO, nao erro. Sem isto, duas abas abertas
   * no totem fariam a segunda estourar 500 na cara do aluno.
   */
  it('trata colisao de unicidade como sucesso idempotente', async () => {
    fake.comRegra({ points: 10 });
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);
    fake.colidirNaProximaEscrita();

    await expect(servico.sincronizarXp(contexto, 'aluno-1', AGORA)).resolves.toMatchObject({
      concedidos: 0,
    });
  });

  it('sessao sem regra vigente na data nao gera movimento', async () => {
    fake.comRegra({ points: 10, effectiveFrom: new Date('2026-09-01T00:00:00Z') });
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);

    expect((await servico.sincronizarXp(contexto, 'aluno-1', AGORA)).concedidos).toBe(0);
  });

  it('desbloqueia a conquista de primeiro treino', async () => {
    fake.comRegra({ points: 10 });
    fake.comDefinicoes([{ id: 'd1', code: 'primeiro-treino', version: 1, title: 'Primeiro treino', criterionKind: 'SESSOES_ACUMULADAS', threshold: 1 }]);
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);

    expect((await servico.sincronizarXp(contexto, 'aluno-1', AGORA)).conquistasNovas).toEqual([
      'primeiro-treino',
    ]);
  });

  /*
   * `M5-BR-002`: recusar o ranking nao reduz XP. O servico de XP nao chama
   * `resolverExposicao` -- e este teste e o que impede alguem de "corrigir"
   * isso mais tarde achando que e coerencia.
   */
  it('concede XP mesmo para aluno em opt-out de ranking', async () => {
    fake.comRegra({ points: 10 });
    fake.comOptOut('aluno-1');
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);

    expect((await servico.sincronizarXp(contexto, 'aluno-1', AGORA)).saldoDoMes).toBe(10);
  });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- engagement-xp.service`
Expected: FAIL — serviço e dublê não existem.

- [ ] **Step 3: Escrever a porta, o dublê e o repositório Prisma**

Siga a forma de `engagement.repository.ts`: `PORTA_DE_XP = Symbol('PortaDeXp')`, interface `PortaDeXp` com `TenantContext` como **primeiro argumento de todo método**, e a classe Prisma implementando.

Pontos que o repositório precisa acertar:

```ts
/**
 * As sessoes que ainda nao geraram movimento -- LEFT JOIN, nao duas
 * consultas.
 *
 * Carregar todas as sessoes e filtrar em memoria contra os movimentos
 * carregados funciona ate o aluno ter dois anos de historico; a partir dai
 * cada abertura da tela puxa a vida inteira dele para a memoria do Node.
 */
async sessoesSemMovimento(
  contexto: TenantContext,
  studentId: string,
): Promise<SessaoPontuavel[]> {
  const sessoes = await this.db.studentAttendanceSession.findMany({
    where: {
      tenantId: contexto.tenantId,
      studentId,
      policyVersion: POLITICA_DE_SESSAO,
      /*
       * `none` traduz para NOT EXISTS. A relacao nao existe no schema --
       * `sourceId` aponta para a sessao sem foreign key, porque o ledger
       * aceita origens de dominios diferentes. Entao a exclusao vem de uma
       * subconsulta explicita.
       */
    },
    select: {
      id: true,
      sessionDate: true,
      firstPassageAt: true,
      gymUnit: { select: { id: true, timezone: true } },
    },
    orderBy: { sessionDate: 'asc' },
  });

  const jaPontuadas = new Set(
    (
      await this.db.xpLedgerEntry.findMany({
        where: {
          tenantId: contexto.tenantId,
          studentId,
          sourceKind: 'ATTENDANCE_SESSION',
          type: 'GRANT',
        },
        select: { sourceId: true },
      })
    ).map((movimento) => movimento.sourceId),
  );

  return sessoes
    .filter((sessao) => !jaPontuadas.has(sessao.id))
    .map((sessao) => ({
      id: sessao.id,
      /* `firstPassageAt` e o instante REAL do treino; `sessionDate` e o dia
       * civil sem hora, e usa-lo aqui colocaria todo treino a meia-noite
       * UTC -- o que joga treino da noite para o mes seguinte na virada. */
      occurredAt: sessao.firstPassageAt,
      fusoDaUnidade: sessao.gymUnit.timezone,
    }));
}
```

**Confirme o nome do campo de fuso em `GymUnit`** antes de escrever (`grep -n "timezone" packages/database/prisma/schema.prisma`). Se o campo tiver outro nome, use o real.

A gravação, no service, numa transação por sessão:

```ts
/*
 * Uma transacao por sessao, e nao uma por sincronizacao inteira: se a
 * quinta sessao colidir, as quatro primeiras ja estao gravadas e nao
 * precisam ser refeitas. Transacao longa aqui tambem seguraria linha de
 * `xp_ledger_entries` durante a leitura da tela.
 */
await this.porta.gravarConcessao(contexto, {
  studentId,
  movimento,
  /* O evento vai na MESMA transacao da mudanca de estado -- regra de
   * arquitetura 5. Publicar antes de commitar e o defeito que o outbox
   * existe para impedir. */
  evento: { eventType: 'XPGranted', aggregateType: 'XpLedgerEntry' },
});
```

Trate a colisão:

```ts
try {
  await this.porta.gravarConcessao(contexto, entrada);
  concedidos += 1;
} catch (erro) {
  /*
   * P2002 e SUCESSO: outra requisicao ja gravou este mesmo fato. Deixar o
   * erro subir transformaria duas abas abertas no totem num 500 na cara do
   * aluno -- e a idempotencia que a chave unica garante existe justamente
   * para que isso nao seja um problema.
   */
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002')) {
    throw erro;
  }
}
```

Registre `EngagementXpService` e `{ provide: PORTA_DE_XP, useClass: EngagementXpRepository }` em `engagement.module.ts`, e **exporte `EngagementXpService`** (o `KioskModule` vai consumi-lo).

- [ ] **Step 4: Executar os testes**

Run: `pnpm --filter api test -- engagement-xp.service`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement/engagement-xp.repository.ts apps/api/src/modules/engagement/engagement-xp.repository.fake.ts apps/api/src/modules/engagement/engagement-xp.service.ts apps/api/src/modules/engagement/engagement-xp.service.spec.ts apps/api/src/modules/engagement/engagement.module.ts
git commit -m "feat(engagement): concede XP por sessao, de forma idempotente

Colisao de unicidade e tratada como SUCESSO: duas abas abertas no totem
nao podem virar 500 na cara do aluno.

O servico de XP nao chama resolverExposicao de proposito -- M5-BR-002 diz
que recusar o ranking nao reduz XP, e ha teste que prende essa decisao."
```

---

### Task 7: Concorrência real — a prova do `M5-AC-002`

**Files:**
- Modify: `apps/api/test/integration/xp-e-ranking.int-spec.ts`

**Interfaces:**
- Consumes: `EngagementXpService.sincronizarXp` da Task 6.
- Produces: nada (só evidência).

- [ ] **Step 1: Escrever o teste de replay concorrente**

Contra Postgres de verdade, seguindo `billing-assinatura-mensal.int-spec.ts`. **Não use dublê aqui** — a memória `duble-esconde-ato-errado` registra o fake que devolvia o id certo pelo motivo errado.

```ts
/*
 * `M5-AC-002`: "reprocessar cem vezes o mesmo evento gera uma concessao de
 * XP".
 *
 * Contra Postgres de verdade, com as cem chamadas de fato concorrentes. Um
 * teste sequencial aqui passaria verde sem medir nada: a guarda que le
 * antes de escrever so falha quando duas escritas se cruzam, e em serie
 * elas nunca se cruzam. A memoria `revisao-adversarial-acha-corrida`
 * registra tres versoes erradas deste mesmo teste na F17.
 */
it('cem sincronizacoes CONCORRENTES geram uma concessao so', async () => {
  const { studentId, sessionId } = await alunoComUmaSessaoConfirmada();

  await Promise.allSettled(
    Array.from({ length: 100 }, () => servico.sincronizarXp(contexto, studentId, AGORA)),
  );

  const movimentos = await db.xpLedgerEntry.findMany({
    where: { tenantId, studentId, sourceKind: 'ATTENDANCE_SESSION', sourceId: sessionId },
  });

  expect(movimentos).toHaveLength(1);
  expect(movimentos[0]?.points).toBe(10);

  /*
   * O SALDO tambem, e nao so a contagem de linhas: a memoria
   * `idempotencia-derivada-de-contagem` registra a cobranca em dobro que
   * passou por uma guarda que contava certo e somava errado.
   */
  const saldo = await db.studentXpBalance.findUniqueOrThrow({
    where: { tenantId_studentId_localMonth: { tenantId, studentId, localMonth: '2026-08' } },
  });
  expect(saldo.points).toBe(10);
  expect(saldo.entryCount).toBe(1);
});

/*
 * `M5-AC-003`: duas entradas no mesmo dia nao duplicam XP. A garantia vem
 * da F24 -- duas passagens no mesmo dia local formam UMA
 * `StudentAttendanceSession` -- e este teste prova que a cadeia inteira
 * preserva isso, nao so a tabela isolada.
 */
it('duas passagens no mesmo dia geram um unico GRANT', async () => {
  const { studentId } = await alunoComDuasPassagensNoMesmoDia();

  await servico.sincronizarXp(contexto, studentId, AGORA);

  const movimentos = await db.xpLedgerEntry.findMany({ where: { tenantId, studentId } });

  expect(movimentos).toHaveLength(1);
});

/*
 * `M5-NFR-002`: a projecao e reconstruivel. Apagar o saldo e refaze-lo do
 * ledger tem de dar o mesmo numero -- se nao der, o ledger deixou de ser a
 * fonte da verdade sem ninguem perceber.
 */
it('reconstroi o saldo a partir do ledger', async () => {
  const { studentId } = await alunoComTresSessoes();
  await servico.sincronizarXp(contexto, studentId, AGORA);

  const antes = await db.studentXpBalance.findUniqueOrThrow({
    where: { tenantId_studentId_localMonth: { tenantId, studentId, localMonth: '2026-08' } },
  });

  await db.studentXpBalance.deleteMany({ where: { tenantId, studentId } });
  await servico.reconstruirProjecao(contexto, studentId);

  const depois = await db.studentXpBalance.findUniqueOrThrow({
    where: { tenantId_studentId_localMonth: { tenantId, studentId, localMonth: '2026-08' } },
  });

  expect(depois.points).toBe(antes.points);
  expect(depois.entryCount).toBe(antes.entryCount);
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test:integration -- xp-e-ranking`
Expected: FAIL — `reconstruirProjecao` não existe ainda.

- [ ] **Step 3: Implementar `reconstruirProjecao`**

Em `EngagementXpService`: lê todos os movimentos do aluno, agrupa por `localMonth`, soma com `somarSaldo`, faz `upsert` em `StudentXpBalance`. Sem tocar no ledger.

- [ ] **Step 4: Executar os testes**

Run: `pnpm --filter api test:integration -- xp-e-ranking`
Expected: PASS. **Se o teste de concorrência passar de primeira, desconfie:** plante uma falha (remova a chave `@@unique` numa migration local descartável) e confirme que ele FICA VERMELHO. A memória `lint-verde-sem-canario` registra que regra ausente é indistinguível de regra satisfeita. Desfaça a migration descartável depois.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/integration/xp-e-ranking.int-spec.ts apps/api/src/modules/engagement/engagement-xp.service.ts
git commit -m "test(engagement): prova M5-AC-002 com cem chamadas concorrentes

Contra Postgres de verdade e com as cem chamadas de fato paralelas: em
serie o teste passaria verde sem medir nada, porque a guarda so falha
quando duas escritas se cruzam.

Assere o SALDO e nao so a contagem de linhas -- guarda que conta certo e
soma errado ja cobrou o aluno em dobro nesta base."
```

---

### Task 8: Snapshot de ranking — gerar, reter e publicar

**Files:**
- Create: `apps/api/src/modules/engagement/engagement-ranking.repository.ts`
- Create: `apps/api/src/modules/engagement/engagement-ranking.repository.fake.ts`
- Create: `apps/api/src/modules/engagement/engagement-ranking.service.ts`
- Create: `apps/api/src/modules/engagement/engagement-ranking.service.spec.ts`
- Modify: `apps/api/src/modules/engagement/engagement.module.ts`

**Interfaces:**
- Consumes: `classificar` (Task 5), `resolverExposicao` (F30, já existe), `TenantContext`.
- Produces:
  - `const PORTA_DE_RANKING: symbol`
  - `class EngagementRankingService` com `gerarSnapshot(contexto, gymUnitId, mes, agora)`, `publicar(contexto, snapshotId, agora)`, `lerPlacarPublicado(contexto, gymUnitId, mes)`, `posicaoDoAluno(contexto, gymUnitId, mes, studentId)`
  - `interface EntradaPublicaDoPlacar { position: number; nomeExibido: string; points: number }` — **sem `studentId`**

- [ ] **Step 1: Escrever os testes**

```ts
describe('EngagementRankingService.gerarSnapshot', () => {
  it('retem a categoria abaixo da coorte minima', async () => {
    fake.comCoorteMinima(5);
    fake.comSaldos(quatroAlunos);

    const snapshot = await servico.gerarSnapshot(contexto, 'unidade-1', '2026-08', AGORA);

    expect(snapshot.status).toBe('WITHHELD');
    expect(snapshot.entries).toEqual([]);
  });

  it('gera DRAFT quando a coorte alcanca o minimo', async () => {
    fake.comCoorteMinima(5);
    fake.comSaldos(cincoAlunos);

    expect((await servico.gerarSnapshot(contexto, 'unidade-1', '2026-08', AGORA)).status).toBe('DRAFT');
  });

  /*
   * A coorte conta APENAS quem apareceria. Contar quem esta em opt-out
   * inflaria o numero e publicaria um placar de tres pessoas alegando cinco.
   */
  it('nao conta aluno em opt-out na coorte', async () => {
    fake.comCoorteMinima(5);
    fake.comSaldos(cincoAlunos);
    fake.comOptOut(cincoAlunos[0]!.studentId);

    expect((await servico.gerarSnapshot(contexto, 'unidade-1', '2026-08', AGORA)).status).toBe('WITHHELD');
  });
});

describe('EngagementRankingService.publicar', () => {
  it('recusa republicar um snapshot ja publicado', async () => {
    const snapshot = await publicado();

    await expect(servico.publicar(contexto, snapshot.id, AGORA)).rejects.toThrow(
      'RANKING_SNAPSHOT_IMUTAVEL',
    );
  });
});

describe('EngagementRankingService.lerPlacarPublicado', () => {
  /*
   * O CASO CENTRAL DA FATIA. O snapshot congela pontuacao; quem aparece e
   * decidido AGORA. Se o nome fosse gravado na entrada, este aluno
   * continuaria estampado num artefato imutavel, e a unica saida seria
   * mutar o que o M5-AC-007 proibe mutar.
   */
  it('omite quem pediu opt-out DEPOIS da publicacao, sem tocar no snapshot', async () => {
    const snapshot = await publicadoCom(['ana', 'bruno', 'carla', 'diego', 'elisa']);

    fake.comOptOut('bruno');

    const placar = await servico.lerPlacarPublicado(contexto, 'unidade-1', '2026-08');

    expect(placar.map((e) => e.nomeExibido)).not.toContain('Bruno');

    const entradas = await fake.entradasDoSnapshot(snapshot.id);
    expect(entradas).toHaveLength(5);
  });

  it('omite aluno inativo', async () => {
    await publicadoCom(['ana', 'bruno']);
    fake.comAlunoInativo('bruno');

    expect(
      (await servico.lerPlacarPublicado(contexto, 'unidade-1', '2026-08')).map((e) => e.nomeExibido),
    ).not.toContain('Bruno');
  });

  it('usa o apelido aprovado quando o aluno escolheu apelido', async () => {
    await publicadoCom(['ana']);
    fake.comApelidoAprovado('ana', 'Aninha');

    expect((await servico.lerPlacarPublicado(contexto, 'unidade-1', '2026-08'))[0]?.nomeExibido).toBe('Aninha');
  });

  it('nao vaza apelido pendente de moderacao', async () => {
    await publicadoCom(['ana']);
    fake.comApelidoPendente('ana', 'ApelidoNaoAprovado');

    const nome = (await servico.lerPlacarPublicado(contexto, 'unidade-1', '2026-08'))[0]?.nomeExibido;

    expect(nome).not.toBe('ApelidoNaoAprovado');
    expect(nome).toBe('Ana');
  });

  /*
   * `M5-AC-001`. O DTO publico nao carrega identificador interno nem nome
   * civil completo -- e este teste inspeciona o JSON serializado, nao as
   * chaves que o tipo promete, porque o tipo nao viaja pela rede.
   */
  it('o DTO publico nao contem studentId nem nome civil', async () => {
    await publicadoCom(['ana']);

    const serializado = JSON.stringify(
      await servico.lerPlacarPublicado(contexto, 'unidade-1', '2026-08'),
    );

    expect(serializado).not.toContain('studentId');
    expect(serializado).not.toContain('Ana Souza Lima');
  });

  it('placar retido nao devolve entrada nenhuma', async () => {
    await retido();

    expect(await servico.lerPlacarPublicado(contexto, 'unidade-1', '2026-08')).toEqual([]);
  });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- engagement-ranking.service`
Expected: FAIL — serviço não existe.

- [ ] **Step 3: Implementar**

`lerPlacarPublicado` carrega as entradas do snapshot **e** os dados de exposição atuais de cada aluno, chama `resolverExposicao()` por entrada e descarta as que devolvem `exibe: false`.

```ts
/**
 * O placar como o publico o ve.
 *
 * `resolverExposicao()` roda AQUI, na leitura, e nao na materializacao do
 * snapshot -- e essa e a decisao mais importante desta fatia.
 *
 * O snapshot e imutavel (`M5-AC-007`) e congela PONTUACAO E POSICAO. Se ele
 * congelasse tambem o NOME, um aluno que pedisse opt-out depois da
 * publicacao continuaria estampado nele, e a unica forma de tirar seria
 * reescrever um artefato que o proprio criterio de aceite proibe
 * reescrever. `M5-FR-003` e `M5-NFR-003` exigem que ele suma da proxima
 * leitura em ate 15 minutos; e o que acontece, sem tocar em nada.
 *
 * A posicao NAO e recalculada apos a remocao: quem era 3o continua 3o, e o
 * 2o simplesmente nao aparece. Renumerar exporia por deducao quem saiu.
 */
async lerPlacarPublicado(
  contexto: TenantContext,
  gymUnitId: string,
  mes: string,
): Promise<readonly EntradaPublicaDoPlacar[]> {
  const snapshot = await this.porta.snapshotPublicado(contexto, gymUnitId, mes);

  if (!snapshot) return [];

  const entradas = await this.porta.entradasComExposicao(contexto, snapshot.id);

  return entradas.flatMap((entrada) => {
    const exposicao = resolverExposicao({
      decisao: entrada.decisao,
      perfil: entrada.perfil,
      primeiroNome: entrada.primeiroNome,
      statusDoAluno: entrada.statusDoAluno,
    });

    return exposicao.exibe
      ? [{ position: entrada.position, nomeExibido: exposicao.nome, points: entrada.points }]
      : [];
  });
}
```

- [ ] **Step 4: Executar os testes**

Run: `pnpm --filter api test -- engagement-ranking.service`
Expected: PASS, 10 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement/engagement-ranking.repository.ts apps/api/src/modules/engagement/engagement-ranking.repository.fake.ts apps/api/src/modules/engagement/engagement-ranking.service.ts apps/api/src/modules/engagement/engagement-ranking.service.spec.ts apps/api/src/modules/engagement/engagement.module.ts
git commit -m "feat(engagement): gera, retem e publica placar mensal

resolverExposicao roda na LEITURA, nunca na materializacao. O snapshot
congela pontuacao e posicao; quem aparece e decidido agora -- e por isso o
aluno que pede opt-out depois da publicacao some da proxima leitura sem que
ninguem reescreva um artefato imutavel.

A posicao nao e renumerada apos a remocao: renumerar exporia por deducao
quem saiu."
```

---

### Task 9: Ponte do totem e endpoints

**Files:**
- Create: `apps/api/src/modules/kiosk/kiosk-xp.service.ts`
- Modify: `apps/api/src/modules/kiosk/kiosk.controller.ts`
- Modify: `apps/api/src/modules/kiosk/kiosk.module.ts`
- Modify: `apps/kiosk/lib/rotas-da-ponte.ts`
- Modify: `apps/kiosk/lib/rotas-da-ponte.spec.ts`
- Modify: `packages/api-contracts/src/kiosk-config.ts`
- Modify: `apps/api/test/integration/xp-e-ranking.int-spec.ts`

**Interfaces:**
- Consumes: `EngagementXpService`, `EngagementRankingService`, `KioskAreaDoAlunoService.resolver()`.
- Produces:
  - `GET /api/v1/kiosk/sessions/:id/engajamento/xp` → `{ saldoDoMes, mes, movimentos: [{ pontos, regra, quando }], conquistas: [{ titulo, desbloqueadaEm, revertida }], posicao: number | null }`
  - `IndicadoresDaUnidade` ganha `placar: readonly EntradaPublicaDoPlacar[]` — **o mesmo tipo da Task 8**, não uma cópia estrutural. Reexporte-o de `packages/api-contracts`; duas definições do mesmo formato divergem na primeira mudança, e a que carrega dado público é a pior para divergir.
  - `KioskConfig.modulos` ganha `xp: boolean`

- [ ] **Step 1: Escrever os testes de integração HTTP**

```ts
it('GET xp devolve saldo, movimentos explicaveis e posicao', async () => {
  const { sessionId } = await sessaoDoAlunoComXp();

  const resposta = await pedir(`/api/v1/kiosk/sessions/${sessionId}/engajamento/xp`);

  expect(resposta.status).toBe(200);
  expect(resposta.body).toMatchObject({ saldoDoMes: 10, mes: '2026-08' });
  /* `M5-FR-004` e §13 do PRD: sempre mostrar POR QUE o aluno recebeu. */
  expect(resposta.body.movimentos[0]).toMatchObject({ pontos: 10, regra: expect.any(String) });
});

/*
 * Cada endpoint da area do aluno so serve O ALUNO DAQUELA SESSAO. A
 * memoria `vazamento` e o `tenant-isolation.int-spec.ts` existem porque
 * este e o erro que mais custa caro.
 */
it('nao devolve XP de aluno de outra sessao', async () => {
  const { sessionId } = await sessaoDoAlunoComXp();
  const outro = await outroAlunoComXp();

  const resposta = await pedir(`/api/v1/kiosk/sessions/${sessionId}/engajamento/xp`);

  expect(JSON.stringify(resposta.body)).not.toContain(outro.studentId);
});

it('o heartbeat entrega o placar ja sem quem pediu opt-out', async () => {
  await placarPublicadoCom(['ana', 'bruno', 'carla', 'diego', 'elisa']);
  await optOut('bruno');

  const resposta = await heartbeat();

  expect(JSON.stringify(resposta.body.indicadores.placar)).not.toContain('Bruno');
  expect(JSON.stringify(resposta.body.indicadores.placar)).not.toContain('studentId');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test:integration -- xp-e-ranking`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Implementar**

`KioskXpService` recebe `EngagementXpService` e `EngagementRankingService` — **nunca o repositório nem o Prisma** (regra de arquitetura 9). Espelhe `kiosk-engajamento.service.ts`.

No controller, siga a forma dos endpoints da área do aluno já existentes: `@Get('sessions/:id/engajamento/xp')`, resolver a sessão por `KioskAreaDoAlunoService`, `@ApiOkResponse` com o schema explícito.

No heartbeat, acrescente `placar` a `indicadores`.

```ts
/*
 * O placar chega pelo HEARTBEAT, com os nomes JA RESOLVIDOS no servidor.
 *
 * `blocos-publicos.tsx` declara que nenhum dado de aluno chega ate ele e
 * que a tela publica nao fala com a rede (`M3.5-BR-001`, F51). Um bloco de
 * ranking e, por definicao, dado de aluno na tela publica -- e a unica
 * forma de manter as duas travas e o servidor entregar nome ja filtrado,
 * sem `studentId`, pelo canal que ja existe.
 *
 * Placar retido ou modulo desligado devolve lista vazia, e o bloco sai do
 * rodizio -- nao aparece cinza, nao aparece vazio.
 */
```

Em `rotas-da-ponte.ts`, acrescente o padrão — **um por endpoint, ancorado**, como o arquivo exige:

```ts
new RegExp(`^sessions/${ID_DE_SESSAO}/engajamento/xp$`),
```

E o teste correspondente em `rotas-da-ponte.spec.ts`, seguindo os que já estão lá (inclusive o caso que prova que `engajamento/xp/../../admin` **não** passa).

Em `kiosk-config.ts`, acrescente `xp: z.boolean()` a `modulos` e `xp: false` ao `CONFIG_PADRAO_DO_TOTEM` — **desligado por padrão**, como `ranking` nasceu na F50. Acrescente a asserção em `kiosk-config.spec.ts`, que compara o objeto inteiro com `toEqual`.

- [ ] **Step 4: Gerar e conferir o contrato**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test:integration -- xp-e-ranking && pnpm --filter @arenahub/api-contracts test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/kiosk apps/kiosk/lib/rotas-da-ponte.ts apps/kiosk/lib/rotas-da-ponte.spec.ts packages/api-contracts/src apps/api/test/integration/xp-e-ranking.int-spec.ts packages/contracts/openapi/openapi.yaml
git commit -m "feat(kiosk): expoe XP do aluno e placar pelo heartbeat

O placar viaja pelo heartbeat com os nomes ja resolvidos no servidor: a
tela publica nao pode ganhar fetch nem receber studentId, e essa e a unica
forma de servir ranking sem quebrar a trava estrutural da F51."
```

---

### Task 10: Telas do totem

**Files:**
- Create: `apps/kiosk/components/xp.tsx`
- Create: `apps/kiosk/components/xp.spec.tsx`
- Modify: `apps/kiosk/components/blocos-publicos.tsx`
- Modify: `apps/kiosk/components/blocos-publicos.spec.tsx`
- Modify: `apps/kiosk/lib/modulos.ts`
- Modify: `apps/kiosk/lib/modulos.spec.ts`
- Modify: `apps/kiosk/components/minha-area.tsx`

**Interfaces:**
- Consumes: `GET /api/kiosk/sessions/:id/engajamento/xp` (Task 9), `IndicadoresDaUnidade.placar`.
- Produces: componente `<Xp />`; card `xp` na grade; bloco `RANKING` no rodízio.

- [ ] **Step 1: Escrever os testes**

```tsx
describe('<Xp />', () => {
  it('mostra o saldo do mes', () => {
    render(<Xp dados={dadosComSaldo(120)} />);

    expect(screen.getByText('120')).toBeInTheDocument();
  });

  /*
   * `M5-FR-004` e §13 do PRD: "sempre mostrar por que o aluno recebeu XP".
   * Saldo sem procedencia e numero magico.
   */
  it('explica de onde veio cada ponto', () => {
    render(<Xp dados={dadosCom([{ pontos: 10, regra: 'Treino do dia', quando: '2026-08-10' }])} />);

    expect(screen.getByText(/Treino do dia/u)).toBeInTheDocument();
    expect(screen.getByText(/10/u)).toBeInTheDocument();
  });

  it('mostra conquista revertida sem apagar o desbloqueio', () => {
    render(<Xp dados={dadosComConquistaRevertida('10 treinos', 'passagem corrigida')} />);

    expect(screen.getByText('10 treinos')).toBeInTheDocument();
    expect(screen.getByText(/passagem corrigida/u)).toBeInTheDocument();
  });

  /*
   * `M5-BR-010`: XP nao tem valor financeiro e nao se transfere. Palavra de
   * dinheiro na tela sugere o contrario.
   */
  it('nao usa linguagem financeira', () => {
    const { container } = render(<Xp dados={dadosComSaldo(120)} />);

    expect(container.textContent).not.toMatch(/R\$|saldo em conta|resgatar|trocar por/iu);
  });

  it('sem posicao no placar, nao promete lugar nenhum', () => {
    render(<Xp dados={{ ...dadosComSaldo(10), posicao: null }} />);

    expect(screen.queryByText(/lugar/iu)).not.toBeInTheDocument();
  });
});

describe('<BlocosPublicos /> com placar', () => {
  it('mostra os nomes que o heartbeat entregou', () => {
    render(<BlocosPublicos config={configComRanking} indicadores={indicadoresComPlacar} />);

    expect(screen.getByText('Aninha')).toBeInTheDocument();
  });

  it('placar vazio tira o bloco do rodizio', () => {
    render(<BlocosPublicos config={configComRanking} indicadores={{ ...indicadores, placar: [] }} />);

    expect(screen.queryByText(/ranking|placar/iu)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter kiosk test -- xp blocos-publicos`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar**

Siga `DS-TOTEM.md` e o estilo de `saude.tsx`/`historico-de-pagamentos.tsx`: token de cor, nunca hex; toque de 44px mínimo; sem `Alert`.

Em `modulos.ts`, acrescente o card **na posição que `DS-TOTEM.md` §5.2 indica** — se o documento não o previr, ponha depois de `ranking` e registre a escolha no PR:

```ts
{
  campo: 'xp',
  titulo: 'Meus pontos',
  destino: 'XP, conquistas e posição',
  natureza: 'leitura',
},
```

No bloco `RANKING` de `blocos-publicos.tsx`: **não acrescente `fetch`, não importe `SessaoDoAluno`**. O placar vem por prop, como os indicadores. Bloco com placar vazio não entra em `blocosVisiveis`.

- [ ] **Step 4: Executar os testes**

Run: `pnpm --filter kiosk test && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Abrir a tela de verdade**

Suba `pnpm dev`, semeie com `pnpm db:demo`, abra o totem, identifique um aluno e **olhe a tela**. A memória `ci-verde-nao-prova-tela` registra três defeitos numa entrega que só apareceram abrindo o navegador — e a F30 teve cinco falhas de fiação, duas delas visíveis só assim.

Confira: o card aparece na grade; o XP mostra procedência; o placar gira no hero; nenhum erro no console.

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/components apps/kiosk/lib/modulos.ts apps/kiosk/lib/modulos.spec.ts
git commit -m "feat(kiosk): tela de XP do aluno e bloco de placar no hero

A tela explica de onde veio cada ponto -- saldo sem procedencia e numero
magico, e o PRD pede a explicacao no §13.

O bloco do hero recebe o placar por prop: nem fetch, nem SessaoDoAluno,
nem studentId cruzam a fronteira da tela publica."
```

---

### Task 11: Painel — publicar placar e ajustar XP

**Files:**
- Create: `apps/api/src/modules/engagement/engagement-xp.controller.ts`
- Create: `apps/api/src/modules/engagement/engagement-xp.controller.spec.ts`
- Create: `apps/admin-web/app/(protected)/engajamento/placar/page.tsx`
- Create: `apps/admin-web/components/engajamento/painel-do-placar.tsx`
- Create: `apps/admin-web/components/engajamento/painel-do-placar.spec.tsx`
- Modify: `apps/api/src/modules/engagement/engagement.module.ts`

**Interfaces:**
- Consumes: `EngagementRankingService`, `EngagementXpService`.
- Produces:
  - `POST /api/v1/engagement/rankings/:gymUnitId/:mes/gerar` (permissão `engagement.moderate`)
  - `POST /api/v1/engagement/rankings/:snapshotId/publicar`
  - `POST /api/v1/engagement/xp/:studentId/ajustar` — corpo `{ pontos, motivo, idempotencyKey }`

- [ ] **Step 1: Escrever os testes**

```ts
it('exige permissao para publicar', async () => {
  await expect(semPermissao().post(`/api/v1/engagement/rankings/${id}/publicar`)).resolves.toMatchObject({ status: 403 });
});

it('ajuste exige motivo', async () => {
  const resposta = await comPermissao()
    .post(`/api/v1/engagement/xp/${studentId}/ajustar`)
    .send({ pontos: -10, motivo: '', idempotencyKey: 'k1' });

  expect(resposta.status).toBe(400);
});

/*
 * `M5-FR-007` e `M5-AC-010`: correcao e movimento compensatorio. Nao ha
 * rota de edicao, e o movimento original continua no ledger.
 */
it('ajuste grava movimento compensatorio sem apagar o original', async () => {
  const original = await concessaoExistente();

  await comPermissao()
    .post(`/api/v1/engagement/xp/${studentId}/ajustar`)
    .send({ pontos: -10, motivo: 'passagem corrigida', idempotencyKey: 'k1' });

  const movimentos = await db.xpLedgerEntry.findMany({ where: { tenantId, studentId }, orderBy: { createdAt: 'asc' } });

  expect(movimentos).toHaveLength(2);
  expect(movimentos[0]?.id).toBe(original.id);
  expect(movimentos[1]).toMatchObject({ type: 'ADJUSTMENT', points: -10, reason: 'passagem corrigida' });
});

it('mesmo idempotencyKey nao ajusta duas vezes', async () => {
  const ajuste = () =>
    comPermissao()
      .post(`/api/v1/engagement/xp/${studentId}/ajustar`)
      .send({ pontos: -10, motivo: 'passagem corrigida', idempotencyKey: 'k1' });

  await ajuste();
  await ajuste();

  expect(await db.xpLedgerEntry.count({ where: { tenantId, studentId, type: 'ADJUSTMENT' } })).toBe(1);
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- engagement-xp.controller`
Expected: FAIL — controller não existe.

- [ ] **Step 3: Implementar**

Controller com `@RequirePermissions('engagement.moderate')`, Zod no boundary, `TenantContextService.require()`. `idempotencyKey` vira o `sourceId` do movimento `MANUAL_ADJUSTMENT` — a chave única já garante o resto.

Tela do painel seguindo `DS-PAINEL.md`: lista de snapshots por unidade e mês, ação de gerar e publicar, e o aviso de `WITHHELD` com o motivo. **Sem campo de edição de posição.**

- [ ] **Step 4: Executar os testes**

Run: `pnpm --filter api test -- engagement-xp.controller && pnpm --filter admin-web test -- painel-do-placar && pnpm openapi:generate && pnpm openapi:check`
Expected: PASS.

- [ ] **Step 5: Abrir a tela do painel**

Mesmo motivo da Task 10, Step 5.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/engagement apps/admin-web packages/contracts/openapi/openapi.yaml
git commit -m "feat(engagement): publica placar e ajusta XP pelo painel

Nao ha rota de edicao de movimento nem de posicao: correcao e movimento
compensatorio com motivo obrigatorio, e o original continua no ledger
(M5-FR-007)."
```

---

### Task 12: Fechamento — evidência, documentação e PR

**Files:**
- Modify: `docs/TESTS.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/CONVENTION.md`
- Modify: `docs/specs/SPEC-031-xp-e-conquistas.md`
- Modify: `docs/specs/SPEC-033-rankings-privados-por-padrao.md`

- [ ] **Step 1: Rodar o gate local inteiro**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build`
Expected: tudo verde. **`pnpm test` não roda integração** — a memória `pnpm-test-nao-roda-integracao` registra que quase passou uma avaliação duplicada por causa disso. Rode os dois.

- [ ] **Step 2: Gerar o relatório de evidência**

Run: `pnpm test:report && pnpm test:report:selfcheck`

Confira a contagem de arquivos contra uma contagem independente (`git diff --name-only main...HEAD | wc -l`) — a memória `selfcheck-conta-o-que-acha` registra guarda verde subcontando 17 arquivos.

- [ ] **Step 3: Numerar as invariantes novas em `docs/CONVENTION.md`**

Acrescente, na §4, com o próximo número livre:

- ledger de XP é append-only; correção é movimento compensatório vinculado;
- snapshot publicado é imutável — regra alterada não o reescreve;
- exposição do placar é avaliada na leitura, nunca congelada no snapshot;
- classificação é determinística; empate total desempata por `studentId`.

- [ ] **Step 4: Atualizar `STATUS.md` e `DEVELOPMENT.md`**

No **Índice Fatia ↔ SPEC**: F31 entregue; **F33 e SPEC-033 marcadas como absorvidas pela F31 (ADR-047), número queimado**. Atualize a linha do gate do MVP 5.

Em `SPEC-031`, preencha §2 (decisões), §3 (escopo negativo) e §4 (invariantes). Em `SPEC-033`, escreva no topo que a fatia foi absorvida pela F31 e aponte para o ADR-047.

- [ ] **Step 5: Commit e PR**

```bash
git add docs
git commit -m "docs: registra a entrega da F31 e a absorcao da F33"
git push -u origin feat/f31-xp-conquistas-ranking
```

PR com `refs #31` — **nunca `closes`**, que forjaria o aceite do PI. Corpo com: o que entrou, as decisões do ADR-047, o catálogo v1 proposto e o escopo negativo.

- [ ] **Step 6: Esperar o CI**

Run: `gh pr checks <n> --watch` em background. **Confira job a job** — a memória `gh-pr-checks-watch-mente-no-exit` registra saída 0 com job vermelho. Use `gh run watch <id> --exit-status`.

- [ ] **Step 7: Depois do merge**

Preencha o número do PR nas linhas de `TESTS.md`, `STATUS.md` e `DEVELOPMENT.md` — a linha nasce com `—` e o `--check` **não valida esse campo** (memória `preencher-pr-no-tests-md-apos-merge`). Aplique `proplan:done` na issue #31 e confira que ela **não** foi fechada (memória `merge-pode-fechar-issue-sem-closes`) — fechar forja o aceite do PI.

Pergunte ao PI se roda `/graphify . --update`.

---

## Verificação da fatia

- [ ] `pnpm --filter api test -- regra-de-xp movimento-de-xp conquista classificacao` → PASS
- [ ] `pnpm --filter api test -- engagement-xp engagement-ranking` → PASS
- [ ] `pnpm --filter api test:integration -- xp-e-ranking` → PASS, incluindo as 100 chamadas concorrentes
- [ ] `pnpm --filter kiosk test && pnpm --filter admin-web test` → PASS
- [ ] `pnpm lint && pnpm typecheck && pnpm build && pnpm openapi:check` → PASS
- [ ] A tela do totem e a do painel **abertas no navegador**, com dado de seed
