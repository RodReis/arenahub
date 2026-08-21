# Avaliação multiarquivo — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Três arquivos da mesma medição mensal (bioimpedância `CF610_G`, análise Unique Health, ECG OMRON) viram **uma** avaliação, revisada de uma vez, comparável mês a mês.

**Architecture:** Inverte a relação `AssessmentImport` ↔ `BodyAssessment` de 1:1 para N:1. Os arquivos sobem individualmente (cada um com seu antivírus e extrator), formam uma sessão de revisão consolidada com deduplicação de campos concordantes, e uma única confirmação humana cria a avaliação com as medidas de todos. O enum de tipos cresce de 15 para 34 para cobrir segmentares e composição.

**Tech Stack:** NestJS + Prisma + PostgreSQL (api), Next.js App Router (admin-web), Jest (api), Vitest + Testing Library (web).

**Spec:** [`docs/superpowers/specs/2026-08-21-avaliacao-multiarquivo-design.md`](../specs/2026-08-21-avaliacao-multiarquivo-design.md)

## Global Constraints

- **Idioma:** código e identificadores em inglês; documentação, commits e texto de interface em pt-BR.
- **INV-103:** nenhum valor extraído vira histórico sem confirmação humana explícita.
- **INV-104:** ausência de dado **nunca** é zero. `null`/`undefined` jamais viram `0`.
- **INV-105:** unidade original preservada junto da canônica.
- **Regra de arquitetura nº 8:** IA e OCR nunca publicam dado de saúde sozinhos.
- **ADR-035:** o ECG é **guardado e citado, nunca interpretado**. Nenhum código deste plano classifica, pontua ou decide a partir do achado cardíaco.
- **Sem dado real de aluno** em fixture, golden file ou log — nome, CPF e datas sintéticos.
- **Sem hex literal** no `admin-web`; tokens do design system (`docs/design/DS-PAINEL.md`).
- **Dinheiro/valores decimais:** `Decimal`, nunca `float`.
- **Gate local antes do push:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`.

**Pré-requisito bloqueante:** ADR aceito pelo PI cobrindo a migração 1:N e o contrato `body-evolution`. **A Task 2 não começa sem ele.** Tasks 1 e 7 (domínio puro) podem rodar antes.

---

### Task 1: Tipos de medida — 15 → 34

**Files:**
- Modify: `apps/api/src/modules/health/domain/medida.ts`
- Test: `apps/api/src/modules/health/domain/medida.spec.ts`

**Interfaces:**
- Consumes: nada (primeira task)
- Produces: `TipoDeMedida` com 34 membros; `TIPOS_DE_MEDIDA` com 34 entradas; `UNIDADE_CANONICA` cobrindo todos; `TIPOS_SEGMENTARES: readonly TipoDeMedida[]` (os 10 novos segmentares); `REGIAO_DO_TIPO: Readonly<Record<TipoDeMedida, RegiaoCorporal | null>>`; `type RegiaoCorporal = 'ARM_LEFT' | 'ARM_RIGHT' | 'TRUNK' | 'LEG_LEFT' | 'LEG_RIGHT'`

- [ ] **Step 1: Escrever o teste que falha**

Em `medida.spec.ts`, acrescentar:

```typescript
describe('tipos novos da avaliacao multiarquivo', () => {
  it('cobre os 34 tipos, com os 10 segmentares', () => {
    expect(TIPOS_DE_MEDIDA).toHaveLength(34);
    expect(TIPOS_SEGMENTARES).toHaveLength(10);
  });

  it('converte massa segmentar mantendo kg como canonica', () => {
    const medida = converterParaCanonica({
      type: 'SEGMENTAL_MUSCLE_MASS_ARM_RIGHT',
      value: 3.4,
      unit: 'kg',
    });

    expect(medida.canonicalValue).toBeCloseTo(3.4, 4);
    expect(medida.canonicalUnit).toBe('kg');
    expect(medida.originalValue).toBeCloseTo(3.4, 4);
  });

  it('mapeia cada segmentar a sua regiao e os demais a null', () => {
    expect(REGIAO_DO_TIPO.SEGMENTAL_FAT_MASS_TRUNK).toBe('TRUNK');
    expect(REGIAO_DO_TIPO.SEGMENTAL_MUSCLE_MASS_LEG_LEFT).toBe('LEG_LEFT');
    expect(REGIAO_DO_TIPO.WEIGHT).toBeNull();
  });

  it('da unidade canonica a todo tipo novo nao adimensional', () => {
    expect(UNIDADE_CANONICA.BONE_MASS).toBe('kg');
    expect(UNIDADE_CANONICA.SUBCUTANEOUS_FAT_PERCENT).toBe('percent');
    expect(UNIDADE_CANONICA.HEART_RATE).toBeNull();
    expect(UNIDADE_CANONICA.WAIST_HIP_RATIO).toBeNull();
  });
});
```

Importar `TIPOS_SEGMENTARES` e `REGIAO_DO_TIPO` no topo do arquivo de teste.

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @arenahub/api test -- medida.spec
```

Esperado: FAIL — `TIPOS_SEGMENTARES` não existe.

- [ ] **Step 3: Implementar**

Em `medida.ts`, acrescentar ao union `TipoDeMedida` (após `HIP_CIRCUMFERENCE`):

```typescript
  // Segmentares (F-multiarquivo): alimentam o boneco do aluno.
  | 'SEGMENTAL_FAT_MASS_ARM_LEFT'
  | 'SEGMENTAL_FAT_MASS_ARM_RIGHT'
  | 'SEGMENTAL_FAT_MASS_TRUNK'
  | 'SEGMENTAL_FAT_MASS_LEG_LEFT'
  | 'SEGMENTAL_FAT_MASS_LEG_RIGHT'
  | 'SEGMENTAL_MUSCLE_MASS_ARM_LEFT'
  | 'SEGMENTAL_MUSCLE_MASS_ARM_RIGHT'
  | 'SEGMENTAL_MUSCLE_MASS_TRUNK'
  | 'SEGMENTAL_MUSCLE_MASS_LEG_LEFT'
  | 'SEGMENTAL_MUSCLE_MASS_LEG_RIGHT'
  // Composicao que os laudos trazem e o enum nao tinha.
  | 'BONE_MASS'
  | 'BODY_CELL_MASS'
  | 'SUBCUTANEOUS_FAT_MASS'
  | 'SUBCUTANEOUS_FAT_PERCENT'
  | 'SKELETAL_MUSCLE_PERCENT'
  | 'MUSCLE_MASS'
  | 'PROTEIN_PERCENT'
  | 'WAIST_HIP_RATIO'
  // Cardiaco. NUNCA interpretado (ADR-035).
  | 'HEART_RATE';
```

Acrescentar os 19 nomes a `TIPOS_DE_MEDIDA`, na mesma ordem.

Acrescentar a `UNIDADE_CANONICA`: os 10 segmentares → `'kg'`; `BONE_MASS`, `BODY_CELL_MASS`, `SUBCUTANEOUS_FAT_MASS`, `MUSCLE_MASS` → `'kg'`; `SUBCUTANEOUS_FAT_PERCENT`, `SKELETAL_MUSCLE_PERCENT`, `PROTEIN_PERCENT` → `'percent'`; `WAIST_HIP_RATIO` e `HEART_RATE` → `null`.

