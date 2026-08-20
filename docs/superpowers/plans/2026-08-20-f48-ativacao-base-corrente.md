# F48 — Ativação da base corrente do Pacto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer as ~340 pessoas ativas hoje na academia para dentro do ArenaHub — cadastro atualizado, credenciais de equipamento, perfil, plano vinculado e acesso liberado.

**Architecture:** Uma tabela nova (`StudentCredential`) guarda os identificadores de leitor; uma coluna nova (`Student.profile`) guarda o papel da pessoa. Um seed lê o JSON do Pacto de caminho externo, casa cada registro com o aluno existente por CPF (ou nome único), atualiza o cadastro e monta a cadeia `Subscription → Entitlement` que a catraca consulta. Todas as funções de decisão são puras e testadas sem banco; a escrita é `upsert` por chave natural, então rodar duas vezes dá o mesmo resultado.

**Tech Stack:** TypeScript estrito, Prisma 7 + PostgreSQL, Jest (unit + integração), `tsx` para o seed.

**Spec:** `docs/superpowers/specs/2026-08-20-ativacao-base-corrente-design.md`

## Global Constraints

- **Idioma:** código e identificadores em inglês; comentários, mensagens e documentação em **pt-BR**.
- **Nunca versionar dado real de aluno** — nem em fixture, nem em golden file, nem em log. O JSON de origem fica fora do repositório, com o caminho no `.gitignore`.
- **`tenantId` em toda entidade de negócio** (regra de arquitetura nº 2); vem do contexto, nunca do payload.
- **Regra de arquitetura nº 1:** só `Entitlement` decide acesso. Nada de ler perfil, assinatura ou pagamento no caminho da catraca.
- **Regra de arquitetura nº 4:** reprocessar é seguro. Toda escrita do seed é idempotente por chave natural.
- **Proibido `any` implícito;** `unknown` antes de validar dado externo (o JSON é dado externo).
- **Funções de cálculo são puras:** sem banco, sem rede, sem relógio — o "agora" entra por parâmetro.
- **Migrations:** nome no padrão `AAAAMMDDHHMMSS_descricao_curta`, criadas com `pnpm --filter @arenahub/database exec prisma migrate dev --name <nome>`.
- **Gate local antes de qualquer push:** `pnpm lint`, `pnpm typecheck`, `pnpm test` verdes.

---

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `packages/database/prisma/schema.prisma` | `StudentCredential`, `StudentCredentialKind`, `StudentProfile`, `Student.profile` |
| `apps/api/src/modules/students/domain/importacao-pacto.ts` | **funções puras**: parse de data, plausibilidade de nascimento, normalização de nome, mapa perfil→origem, decisão de casamento |
| `apps/api/src/modules/students/domain/importacao-pacto.spec.ts` | unitário do acima |
| `apps/api/src/modules/membership/domain/entitlement.ts` | `SnapshotDePolitica.planId` passa a aceitar `null` |
| `packages/database/prisma/seed-ativos.ts` | orquestração: lê JSON, casa, escreve, relata |
| `apps/api/test/integration/importacao-ativos.integration-spec.ts` | casamento, idempotência, não-apagar, negação sem entitlement |

**Ordem das tarefas:** schema → domínio puro → snapshot → seed → integração. Cada uma entrega algo testável sozinho.

---

### Task 1: Schema — credencial de equipamento e perfil

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_f48_credencial_e_perfil/migration.sql` (gerada)

**Interfaces:**
- Consumes: nada (primeira tarefa)
- Produces: modelo `StudentCredential`, enums `StudentCredentialKind` (`TURNSTILE_CARD`, `FACIAL_ENROLL_ID`) e `StudentProfile` (`ADMIN`, `STUDENT`, `STAFF`, `TRAINER`), campo `Student.profile: StudentProfile @default(STUDENT)`

- [ ] **Step 1: Adicionar os enums ao schema**

Em `packages/database/prisma/schema.prisma`, junto dos outros enums de aluno (perto de `StudentContactType`, ~linha 111):

```prisma
/// Papel da pessoa na academia. NAO decide acesso -- origina um
/// `Entitlement` (F48). Ler isto dentro do motor de decisao criaria a
/// segunda fonte de verdade que a regra de arquitetura no 1 proibe.
enum StudentProfile {
  /// Acesso liberado por vinculo.
  ADMIN
  /// Acesso controlado: depende de plano vigente. E o caso comum.
  STUDENT
  /// Funcionario. Acesso liberado por vinculo.
  STAFF
  /// Professor ou personal. Acesso liberado por vinculo.
  TRAINER

  @@map("student_profile")
}

/// Tipo de credencial que o equipamento le para identificar a pessoa.
///
/// NAO E BIOMETRIA: e o numero que o leitor usa como chave. O template
/// facial vive no equipamento e no `BiometricIdentity`, que exige
/// consentimento (INV-017) e nao e tocado por aqui.
enum StudentCredentialKind {
  /// Cartao de proximidade.
  TURNSTILE_CARD
  /// `enrollid` do cadastro facial dentro do leitor.
  FACIAL_ENROLL_ID

  @@map("student_credential_kind")
}
```

- [ ] **Step 2: Adicionar o modelo `StudentCredential`**

No mesmo arquivo, depois de `model StudentContact`:

```prisma
/// Identificador que o equipamento usa para reconhecer a pessoa (F48).
///
/// Tabela propria, e nao coluna em `Student`, por dois motivos que a coluna
/// nao daria: uma pessoa troca de cartao e re-enrola a face (varias
/// credenciais ao longo do tempo), e o numero precisa ser unico dentro do
/// tenant -- garantia que so o banco entrega.
model StudentCredential {
  id         String                @id @default(uuid()) @db.Uuid
  tenantId   String                @map("tenant_id") @db.Uuid
  studentId  String                @map("student_id") @db.Uuid
  kind       StudentCredentialKind
  /// O numero como o leitor o conhece. Texto, nao inteiro: e chave externa
  /// de equipamento, e zero a esquerda importa.
  externalId String                @map("external_id")
  createdAt  DateTime              @default(now()) @map("created_at")
  updatedAt  DateTime              @updatedAt @map("updated_at")

  tenant  Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  /// Dois alunos nao dividem o mesmo numero: seria a catraca abrindo para a
  /// pessoa errada.
  @@unique([tenantId, kind, externalId])
  @@index([tenantId, studentId])
  @@map("student_credentials")
}
```

- [ ] **Step 3: Ligar o modelo em `Student` e `Tenant`**

Em `model Student`, junto das outras relações (perto de `deviceUsers`):

```prisma
  credentials         StudentCredential[]
```

E o campo, junto de `status`:

```prisma
  /// Papel da pessoa (F48). Default `STUDENT` porque e o caso comum e
  /// porque as 1.926 linhas ja existentes precisam de um valor.
  profile          StudentProfile        @default(STUDENT)
```

Em `model Tenant`, junto das outras coleções:

```prisma
  studentCredentials StudentCredential[]
```

- [ ] **Step 4: Gerar a migration**

Run: `pnpm --filter @arenahub/database exec prisma migrate dev --name f48_credencial_e_perfil`
Expected: migration criada, aplicada no banco local, client regerado.

- [ ] **Step 5: Verificar que o banco recebeu a estrutura**

Run: `pnpm --filter @arenahub/database exec prisma migrate status`
Expected: "Database schema is up to date!"

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: sem erros — o client regerado já conhece `StudentCredential` e `profile`.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): credencial de equipamento e perfil do aluno (F48)"
```

---

### Task 2: Domínio puro — parse e plausibilidade de data

**Files:**
- Create: `apps/api/src/modules/students/domain/importacao-pacto.ts`
- Test: `apps/api/src/modules/students/domain/importacao-pacto.spec.ts`

**Interfaces:**
- Consumes: nada
- Produces: `parsearDataDoPacto(valor: string): Date | null`, `nascimentoEhPlausivel(nascimento: Date, agora: Date): boolean`

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/src/modules/students/domain/importacao-pacto.spec.ts`:

```typescript
import { nascimentoEhPlausivel, parsearDataDoPacto } from './importacao-pacto.js';