Acrescentar `WAIST_HIP_RATIO` e `HEART_RATE` a `TIPOS_ADIMENSIONAIS` (razão não tem unidade; bpm é contagem por minuto, não unidade do enum).

Ao final do arquivo:

```typescript
/** Região do corpo de um tipo segmentar. */
export type RegiaoCorporal = 'ARM_LEFT' | 'ARM_RIGHT' | 'TRUNK' | 'LEG_LEFT' | 'LEG_RIGHT';

export const TIPOS_SEGMENTARES: readonly TipoDeMedida[] = [
  'SEGMENTAL_FAT_MASS_ARM_LEFT',
  'SEGMENTAL_FAT_MASS_ARM_RIGHT',
  'SEGMENTAL_FAT_MASS_TRUNK',
  'SEGMENTAL_FAT_MASS_LEG_LEFT',
  'SEGMENTAL_FAT_MASS_LEG_RIGHT',
  'SEGMENTAL_MUSCLE_MASS_ARM_LEFT',
  'SEGMENTAL_MUSCLE_MASS_ARM_RIGHT',
  'SEGMENTAL_MUSCLE_MASS_TRUNK',
  'SEGMENTAL_MUSCLE_MASS_LEG_LEFT',
  'SEGMENTAL_MUSCLE_MASS_LEG_RIGHT',
];

/**
 * Região de cada tipo. `null` para o que não é segmentar.
 *
 * Record COMPLETO de propósito: tipo novo sem entrada aqui quebra a
 * compilação, em vez de sumir calado do boneco.
 */
export const REGIAO_DO_TIPO: Readonly<Record<TipoDeMedida, RegiaoCorporal | null>> = {
  WEIGHT: null, HEIGHT: null, BODY_FAT_PERCENT: null, BODY_FAT_MASS: null,
  LEAN_BODY_MASS: null, SKELETAL_MUSCLE_MASS: null, TOTAL_BODY_WATER: null,
  INTRACELLULAR_WATER: null, EXTRACELLULAR_WATER: null, PROTEIN_MASS: null,
  MINERAL_MASS: null, VISCERAL_FAT_LEVEL: null, BASAL_METABOLIC_RATE: null,
  WAIST_CIRCUMFERENCE: null, HIP_CIRCUMFERENCE: null,
  BONE_MASS: null, BODY_CELL_MASS: null, SUBCUTANEOUS_FAT_MASS: null,
  SUBCUTANEOUS_FAT_PERCENT: null, SKELETAL_MUSCLE_PERCENT: null,
  MUSCLE_MASS: null, PROTEIN_PERCENT: null, WAIST_HIP_RATIO: null,
  HEART_RATE: null,
  SEGMENTAL_FAT_MASS_ARM_LEFT: 'ARM_LEFT',
  SEGMENTAL_FAT_MASS_ARM_RIGHT: 'ARM_RIGHT',
  SEGMENTAL_FAT_MASS_TRUNK: 'TRUNK',
  SEGMENTAL_FAT_MASS_LEG_LEFT: 'LEG_LEFT',
  SEGMENTAL_FAT_MASS_LEG_RIGHT: 'LEG_RIGHT',
  SEGMENTAL_MUSCLE_MASS_ARM_LEFT: 'ARM_LEFT',
  SEGMENTAL_MUSCLE_MASS_ARM_RIGHT: 'ARM_RIGHT',
  SEGMENTAL_MUSCLE_MASS_TRUNK: 'TRUNK',
  SEGMENTAL_MUSCLE_MASS_LEG_LEFT: 'LEG_LEFT',
  SEGMENTAL_MUSCLE_MASS_LEG_RIGHT: 'LEG_RIGHT',
};
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter @arenahub/api test -- medida.spec
pnpm typecheck
```

Esperado: PASS. O typecheck confirma que nenhum `Record<TipoDeMedida, ...>` do repo ficou incompleto — se algum quebrar, completá-lo é parte desta task.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/health/domain/medida.ts apps/api/src/modules/health/domain/medida.spec.ts
git commit -m "feat(health): 19 tipos de medida para laudo multiarquivo"
```

---

### Task 2: Schema e migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_avaliacao_multiarquivo/migration.sql`

**Interfaces:**
- Consumes: os 19 tipos da Task 1 (o enum Prisma espelha o do domínio)
- Produces: `BodyAssessment.imports: AssessmentImport[]`, `BodyAssessment.deviceReport: Json?`, `.deviceModel: String?`, `.deviceSerial: String?`; `AssessmentImport.reviewSessionId: String?`, `.sourceLabel: String?`; `ImportedField.sourceLabel: String?`, `.agreesWithFieldId: String?`, `.referenceMin: Decimal?`, `.referenceMax: Decimal?`, `.standardPercent: Decimal?`

- [ ] **Step 1: Confirmar que a migração é estrutural**

```bash
docker compose ps
psql "$DATABASE_URL" -c "SELECT count(*) FROM assessment_imports WHERE assessment_id IS NOT NULL;"
```

Esperado: `0`. **Se vier diferente de zero, PARE** — há dado a converter, o plano muda e o PI precisa ser avisado antes de prosseguir.

- [ ] **Step 2: Editar o schema**

Em `schema.prisma`:

1. No enum `BodyMeasurementType`, acrescentar os 19 valores da Task 1, na mesma ordem.

2. Em `BodyAssessment` (linha ~3270), trocar:
```prisma
  import       AssessmentImport?
```
por:
```prisma
  /// Os arquivos que originaram esta avaliação. Vazio em avaliação
  /// digitada à mão; um ou mais quando veio de laudo.
  imports      AssessmentImport[]

  /// Índices, classificações e sugestões DO APARELHO (idade corporal,
  /// pontuação, tipo de corpo, peso ideal). Não são medidas: não entram no
  /// gráfico de evolução, porque a fórmula é proprietária e muda com
  /// firmware. Ver §4.4 da spec.
  deviceReport Json?   @map("device_report")
  deviceModel  String? @map("device_model")
  deviceSerial String? @map("device_serial")
```

3. Em `AssessmentImport` (linha ~3672), remover `@unique` de `assessmentId`:
```prisma
  assessmentId String? @map("assessment_id") @db.Uuid
```
e acrescentar:
```prisma
  /// Agrupa os arquivos da MESMA medição. Todos os arquivos de uma sessão
  /// confirmam juntos e produzem UMA avaliação.
  reviewSessionId String? @map("review_session_id") @db.Uuid
  /// Rótulo de origem exibido na revisão (`CF610_G`, `Unique Health`,
  /// `ECG 30s`). Derivado do conteúdo, nunca do nome do arquivo.
  sourceLabel     String? @map("source_label")
```
e o índice:
```prisma
  @@index([tenantId, reviewSessionId])
```

4. Em `ImportedField`, acrescentar:
```prisma
  /// De qual arquivo veio este campo. É a coluna "Origem" da tela.
  sourceLabel String? @map("source_label")

  /// Quando outro arquivo trouxe o MESMO tipo com valor equivalente, este
  /// campo aponta para o primeiro e não vira linha própria na revisão.
  /// Divergência NUNCA é deduplicada: fica como duas linhas para o humano
  /// escolher.
  agreesWithFieldId String? @map("agrees_with_field_id") @db.Uuid

  /// Faixa de referência VIGENTE no laudo, guardada junto da medida: ela é
  /// do fabricante e muda com firmware. Em tabela global, a leitura de
  /// agosto deixaria de fazer sentido em dezembro.
  referenceMin Decimal? @map("reference_min") @db.Decimal(10, 4)
  referenceMax Decimal? @map("reference_max") @db.Decimal(10, 4)
  /// Percentual do padrão que o aparelho reporta (233,3% no braço direito).
  standardPercent Decimal? @map("standard_percent") @db.Decimal(7, 2)
```
e o índice:
```prisma
  @@index([importId, agreesWithFieldId])
```

- [ ] **Step 3: Gerar a migration**

```bash
pnpm --filter @arenahub/database exec prisma migrate dev --name avaliacao_multiarquivo --create-only
```

Abrir o SQL gerado e confirmar: `DROP INDEX` do unique em `assessment_id`, `ALTER TYPE ... ADD VALUE` para os 19 tipos, `ALTER TABLE ... ADD COLUMN` para os novos campos. **Nenhum `DROP COLUMN` e nenhum `DELETE`** — se houver, o schema foi editado errado.

- [ ] **Step 4: Aplicar e validar**

```bash
pnpm --filter @arenahub/database exec prisma migrate dev
pnpm typecheck
```

Esperado: migration aplica, client regenera, typecheck passa.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(health): schema da avaliacao multiarquivo (1:N import-avaliacao)"
```

---

### Task 3: Deduplicação — o domínio puro

**Files:**
- Create: `apps/api/src/modules/health/domain/consolidacao-de-laudos.ts`
- Test: `apps/api/src/modules/health/domain/consolidacao-de-laudos.spec.ts`

**Interfaces:**
- Consumes: `CampoExtraido`, `TipoDeMedida`, `UnidadeDeMedida` de `revisao-de-importacao.ts` e `medida.ts`
- Produces:
  - `type LinhaConsolidada = { readonly type: TipoDeMedida; readonly campos: readonly CampoExtraido[]; readonly concordante: boolean; readonly origens: readonly string[] }`
  - `function consolidar(campos: readonly CampoExtraido[]): LinhaConsolidada[]`
  - `function equivalentes(a: CampoExtraido, b: CampoExtraido): boolean`
  - `function toleranciaDe(tipo: TipoDeMedida): number`

- [ ] **Step 1: Escrever os testes que falham**

```typescript
import { consolidar, equivalentes, toleranciaDe } from './consolidacao-de-laudos.js';
import type { CampoExtraido } from './revisao-de-importacao.js';

function campo(over: Partial<CampoExtraido> & Pick<CampoExtraido, 'id' | 'type'>): CampoExtraido {
  return {
    extractedValue: null, extractedUnit: null, confidence: null,
    sourceLocation: null, state: 'PENDING', reviewedValue: null,
    reviewedUnit: null, sourceLabel: null,
    ...over,
  } as CampoExtraido;
}