describe('parsearDataDoPacto', () => {
  it('converte AAAAMMDD em data', () => {
    expect(parsearDataDoPacto('20260803')?.toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });

  it('converte DD/MM/AAAA em data -- o formato do nascimento', () => {
    expect(parsearDataDoPacto('11/03/1996')?.toISOString()).toBe('1996-03-11T00:00:00.000Z');
  });

  it('devolve nulo para vazio', () => {
    expect(parsearDataDoPacto('')).toBeNull();
    expect(parsearDataDoPacto('   ')).toBeNull();
  });

  it('devolve nulo para data que nao existe no calendario', () => {
    // 31 de fevereiro: `Date` normalizaria para 2 ou 3 de marco em silencio.
    expect(parsearDataDoPacto('20260231')).toBeNull();
    expect(parsearDataDoPacto('31/02/2026')).toBeNull();
  });

  it('devolve nulo para lixo', () => {
    expect(parsearDataDoPacto('1E+11')).toBeNull();
    expect(parsearDataDoPacto('abc')).toBeNull();
  });
});

describe('nascimentoEhPlausivel', () => {
  const agora = new Date('2026-08-20T12:00:00.000Z');

  it('aceita nascimento de adulto', () => {
    expect(nascimentoEhPlausivel(new Date('1996-03-11T00:00:00.000Z'), agora)).toBe(true);
  });

  it('recusa nascimento no futuro -- o arquivo traz cinco', () => {
    expect(nascimentoEhPlausivel(new Date('2026-08-01T00:00:00.000Z'), agora)).toBe(false);
  });

  it('recusa bebe: ninguem de dois anos treina musculacao', () => {
    expect(nascimentoEhPlausivel(new Date('2025-09-25T00:00:00.000Z'), agora)).toBe(false);
  });

  it('recusa idade impossivel', () => {
    expect(nascimentoEhPlausivel(new Date('1890-01-01T00:00:00.000Z'), agora)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test -- importacao-pacto`
Expected: FAIL — `Cannot find module './importacao-pacto.js'`

- [ ] **Step 3: Implementar**

Crie `apps/api/src/modules/students/domain/importacao-pacto.ts`:

```typescript
/**
 * Regras puras da importacao da base corrente do Pacto -- F48.
 *
 * Tudo aqui e funcao pura (`CLAUDE.md`): sem banco, sem rede, sem relogio.
 * O "agora" entra por parametro. E o que permite provar as decisoes que
 * decidem se uma pessoa entra na academia sem subir infraestrutura.
 */

/** Menor e maior idade que um cadastro de academia admite. */
const IDADE_MINIMA_ANOS = 3;
const IDADE_MAXIMA_ANOS = 110;

/**
 * Data do Pacto em `Date`, ou `null` quando o valor nao e uma data.
 *
 * O arquivo usa DOIS formatos: `AAAAMMDD` na vigencia do plano e
 * `DD/MM/AAAA` no nascimento. Aceitar os dois aqui evita espalhar o
 * conhecimento do formato pelo seed.
 *
 * VALIDA O CALENDARIO, nao so o formato: `Date.UTC(2026, 1, 31)` devolve 3
 * de marco sem reclamar, e uma data que "existe" errado e pior que uma
 * ausente -- ela passa despercebida.
 */
export function parsearDataDoPacto(valor: string): Date | null {
  const texto = valor.trim();

  if (texto === '') return null;

  const compacto = /^(\d{4})(\d{2})(\d{2})$/.exec(texto);
  const barrado = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);

  let ano: number;
  let mes: number;
  let dia: number;

  if (compacto) {
    ano = Number(compacto[1]);
    mes = Number(compacto[2]);
    dia = Number(compacto[3]);
  } else if (barrado) {
    dia = Number(barrado[1]);
    mes = Number(barrado[2]);
    ano = Number(barrado[3]);
  } else {
    return null;
  }

  const data = new Date(Date.UTC(ano, mes - 1, dia));

  // Ida e volta: se o mes ou o dia mudou, a data nao existe no calendario.
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    return null;
  }

  return data;
}

/**
 * O nascimento faz sentido para um aluno de academia?
 *
 * O arquivo do Pacto traz nascimentos em 2026 e 2022 -- alguem digitou a
 * data de hoje no campo errado. Sobrescrever o cadastro com isso apagaria
 * dado bom com dado impossivel.
 */
export function nascimentoEhPlausivel(nascimento: Date, agora: Date): boolean {
  const idadeMs = agora.getTime() - nascimento.getTime();

  if (idadeMs < 0) return false;

  const anos = idadeMs / (365.25 * 24 * 60 * 60 * 1000);

  return anos >= IDADE_MINIMA_ANOS && anos <= IDADE_MAXIMA_ANOS;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test -- importacao-pacto`
Expected: PASS — 9 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/students/domain/importacao-pacto.ts apps/api/src/modules/students/domain/importacao-pacto.spec.ts
git commit -m "feat(students): parse e plausibilidade de data do Pacto (F48)"
```

---

### Task 3: Domínio puro — perfil e origem do direito

**Files:**
- Modify: `apps/api/src/modules/students/domain/importacao-pacto.ts`
- Test: `apps/api/src/modules/students/domain/importacao-pacto.spec.ts`

**Interfaces:**
- Consumes: nada da Task 2 (mesmo arquivo, funções independentes)
- Produces: `type PerfilImportado = 'ADMIN' | 'STUDENT' | 'STAFF' | 'TRAINER'`; `traduzirPerfil(codigo: string): PerfilImportado | null`; `origemDoDireito(perfil: PerfilImportado): 'SUBSCRIPTION' | 'EMPLOYEE' | 'PERSONAL_TRAINER'`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente a `importacao-pacto.spec.ts`:

```typescript
import { origemDoDireito, traduzirPerfil } from './importacao-pacto.js';

describe('traduzirPerfil', () => {
  it('mapeia os quatro codigos que a academia usa', () => {
    expect(traduzirPerfil('0')).toBe('ADMIN');
    expect(traduzirPerfil('1')).toBe('STUDENT');
    expect(traduzirPerfil('2')).toBe('STAFF');
    expect(traduzirPerfil('3')).toBe('TRAINER');
  });

  it('devolve nulo para codigo de teste -- 4, 5 e 6 so aparecem em lixo', () => {
    expect(traduzirPerfil('6')).toBeNull();
    expect(traduzirPerfil('')).toBeNull();
    expect(traduzirPerfil('9')).toBeNull();
  });
});

describe('origemDoDireito', () => {
  it('aluno entra por assinatura', () => {
    expect(origemDoDireito('STUDENT')).toBe('SUBSCRIPTION');
  });

  it('professor entra como personal, nao como funcionario', () => {
    expect(origemDoDireito('TRAINER')).toBe('PERSONAL_TRAINER');
  });

  it('funcionario e administrador entram por vinculo', () => {
    expect(origemDoDireito('STAFF')).toBe('EMPLOYEE');
    expect(origemDoDireito('ADMIN')).toBe('EMPLOYEE');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test -- importacao-pacto`
Expected: FAIL — `traduzirPerfil is not a function`

- [ ] **Step 3: Implementar**

Acrescente a `importacao-pacto.ts`:

```typescript
/** Os quatro papeis que a academia opera hoje. Espelha `StudentProfile`. */
export type PerfilImportado = 'ADMIN' | 'STUDENT' | 'STAFF' | 'TRAINER';

/**
 * `Codigo Perfil` do Pacto para o papel do ArenaHub.
 *
 * LISTA FECHADA, e o desconhecido vira `null`: os codigos 4, 5 e 6
 * aparecem no arquivo apenas em registros de teste, e adivinhar o
 * significado deles daria acesso a alguem que nem existe.
 */
const PERFIL_POR_CODIGO: Record<string, PerfilImportado> = {
  '0': 'ADMIN',
  '1': 'STUDENT',
  '2': 'STAFF',
  '3': 'TRAINER',
};

export function traduzirPerfil(codigo: string): PerfilImportado | null {
  return PERFIL_POR_CODIGO[codigo.trim()] ?? null;
}

/**
 * De onde vem o direito de acesso desse papel.
 *
 * O perfil NAO decide acesso -- ele diz qual `EntitlementSource` origina o
 * direito. Quem decide continua sendo o `Entitlement` (regra no 1).
 */
export function origemDoDireito(
  perfil: PerfilImportado,
): 'SUBSCRIPTION' | 'EMPLOYEE' | 'PERSONAL_TRAINER' {
  if (perfil === 'STUDENT') return 'SUBSCRIPTION';
  if (perfil === 'TRAINER') return 'PERSONAL_TRAINER';

  return 'EMPLOYEE';
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test -- importacao-pacto`
Expected: PASS — 14 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/students/domain/importacao-pacto.ts apps/api/src/modules/students/domain/importacao-pacto.spec.ts
git commit -m "feat(students): mapa de perfil e origem do direito (F48)"
```

---

### Task 4: Domínio puro — decisão de casamento

**Files:**
- Modify: `apps/api/src/modules/students/domain/importacao-pacto.ts`
- Test: `apps/api/src/modules/students/domain/importacao-pacto.spec.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `normalizarNome(valor: string): string`
  - `interface CandidatoDeAluno { id: string; nomeNormalizado: string; cpfNormalizado: string | null }`
  - `type Casamento = { tipo: 'CPF' | 'NOME'; studentId: string } | { tipo: 'AMBIGUO' | 'NAO_ENCONTRADO' }`
  - `decidirCasamento(entrada: { nome: string; cpf: string }, candidatos: readonly CandidatoDeAluno[]): Casamento`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente a `importacao-pacto.spec.ts`:

```typescript
import { decidirCasamento, normalizarNome, type CandidatoDeAluno } from './importacao-pacto.js';

describe('normalizarNome', () => {
  it('tira acento, caixa e espaco duplicado', () => {
    expect(normalizarNome('  MARTA   Mirella  Militão ')).toBe('marta mirella militao');
  });

  it('iguala as duas grafias de Wagnusia/Wagnuzia? nao -- s e z sao letras diferentes', () => {
    expect(normalizarNome('Wagnusia')).not.toBe(normalizarNome('Wagnuzia'));
  });
});

describe('decidirCasamento', () => {
  const maria: CandidatoDeAluno = {
    id: 'id-maria',
    nomeNormalizado: 'maria silva',
    cpfNormalizado: '70310310105',
  };
  const outraMaria: CandidatoDeAluno = {
    id: 'id-maria-2',
    nomeNormalizado: 'maria silva',
    cpfNormalizado: null,
  };

  it('casa por CPF, mesmo com o nome escrito diferente', () => {
    const r = decidirCasamento({ nome: 'MARIA SILVA DE SOUZA', cpf: '703.103.101-05' }, [maria]);
    expect(r).toEqual({ tipo: 'CPF', studentId: 'id-maria' });
  });

  it('casa por nome unico quando o registro nao tem CPF', () => {
    const r = decidirCasamento({ nome: 'Maria Silva', cpf: '' }, [maria]);
    expect(r).toEqual({ tipo: 'NOME', studentId: 'id-maria' });
  });

  it('recusa quando o nome aparece duas vezes -- homonimo nao se adivinha', () => {
    const r = decidirCasamento({ nome: 'Maria Silva', cpf: '' }, [maria, outraMaria]);
    expect(r).toEqual({ tipo: 'AMBIGUO' });
  });

  it('CPF vence nome: o mesmo nome de duas pessoas nao atrapalha quem tem documento', () => {
    const r = decidirCasamento({ nome: 'Maria Silva', cpf: '70310310105' }, [maria, outraMaria]);
    expect(r).toEqual({ tipo: 'CPF', studentId: 'id-maria' });
  });

  it('recusa CPF invalido e cai para o nome', () => {
    // 111.111.111-11 passa na aritmetica e nao existe como documento.
    const r = decidirCasamento({ nome: 'Maria Silva', cpf: '11111111111' }, [maria]);
    expect(r).toEqual({ tipo: 'NOME', studentId: 'id-maria' });
  });

  it('nao encontra quando ninguem bate', () => {
    const r = decidirCasamento({ nome: 'Joao Ninguem', cpf: '' }, [maria]);
    expect(r).toEqual({ tipo: 'NAO_ENCONTRADO' });
  });

  it('recusa quando dois candidatos tem o MESMO CPF -- base duplicada', () => {
    const gemeo: CandidatoDeAluno = { ...maria, id: 'id-maria-3' };
    const r = decidirCasamento({ nome: 'Maria', cpf: '70310310105' }, [maria, gemeo]);
    expect(r).toEqual({ tipo: 'AMBIGUO' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test -- importacao-pacto`
Expected: FAIL — `decidirCasamento is not a function`

- [ ] **Step 3: Implementar**

Acrescente a `importacao-pacto.ts` (o import vai no topo do arquivo):

```typescript
import { cpfEhValido, normalizarCpf } from './identificacao.js';

/**
 * Nome comparavel: sem acento, sem caixa, sem espaco sobrando.
 *
 * NAO tenta corrigir grafia. "Wagnusia" e "Wagnuzia" continuam diferentes de
 * proposito -- aproximar nome por semelhanca casaria irmaos e homonimos, e o
 * preco do erro aqui e uma pessoa recebendo o acesso de outra.
 */
export function normalizarNome(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export interface CandidatoDeAluno {
  readonly id: string;
  readonly nomeNormalizado: string;
  readonly cpfNormalizado: string | null;
}

export type Casamento =
  | { tipo: 'CPF'; studentId: string }
  | { tipo: 'NOME'; studentId: string }
  | { tipo: 'AMBIGUO' }
  | { tipo: 'NAO_ENCONTRADO' };

/**
 * Com qual aluno do banco este registro do Pacto se parece?
 *
 * EM CASCATA, e o primeiro criterio que bate vence:
 *   1. CPF valido e unico -- documento e o unico identificador forte aqui
 *   2. nome normalizado UNICO -- vale so para quem nao tem CPF no arquivo
 *   3. qualquer outra coisa -- pendencia humana
 *
 * NUNCA escolhe entre dois candidatos e NUNCA cria aluno novo. A base ja tem
 * 1.926 pessoas da F47: adivinhar aqui produz o aluno duplicado que a
 * recepcao descobre seis meses depois, com dois historicos pela metade.
 */
export function decidirCasamento(
  entrada: { nome: string; cpf: string },
  candidatos: readonly CandidatoDeAluno[],
): Casamento {
  const cpf = normalizarCpf(entrada.cpf);

  if (cpf !== '' && cpfEhValido(cpf)) {
    const porCpf = candidatos.filter((c) => c.cpfNormalizado === cpf);

    if (porCpf.length === 1) return { tipo: 'CPF', studentId: porCpf[0]!.id };
    if (porCpf.length > 1) return { tipo: 'AMBIGUO' };
  }

  const nome = normalizarNome(entrada.nome);

  if (nome === '') return { tipo: 'NAO_ENCONTRADO' };

  const porNome = candidatos.filter((c) => c.nomeNormalizado === nome);

  if (porNome.length === 1) return { tipo: 'NOME', studentId: porNome[0]!.id };
  if (porNome.length > 1) return { tipo: 'AMBIGUO' };

  return { tipo: 'NAO_ENCONTRADO' };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test -- importacao-pacto`
Expected: PASS — 23 testes.

- [ ] **Step 5: Lint e typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/students/domain/importacao-pacto.ts apps/api/src/modules/students/domain/importacao-pacto.spec.ts
git commit -m "feat(students): decisao de casamento do de/para do Pacto (F48)"
```

---

### Task 5: `SnapshotDePolitica` aceita direito sem plano

**Files:**
- Modify: `apps/api/src/modules/membership/domain/entitlement.ts:167-190`
- Test: `apps/api/src/modules/membership/domain/entitlement.spec.ts`

**Interfaces:**
- Consumes: nada
- Produces: `SnapshotDePolitica.planId: string | null`; `montarSnapshotDeVinculo(perfil: string, gymUnitIds: readonly string[]): SnapshotDePolitica`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente a `apps/api/src/modules/membership/domain/entitlement.spec.ts`:

```typescript
import { montarSnapshotDeVinculo } from './entitlement.js';

describe('montarSnapshotDeVinculo', () => {
  it('monta snapshot sem plano, com janela livre', () => {
    const snapshot = montarSnapshotDeVinculo('STAFF', ['unidade-1']);

    expect(snapshot.planId).toBeNull();
    expect(snapshot.planName).toBe('Vinculo STAFF');
    expect(snapshot.gymUnitIds).toEqual(['unidade-1']);
    // Sete dias, do primeiro ao ultimo minuto: vinculo nao tem horario.
    expect(snapshot.janelas).toHaveLength(7);
    expect(snapshot.janelas[0]).toEqual({
      gymUnitId: 'unidade-1',
      dayOfWeek: 1,
      startMinute: 0,
      endMinute: 1440,
    });
  });

  it('cobre todas as unidades informadas', () => {
    const snapshot = montarSnapshotDeVinculo('TRAINER', ['u1', 'u2']);

    expect(snapshot.janelas).toHaveLength(14);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test -- entitlement`
Expected: FAIL — `montarSnapshotDeVinculo is not a function`

- [ ] **Step 3: Alargar o tipo e implementar**

Em `apps/api/src/modules/membership/domain/entitlement.ts`, mude a interface:

```typescript
export interface SnapshotDePolitica {
  /**
   * NULO quando o direito nao vem de plano (vinculo de funcionario,
   * professor, administrador -- F48). O snapshot continua sendo a copia
   * congelada das regras que valiam quando o direito nasceu; a regra, nesse
   * caso, e "acesso liberado por vinculo".
   */
  planId: string | null;
  planName: string;
  snapshotVersion: 1;
  gymUnitIds: readonly string[];
  janelas: readonly JanelaDeAcesso[];
}
```

E acrescente, depois de `montarSnapshotDePolitica`:

```typescript
/**
 * Snapshot do direito que vem de VINCULO, nao de plano (F48).
 *
 * Janela livre -- sete dias, do minuto zero ao 1440. Funcionario que abre a
 * academia as 5h e professor que fecha as 23h nao cabem numa grade de
 * horario comercial, e inventar uma criaria a negacao que a recepcao teria
 * de contornar na mao todo dia.
 */
export function montarSnapshotDeVinculo(
  perfil: string,
  gymUnitIds: readonly string[],
): SnapshotDePolitica {
  const unidades = [...gymUnitIds].sort();

  const janelas: JanelaDeAcesso[] = unidades.flatMap((gymUnitId) =>
    [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
      gymUnitId,
      dayOfWeek,
      startMinute: 0,
      endMinute: 1440,
    })),
  );

  return {
    planId: null,
    planName: `Vinculo ${perfil}`,
    snapshotVersion: 1,
    gymUnitIds: unidades,
    janelas,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test -- entitlement`
Expected: PASS — inclusive os testes que já existiam.

- [ ] **Step 5: Typecheck — o `planId` nulo pode ter quebrado consumidores**

Run: `pnpm typecheck`
Expected: sem erros. Se algum consumidor assumir `planId` string, ajuste com `?? '—'` na exibição, nunca com `as string`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/membership/domain/entitlement.ts apps/api/src/modules/membership/domain/entitlement.spec.ts
git commit -m "feat(membership): snapshot de politica aceita direito sem plano (F48)"
```

---

### Task 6: Seed de importação

**Files:**
- Create: `packages/database/prisma/seed-ativos.ts`
- Modify: `packages/database/package.json` (script `seed:ativos`)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `parsearDataDoPacto`, `nascimentoEhPlausivel`, `traduzirPerfil`, `origemDoDireito`, `decidirCasamento`, `normalizarNome` (Tasks 2-4); `montarSnapshotDeVinculo`, `montarSnapshotDePolitica` (Task 5); `StudentCredential`, `Student.profile` (Task 1)
- Produces: comando `pnpm --filter @arenahub/database seed:ativos`

- [ ] **Step 1: Barrar o dado real no `.gitignore`**

Acrescente ao `.gitignore` da raiz:

```gitignore
# Dado real de aluno NUNCA entra no repositorio (CLAUDE.md). O JSON de
# importacao do Pacto vive fora, e o caminho vai por variavel de ambiente.
insumos/
*.pessoas-ativas.json
```

- [ ] **Step 2: Escrever o seed**

Crie `packages/database/prisma/seed-ativos.ts`:

```typescript
/**
 * Importacao da base CORRENTE do Pacto -- F48.
 *
 * A F47 trouxe os 1.926 historicos como CANCELLED. Este traz quem treina
 * hoje: atualiza cadastro, grava credencial de equipamento, vincula o plano
 * e libera o acesso.
 *
 *   ARENAHUB_PESSOAS_ATIVAS=/caminho/pessoas-ativas.json \
 *     pnpm --filter @arenahub/database seed:ativos
 *
 * O ARQUIVO NAO ENTRA NO REPOSITORIO (CLAUDE.md): e dado real de aluno. Sem
 * a variavel, o seed nao falha -- apenas nao importa.
 *
 * IDEMPOTENTE (regra de arquitetura no 4): toda escrita e upsert por chave
 * natural. Rodar duas vezes produz o mesmo banco.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import {
  decidirCasamento,
  nascimentoEhPlausivel,
  normalizarNome,
  origemDoDireito,
  parsearDataDoPacto,
  traduzirPerfil,
  type CandidatoDeAluno,
} from '../../../apps/api/src/modules/students/domain/importacao-pacto.js';
import {
  montarSnapshotDePolitica,
  montarSnapshotDeVinculo,
} from '../../../apps/api/src/modules/membership/domain/entitlement.js';
import { normalizarCpf, normalizarTelefone } from '../../../apps/api/src/modules/students/domain/identificacao.js';
import { criarPrismaClient } from '../src/client.js';

const NOME_DO_PLANO = 'Programa Adultos e Idosos';
const MESES_DE_VINCULO = 12;

/** Registros de teste do Pacto: nome igual a numero, ou marcador de POC. */
function ehRegistroDeTeste(nome: string): boolean {
  const limpo = nome.trim();

  return limpo === '' || /^\d+$/.test(limpo) || limpo.toLowerCase().startsWith('teste-');
}

interface RegistroDoPacto {
  readonly Nome: string;
  readonly Cartao: string;
  readonly 'Identificador Facial': string;
  readonly 'Codigo Perfil': string;
  readonly 'Data Nascimento': string;
  readonly Endereco: string;
  readonly Bairro: string;
  readonly Cep: string;
  readonly Municipio: string;
  readonly Uf: string;
  readonly Telefone: string;
  readonly Celular: string;
  readonly Cpf: string;
  readonly 'Data Inicio': string;
  readonly 'Data Fim': string;
  readonly Email: string;
}

interface Pendencia {
  readonly nome: string;
  readonly motivo: string;
}

async function main(): Promise<void> {
  const caminho = process.env['ARENAHUB_PESSOAS_ATIVAS'];

  if (!caminho) {
    console.log('ARENAHUB_PESSOAS_ATIVAS nao definida -- nada a importar.');
    return;
  }

  const agora = new Date();
  const db = criarPrismaClient();
  const pendencias: Pendencia[] = [];
  const preenchimento = { endereco: 0, telefone: 0, email: 0, credencial: 0, nascimento: 0 };
  let casados = 0;
  let descartados = 0;

  // `unknown` antes de validar dado externo (CLAUDE.md).
  const bruto: unknown = JSON.parse(readFileSync(caminho, 'utf8'));

  if (!Array.isArray(bruto)) {
    throw new Error('O arquivo de pessoas ativas nao e uma lista.');
  }

  const registros = bruto as RegistroDoPacto[];

  const tenant = await db.tenant.findFirstOrThrow({ select: { id: true } });
  const tenantId = tenant.id;

  const plano = await db.plan.findFirst({
    where: { tenantId, name: NOME_DO_PLANO },
    select: { id: true, name: true },
  });

  if (!plano) {
    // Falha ALTA, nao importacao parcial: sem plano, metade das pessoas
    // entraria sem direito e ninguem perceberia ate a fila na catraca.
    throw new Error(`Plano "${NOME_DO_PLANO}" nao existe neste tenant.`);
  }

  const unidades = await db.gymUnit.findMany({ where: { tenantId }, select: { id: true } });
  const gymUnitIds = unidades.map((u) => u.id);

  const alunos = await db.student.findMany({
    where: { tenantId },
    select: { id: true, fullName: true, cpf: true },
  });

  const candidatos: CandidatoDeAluno[] = alunos.map((a) => ({
    id: a.id,
    nomeNormalizado: normalizarNome(a.fullName),
    cpfNormalizado: a.cpf === null ? null : normalizarCpf(a.cpf),
  }));

  for (const registro of registros) {
    if (ehRegistroDeTeste(registro.Nome)) {
      descartados += 1;
      continue;
    }

    const perfil = traduzirPerfil(registro['Codigo Perfil']);

    if (perfil === null) {
      pendencias.push({ nome: registro.Nome, motivo: 'perfil desconhecido' });
      continue;
    }

    const casamento = decidirCasamento(
      { nome: registro.Nome, cpf: registro.Cpf },
      candidatos,
    );

    if (casamento.tipo === 'AMBIGUO' || casamento.tipo === 'NAO_ENCONTRADO') {
      pendencias.push({
        nome: registro.Nome,
        motivo: casamento.tipo === 'AMBIGUO' ? 'mais de um candidato' : 'nao encontrado',
      });
      continue;
    }

    const studentId = casamento.studentId;
    casados += 1;

    await db.$transaction(async (tx) => {
      const nascimento = parsearDataDoPacto(registro['Data Nascimento']);
      const nascimentoBom = nascimento !== null && nascimentoEhPlausivel(nascimento, agora);

      if (nascimento !== null && !nascimentoBom) {
        pendencias.push({ nome: registro.Nome, motivo: 'nascimento implausivel' });
      }

      if (nascimentoBom) preenchimento.nascimento += 1;

      await tx.student.update({
        where: { id: studentId },
        data: {
          profile: perfil,
          status: 'ACTIVE',
          ...(nascimentoBom ? { birthDate: nascimento } : {}),
        },
      });

      // --- credenciais de equipamento -------------------------------------
      for (const [kind, valor] of [
        ['TURNSTILE_CARD', registro.Cartao],
        ['FACIAL_ENROLL_ID', registro['Identificador Facial']],
      ] as const) {
        const externalId = valor.trim();

        if (externalId === '') continue;

        await tx.studentCredential.upsert({
          where: { tenantId_kind_externalId: { tenantId, kind, externalId } },
          create: { tenantId, studentId, kind, externalId },
          update: { studentId },
        });
        preenchimento.credencial += 1;
      }

      // --- contatos: campo vazio NAO apaga o que ja existe -----------------
      for (const [type, valor] of [
        ['PHONE', registro.Telefone],
        ['WHATSAPP', registro.Celular],
        ['EMAIL', registro.Email],
      ] as const) {
        const cru = valor.trim();

        if (cru === '') continue;
        if (type === 'EMAIL' && !cru.includes('@')) continue;

        const value = type === 'EMAIL' ? cru.toLowerCase() : normalizarTelefone(cru);

        if (value === '') continue;

        const existente = await tx.studentContact.findFirst({
          where: { studentId, type, value },
          select: { id: true },
        });

        if (!existente) {
          await tx.studentContact.create({
            data: { tenantId, studentId, type, value, isPrimary: type === 'PHONE' },
          });
        }

        if (type === 'EMAIL') preenchimento.email += 1;
        else preenchimento.telefone += 1;
      }

      // --- endereco: so quando vem inteiro o suficiente ---------------------
      const street = registro.Endereco.trim();
      const city = registro.Municipio.trim();
      const postalCode = registro.Cep.trim();

      if (street !== '' && postalCode !== '') {
        const jaTem = await tx.studentAddress.findFirst({
          where: { studentId },
          select: { id: true },
        });

        if (!jaTem) {
          await tx.studentAddress.create({
            data: {
              tenantId,
              studentId,
              street,
              city: city === '' ? 'Trindade' : city,
              // O relatorio do Pacto nao traz UF confiavel (vem 'g', 'Go',
              // vazio). A academia e de Goias -- ADR-033 ja fixou assim.
              state: 'GO',
              postalCode,
              district: registro.Bairro.trim() || null,
            },
          });
        }
        preenchimento.endereco += 1;
      }

      // --- vinculo de plano e direito de acesso -----------------------------
      const inicio = parsearDataDoPacto(registro['Data Inicio']);
      const fim = parsearDataDoPacto(registro['Data Fim']);
      const source = origemDoDireito(perfil);

      if (perfil === 'STUDENT') {
        if (inicio === null || fim === null) {
          pendencias.push({ nome: registro.Nome, motivo: 'aluno sem periodo de plano' });
          return;
        }

        const assinatura = await tx.subscription.findFirst({
          where: { tenantId, studentId, planId: plano.id, startsAt: inicio },
          select: { id: true },
        });

        const subscriptionId =
          assinatura?.id ??
          (
            await tx.subscription.create({
              data: {
                tenantId,
                studentId,
                planId: plano.id,
                status: 'ACTIVE',
                startsAt: inicio,
                endsAt: fim,
                lastReason: 'Importacao da base ativa do Pacto',
              },
              select: { id: true },
            })
          ).id;

        const direito = await tx.entitlement.findFirst({
          where: { tenantId, studentId, source, startsAt: inicio },
          select: { id: true },
        });

        if (!direito) {
          await tx.entitlement.create({
            data: {
              tenantId,
              studentId,
              source,
              subscriptionId,
              status: 'ACTIVE',
              startsAt: inicio,
              endsAt: fim,
              policySnapshot: montarSnapshotDePolitica(plano.id, plano.name, gymUnitIds, []),
            },
          });
        }

        return;
      }

      // Vinculo: periodo nao vem do arquivo. Doze meses e revalidacao anual
      // -- quem sai perde o acesso sozinho, sem depender de alguem lembrar.
      const fimDoVinculo = new Date(agora);
      fimDoVinculo.setUTCMonth(fimDoVinculo.getUTCMonth() + MESES_DE_VINCULO);

      const jaTemVinculo = await tx.entitlement.findFirst({
        where: { tenantId, studentId, source },
        select: { id: true },
      });

      if (!jaTemVinculo) {
        await tx.entitlement.create({
          data: {
            tenantId,
            studentId,
            source,
            status: 'ACTIVE',
            startsAt: agora,
            endsAt: fimDoVinculo,
            reason: `Vinculo (perfil ${perfil}) -- importacao da base ativa do Pacto`,
            policySnapshot: montarSnapshotDeVinculo(perfil, gymUnitIds),
          },
        });
      }
    });
  }

  // --- relatorio: sem ele, a entrega nao esta pronta -----------------------
  //
  // Foi um `logradouro 0/1934` que denunciou extrator quebrado na F47.
  // Importacao que so diz "sucesso" e como esses registros viraram lixo.
  console.log('\n=== Importacao da base ativa ===');
  console.log(`registros no arquivo : ${registros.length}`);
  console.log(`descartados (teste)  : ${descartados}`);
  console.log(`casados              : ${casados}`);
  console.log('\n--- preenchimento por campo (sobre os casados) ---');
  console.log(`credencial : ${preenchimento.credencial}`);
  console.log(`telefone   : ${preenchimento.telefone}/${casados}`);
  console.log(`email      : ${preenchimento.email}/${casados}`);
  console.log(`endereco   : ${preenchimento.endereco}/${casados}`);
  console.log(`nascimento : ${preenchimento.nascimento}/${casados}`);
  console.log(`\n--- pendencias: ${pendencias.length} ---`);

  for (const p of pendencias) {
    console.log(`  ${p.nome} -- ${p.motivo}`);
  }

  await db.$disconnect();
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exit(1);
});
```

- [ ] **Step 3: Registrar o script**

Em `packages/database/package.json`, junto do `seed` existente:

```json
    "seed:ativos": "tsx prisma/seed-ativos.ts"
```

- [ ] **Step 4: Typecheck e lint**

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

- [ ] **Step 5: Rodar sem a variável — não pode explodir**

Run: `pnpm --filter @arenahub/database seed:ativos`
Expected: imprime "ARENAHUB_PESSOAS_ATIVAS nao definida -- nada a importar." e sai com código 0.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/seed-ativos.ts packages/database/package.json .gitignore
git commit -m "feat(database): seed de importacao da base ativa do Pacto (F48)"
```

---

### Task 7: Integração — casamento, idempotência e negação

**Files:**
- Create: `apps/api/test/integration/importacao-ativos.integration-spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1-6
- Produces: nada (é o gate)

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/test/integration/importacao-ativos.integration-spec.ts`. Use o mesmo bootstrap dos outros testes de integração da pasta (copie o `beforeAll`/`afterAll` de um vizinho — cada suíte tem banco próprio).

```typescript
/**
 * Integracao da F48 -- o que o unitario nao consegue provar.
 *
 * Os tres casos aqui sao os que quebram em producao e passam no unitario:
 * idempotencia real contra UNIQUE do banco, campo vazio nao apagando dado
 * bom, e a garantia de que ativar cadastro NAO abre a catraca sozinho.
 */
describe('importacao da base ativa (F48)', () => {
  it('grava as duas credenciais e nao duplica na segunda execucao', async () => {
    // Arrange: aluno importado da F47, CANCELLED, sem credencial.
    const aluno = await criarAlunoCancelado({ cpf: '70310310105' });

    // Act: importa duas vezes o mesmo registro.
    await importar([registroDe(aluno, { cartao: '2061', facial: '2061' })]);
    await importar([registroDe(aluno, { cartao: '2061', facial: '2061' })]);

    // Assert: duas credenciais (cartao + facial), nao quatro.
    const credenciais = await db.studentCredential.findMany({
      where: { studentId: aluno.id },
    });
    expect(credenciais).toHaveLength(2);
    expect(credenciais.map((c) => c.kind).sort()).toEqual([
      'FACIAL_ENROLL_ID',
      'TURNSTILE_CARD',
    ]);
  });

  it('casa por CPF mesmo com o nome escrito diferente do banco', async () => {
    const aluno = await criarAlunoCancelado({
      nome: 'ZORAIDE LOPES INVENTADA',
      cpf: '11144477735',
    });

    await importar([registroDe(aluno, { nome: 'Zoraide Lopes Inventada ' })]);

    const atualizado = await db.student.findUniqueOrThrow({ where: { id: aluno.id } });
    expect(atualizado.status).toBe('ACTIVE');
  });

  it('campo vazio no arquivo NAO apaga o telefone que a recepcao corrigiu', async () => {
    const aluno = await criarAlunoCancelado({ cpf: '70310310105' });
    await db.studentContact.create({
      data: {
        tenantId,
        studentId: aluno.id,
        type: 'PHONE',
        value: '62999990000',
        isPrimary: true,
      },
    });

    await importar([registroDe(aluno, { telefone: '', celular: '' })]);

    const contatos = await db.studentContact.findMany({ where: { studentId: aluno.id } });
    expect(contatos).toHaveLength(1);
    expect(contatos[0]!.value).toBe('62999990000');
  });

  it('aluno sem periodo e ativado, mas NAO ganha direito de acesso', async () => {
    const aluno = await criarAlunoCancelado({ cpf: '70310310105' });

    await importar([registroDe(aluno, { inicio: '', fim: '', perfil: '1' })]);

    const atualizado = await db.student.findUniqueOrThrow({ where: { id: aluno.id } });
    const direitos = await db.entitlement.findMany({ where: { studentId: aluno.id } });

    expect(atualizado.status).toBe('ACTIVE');
    // A REGRA No 1 EM UMA LINHA: cadastro ativo nao e direito de acesso.
    expect(direitos).toHaveLength(0);
  });

  it('funcionario ganha direito por vinculo, sem assinatura', async () => {
    const aluno = await criarAlunoCancelado({ cpf: '02974864112' });

    await importar([registroDe(aluno, { perfil: '2', inicio: '', fim: '' })]);

    const direitos = await db.entitlement.findMany({ where: { studentId: aluno.id } });
    const assinaturas = await db.subscription.findMany({ where: { studentId: aluno.id } });

    expect(direitos).toHaveLength(1);
    expect(direitos[0]!.source).toBe('EMPLOYEE');
    expect(direitos[0]!.subscriptionId).toBeNull();
    // Funcionario nao paga mensalidade: assinatura falsa poluiria o financeiro.
    expect(assinaturas).toHaveLength(0);
  });

  it('aluno com periodo ganha assinatura ligada ao plano correto', async () => {
    const aluno = await criarAlunoCancelado({ cpf: '70310310105' });

    await importar([
      registroDe(aluno, { perfil: '1', inicio: '20260803', fim: '20260902' }),
    ]);

    const assinatura = await db.subscription.findFirstOrThrow({
      where: { studentId: aluno.id },
      include: { plan: true },
    });
    const direito = await db.entitlement.findFirstOrThrow({
      where: { studentId: aluno.id },
    });

    expect(assinatura.plan.name).toBe('Programa Adultos e Idosos');
    expect(assinatura.status).toBe('ACTIVE');
    expect(direito.source).toBe('SUBSCRIPTION');
    expect(direito.subscriptionId).toBe(assinatura.id);
  });

  it('NAO emite cobranca -- essas pessoas ja pagaram no Pacto', async () => {
    const aluno = await criarAlunoCancelado({ cpf: '70310310105' });

    await importar([
      registroDe(aluno, { perfil: '1', inicio: '20260803', fim: '20260902' }),
    ]);

    const faturas = await db.invoice.findMany({
      where: { subscription: { studentId: aluno.id } },
    });

    // Vincular plano NAO e cobrar. Fatura retroativa criaria divida
    // fantasma para ~340 pessoas que ja quitaram no sistema antigo.
    expect(faturas).toHaveLength(0);
  });

  it('descarta registro de teste sem tentar casar', async () => {
    const antes = await db.student.count();

    const { casados, pendencias } = await importar([
      registroDe(null, { nome: 'teste-poc-17-08', cpf: '' }),
      registroDe(null, { nome: '8585', cpf: '' }),
    ]);

    // Lixo do Pacto nao vira aluno nem vira pendencia: vira descarte
    // contado, para o relatorio nao esconder o que ignorou.
    expect(casados).toBe(0);
    expect(pendencias).toHaveLength(0);
    expect(await db.student.count()).toBe(antes);
  });
});
```

Os três helpers são locais da suíte:

- `criarAlunoCancelado(dados)` — insere um aluno no estado que a F47 deixou (`CANCELLED`, sem credencial), devolvendo `{ id, fullName, cpf }`. Defaults para o que não vier.
- `registroDe(aluno, sobrescritas)` — monta um `RegistroDoPacto` completo. Com `aluno`, herda nome e CPF dele; com `null`, usa só as sobrescritas (é como se testa registro que não casa com ninguém).
- `importar(registros)` — chama `importarPessoasAtivas(db, registros, new Date('2026-08-20T12:00:00.000Z'))` e devolve `{ casados, pendencias }`. Data fixa: o "agora" entra por parâmetro justamente para o teste não depender do relógio.

- [ ] **Step 2: Extrair a função importável do seed**

Para o teste chamar sem `process.exit`, exporte de `seed-ativos.ts`:

```typescript
export async function importarPessoasAtivas(
  db: PrismaClientLike,
  registros: readonly RegistroDoPacto[],
  agora: Date,
): Promise<{ casados: number; pendencias: readonly Pendencia[] }> {
```

O `main()` passa a ser um invólucro fino: lê arquivo, chama `importarPessoasAtivas`, imprime relatório. O laço inteiro vai para a função exportada.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- importacao-ativos`
Expected: FAIL — helpers/função ainda não existem.

- [ ] **Step 4: Implementar helpers e fazer passar**

Escreva os três helpers no topo da suíte e ajuste até verde.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test:integration -- importacao-ativos`
Expected: PASS — 8 testes.

- [ ] **Step 6: Gate completo**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/integration/importacao-ativos.integration-spec.ts packages/database/prisma/seed-ativos.ts
git commit -m "test(integration): casamento, idempotencia e negacao sem direito (F48)"
```

---

### Task 8: Documentação e fechamento

**Files:**
- Modify: `docs/STATUS.md` (Índice Fatia ↔ SPEC)
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/TESTS.md`

**Interfaces:**
- Consumes: tudo
- Produces: rastro da fatia nos documentos

- [ ] **Step 1: Registrar a F48 no índice**

Em `docs/STATUS.md`, na tabela do Índice Fatia ↔ SPEC, depois da linha da F47:

```markdown
| F48 | — | 1 | — | Ativação da base corrente do Pacto (~340 ativos) | [design](superpowers/specs/2026-08-20-ativacao-base-corrente-design.md) | — | **entregue** |
```

- [ ] **Step 2: Atualizar `DEVELOPMENT.md`**

Acrescente a F48 na ordem de execução, com o comando do seed e a exigência da variável de ambiente.

- [ ] **Step 3: Registrar evidência em `TESTS.md`**

Siga o formato das linhas existentes: SPEC/fatia, o que foi provado, e o número do PR (preencher depois do merge — a linha nasce com `—` e o `--check` não valida esse campo).

- [ ] **Step 4: Gate final**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: verde.

- [ ] **Step 5: Commit**

```bash
git add docs/STATUS.md docs/DEVELOPMENT.md docs/TESTS.md
git commit -m "docs: registra a F48 no indice, execucao e evidencia"
```

---

## Notas para quem executa

**A ordem importa.** Task 1 gera o client do Prisma que as Tasks 6-7 consomem; Task 5 muda um tipo que a Task 6 usa. Não pule para o seed antes do schema.

**O JSON não está no repositório e não deve estar.** Para testar de verdade, peça o caminho ao PI e exporte `ARENAHUB_PESSOAS_ATIVAS`. Os testes de integração usam registros sintéticos, nunca o arquivo real.

**Se o casamento cobrir menos que ~80% dos registros,** pare e reporte antes de seguir: significa que a base do banco divergiu do arquivo, e importar metade é pior que não importar.

**Não crie `BiometricIdentity`.** O número do leitor entra como `StudentCredential`. O vínculo de consentimento nasce no fluxo da recepção (F8/F17), não aqui.