describe('consolidar laudos da mesma medicao', () => {
  it('funde campo concordante numa linha so, citando as duas origens', () => {
    const linhas = consolidar([
      campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg', sourceLabel: 'CF610_G' }),
      campo({ id: 'b', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg', sourceLabel: 'Unique Health' }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].concordante).toBe(true);
    expect(linhas[0].origens).toEqual(['CF610_G', 'Unique Health']);
  });

  it('trata arredondamento diferente como o MESMO valor', () => {
    // 92,25 e 92,3 sao o mesmo peso escrito com precisao diferente.
    expect(
      equivalentes(
        campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg' }),
        campo({ id: 'b', type: 'WEIGHT', extractedValue: 92.3, extractedUnit: 'kg' }),
      ),
    ).toBe(true);
  });

  it('NAO funde divergencia real: duas linhas, para o humano escolher', () => {
    const linhas = consolidar([
      campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg', sourceLabel: 'CF610_G' }),
      campo({ id: 'b', type: 'WEIGHT', extractedValue: 88.10, extractedUnit: 'kg', sourceLabel: 'Unique Health' }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].concordante).toBe(false);
    expect(linhas[0].campos).toHaveLength(2);
  });

  it('NAO funde bpm de aparelhos diferentes -- sao medicoes distintas', () => {
    const linhas = consolidar([
      campo({ id: 'a', type: 'HEART_RATE', extractedValue: 89, extractedUnit: null, sourceLabel: 'Unique Health' }),
      campo({ id: 'b', type: 'HEART_RATE', extractedValue: 99, extractedUnit: null, sourceLabel: 'ECG 30s' }),
    ]);

    expect(linhas[0].concordante).toBe(false);
  });

  it('converte antes de comparar: 92,25 kg e 92250 g sao o mesmo peso', () => {
    expect(
      equivalentes(
        campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg' }),
        campo({ id: 'b', type: 'WEIGHT', extractedValue: 92_250, extractedUnit: 'g' }),
      ),
    ).toBe(true);
  });

  it('valor ausente NUNCA e zero e nunca equivale a outro (INV-104)', () => {
    expect(
      equivalentes(
        campo({ id: 'a', type: 'WEIGHT', extractedValue: null, extractedUnit: 'kg' }),
        campo({ id: 'b', type: 'WEIGHT', extractedValue: 0, extractedUnit: 'kg' }),
      ),
    ).toBe(false);
  });

  it('percentual tem tolerancia mais apertada que massa', () => {
    expect(toleranciaDe('BODY_FAT_PERCENT')).toBeLessThan(toleranciaDe('WEIGHT'));
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @arenahub/api test -- consolidacao-de-laudos
```

Esperado: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```typescript
import { converterParaCanonica, type TipoDeMedida } from './medida.js';
import type { CampoExtraido } from './revisao-de-importacao.js';

/**
 * Consolidação dos laudos da MESMA medição (spec §3.3).
 *
 * Funções puras: sem banco, sem relógio, sem rede.
 *
 * ---------------------------------------------------------------------------
 * A ASSIMETRIA É DELIBERADA: ERRAR PARA O LADO DE MOSTRAR.
 * ---------------------------------------------------------------------------
 *
 * Fundir dois valores que divergem ESCONDE do professor que a balança
 * exportou errado — e o número errado vira histórico com selo de confirmado
 * por dois arquivos. Mostrar divergência que era só arredondamento custa um
 * clique. Por isso a tolerância é apertada: o erro barato é o preferido.
 */

/**
 * Quanto dois valores podem diferir e ainda serem "o mesmo".
 *
 * Deriva da PRECISÃO IMPRESSA no laudo, não de palpite: a balança escreve
 * peso com 2 casas (92,25) e o app com 1 (92,3), então meio décimo cobre o
 * arredondamento e nada mais. Percentual é impresso com 1 casa, e diferença
 * de 0,1 ponto em gordura corporal é real — tolerância menor.
 */
export function toleranciaDe(tipo: TipoDeMedida): number {
  if (tipo === 'HEART_RATE') return 0; // bpm é inteiro: 89 e 99 são valores distintos.
  if (tipo === 'WAIST_HIP_RATIO') return 0.005;
  if (tipo.endsWith('_PERCENT')) return 0.05;
  return 0.05;
}

/** Dois campos medem a mesma coisa com o mesmo valor? */
export function equivalentes(a: CampoExtraido, b: CampoExtraido): boolean {
  if (a.type !== b.type) return false;

  // INV-104: ausência não é zero, e ausência não equivale a nada — nem a
  // outra ausência: dois arquivos que não leram o campo não confirmam um
  // ao outro.
  if (a.extractedValue === null || b.extractedValue === null) return false;

  const canonicaA = converterParaCanonica({
    type: a.type, value: a.extractedValue, unit: a.extractedUnit,
  });
  const canonicaB = converterParaCanonica({
    type: b.type, value: b.extractedValue, unit: b.extractedUnit,
  });

  return Math.abs(canonicaA.canonicalValue - canonicaB.canonicalValue) <= toleranciaDe(a.type);
}

export interface LinhaConsolidada {
  readonly type: TipoDeMedida;
  /** Um campo quando concordam; todos quando divergem. */
  readonly campos: readonly CampoExtraido[];
  readonly concordante: boolean;
  readonly origens: readonly string[];
}

/**
 * Agrupa por tipo e decide, por grupo, se é uma linha ou várias.
 *
 * Ordem de entrada preservada: a origem que aparece primeiro é a primeira
 * listada, e a revisão fica estável entre recarregamentos.
 */
export function consolidar(campos: readonly CampoExtraido[]): LinhaConsolidada[] {
  const porTipo = new Map<TipoDeMedida, CampoExtraido[]>();

  for (const campo of campos) {
    const grupo = porTipo.get(campo.type);
    if (grupo === undefined) porTipo.set(campo.type, [campo]);
    else grupo.push(campo);
  }

  const linhas: LinhaConsolidada[] = [];

  for (const [type, grupo] of porTipo) {
    const primeiro = grupo[0];
    const todosConcordam = grupo.every((campo) => equivalentes(primeiro, campo));
    const origens = grupo
      .map((campo) => campo.sourceLabel)
      .filter((label): label is string => label !== null);

    linhas.push({
      type,
      campos: todosConcordam ? [primeiro] : grupo,
      concordante: todosConcordam && grupo.length > 1,
      origens,
    });
  }

  return linhas;
}
```

**Nota para o implementador:** `CampoExtraido` precisa ganhar `readonly sourceLabel: string | null` em `revisao-de-importacao.ts` — acrescente junto, é o mesmo commit conceitual.

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter @arenahub/api test -- consolidacao-de-laudos
```

Esperado: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/health/domain/consolidacao-de-laudos.ts apps/api/src/modules/health/domain/consolidacao-de-laudos.spec.ts apps/api/src/modules/health/domain/revisao-de-importacao.ts
git commit -m "feat(health): consolidacao de laudos com deduplicacao por equivalencia"
```

---

### Task 4: Sessão de revisão — regras de composição

**Files:**
- Create: `apps/api/src/modules/health/domain/sessao-de-revisao.ts`
- Test: `apps/api/src/modules/health/domain/sessao-de-revisao.spec.ts`

**Interfaces:**
- Consumes: `LinhaConsolidada` da Task 3
- Produces:
  - `type TipoDeLaudo = 'BIOIMPEDANCE' | 'ECG' | 'UNKNOWN'`
  - `type ArquivoDaSessao = { readonly importId: string; readonly sourceLabel: string; readonly tipoDeLaudo: TipoDeLaudo }`
  - `type AvaliacaoDaSessao = { readonly pronta: true } | { readonly pronta: false; readonly motivo: MotivoDeBloqueioDaSessao }`
  - `type MotivoDeBloqueioDaSessao = 'SESSION_EMPTY' | 'BIOIMPEDANCE_REQUIRED' | 'DIVERGENCE_UNRESOLVED'`
  - `function sessaoPodeConfirmar(arquivos: readonly ArquivoDaSessao[], linhas: readonly LinhaConsolidada[]): AvaliacaoDaSessao`

- [ ] **Step 1: Escrever os testes que falham**

```typescript
import { sessaoPodeConfirmar, type ArquivoDaSessao } from './sessao-de-revisao.js';
import type { LinhaConsolidada } from './consolidacao-de-laudos.js';

const bio: ArquivoDaSessao = { importId: 'i1', sourceLabel: 'CF610_G', tipoDeLaudo: 'BIOIMPEDANCE' };
const ecg: ArquivoDaSessao = { importId: 'i2', sourceLabel: 'ECG 30s', tipoDeLaudo: 'ECG' };

const linhaResolvida: LinhaConsolidada = {
  type: 'WEIGHT', campos: [{ state: 'CONFIRMED' } as never], concordante: true, origens: ['CF610_G'],
};

describe('quando a sessao pode virar avaliacao', () => {
  it('aceita bioimpedancia sozinha -- o ECG e opcional', () => {
    expect(sessaoPodeConfirmar([bio], [linhaResolvida])).toEqual({ pronta: true });
  });

  it('recusa sessao so com ECG', () => {
    expect(sessaoPodeConfirmar([ecg], [linhaResolvida])).toEqual({
      pronta: false, motivo: 'BIOIMPEDANCE_REQUIRED',
    });
  });

  it('recusa sessao vazia', () => {
    expect(sessaoPodeConfirmar([], [])).toEqual({ pronta: false, motivo: 'SESSION_EMPTY' });
  });

  it('recusa enquanto houver divergencia sem escolha do humano', () => {
    const divergente: LinhaConsolidada = {
      type: 'WEIGHT',
      campos: [{ state: 'PENDING' } as never, { state: 'PENDING' } as never],
      concordante: false,
      origens: ['CF610_G', 'Unique Health'],
    };

    expect(sessaoPodeConfirmar([bio], [divergente])).toEqual({
      pronta: false, motivo: 'DIVERGENCE_UNRESOLVED',
    });
  });

  it('aceita divergencia JA resolvida pelo humano', () => {
    const resolvida: LinhaConsolidada = {
      type: 'WEIGHT',
      campos: [{ state: 'CONFIRMED' } as never, { state: 'DISCARDED' } as never],
      concordante: false,
      origens: ['CF610_G', 'Unique Health'],
    };

    expect(sessaoPodeConfirmar([bio], [resolvida])).toEqual({ pronta: true });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @arenahub/api test -- sessao-de-revisao
```

Esperado: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```typescript
import type { LinhaConsolidada } from './consolidacao-de-laudos.js';

/**
 * Regras de composição de uma sessão de revisão (spec §3.2 e §3.4).
 *
 * Funções puras. Decisão do PI: bioimpedância é obrigatória, ECG é opcional.
 * O ECG sozinho não vira avaliação porque não há composição corporal a
 * comparar — e uma avaliação sem medida corporal seria um ponto vazio na
 * série da F18.
 */

export type TipoDeLaudo = 'BIOIMPEDANCE' | 'ECG' | 'UNKNOWN';

export interface ArquivoDaSessao {
  readonly importId: string;
  readonly sourceLabel: string;
  readonly tipoDeLaudo: TipoDeLaudo;
}

export type MotivoDeBloqueioDaSessao =
  /** Nenhum arquivo na sessão. */
  | 'SESSION_EMPTY'
  /** Só ECG, ou nenhum laudo de bioimpedância reconhecido. */
  | 'BIOIMPEDANCE_REQUIRED'
  /** Dois arquivos discordam num campo e ninguém escolheu ainda. */
  | 'DIVERGENCE_UNRESOLVED';

export type AvaliacaoDaSessao =
  | { readonly pronta: true }
  | { readonly pronta: false; readonly motivo: MotivoDeBloqueioDaSessao };

export function sessaoPodeConfirmar(
  arquivos: readonly ArquivoDaSessao[],
  linhas: readonly LinhaConsolidada[],
): AvaliacaoDaSessao {
  if (arquivos.length === 0) return { pronta: false, motivo: 'SESSION_EMPTY' };

  const temBio = arquivos.some((arquivo) => arquivo.tipoDeLaudo === 'BIOIMPEDANCE');
  if (!temBio) return { pronta: false, motivo: 'BIOIMPEDANCE_REQUIRED' };

  // Divergência exige escolha EXPLÍCITA: enquanto os dois lados estiverem
  // pendentes, ninguém decidiu qual valor é o verdadeiro. Não há default —
  // escolher por ele seria decidir no lugar de quem avalia.
  const divergenciaAberta = linhas.some(
    (linha) => !linha.concordante
      && linha.campos.length > 1
      && linha.campos.every((campo) => campo.state === 'PENDING'),
  );

  if (divergenciaAberta) return { pronta: false, motivo: 'DIVERGENCE_UNRESOLVED' };

  return { pronta: true };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter @arenahub/api test -- sessao-de-revisao
```

Esperado: PASS, 5 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/health/domain/sessao-de-revisao.ts apps/api/src/modules/health/domain/sessao-de-revisao.spec.ts
git commit -m "feat(health): regras de composicao da sessao de revisao"
```

---

### Task 5: Upload em sessão e confirmação única

**Files:**
- Modify: `apps/api/src/modules/health/import.service.ts:240-298` (`confirmar`)
- Modify: `apps/api/src/modules/health/import.repository.ts`
- Modify: `apps/api/src/modules/health/import.controller.ts`
- Test: `apps/api/test/integration/health/sessao-multiarquivo.integration.spec.ts`

**Interfaces:**
- Consumes: `consolidar` (Task 3), `sessaoPodeConfirmar` (Task 4), colunas da Task 2
- Produces:
  - `POST /api/v1/students/:id/assessment-imports` aceita `reviewSessionId` opcional no corpo; sem ele, abre sessão nova e devolve o id gerado
  - `GET /api/v1/assessment-imports/sessions/:sessionId` → `{ sessionId, arquivos: ArquivoDaSessao[], linhas: LinhaConsolidada[], podeConfirmar: AvaliacaoDaSessao }`
  - `POST /api/v1/assessment-imports/sessions/:sessionId/confirm` → `{ assessmentId }`
  - `ImportService.confirmarSessao(contexto, sessionId, revisorId, assessedAt, agora): Promise<{ assessmentId: string }>`

- [ ] **Step 1: Escrever o teste de integração que falha**

```typescript
describe('sessao multiarquivo', () => {
  it('tres arquivos viram UMA avaliacao com as medidas de todos', async () => {
    const sessao = await enviarArquivo(bioCsv, { sourceLabel: 'CF610_G' });
    await enviarArquivo(uniqueCsv, { reviewSessionId: sessao.reviewSessionId, sourceLabel: 'Unique Health' });
    await enviarArquivo(ecgCsv, { reviewSessionId: sessao.reviewSessionId, sourceLabel: 'ECG 30s' });

    await confirmarTodosOsCampos(sessao.reviewSessionId);
    const { assessmentId } = await confirmarSessao(sessao.reviewSessionId);

    const avaliacoes = await prisma.bodyAssessment.findMany({ where: { studentId } });
    expect(avaliacoes).toHaveLength(1);

    const imports = await prisma.assessmentImport.findMany({ where: { assessmentId } });
    expect(imports).toHaveLength(3);
  });

  it('confirmar duas vezes NAO cria duas avaliacoes', async () => {
    const sessao = await prepararSessaoCompleta();

    const [a, b] = await Promise.allSettled([
      confirmarSessao(sessao.reviewSessionId),
      confirmarSessao(sessao.reviewSessionId),
    ]);

    const avaliacoes = await prisma.bodyAssessment.findMany({ where: { studentId } });
    expect(avaliacoes).toHaveLength(1);

    const sucessos = [a, b].filter((r) => r.status === 'fulfilled');
    expect(sucessos).toHaveLength(1);
  });

  it('recusa sessao sem bioimpedancia', async () => {
    const sessao = await enviarArquivo(ecgCsv, { sourceLabel: 'ECG 30s' });
    await confirmarTodosOsCampos(sessao.reviewSessionId);

    await expect(confirmarSessao(sessao.reviewSessionId)).rejects.toMatchObject({
      response: { code: 'BIOIMPEDANCE_REQUIRED' },
    });
  });

  it('nao vaza sessao entre tenants', async () => {
    const sessao = await prepararSessaoCompleta();
    await expect(lerSessaoComoOutroTenant(sessao.reviewSessionId)).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm test:integration -- sessao-multiarquivo
```

Esperado: FAIL — rota de sessão não existe.

- [ ] **Step 3: Implementar**

Índice parcial garantindo a exclusão mútua — acrescentar à migration da Task 2 (ou nova migration):

```sql
-- Uma sessão produz NO MÁXIMO uma avaliação. A garantia é do BANCO, não de
-- um `if` na aplicação: duas confirmações simultâneas passam pela mesma
-- checagem antes de qualquer uma gravar, e contagem derivada já cobrou
-- aluno em dobro neste repo.
CREATE UNIQUE INDEX assessment_imports_session_assessment_uq
  ON assessment_imports (review_session_id)
  WHERE assessment_id IS NOT NULL AND review_session_id IS NOT NULL;
```

Em `import.service.ts`, `confirmarSessao` segue a forma de `confirmar` (linhas 240-298), com estas diferenças:

1. Carrega **todos** os imports da sessão, não um.
2. Consolida os campos de todos com `consolidar`.
3. Valida com `sessaoPodeConfirmar`; bloqueio vira `ConflictException` com o `motivo` como `code`.
4. `valoresAceitos` roda sobre os campos **aceitos** de todas as linhas.
5. Uma `criarRascunho` + `publicar`, com `sourceReference: sessionId`.
6. `confirmar` de cada import da sessão, todos apontando para a mesma `assessmentId`.
7. Apaga os arquivos de todos os imports.
8. **Tudo numa transação** — o caso de uso controla a transação (`CLAUDE.md`).

`deviceReport`, `deviceModel` e `deviceSerial` vêm dos atributos que o extrator separou (Task 6) e são gravados na criação do rascunho.

**Manter `confirmar` (um import) funcionando:** a F19 já entregou esse caminho e há avaliação manual dependendo dele. Internamente, delega para `confirmarSessao` quando o import tem `reviewSessionId`.

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm test:integration -- sessao-multiarquivo
pnpm --filter @arenahub/api test -- import
```

Esperado: PASS — os 4 novos e os testes existentes da F19 intactos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/health packages/database/prisma/migrations apps/api/test/integration/health
git commit -m "feat(health): sessao de revisao com confirmacao unica e idempotente"
```

---

### Task 6: Extrator dos laudos reais

**Files:**
- Create: `apps/api/src/modules/health/provider/laudo-bioimpedancia.extractor.ts`
- Create: `apps/api/test/fixtures/health/laudo-cf610g-sintetico.csv`
- Create: `apps/api/test/fixtures/health/laudo-unique-health-sintetico.csv`
- Create: `apps/api/test/fixtures/health/ecg-omron-sintetico.txt`
- Test: `apps/api/src/modules/health/provider/laudo-bioimpedancia.extractor.spec.ts`

**Interfaces:**
- Consumes: `DocumentExtractor` de `document-extractor.port.ts`, `REGIAO_DO_TIPO` (Task 1)
- Produces: `LaudoBioimpedanciaExtractor implements DocumentExtractor`; `ResultadoDaExtracao` ganha `readonly atributos: Record<string, unknown>`, `readonly sourceLabel: string`, `readonly tipoDeLaudo: TipoDeLaudo`

- [ ] **Step 1: Criar as fixtures sintéticas**

**Dado sintético obrigatório** — nome, datas e medidas alterados em relação ao laudo real do PI. O `CLAUDE.md` proíbe dado real de aluno no repositório.

`laudo-cf610g-sintetico.csv`:
```csv
tipo,valor,unidade,faixa_min,faixa_max,percentual_padrao
WEIGHT,88.40,kg,60.6,82.0,
SKELETAL_MUSCLE_MASS,37.20,kg,30.6,37.4,
BODY_FAT_MASS,20.10,kg,8.6,17.2,
SEGMENTAL_FAT_MASS_ARM_LEFT,1.10,kg,,,190.5
SEGMENTAL_FAT_MASS_ARM_RIGHT,1.20,kg,,,205.0
SEGMENTAL_FAT_MASS_TRUNK,10.40,kg,,,230.1
SEGMENTAL_MUSCLE_MASS_ARM_LEFT,3.50,kg,,,101.2
SEGMENTAL_MUSCLE_MASS_TRUNK,29.10,kg,,,100.8
VISCERAL_FAT_LEVEL,8,,1,9,
BASAL_METABOLIC_RATE,1810,kcal,1894,2232,
```

`laudo-unique-health-sintetico.csv` — repete `WEIGHT` com **88.4** (concordante), acrescenta os exclusivos:
```csv
tipo,valor,unidade,faixa_min,faixa_max,percentual_padrao
WEIGHT,88.4,kg,61,82,
BONE_MASS,3.60,kg,3.1,3.8,
BODY_CELL_MASS,44.00,kg,35.6,43.5,
SUBCUTANEOUS_FAT_PERCENT,20.10,percent,8.6,16.7,
WAIST_HIP_RATIO,0.88,,0.8,0.9,
HEART_RATE,84,,55,100,
```

`ecg-omron-sintetico.txt`:
```
Paciente: Aluno Sintetico
Gravado: segunda-feira, 3 de agosto de 2026 as 08:10:00
Frequencia cardiaca: 92 BPM
Duracao: 30s
Tags: Atividade:Alta
Analise instantanea: Ritmo nao classificado
```

- [ ] **Step 2: Escrever os testes que falham**

```typescript
describe('extrator de laudo de bioimpedancia', () => {
  it('le os segmentares com faixa e percentual do padrao', async () => {
    const r = await extrator.extrair({ tipo: 'CSV', conteudo: lerFixture('laudo-cf610g-sintetico.csv') });
    const tronco = r.campos.find((c) => c.type === 'SEGMENTAL_FAT_MASS_TRUNK');

    expect(tronco?.extractedValue).toBeCloseTo(10.4, 2);
    expect(tronco?.standardPercent).toBeCloseTo(230.1, 1);
  });

  it('guarda faixa de referencia junto do campo', async () => {
    const r = await extrator.extrair({ tipo: 'CSV', conteudo: lerFixture('laudo-cf610g-sintetico.csv') });
    const peso = r.campos.find((c) => c.type === 'WEIGHT');

    expect(peso?.referenceMin).toBeCloseTo(60.6, 1);
    expect(peso?.referenceMax).toBeCloseTo(82.0, 1);
  });

  it('classifica o laudo e rotula a origem', async () => {
    const r = await extrator.extrair({ tipo: 'CSV', conteudo: lerFixture('laudo-cf610g-sintetico.csv') });
    expect(r.tipoDeLaudo).toBe('BIOIMPEDANCE');
    expect(r.sourceLabel).toBe('CF610_G');
  });

  it('le bpm do ECG como MEDIDA e o achado como ATRIBUTO', async () => {
    const r = await extrator.extrair({ tipo: 'TXT', conteudo: lerFixture('ecg-omron-sintetico.txt') });

    expect(r.campos.find((c) => c.type === 'HEART_RATE')?.extractedValue).toBe(92);
    expect(r.atributos.ecgFinding).toBe('Ritmo nao classificado');
    expect(r.atributos.ecgTags).toEqual(['Atividade:Alta']);
    expect(r.tipoDeLaudo).toBe('ECG');
  });

  it('NAO transforma indice do fabricante em medida', async () => {
    const r = await extrator.extrair({ tipo: 'CSV', conteudo: lerFixture('laudo-unique-health-sintetico.csv') });

    // Idade corporal, pontuacao e peso ideal sao atributos (spec §4.4):
    // formula proprietaria muda com firmware e produziria tendencia falsa.
    expect(r.campos.some((c) => String(c.type).includes('BODY_AGE'))).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter @arenahub/api test -- laudo-bioimpedancia
```

Esperado: FAIL — extrator não existe.

- [ ] **Step 4: Implementar**

`LaudoBioimpedanciaExtractor` estende o formato do `CsvDocumentExtractorAdapter` com as colunas `faixa_min`, `faixa_max` e `percentual_padrao`, todas opcionais. Reaproveita a validação de tipo contra `TIPOS_DE_MEDIDA`.

Classificação do laudo:
- Contém tipo de `TIPOS_SEGMENTARES` ou `SKELETAL_MUSCLE_MASS` → `BIOIMPEDANCE`
- Contém `Analise instantanea:` ou `Frequencia cardiaca:` em texto → `ECG`
- Nenhum dos dois → `UNKNOWN`

Do ECG, extrai `HEART_RATE` como campo, e `ecgFinding`, `ecgTags`, `ecgDurationSeconds`, `ecgRecordedAt` como atributos. **Nenhuma lógica lê `ecgFinding` para decidir coisa alguma** (ADR-035).

`confidence` fica `null` no CSV — parser determinístico não estima.

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter @arenahub/api test -- laudo-bioimpedancia
```

Esperado: PASS, 5 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/health/provider apps/api/test/fixtures/health
git commit -m "feat(health): extrator de laudo de bioimpedancia e ECG textual"
```

---

### Task 7: Faixas e cores — domínio puro

**Files:**
- Create: `apps/api/src/modules/health/domain/leitura-de-faixa.ts`
- Test: `apps/api/src/modules/health/domain/leitura-de-faixa.spec.ts`

**Interfaces:**
- Consumes: `TipoDeMedida` (Task 1)
- Produces:
  - `type Leitura = 'BELOW' | 'WITHIN' | 'ABOVE' | 'AT_LIMIT' | 'UNKNOWN'`
  - `function lerFaixa(valor: number | null, min: number | null, max: number | null): Leitura`
  - `function leituraDoPercentual(percentual: number | null): Leitura`

- [ ] **Step 1: Escrever os testes que falham**

```typescript
describe('leitura de faixa de referencia', () => {
  it('classifica dentro, abaixo e acima', () => {
    expect(lerFaixa(35, 30.6, 37.4)).toBe('WITHIN');
    expect(lerFaixa(28, 30.6, 37.4)).toBe('BELOW');
    expect(lerFaixa(39.8, 30.6, 37.4)).toBe('ABOVE');
  });

  it('marca o limite exato como AT_LIMIT, nao como dentro', () => {
    // Gordura visceral 9 na faixa 1-9: o laudo escreve "no limite", e
    // arredondar para "dentro" esconderia do professor que o proximo mes
    // pode sair da faixa.
    expect(lerFaixa(9, 1, 9)).toBe('AT_LIMIT');
  });

  it('sem faixa ou sem valor nao inventa leitura (INV-104)', () => {
    expect(lerFaixa(35, null, null)).toBe('UNKNOWN');
    expect(lerFaixa(null, 30.6, 37.4)).toBe('UNKNOWN');
  });

  it('le percentual do padrao com 100 como centro', () => {
    expect(leituraDoPercentual(100)).toBe('WITHIN');
    expect(leituraDoPercentual(233.3)).toBe('ABOVE');
    expect(leituraDoPercentual(88)).toBe('BELOW');
    expect(leituraDoPercentual(null)).toBe('UNKNOWN');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @arenahub/api test -- leitura-de-faixa
```

Esperado: FAIL.

- [ ] **Step 3: Implementar**

```typescript
/**
 * Leitura de um valor contra a faixa do fabricante (spec §6).
 *
 * Funções puras. Mora no SERVIDOR de propósito: se cada superfície
 * calculasse a sua, o aluno veria o braço verde no celular e amarelo no
 * totem no dia em que uma faixa mudasse.
 */

export type Leitura = 'BELOW' | 'WITHIN' | 'ABOVE' | 'AT_LIMIT' | 'UNKNOWN';

/** Faixa do padrão em percentual: 90% a 110% é o intervalo dos laudos. */
const PERCENTUAL_MIN = 90;
const PERCENTUAL_MAX = 110;

export function lerFaixa(valor: number | null, min: number | null, max: number | null): Leitura {
  // INV-104: sem valor ou sem faixa não há leitura — e "UNKNOWN" não é
  // "WITHIN". Assumir dentro esconderia ausência de dado atrás de um
  // rótulo tranquilizador.
  if (valor === null) return 'UNKNOWN';
  if (min === null && max === null) return 'UNKNOWN';

  if (min !== null && valor < min) return 'BELOW';
  if (max !== null && valor > max) return 'ABOVE';
  if ((min !== null && valor === min) || (max !== null && valor === max)) return 'AT_LIMIT';

  return 'WITHIN';
}

export function leituraDoPercentual(percentual: number | null): Leitura {
  return lerFaixa(percentual, PERCENTUAL_MIN, PERCENTUAL_MAX);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter @arenahub/api test -- leitura-de-faixa
```

Esperado: PASS, 4 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/health/domain/leitura-de-faixa.ts apps/api/src/modules/health/domain/leitura-de-faixa.spec.ts
git commit -m "feat(health): leitura de faixa de referencia no servidor"
```

---

### Task 8: Contrato de evolução corporal

**Files:**
- Create: `apps/api/src/modules/health/body-evolution.controller.ts`
- Create: `apps/api/src/modules/health/body-evolution.service.ts`
- Modify: `apps/api/src/modules/health/health.module.ts`
- Test: `apps/api/test/integration/health/body-evolution.integration.spec.ts`

**Interfaces:**
- Consumes: `REGIAO_DO_TIPO`, `TIPOS_SEGMENTARES` (Task 1), `lerFaixa`, `leituraDoPercentual` (Task 7)
- Produces: `GET /api/v1/students/:id/body-evolution?period=30D|90D|6M|1Y|ALL`

```typescript
{
  months: Array<{
    assessedAtLocal: string;              // AAAA-MM-DD no fuso da unidade
    regions: Record<RegiaoCorporal, {
      fatMassKg: number | null;
      muscleMassKg: number | null;
      fatReading: Leitura;                // já resolvida no servidor
      muscleReading: Leitura;
    }>;
    metrics: Array<{ type: string; value: number; unit: string | null; reading: Leitura }>;
  }>;
  latestAnalysis: {
    positivePoints: string[];
    attentionPoints: string[];
    disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS';
  } | null;
}
```

- [ ] **Step 1: Escrever o teste de integração que falha**

```typescript
describe('GET body-evolution', () => {
  it('devolve as 5 regioes com leitura ja resolvida', async () => {
    const r = await get(`/api/v1/students/${studentId}/body-evolution?period=ALL`);

    expect(Object.keys(r.body.months[0].regions).sort()).toEqual([
      'ARM_LEFT', 'ARM_RIGHT', 'LEG_LEFT', 'LEG_RIGHT', 'TRUNK',
    ]);
    expect(r.body.months[0].regions.TRUNK.fatReading).toBe('ABOVE');
  });

  it('regiao sem medida vem null, nunca zero (INV-104)', async () => {
    const r = await get(`/api/v1/students/${semSegmentares}/body-evolution?period=ALL`);
    expect(r.body.months[0].regions.ARM_LEFT.fatMassKg).toBeNull();
  });

  it('traz os pontos positivos da analise publicada, com o aviso', async () => {
    const r = await get(`/api/v1/students/${studentId}/body-evolution?period=ALL`);

    expect(r.body.latestAnalysis.positivePoints.length).toBeGreaterThan(0);
    expect(r.body.latestAnalysis.disclaimerCode).toBe('NOT_MEDICAL_DIAGNOSIS');
  });

  it('NAO devolve analise rejeitada nem falha', async () => {
    const r = await get(`/api/v1/students/${soAnaliseRejeitada}/body-evolution?period=ALL`);
    expect(r.body.latestAnalysis).toBeNull();
  });

  it('nao vaza aluno de outro tenant', async () => {
    const r = await getComoOutroTenant(`/api/v1/students/${studentId}/body-evolution?period=ALL`);
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm test:integration -- body-evolution
```

Esperado: FAIL — rota não existe.

- [ ] **Step 3: Implementar**

`BodyEvolutionService` lê as avaliações publicadas do período (mesma janela da F18), agrupa as medidas segmentares por `REGIAO_DO_TIPO`, resolve a leitura com `lerFaixa`/`leituraDoPercentual` e anexa a última `AiAnalysis` com `status: 'PUBLISHED'`.

Permissão: `health.read`. Controller valida e delega.

Região sem medida → objeto com `null` nos valores e `'UNKNOWN'` nas leituras. **Nunca omitir a chave**: o cliente que espera as 5 regiões quebraria, e ausência viraria bug de layout no totem.

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm test:integration -- body-evolution
```

Esperado: PASS, 5 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/health apps/api/test/integration/health/body-evolution.integration.spec.ts
git commit -m "feat(health): contrato de evolucao corporal para app e totem"
```

---

### Task 9: Tela do professor

**Files:**
- Create: `apps/admin-web/app/(protected)/students/[id]/health/imports/[sessionId]/page.tsx`
- Create: `apps/admin-web/app/(protected)/students/[id]/health/imports/[sessionId]/revisao-de-campos.tsx`
- Create: `apps/admin-web/app/(protected)/students/[id]/health/imports/[sessionId]/painel-de-analise.tsx`
- Create: `apps/admin-web/app/(protected)/students/[id]/health/imports/[sessionId]/sessao.module.css`
- Test: `apps/admin-web/app/(protected)/students/[id]/health/imports/[sessionId]/revisao-de-campos.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/assessment-imports/sessions/:sessionId` e `POST .../confirm` (Task 5)
- Produces: rota `students/[id]/health/imports/[sessionId]`

- [ ] **Step 1: Escrever os testes que falham**

```typescript
describe('revisao de campos', () => {
  it('mostra campo concordante numa linha so, com as duas origens', () => {
    render(<RevisaoDeCampos linhas={[linhaConcordante]} />);

    expect(screen.getAllByRole('row')).toHaveLength(2); // cabecalho + 1
    expect(screen.getByText(/2 arquivos/i)).toBeInTheDocument();
  });

  it('mostra divergencia como duas linhas, SEM pre-selecao', () => {
    render(<RevisaoDeCampos linhas={[linhaDivergente]} />);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });

  it('desabilita confirmar enquanto houver divergencia aberta', () => {
    render(<RevisaoDeCampos linhas={[linhaDivergente]} podeConfirmar={{ pronta: false, motivo: 'DIVERGENCE_UNRESOLVED' }} />);

    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();
    expect(screen.getByText(/escolha qual valor vale/i)).toBeInTheDocument();
  });

  it('exibe o achado do ECG como texto do aparelho, sem acao', () => {
    render(<PainelDeAnalise atributos={{ ecgFinding: 'Ritmo nao classificado' }} />);

    expect(screen.getByText(/ritmo nao classificado/i)).toBeInTheDocument();
    expect(screen.getByText(/relatado pelo aparelho/i)).toBeInTheDocument();
    // ADR-035 e decisao 2 do PI: nada de encaminhamento nesta tela.
    expect(screen.queryByRole('button', { name: /encaminhamento/i })).not.toBeInTheDocument();
  });

  it('mostra valor ausente como travessao, nunca como zero', () => {
    render(<RevisaoDeCampos linhas={[linhaSemValor]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @arenahub/admin-web test -- revisao-de-campos
```

Esperado: FAIL — componentes não existem.

- [ ] **Step 3: Implementar**

Server Component na `page.tsx` (busca a sessão), Client Component na revisão (estado das escolhas).

Layout, conforme spec §5: cabeçalho com aluno e consentimento; cards por arquivo; tabela de revisão; painel de análise à direita; segmentares e histórico no rodapé.

Regras de UI que os testes fixam:
- Concordante → uma linha, selo `2 arquivos` na Origem
- Divergente → agrupadas, destacadas, radio **sem** `defaultChecked`
- Ausente → `—` via `<Ausente />` do `@arenahub/ui` (INV-104)
- Botão desabilitado com motivo em texto quando `podeConfirmar.pronta === false`
- Bloco do aparelho rotulado **"Sugerido pelo aparelho"**, nunca "Metas"

**Sem hex literal** — tokens do `DS-PAINEL.md`. Erro vai por Toast, nunca Alert (`CLAUDE.md`).

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter @arenahub/admin-web test -- revisao-de-campos
pnpm lint
```

Esperado: PASS, 5 testes; lint sem violação de hex.

- [ ] **Step 5: Revisão de craft**

Rodar as skills `/impeccable` e `gstack:design-review` sobre a tela. Corrigir o que apontarem antes do commit.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/app
git commit -m "feat(health): tela de revisao de laudo multiarquivo"
```

---

### Task 10: Documentação e gate final

**Files:**
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/TESTS.md`
- Modify: `docs/CONVENTION.md`

- [ ] **Step 1: Gate local completo**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build
```

Os cinco verdes são o piso. Falhou, conserta antes de seguir.

- [ ] **Step 2: Atualizar a documentação**

- `DEVELOPMENT.md`: os passos desta fatia, com estado por item
- `TESTS.md`: linha da fatia; campo do PR fica `—` até o merge (**preencher depois**, o `--check` não valida esse campo)
- `CONVENTION.md`: os 19 tipos novos; a regra medida × atributo (§4.4); a sessão de revisão

- [ ] **Step 3: Commit e PR**

```bash
git add docs/
git commit -m "docs: registra a fatia da avaliacao multiarquivo"
git push -u origin <branch>
gh pr create --title "feat(health): avaliacao multiarquivo (bioimpedancia, analise e ECG)" --body "..."
```

Corpo do PR: `refs #N` (**nunca `closes`** — forjaria o aceite do PI), decisões técnicas tomadas, e o que ficou fora.

- [ ] **Step 4: Esperar o CI**

```bash
gh pr checks <n> --watch
```

`--watch` já saiu 0 com job vermelho neste repo: conferir job a job com `gh run watch <id> --exit-status`.

- [ ] **Step 5: Merge e pós-merge**

Com CI verde, mergear. Depois: `proplan:done` na issue com link do PR, preencher o PR no `TESTS.md`, e perguntar ao PI se roda `/graphify . --update`.

---

## Self-review

**Cobertura da spec:**

| seção | task |
|---|---|
| §3.1 relação 1:N | 2 |
| §3.2 sessão de revisão | 4, 5 |
| §3.3 deduplicação | 3 |
| §3.4 bioimpedância obrigatória | 4, 5 |
| §4.1–4.3 os 19 tipos | 1 |
| §4.4 medida × atributo | 1, 6 |
| §5 tela do professor | 9 |
| §6 contrato do aluno | 7, 8 |
| §7 testes | em cada task |
| §8 migração | 2 |
| §9 riscos | 3 (tolerância), 6 (faixa junto da medida), 9 (divergência exibida) |

**Consistência de tipos:** `LinhaConsolidada` (Task 3) é consumida com os mesmos campos na Task 4; `ArquivoDaSessao` (Task 4) idem na Task 5; `Leitura` (Task 7) idem na Task 8; `RegiaoCorporal` (Task 1) idem nas Tasks 7 e 8.

**Sem placeholders:** todo passo de código traz o código; todo passo de teste traz o teste; todo comando é executável.
