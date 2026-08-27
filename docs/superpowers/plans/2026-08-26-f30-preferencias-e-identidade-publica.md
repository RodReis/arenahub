# F30 — Preferências e identidade pública · plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao aluno controle sobre aparecer ou não no ranking e sobre o nome com que aparece, com moderação de apelido pelo painel — tudo a partir do totem, sem app mobile.

**Architecture:** A preferência do aluno é um `ConsentRecord` (estendendo `ConsentDocumentType`), não uma tabela paralela. Uma função pura `resolverExposicao()` é o ponto único que decide se um aluno pode aparecer, e todo caminho de exibição passa por ela. O alias público mora em tabela nova (`PublicProfile`) com moderação humana e unicidade em índice parcial sobre `APPROVED`.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Zod, Next.js (App Router), Jest (api), Vitest + Testing Library (web), TypeScript estrito.

**Spec:** [`docs/superpowers/specs/2026-08-26-f30-preferencias-e-identidade-publica-design.md`](../specs/2026-08-26-f30-preferencias-e-identidade-publica-design.md)

## Global Constraints

- **Idioma:** domínio e identificadores em inglês; comentário, documento e texto de interface em **pt-BR**. Comentário de código **sem acento** (o repositório inteiro segue isso).
- **A inversão de regime:** ausência de `ConsentRecord` significa **participa** no engajamento — o oposto da biometria. Nunca reusar `avaliarConsentimento()` de `modules/privacy` para engajamento.
- **`tenant_id` em toda entidade de negócio**, vindo da identidade autenticada — nunca do corpo da requisição (Regra de arquitetura 2).
- **Módulo não lê tabela privada de outro módulo** (Regra 9): o totem chama caso de uso público, nunca `consent_records` direto.
- **Sem `any` implícito; `unknown` antes de validar** dado externo, com Zod no boundary.
- **Dinheiro não aparece nesta fatia.** Se aparecer, é sinal de escopo vazando.
- **Toda tela lê tokens** — nunca hex literal (a lint proíbe). `DS-TOTEM.md` para o totem, `DS-PAINEL.md` para o painel.
- **Toast, nunca `alert`**, para info/aviso/erro.
- **Migration é SQL escrito à mão** em `packages/database/prisma/migrations/<timestamp>_<nome>/migration.sql`, com comentário explicando o porquê. Timestamp desta fatia: `20260827000000_f30_engajamento`.
- **Piso de verde:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`. Antes do commit final, `pnpm test:report` (o `pnpm test` **não** roda integração).
- **PR usa `refs #30`**, nunca `closes #30` — só o PI fecha a issue.

---

### Task 1: Domínio puro — participação e exposição

O coração da fatia, e o lugar onde o erro é mais caro. Nasce sem banco e sem NestJS: funções puras, testadas isoladas.

**Files:**
- Create: `apps/api/src/modules/engagement/domain/participacao.ts`
- Create: `apps/api/src/modules/engagement/domain/participacao.spec.ts`
- Create: `apps/api/src/modules/engagement/domain/exposicao.ts`
- Create: `apps/api/src/modules/engagement/domain/exposicao.spec.ts`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces:
  - `type FinalidadeDeEngajamento = 'RANKING' | 'CHALLENGE' | 'ENGAGEMENT_PUSH' | 'PHYSICAL_EVOLUTION_RANKING'`
  - `interface DecisaoDeEngajamento { decision: 'ACCEPTED' | 'REFUSED'; supersededAt: Date | null }`
  - `function participaDoRanking(decisao: DecisaoDeEngajamento | null): boolean`
  - `type StatusDoPerfilPublico = 'PENDING' | 'APPROVED' | 'REJECTED' | 'HIDDEN'`
  - `type IdentidadeEscolhida = 'PRIMEIRO_NOME' | 'APELIDO' | 'ANONIMO'`
  - `interface PerfilPublico { alias: string | null; status: StatusDoPerfilPublico; identidade: IdentidadeEscolhida }`
  - `type Exposicao = { exibe: true; nome: string } | { exibe: false; motivo: 'OPT_OUT' | 'ALUNO_INATIVO' }`
  - `function resolverExposicao(entrada: EntradaDeExposicao): Exposicao`
  - `const NOME_ANONIMO = 'Participante'`

- [ ] **Step 1: Escrever o teste da inversão de regime (o que falha se alguém trocar o default)**

Crie `apps/api/src/modules/engagement/domain/participacao.spec.ts`:

```ts
import { participaDoRanking } from './participacao.js';

describe('participaDoRanking -- regime de OPT-OUT', () => {
  /*
   * O TESTE MAIS IMPORTANTE DA FATIA.
   *
   * Se alguem trocar o default para `false` (copiando a biometria, onde
   * ausencia significa NAO AUTORIZADO), este teste cai. Sem ele, a troca
   * passa verde e a academia inteira some do ranking sem ninguem notar.
   */
  it('aluno SEM linha de decisao PARTICIPA -- o oposto da biometria', () => {
    expect(participaDoRanking(null)).toBe(true);
  });

  it('aluno que pediu para sair nao participa', () => {
    expect(participaDoRanking({ decision: 'REFUSED', supersededAt: null })).toBe(false);
  });

  it('aluno que saiu e voltou participa', () => {
    expect(participaDoRanking({ decision: 'ACCEPTED', supersededAt: null })).toBe(true);
  });

  it('decisao ja substituida nao vale -- vale a linha viva', () => {
    // Uma decisao com `supersededAt` preenchido e historico, nao estado
    // atual. Tratada como ausencia: volta ao padrao, que e participar.
    expect(participaDoRanking({ decision: 'REFUSED', supersededAt: new Date() })).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter api test -- participacao`
Expected: FAIL — `Cannot find module './participacao.js'`.

- [ ] **Step 3: Implementar `participacao.ts`**

```ts
/**
 * Regime de participacao no engajamento -- OPT-OUT.
 *
 * ATENCAO, e aqui que se erra: ausencia de linha significa PARTICIPA, o
 * OPOSTO de `avaliarConsentimento` em `modules/privacy` (biometria), onde
 * ausencia significa NAO AUTORIZADO.
 *
 * NAO unifique os dois predicados. A diferenca e de REGIME, nao de
 * implementacao: o PI decidiu em 26/08/2026 que os alunos ja estao aceitos
 * e autorizados no ranking, e quem nao quiser aparecer pede para sair
 * (ADR-046). Um predicado servindo aos dois regimes passa verde enquanto
 * nenhum teste misturar os casos -- e ai a academia some do ranking, ou
 * pior, um aluno que pediu para sair reaparece.
 */

/** Finalidades de engajamento. `CHALLENGE` e `ENGAGEMENT_PUSH` nascem
 * DORMENTES: modeladas para que F31-F35 nao precisem de migration, sem
 * consumidor nesta fatia. */
export type FinalidadeDeEngajamento =
  | 'RANKING'
  | 'CHALLENGE'
  | 'ENGAGEMENT_PUSH'
  | 'PHYSICAL_EVOLUTION_RANKING';

/** O que a regra precisa saber sobre a decisao ja registrada. */
export interface DecisaoDeEngajamento {
  decision: 'ACCEPTED' | 'REFUSED';
  /** Preenchido quando uma decisao posterior substituiu esta. */
  supersededAt: Date | null;
}

/**
 * O aluno participa do ranking AGORA?
 *
 * `null` = participa: nunca houve manifestacao, e o padrao e participar.
 * Decisao substituida tambem: e historico, nao estado atual.
 */
export function participaDoRanking(decisao: DecisaoDeEngajamento | null): boolean {
  if (!decisao) return true;
  if (decisao.supersededAt !== null) return true;

  return decisao.decision === 'ACCEPTED';
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter api test -- participacao`
Expected: PASS, 4 testes.

- [ ] **Step 5: Escrever o teste de exposição**

Crie `apps/api/src/modules/engagement/domain/exposicao.spec.ts`:

```ts
import { NOME_ANONIMO, resolverExposicao } from './exposicao.js';

const base = {
  decisao: null,
  perfil: null,
  primeiroNome: 'Ana',
  statusDoAluno: 'ACTIVE' as const,
};

describe('resolverExposicao', () => {
  it('sem perfil e sem decisao, exibe o primeiro nome', () => {
    expect(resolverExposicao(base)).toEqual({ exibe: true, nome: 'Ana' });
  });

  it('quem pediu para sair nao aparece', () => {
    const saiu = { ...base, decisao: { decision: 'REFUSED' as const, supersededAt: null } };
    expect(resolverExposicao(saiu)).toEqual({ exibe: false, motivo: 'OPT_OUT' });
  });

  it('aluno cancelado nao aparece, mesmo participando', () => {
    // A base legada do Pacto tem 1.926 CANCELLED (F47). Cancelado no telao
    // do saguao e vazamento com outro nome.
    const cancelado = { ...base, statusDoAluno: 'CANCELLED' as const };
    expect(resolverExposicao(cancelado)).toEqual({ exibe: false, motivo: 'ALUNO_INATIVO' });
  });

  it('apelido APROVADO aparece', () => {
    const perfil = { alias: 'Tigre', status: 'APPROVED' as const, identidade: 'APELIDO' as const };
    expect(resolverExposicao({ ...base, perfil })).toEqual({ exibe: true, nome: 'Tigre' });
  });

  it('apelido PENDENTE nao vaza -- cai no primeiro nome', () => {
    const perfil = { alias: 'Tigre', status: 'PENDING' as const, identidade: 'APELIDO' as const };
    expect(resolverExposicao({ ...base, perfil })).toEqual({ exibe: true, nome: 'Ana' });
  });

  it.each(['REJECTED', 'HIDDEN'] as const)('apelido %s nao vaza', (status) => {
    const perfil = { alias: 'Tigre', status, identidade: 'APELIDO' as const };
    expect(resolverExposicao({ ...base, perfil })).toEqual({ exibe: true, nome: 'Ana' });
  });

  it('quem escolheu anonimo aparece como Participante', () => {
    const perfil = { alias: null, status: 'APPROVED' as const, identidade: 'ANONIMO' as const };
    expect(resolverExposicao({ ...base, perfil })).toEqual({ exibe: true, nome: NOME_ANONIMO });
  });

  it('escolheu apelido mas o alias sumiu -- cai no primeiro nome, nao quebra', () => {
    const perfil = { alias: null, status: 'APPROVED' as const, identidade: 'APELIDO' as const };
    expect(resolverExposicao({ ...base, perfil })).toEqual({ exibe: true, nome: 'Ana' });
  });

  it('opt-out vence a escolha de identidade', () => {
    const perfil = { alias: 'Tigre', status: 'APPROVED' as const, identidade: 'APELIDO' as const };
    const saiu = { decision: 'REFUSED' as const, supersededAt: null };
    expect(resolverExposicao({ ...base, perfil, decisao: saiu })).toEqual({
      exibe: false,
      motivo: 'OPT_OUT',
    });
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `pnpm --filter api test -- exposicao`
Expected: FAIL — módulo não existe.

- [ ] **Step 7: Implementar `exposicao.ts`**

```ts
import type { StudentStatus } from '@prisma/client';

import { type DecisaoDeEngajamento, participaDoRanking } from './participacao.js';

/** Como o aluno aparece quando escolheu nao se identificar. */
export const NOME_ANONIMO = 'Participante';

export type StatusDoPerfilPublico = 'PENDING' | 'APPROVED' | 'REJECTED' | 'HIDDEN';

export type IdentidadeEscolhida = 'PRIMEIRO_NOME' | 'APELIDO' | 'ANONIMO';

export interface PerfilPublico {
  alias: string | null;
  status: StatusDoPerfilPublico;
  identidade: IdentidadeEscolhida;
}

export interface EntradaDeExposicao {
  /** Ausencia significa PARTICIPA -- ver `participacao.ts`. */
  decisao: DecisaoDeEngajamento | null;
  perfil: PerfilPublico | null;
  primeiroNome: string;
  statusDoAluno: StudentStatus;
}

export type Exposicao =
  | { exibe: true; nome: string }
  | { exibe: false; motivo: 'OPT_OUT' | 'ALUNO_INATIVO' };

/**
 * O PONTO UNICO que decide se um aluno pode aparecer publicamente, e com
 * que nome.
 *
 * Pura: sem banco, sem relogio. Toda exibicao -- API, tela do totem,
 * exportacao, ranking futuro -- passa por aqui. Quem quiser expor um aluno
 * sem chamar esta funcao tem de escrever o nome na mao, e isso aparece em
 * revisao.
 */
export function resolverExposicao(entrada: EntradaDeExposicao): Exposicao {
  if (entrada.statusDoAluno !== 'ACTIVE') {
    return { exibe: false, motivo: 'ALUNO_INATIVO' };
  }

  if (!participaDoRanking(entrada.decisao)) {
    return { exibe: false, motivo: 'OPT_OUT' };
  }

  return { exibe: true, nome: nomeExibido(entrada) };
}

/**
 * Ordem: apelido APROVADO -> anonimo -> primeiro nome.
 *
 * Alias em qualquer estado que nao `APPROVED` cai no primeiro nome. E o
 * ponto onde um apelido em moderacao vazaria se a checagem de status
 * ficasse de fora.
 */
function nomeExibido(entrada: EntradaDeExposicao): string {
  const { perfil, primeiroNome } = entrada;

  if (!perfil) return primeiroNome;

  if (perfil.identidade === 'ANONIMO') return NOME_ANONIMO;

  if (perfil.identidade === 'APELIDO' && perfil.status === 'APPROVED' && perfil.alias) {
    return perfil.alias;
  }

  return primeiroNome;
}
```

- [ ] **Step 8: Rodar os dois arquivos e confirmar verde**

Run: `pnpm --filter api test -- engagement/domain`
Expected: PASS, 13 testes.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/engagement/domain
git commit -m "feat(engagement): participacao opt-out e politica de exposicao"
```

---

### Task 2: Triagem de alias

Função pura que **classifica**, nunca decide. Tudo vira `PENDING`; ela anexa códigos de sinal para o moderador.

**Files:**
- Create: `apps/api/src/modules/engagement/domain/triagem-de-alias.ts`
- Create: `apps/api/src/modules/engagement/domain/triagem-de-alias.spec.ts`

**Interfaces:**
- Consumes: nada de Task 1 (independente).
- Produces:
  - `type SinalDeAlias = 'CURTO_DEMAIS' | 'LONGO_DEMAIS' | 'CARACTERE_INVISIVEL' | 'PARECE_EMAIL' | 'PARECE_TELEFONE' | 'PARECE_CPF' | 'PALAVRA_BLOQUEADA' | 'SO_SIMBOLOS'`
  - `interface ResultadoDaTriagem { normalizado: string; sinais: readonly SinalDeAlias[] }`
  - `function triarAlias(bruto: string, palavrasBloqueadas: readonly string[]): ResultadoDaTriagem`
  - `const ALIAS_MIN = 2`, `const ALIAS_MAX = 24`

- [ ] **Step 1: Escrever o teste**

Crie `apps/api/src/modules/engagement/domain/triagem-de-alias.spec.ts`:

```ts
import { triarAlias } from './triagem-de-alias.js';

const SEM_BLOQUEIO: readonly string[] = [];

describe('triarAlias -- normalizacao', () => {
  it('normaliza para NFKC e minusculas', () => {
    // 'Ｔｉｇｒｅ' em largura total vira 'tigre' -- senao dois alunos ficam
    // com aliases visualmente iguais e o indice unico nao percebe.
    expect(triarAlias('Ｔｉｇｒｅ', SEM_BLOQUEIO).normalizado).toBe('tigre');
  });

  it('colapsa espaco repetido e apara as pontas', () => {
    expect(triarAlias('  Tigre   de   Aco  ', SEM_BLOQUEIO).normalizado).toBe('tigre de aco');
  });

  it('remove caractere invisivel e SINALIZA', () => {
    // U+200B (zero-width space) faz 'tigre' e 'ti​gre' passarem por
    // alias diferentes no banco e identicos na tela.
    const resultado = triarAlias('ti​gre', SEM_BLOQUEIO);
    expect(resultado.normalizado).toBe('tigre');
    expect(resultado.sinais).toContain('CARACTERE_INVISIVEL');
  });
});

describe('triarAlias -- sinais', () => {
  it('sinaliza alias curto demais', () => {
    expect(triarAlias('a', SEM_BLOQUEIO).sinais).toContain('CURTO_DEMAIS');
  });

  it('sinaliza alias longo demais', () => {
    expect(triarAlias('a'.repeat(25), SEM_BLOQUEIO).sinais).toContain('LONGO_DEMAIS');
  });

  it.each([
    ['ana@exemplo.com', 'PARECE_EMAIL'],
    ['41999998888', 'PARECE_TELEFONE'],
    ['529.982.247-25', 'PARECE_CPF'],
  ] as const)('sinaliza PII: %s', (bruto, sinal) => {
    expect(triarAlias(bruto, SEM_BLOQUEIO).sinais).toContain(sinal);
  });

  it('sinaliza palavra bloqueada do tenant', () => {
    expect(triarAlias('Tigre Palavrao', ['palavrao']).sinais).toContain('PALAVRA_BLOQUEADA');
  });

  it('pega palavra bloqueada com acento e caixa diferentes', () => {
    expect(triarAlias('ARROMBÁDO', ['arrombado']).sinais).toContain('PALAVRA_BLOQUEADA');
  });

  it('sinaliza alias so de simbolos', () => {
    expect(triarAlias('!!!###', SEM_BLOQUEIO).sinais).toContain('SO_SIMBOLOS');
  });

  it('alias limpo nao gera sinal nenhum', () => {
    expect(triarAlias('Tigre', SEM_BLOQUEIO).sinais).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter api test -- triagem-de-alias`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `triagem-de-alias.ts`**

```ts
/**
 * Triagem de apelido publico.
 *
 * ELA CLASSIFICA, NAO PUNE. Todo alias vira `PENDING` de qualquer jeito; o
 * que a triagem faz e anexar codigos de sinal para o moderador ver primeiro
 * o que merece olhar. Rejeitar automaticamente transformaria o filtro NA
 * moderacao -- e filtro se contorna, moderador nao.
 *
 * Pura e sem servico externo: sem IA, sem chamada de rede. Ha um humano na
 * fila por decisao do PI (26/08/2026).
 */

export const ALIAS_MIN = 2;
export const ALIAS_MAX = 24;

export type SinalDeAlias =
  | 'CURTO_DEMAIS'
  | 'LONGO_DEMAIS'
  | 'CARACTERE_INVISIVEL'
  | 'PARECE_EMAIL'
  | 'PARECE_TELEFONE'
  | 'PARECE_CPF'
  | 'PALAVRA_BLOQUEADA'
  | 'SO_SIMBOLOS';

export interface ResultadoDaTriagem {
  /** Forma canonica: NFKC, minuscula, sem invisivel, espaco colapsado. */
  normalizado: string;
  sinais: readonly SinalDeAlias[];
}

/** Zero-width space, ZWNJ, ZWJ, BOM e afins -- invisiveis que duplicam alias. */
const INVISIVEIS = /[­​-‏‪-‮⁠-⁤﻿]/gu;

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
/** 10 ou 11 digitos seguidos, com ou sem separador -- telefone brasileiro. */
const TELEFONE = /(?:\d[\s().-]*){10,11}/u;
/** 11 digitos com a pontuacao classica de CPF. */
const CPF = /\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}/u;
/** Pelo menos uma letra ou digito -- senao e so simbolo. */
const TEM_ALFANUMERICO = /[\p{L}\p{N}]/u;

/**
 * Remove acento para comparar palavra bloqueada.
 *
 * Sem isto, bloquear "arrombado" nao pega "arrombádo" -- e trocar uma letra
 * por sua versao acentuada e a primeira coisa que se tenta.
 */
function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function triarAlias(
  bruto: string,
  palavrasBloqueadas: readonly string[],
): ResultadoDaTriagem {
  const sinais = new Set<SinalDeAlias>();

  if (INVISIVEIS.test(bruto)) sinais.add('CARACTERE_INVISIVEL');
  // `lastIndex` sobrevive entre chamadas em regex global -- zerar aqui
  // evita que a proxima chamada comece do meio da string anterior.
  INVISIVEIS.lastIndex = 0;

  const normalizado = bruto
    .normalize('NFKC')
    .replace(INVISIVEIS, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();

  if (normalizado.length < ALIAS_MIN) sinais.add('CURTO_DEMAIS');
  if (normalizado.length > ALIAS_MAX) sinais.add('LONGO_DEMAIS');
  if (!TEM_ALFANUMERICO.test(normalizado)) sinais.add('SO_SIMBOLOS');

  if (EMAIL.test(normalizado)) sinais.add('PARECE_EMAIL');
  if (CPF.test(normalizado)) sinais.add('PARECE_CPF');
  else if (TELEFONE.test(normalizado)) sinais.add('PARECE_TELEFONE');

  const comparavel = semAcento(normalizado);
  const bloqueada = palavrasBloqueadas.some((palavra) =>
    comparavel.includes(semAcento(palavra.toLowerCase())),
  );
  if (bloqueada) sinais.add('PALAVRA_BLOQUEADA');

  return { normalizado, sinais: [...sinais] };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter api test -- triagem-de-alias`
Expected: PASS, 12 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement/domain/triagem-de-alias.ts apps/api/src/modules/engagement/domain/triagem-de-alias.spec.ts
git commit -m "feat(engagement): triagem de alias publico"
```

---

### Task 3: Schema e migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (enum `ConsentDocumentType` ~linha 273; modelo `Student` ~linha 896 para a relação; modelo novo ao fim do arquivo)
- Create: `packages/database/prisma/migrations/20260827000000_f30_engajamento/migration.sql`

**Interfaces:**
- Consumes: os tipos de Task 1 (`StatusDoPerfilPublico`, `IdentidadeEscolhida`) espelham os enums criados aqui.
- Produces: modelo Prisma `PublicProfile`, enums `PublicProfileStatus`, `PublicIdentityChoice`, `AliasRejectionReason`; `ConsentDocumentType` com quatro valores novos.

- [ ] **Step 1: Estender `ConsentDocumentType` no schema**

Em `packages/database/prisma/schema.prisma`, substitua o enum (linha ~273):

```prisma
/// Finalidade do documento de consentimento.
///
/// ATENCAO AO REGIME: `BIOMETRIC`, `HEALTH` e `AI_ANALYSIS` sao OPT-IN --
/// sem linha aceita, nao autoriza. As quatro finalidades de ENGAJAMENTO sao
/// OPT-OUT: sem linha, o aluno PARTICIPA (ADR-046, decisao do PI em
/// 26/08/2026). A mesma tabela guarda os dois regimes, e o predicado de
/// cada um vive separado -- `modules/privacy` para o primeiro,
/// `modules/engagement/domain/participacao.ts` para o segundo.
enum ConsentDocumentType {
  BIOMETRIC

  HEALTH

  AI_ANALYSIS

  /// Aparecer em ranking. OPT-OUT.
  RANKING

  /// Participar de desafio. OPT-OUT. DORMENTE ate a F34.
  CHALLENGE

  /// Receber notificacao de engajamento. OPT-OUT. DORMENTE: nao ha app.
  ENGAGEMENT_PUSH

  /// Aparecer em ranking de evolucao fisica. OPT-OUT. DORMENTE ate a F33.
  PHYSICAL_EVOLUTION_RANKING

  @@map("consent_document_type")
}
```

- [ ] **Step 2: Acrescentar os enums e o modelo `PublicProfile`**

Ao fim de `schema.prisma`:

```prisma
/// Estado de moderacao do apelido publico.
enum PublicProfileStatus {
  /// Aguardando moderacao. Enquanto isso, o aluno aparece pelo primeiro nome.
  PENDING
  APPROVED
  REJECTED
  /// Ocultado depois de aprovado -- denuncia, revisao, mudanca de politica.
  HIDDEN

  @@map("public_profile_status")
}

/// Como o aluno escolheu aparecer.
enum PublicIdentityChoice {
  PRIMEIRO_NOME
  APELIDO
  ANONIMO

  @@map("public_identity_choice")
}

/// Razao CATEGORIZADA de recusa. Enum, nunca texto livre: texto livre vira
/// PII e vira inconsistencia entre moderadores.
enum AliasRejectionReason {
  OFENSIVO
  CONTEM_PII
  IMPERSONACAO
  SPAM_OU_PROPAGANDA
  ILEGIVEL

  @@map("alias_rejection_reason")
}

/// Identidade publica do aluno no engajamento.
///
/// SEPARADA do cadastro civil de proposito: `Student.name` e nome legal e
/// nunca vira apelido publico por acidente. Uma linha por aluno por tenant;
/// a ausencia dela significa "aparece pelo primeiro nome".
model PublicProfile {
  id              String                @id @default(uuid()) @db.Uuid
  tenantId        String                @map("tenant_id") @db.Uuid
  studentId       String                @map("student_id") @db.Uuid
  identityChoice  PublicIdentityChoice  @default(PRIMEIRO_NOME) @map("identity_choice")
  /// Como o aluno digitou. Exibido so quando `status = APPROVED`.
  alias           String?
  /// Forma canonica (NFKC, minuscula, sem invisivel) -- alimenta o indice
  /// parcial de unicidade. Ver `triagem-de-alias.ts`.
  aliasNormalized String?               @map("alias_normalized")
  status          PublicProfileStatus   @default(PENDING)
  /// Codigos de sinal da triagem, para o moderador priorizar. Array de
  /// `SinalDeAlias`. NUNCA guarda o motivo em texto livre.
  screeningSignals String[]             @default([]) @map("screening_signals")
  rejectionReason AliasRejectionReason? @map("rejection_reason")
  moderatedBy     String?               @map("moderated_by") @db.Uuid
  moderatedAt     DateTime?             @map("moderated_at")
  /// Compare-and-swap: o cliente manda a versao que leu, e a escrita falha
  /// se outra edicao passou no meio.
  version         Int                   @default(1)
  createdAt       DateTime              @default(now()) @map("created_at")
  updatedAt       DateTime              @updatedAt @map("updated_at")

  tenant    Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  student   Student @relation(fields: [studentId], references: [id], onDelete: Cascade)
  moderator User?   @relation(fields: [moderatedBy], references: [id])

  /// Unicidade do alias vive em INDICE PARCIAL sobre `APPROVED`, escrito a
  /// mao na migracao: Prisma nao expressa `WHERE` em @@unique. Indice total
  /// recusaria o segundo PENDING legitimo antes de um moderador olhar.
  @@unique([tenantId, studentId])
  @@index([tenantId, status, createdAt])
  @@map("public_profiles")
}
```

- [ ] **Step 3: Declarar as relações inversas**

Em `model Student` (~linha 896), acrescente junto às outras relações:

```prisma
  publicProfile PublicProfile?
```

Em `model Tenant` (~linha 513):

```prisma
  publicProfiles PublicProfile[]
```

Em `model User` (~linha 641):

```prisma
  moderatedProfiles PublicProfile[]
```

- [ ] **Step 4: Escrever a migration à mão**

Crie `packages/database/prisma/migrations/20260827000000_f30_engajamento/migration.sql`:

```sql
-- F30 -- Preferencias e identidade publica (ADR-046).
--
-- Duas coisas: quatro finalidades novas de consentimento (regime OPT-OUT,
-- ao contrario da biometria) e a tabela de identidade publica.

-- As finalidades de engajamento. Aditivo puro: `ALTER TYPE ... ADD VALUE`
-- nao toca em linha existente.
ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'RANKING';
ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'CHALLENGE';
ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'ENGAGEMENT_PUSH';
ALTER TYPE "consent_document_type" ADD VALUE IF NOT EXISTS 'PHYSICAL_EVOLUTION_RANKING';

CREATE TYPE "public_profile_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN');
CREATE TYPE "public_identity_choice" AS ENUM ('PRIMEIRO_NOME', 'APELIDO', 'ANONIMO');
CREATE TYPE "alias_rejection_reason" AS ENUM (
  'OFENSIVO', 'CONTEM_PII', 'IMPERSONACAO', 'SPAM_OU_PROPAGANDA', 'ILEGIVEL'
);

CREATE TABLE "public_profiles" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid NOT NULL,
  "student_id"        uuid NOT NULL,
  "identity_choice"   "public_identity_choice" NOT NULL DEFAULT 'PRIMEIRO_NOME',
  "alias"             text,
  "alias_normalized"  text,
  "status"            "public_profile_status" NOT NULL DEFAULT 'PENDING',
  "screening_signals" text[] NOT NULL DEFAULT '{}',
  "rejection_reason"  "alias_rejection_reason",
  "moderated_by"      uuid,
  "moderated_at"      timestamp(3),
  "version"           integer NOT NULL DEFAULT 1,
  "created_at"        timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        timestamp(3) NOT NULL,

  CONSTRAINT "public_profiles_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "public_profiles_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE,
  CONSTRAINT "public_profiles_moderated_by_fkey"
    FOREIGN KEY ("moderated_by") REFERENCES "users"("id")
);

-- Um perfil por aluno.
CREATE UNIQUE INDEX "public_profiles_tenant_id_student_id_key"
  ON "public_profiles" ("tenant_id", "student_id");

-- A fila de moderacao le por aqui.
CREATE INDEX "public_profiles_tenant_id_status_created_at_idx"
  ON "public_profiles" ("tenant_id", "status", "created_at");

-- ALIAS UNICO SO ENTRE OS APROVADOS, e o WHERE e o ponto todo.
--
-- Indice TOTAL recusaria o segundo aluno que PEDIU o mesmo apelido, antes
-- de qualquer moderador olhar -- negando um pedido legitimo pelo motivo
-- errado. Dois PENDING iguais convivem; so um chega a APPROVED, e e ai que
-- a colisao importa, porque e ai que o nome aparece na tela.
CREATE UNIQUE INDEX "public_profiles_alias_aprovado_unico"
  ON "public_profiles" ("tenant_id", "alias_normalized")
  WHERE "status" = 'APPROVED' AND "alias_normalized" IS NOT NULL;
```

- [ ] **Step 5: Aplicar e conferir**

Run: `pnpm --filter @arenahub/database exec prisma migrate dev --name f30_engajamento`

Se o Prisma pedir para criar a migration (em vez de aplicar a existente), responda que ela já existe — o arquivo foi escrito à mão de propósito. Em caso de bloqueio por reset, ver a memória `prisma-bloqueia-migrate-reset-para-ia`: **não** force reset.

Depois: `pnpm --filter @arenahub/database exec prisma generate`
Expected: cliente regenerado com `PublicProfile`.

- [ ] **Step 6: Verificar que o índice parcial existe de fato**

```bash
psql "$DATABASE_URL" -c "\d public_profiles"
```
Expected: a saída lista `public_profiles_alias_aprovado_unico` com o predicado `WHERE ((status = 'APPROVED') AND (alias_normalized IS NOT NULL))`. Se o predicado não aparecer, a migration não é a que rodou.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma
git commit -m "feat(engagement): schema de identidade publica e finalidades de engajamento"
```

---

### Task 4: Repositório e casos de uso

**Files:**
- Create: `apps/api/src/modules/engagement/engagement.repository.ts`
- Create: `apps/api/src/modules/engagement/engagement.service.ts`
- Create: `apps/api/src/modules/engagement/engagement.service.spec.ts`
- Create: `apps/api/src/modules/engagement/engagement.module.ts`

**Interfaces:**
- Consumes: `participaDoRanking`, `resolverExposicao`, `triarAlias` (Tasks 1–2); `PublicProfile` do Prisma (Task 3); `TenantContext` de `common/tenant/tenant-context.js`.
- Produces:
  - `class EngagementService` com:
    - `obterPreferencias(ctx: TenantContext, studentId: string): Promise<PreferenciasDoAluno>`
    - `atualizarPreferencia(ctx, entrada: EntradaDeAtualizacao, agora: Date): Promise<PreferenciasDoAluno>`
    - `definirAliasPublico(ctx, entrada: EntradaDeAlias, agora: Date): Promise<PerfilPublicoDoAluno>`
    - `listarParaModeracao(ctx, filtro: FiltroDeModeracao): Promise<PerfilPublicoDoAluno[]>`
    - `moderarAlias(ctx, entrada: EntradaDeModeracao, agora: Date): Promise<PerfilPublicoDoAluno>`
  - `interface PreferenciasDoAluno { finalidades: Record<FinalidadeDeEngajamento, boolean>; perfil: PerfilPublicoDoAluno | null; nomeExibido: string }`
  - `interface PerfilPublicoDoAluno { id: string; identityChoice: IdentidadeEscolhida; alias: string | null; status: StatusDoPerfilPublico; screeningSignals: readonly string[]; rejectionReason: string | null; version: number }`

- [ ] **Step 1: Escrever o teste dos casos de uso**

Crie `apps/api/src/modules/engagement/engagement.service.spec.ts`. Use o dublê de repositório em memória — **uma instância nova por teste** (memória `duble-com-estado-vaza-entre-testes`: instância compartilhada contamina o bloco seguinte).

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';

import { EngagementService } from './engagement.service.js';
import { RepositorioEmMemoria } from './engagement.repository.fake.js';

const CTX = {
  tenantId: 't1',
  actorId: 'u1',
  sessionId: 's1',
  permissions: new Set<string>(),
  allowedUnitIds: new Set(['g1']),
};
const AGORA = new Date('2026-08-27T12:00:00.000Z');

describe('EngagementService -- preferencias', () => {
  let repo: RepositorioEmMemoria;
  let service: EngagementService;

  beforeEach(() => {
    // Instancia NOVA por teste: dublê com estado vaza entre casos.
    repo = new RepositorioEmMemoria();
    service = new EngagementService(repo);
    repo.cadastrarAluno({ id: 'a1', tenantId: 't1', name: 'Ana Souza', status: 'ACTIVE' });
  });

  it('aluno sem manifestacao aparece participando de todas as finalidades', async () => {
    const preferencias = await service.obterPreferencias(CTX, 'a1');
    expect(preferencias.finalidades.RANKING).toBe(true);
    expect(preferencias.nomeExibido).toBe('Ana');
  });

  it('sair do ranking grava REFUSED e passa a nao participar', async () => {
    await service.atualizarPreferencia(
      CTX,
      { studentId: 'a1', finalidade: 'RANKING', participa: false, idempotencyKey: 'k1' },
      AGORA,
    );
    const preferencias = await service.obterPreferencias(CTX, 'a1');
    expect(preferencias.finalidades.RANKING).toBe(false);
  });

  it('voltar ao ranking substitui a decisao anterior, sem apagar', async () => {
    const sair = { studentId: 'a1', finalidade: 'RANKING' as const, participa: false };
    const voltar = { studentId: 'a1', finalidade: 'RANKING' as const, participa: true };
    await service.atualizarPreferencia(CTX, { ...sair, idempotencyKey: 'k1' }, AGORA);
    await service.atualizarPreferencia(CTX, { ...voltar, idempotencyKey: 'k2' }, AGORA);

    expect((await service.obterPreferencias(CTX, 'a1')).finalidades.RANKING).toBe(true);
    // INV-021: a decisao anterior continua existindo, marcada como substituida.
    expect(repo.decisoesDe('a1', 'RANKING')).toHaveLength(2);
    expect(repo.decisoesDe('a1', 'RANKING')[0].supersededAt).toEqual(AGORA);
  });

  it('mesma Idempotency-Key nao cria segunda linha', async () => {
    const entrada = {
      studentId: 'a1',
      finalidade: 'RANKING' as const,
      participa: false,
      idempotencyKey: 'k1',
    };
    await service.atualizarPreferencia(CTX, entrada, AGORA);
    await service.atualizarPreferencia(CTX, entrada, AGORA);
    expect(repo.decisoesDe('a1', 'RANKING')).toHaveLength(1);
  });

  it('nao le nem escreve preferencia de aluno de outro tenant', async () => {
    repo.cadastrarAluno({ id: 'a9', tenantId: 't2', name: 'Bruno Lima', status: 'ACTIVE' });
    await expect(service.obterPreferencias(CTX, 'a9')).rejects.toThrow(NotFoundException);
  });
});

describe('EngagementService -- alias publico', () => {
  let repo: RepositorioEmMemoria;
  let service: EngagementService;

  beforeEach(() => {
    repo = new RepositorioEmMemoria();
    service = new EngagementService(repo);
    repo.cadastrarAluno({ id: 'a1', tenantId: 't1', name: 'Ana Souza', status: 'ACTIVE' });
  });

  it('alias novo nasce PENDING, mesmo limpo', async () => {
    const perfil = await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    expect(perfil.status).toBe('PENDING');
    expect(perfil.screeningSignals).toEqual([]);
  });

  it('alias suspeito vai para revisao humana COM sinal, nao rejeitado', async () => {
    const perfil = await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'ana@exemplo.com', version: null },
      AGORA,
    );
    expect(perfil.status).toBe('PENDING');
    expect(perfil.screeningSignals).toContain('PARECE_EMAIL');
  });

  it('enquanto pendente, o nome exibido continua sendo o primeiro nome', async () => {
    await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    expect((await service.obterPreferencias(CTX, 'a1')).nomeExibido).toBe('Ana');
  });

  it('aprovado, o apelido passa a ser o nome exibido', async () => {
    const perfil = await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    await service.moderarAlias(
      CTX,
      { perfilId: perfil.id, decisao: 'APPROVED', rejectionReason: null },
      AGORA,
    );
    expect((await service.obterPreferencias(CTX, 'a1')).nomeExibido).toBe('Tigre');
  });

  it('editar alias aprovado devolve o perfil a PENDING', async () => {
    const perfil = await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    await service.moderarAlias(
      CTX,
      { perfilId: perfil.id, decisao: 'APPROVED', rejectionReason: null },
      AGORA,
    );
    const atual = await service.obterPreferencias(CTX, 'a1');
    const editado = await service.definirAliasPublico(
      CTX,
      {
        studentId: 'a1',
        identityChoice: 'APELIDO',
        alias: 'Leao',
        version: atual.perfil?.version ?? null,
      },
      AGORA,
    );
    expect(editado.status).toBe('PENDING');
  });

  it('versao velha e recusada -- compare-and-swap', async () => {
    await service.definirAliasPublico(
      CTX,
      { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      AGORA,
    );
    await expect(
      service.definirAliasPublico(
        CTX,
        { studentId: 'a1', identityChoice: 'APELIDO', alias: 'Leao', version: 99 },
        AGORA,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('moderador nao alcanca perfil de outro tenant', async () => {
    repo.cadastrarAluno({ id: 'a9', tenantId: 't2', name: 'Bruno Lima', status: 'ACTIVE' });
    const alheio = await service.definirAliasPublico(
      { ...CTX, tenantId: 't2' },
      { studentId: 'a9', identityChoice: 'APELIDO', alias: 'Lobo', version: null },
      AGORA,
    );
    await expect(
      service.moderarAlias(
        CTX,
        { perfilId: alheio.id, decisao: 'APPROVED', rejectionReason: null },
        AGORA,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter api test -- engagement.service`
Expected: FAIL — service e dublê não existem.

- [ ] **Step 3: Escrever o dublê de repositório**

Crie `apps/api/src/modules/engagement/engagement.repository.fake.ts`. Ele implementa a **mesma interface** que o repositório real (`PortaDeEngajamento`), e vive no boundary — nunca dentro do domínio (`docs/TESTING.md` §3).

Assine cada método exatamente como o repositório real (Step 4); guarde alunos, decisões e perfis em `Map`. `decisoesDe(studentId, finalidade)` é auxiliar **só do dublê**, para o teste inspecionar o histórico — ordene por `occurredAt` crescente e devolva cópia, não a lista interna.

- [ ] **Step 4: Implementar repositório e service**

`engagement.repository.ts` — a porta e a implementação Prisma:

```ts
/**
 * Le e escreve consentimento de ENGAJAMENTO e perfil publico.
 *
 * `ConsentRecord` e a mesma tabela da biometria, e isso e deliberado
 * (ADR-046): append-only, revogacao por linha nova, ator e IP ja modelados.
 * O que muda e o REGIME de leitura -- ver `domain/participacao.ts`.
 */
export interface PortaDeEngajamento {
  buscarAluno(tenantId: string, studentId: string): Promise<AlunoParaExposicao | null>;
  decisaoVigente(
    tenantId: string,
    studentId: string,
    finalidade: FinalidadeDeEngajamento,
  ): Promise<DecisaoDeEngajamento | null>;
  registrarDecisao(entrada: EntradaDeRegistro, agora: Date): Promise<void>;
  perfilDoAluno(tenantId: string, studentId: string): Promise<PerfilPublicoDoAluno | null>;
  perfilPorId(tenantId: string, perfilId: string): Promise<PerfilPublicoDoAluno | null>;
  salvarPerfil(entrada: EntradaDeSalvamento, agora: Date): Promise<PerfilPublicoDoAluno>;
  moderarPerfil(entrada: EntradaDeModeracaoNoBanco, agora: Date): Promise<PerfilPublicoDoAluno>;
  listarPorStatus(
    tenantId: string,
    status: StatusDoPerfilPublico,
    limite: number,
  ): Promise<PerfilPublicoDoAluno[]>;
}
```

Regras da implementação Prisma:

1. `decisaoVigente` — busca por `(tenantId, studentId, document.type)` com `supersededAt: null`, `orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }]`. **`orderBy` obrigatório**: sem ele a ordem física do Postgres decide qual decisão vale (memória `sort-estavel-decide-consentimento`).
2. `registrarDecisao` — dentro de `$transaction`: `updateMany` pondo `supersededAt: agora` nas vigentes, depois `create` da nova. Mesmo desenho de `privacy/consent.repository.ts:107`. `subjectAgeYears` recebe a idade calculada; `subjectKind: 'STUDENT'` (engajamento não tem regime de responsável legal). Idempotência por `evidence.idempotencyKey`: antes de escrever, procure decisão com a mesma chave nas últimas 24h e devolva sem gravar se existir.
3. `salvarPerfil` — `upsert` por `(tenantId, studentId)`. Ao criar: `version: 1`. Ao atualizar: `where` inclui a `version` observada e `data` faz `version: { increment: 1 }`; se `updateMany` devolver `count: 0`, houve corrida — o service traduz em `ConflictException`. Toda escrita de alias volta o status para `PENDING` e limpa `rejectionReason`, `moderatedBy` e `moderatedAt`.
4. `moderarPerfil` — `updateMany` com `tenantId` no `where` (nunca só o `id`), gravando `status`, `rejectionReason`, `moderatedBy: contexto.actorId`, `moderatedAt: agora`. `count: 0` vira `NotFoundException` — é o que barra o moderador de outro tenant.
5. **Colisão de alias aprovado** — o índice parcial dispara erro do Postgres na aprovação. Capture e traduza em `ConflictException` com código `ALIAS_JA_APROVADO_PARA_OUTRO_ALUNO`. **Não** confie em `error.meta.target`: com Prisma 7 + adapter-pg o nome do constraint só vem em texto livre (memória `prisma7-adapter-pg-sem-meta-target`) — case o nome do índice na mensagem.

`engagement.service.ts` — orquestra domínio e porta:

- `obterPreferencias` — busca aluno (404 se de outro tenant), lê as quatro decisões vigentes, monta `finalidades` com `participaDoRanking` em cada uma, e calcula `nomeExibido` com `resolverExposicao`. Se `exibe: false`, `nomeExibido` é `''` e o chamador decide o que mostrar.
- `atualizarPreferencia` — `participa: false` grava `REFUSED`; `true` grava `ACCEPTED`.
- `definirAliasPublico` — chama `triarAlias` com as palavras bloqueadas do tenant (nesta fatia, lista vazia: não há tela de configuração; o parâmetro existe para a F34 preencher), grava `alias`, `aliasNormalized` e `screeningSignals`. `identityChoice` diferente de `APELIDO` grava `alias: null`.
- `moderarAlias` — `REJECTED` exige `rejectionReason`; sem ela, `BadRequestException`.
- `listarParaModeracao` — delega a `listarPorStatus`, limite 100.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter api test -- engagement.service`
Expected: PASS, 13 testes.

- [ ] **Step 6: Escrever o módulo Nest**

`engagement.module.ts`: importa `PersistenceModule`, provê `EngagementService` e o repositório Prisma sob o token `PortaDeEngajamento`, e **exporta `EngagementService`** — o `KioskModule` vai consumi-lo como caso de uso público (Regra 9).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/engagement
git commit -m "feat(engagement): casos de uso de preferencia e alias publico"
```

---

### Task 5: Teste de integração — os dois regimes e o índice parcial

O que o dublê não prova: que a mesma tabela suporta os dois regimes sem contaminar, e que o índice parcial existe de verdade.

**Files:**
- Create: `apps/api/src/modules/engagement/engagement.integration.spec.ts`

**Interfaces:**
- Consumes: `EngagementService` e o repositório Prisma (Task 4); schema aplicado (Task 3).
- Produces: nada — é folha.

- [ ] **Step 1: Escrever o teste**

Siga o padrão de integração já usado em `apps/api` (banco dedicado, `pretest:integration` prepara). Casos obrigatórios:

```ts
it('os dois regimes convivem na mesma tabela sem se contaminar', async () => {
  // O aluno RECUSOU biometria e nao manifestou nada sobre ranking.
  // Regime opt-in: biometria negada. Regime opt-out: participa do ranking.
  // Se alguem unificar os predicados, um dos dois inverte e este teste cai.
  await registrarConsentimentoBiometrico(alunoId, 'REFUSED');

  expect(await biometriaAutorizada(alunoId)).toBe(false);
  expect((await service.obterPreferencias(ctx, alunoId)).finalidades.RANKING).toBe(true);
});

it('dois alunos podem ter o mesmo alias PENDENTE', async () => {
  await service.definirAliasPublico(ctx, aliasDe(aluno1, 'Tigre'), agora);
  await expect(service.definirAliasPublico(ctx, aliasDe(aluno2, 'Tigre'), agora)).resolves
    .toMatchObject({ status: 'PENDING' });
});

it('o segundo APPROVED com o mesmo alias e recusado', async () => {
  const p1 = await service.definirAliasPublico(ctx, aliasDe(aluno1, 'Tigre'), agora);
  const p2 = await service.definirAliasPublico(ctx, aliasDe(aluno2, 'Tigre'), agora);
  await service.moderarAlias(ctx, aprovar(p1.id), agora);
  await expect(service.moderarAlias(ctx, aprovar(p2.id), agora)).rejects.toThrow(ConflictException);
});

it('o mesmo alias aprovado em OUTRO tenant e permitido', async () => {
  // O indice e por tenant. Se alguem esquecer `tenant_id` na chave, dois
  // clientes diferentes brigam pelo mesmo apelido.
  await aprovarAlias(tenantA, aluno1, 'Tigre');
  await expect(aprovarAlias(tenantB, aluno9, 'Tigre')).resolves.toMatchObject({
    status: 'APPROVED',
  });
});

it('decisao vigente e a mais recente mesmo com occurredAt empatado', async () => {
  // Empate de timestamp nao pode deixar a ordem fisica do banco decidir.
  await registrarDuasDecisoesNoMesmoInstante(alunoId);
  expect((await service.obterPreferencias(ctx, alunoId)).finalidades.RANKING).toBe(false);
});
```

- [ ] **Step 2: Rodar**

Run: `pnpm db:int && pnpm --filter api test:integration -- engagement`
Expected: PASS. Se der `exit 3221226505` no Windows **depois** de os testes passarem, é o crash pré-existente do Jest — não é regressão (memória `jest-integracao-crasha-no-windows`).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/engagement/engagement.integration.spec.ts
git commit -m "test(engagement): integracao dos dois regimes e do indice parcial"
```

---

### Task 6: Contrato compartilhado e rotas do totem

**Files:**
- Create: `packages/api-contracts/src/engajamento.ts`
- Create: `packages/api-contracts/src/engajamento.spec.ts`
- Modify: `packages/api-contracts/src/index.ts`
- Modify: `apps/api/src/modules/kiosk/kiosk.controller.ts`
- Modify: `apps/api/src/modules/kiosk/kiosk.module.ts`
- Create: `apps/api/src/modules/kiosk/kiosk-engajamento.service.ts`
- Create: `apps/api/src/modules/kiosk/kiosk-engajamento.controller.spec.ts`

**Interfaces:**
- Consumes: `EngagementService` (Task 4), `KioskAreaDoAlunoService.resolver()` (existente).
- Produces:
  - `const preferenciasSchema`, `const aliasPublicoSchema` (Zod)
  - `type PreferenciasDoTotem`, `type PerfilPublicoDoTotem`

- [ ] **Step 1: Escrever o teste do controller**

Crie `apps/api/src/modules/kiosk/kiosk-engajamento.controller.spec.ts`, no padrão dos testes de controller do totem já existentes:

```ts
it('modulo ranking desligado responde 404', async () => {
  await comModulo({ ranking: false });
  await request(app)
    .get(`/api/v1/kiosk/sessoes/${sessionId}/engajamento/preferencias`)
    .set('Authorization', `Bearer ${tokenDoAluno}`)
    .expect(404);
});

it('sessao de outro aluno nao le preferencia alheia', async () => {
  // Nao ha parametro de aluno na URL: o studentId sai da sessao. Este teste
  // guarda essa ausencia -- se alguem acrescentar `?studentId=`, ele cai.
  await request(app)
    .get(`/api/v1/kiosk/sessoes/${sessaoDoOutroAluno}/engajamento/preferencias`)
    .set('Authorization', `Bearer ${tokenDoAluno}`)
    .expect(401);
});

it('sair do ranking devolve a preferencia atualizada', async () => {
  const resposta = await request(app)
    .patch(`/api/v1/kiosk/sessoes/${sessionId}/engajamento/preferencias`)
    .set('Authorization', `Bearer ${tokenDoAluno}`)
    .set('Idempotency-Key', 'k1')
    .send({ finalidade: 'RANKING', participa: false })
    .expect(200);
  expect(resposta.body.finalidades.RANKING).toBe(false);
});

it('finalidade dormente e recusada pelo contrato', async () => {
  // CHALLENGE e ENGAGEMENT_PUSH existem no banco, nao na API desta fatia:
  // aceitar aqui criaria consentimento que nenhuma tela mostra e nenhum
  // consumidor le.
  await request(app)
    .patch(`/api/v1/kiosk/sessoes/${sessionId}/engajamento/preferencias`)
    .set('Authorization', `Bearer ${tokenDoAluno}`)
    .set('Idempotency-Key', 'k2')
    .send({ finalidade: 'CHALLENGE', participa: false })
    .expect(400);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter api test -- kiosk-engajamento`
Expected: FAIL — rotas não existem (404 em todas).

- [ ] **Step 3: Escrever o contrato Zod**

Em `packages/api-contracts/src/engajamento.ts`:

```ts
import { z } from 'zod';

/**
 * So `RANKING` na API desta fatia.
 *
 * `CHALLENGE`, `ENGAGEMENT_PUSH` e `PHYSICAL_EVOLUTION_RANKING` existem no
 * banco (para F31-F35 nao precisarem de migration) mas NAO no contrato:
 * aceitar aqui criaria consentimento que nenhuma tela mostra e nenhum
 * consumidor le. Cada uma entra junto com quem a consome.
 */
export const finalidadeExpostaSchema = z.literal('RANKING');

export const preferenciasSchema = z.object({
  finalidade: finalidadeExpostaSchema,
  participa: z.boolean(),
});

export const aliasPublicoSchema = z
  .object({
    identityChoice: z.enum(['PRIMEIRO_NOME', 'APELIDO', 'ANONIMO']),
    alias: z.string().trim().min(1).max(64).nullable(),
    /** Versao lida pelo cliente. `null` na primeira gravacao. */
    version: z.number().int().positive().nullable(),
  })
  .refine((v) => v.identityChoice !== 'APELIDO' || (v.alias !== null && v.alias.length > 0), {
    message: 'apelido e obrigatorio quando a identidade escolhida e APELIDO',
    path: ['alias'],
  });
```

Exporte de `index.ts`. O `max(64)` é maior que `ALIAS_MAX` de propósito: o boundary aceita, a triagem **sinaliza** `LONGO_DEMAIS`, e o moderador decide — rejeitar no boundary tiraria o caso da fila humana.

- [ ] **Step 4: Implementar service e rotas**

`kiosk-engajamento.service.ts` traduz `ContextoDoKiosk` → `TenantContext` reusando `KioskAreaDoAlunoService.resolver()` com `modulo: 'ranking'`, e delega ao `EngagementService`. **Nenhuma leitura direta de tabela** — Regra 9.

No `kiosk.controller.ts`, três rotas, todas com `sessionId` no path e token do aluno no header (mesmo padrão de pagamento e saúde):

```
GET   api/v1/kiosk/sessoes/:sessionId/engajamento/preferencias
PATCH api/v1/kiosk/sessoes/:sessionId/engajamento/preferencias
PATCH api/v1/kiosk/sessoes/:sessionId/engajamento/perfil-publico
```

Em `kiosk.module.ts`: `imports` ganha `EngagementModule`; `providers` ganha `KioskEngajamentoService`. Comente por que, no estilo das linhas já existentes.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter api test -- kiosk-engajamento` e `pnpm --filter @arenahub/api-contracts test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api-contracts/src apps/api/src/modules/kiosk
git commit -m "feat(kiosk): rotas de preferencia e identidade publica no totem"
```

---

### Task 7: Rotas de moderação no painel

**Files:**
- Create: `apps/api/src/modules/engagement/engagement.controller.ts`
- Create: `apps/api/src/modules/engagement/engagement.controller.spec.ts`
- Modify: `apps/api/src/modules/engagement/engagement.module.ts`
- Modify: `packages/database/prisma/seed.ts` (catálogo de permissões, ~linha 126)
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `EngagementService` (Task 4).
- Produces: rotas `GET /api/v1/engagement/aliases` e `PATCH /api/v1/engagement/aliases/:id`; permissões `engagement.read` e `engagement.moderate`.

- [ ] **Step 1: Escrever o teste**

```ts
it('sem permissao, 403', async () => {
  await request(app)
    .get('/api/v1/engagement/aliases?status=PENDING')
    .set('Authorization', `Bearer ${tokenSemPermissao}`)
    .expect(403);
});

it('lista os pendentes com os sinais da triagem', async () => {
  const resposta = await request(app)
    .get('/api/v1/engagement/aliases?status=PENDING')
    .set('Authorization', `Bearer ${tokenDeModerador}`)
    .expect(200);
  expect(resposta.body.itens[0]).toMatchObject({ status: 'PENDING' });
});

it('rejeitar sem razao categorizada e 400', async () => {
  await request(app)
    .patch(`/api/v1/engagement/aliases/${perfilId}`)
    .set('Authorization', `Bearer ${tokenDeModerador}`)
    .send({ decisao: 'REJECTED' })
    .expect(400);
});

it('moderar perfil de outro tenant e 404', async () => {
  await request(app)
    .patch(`/api/v1/engagement/aliases/${perfilDeOutroTenant}`)
    .set('Authorization', `Bearer ${tokenDeModerador}`)
    .send({ decisao: 'APPROVED' })
    .expect(404);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter api test -- engagement.controller`
Expected: FAIL — controller não existe.

- [ ] **Step 3: Acrescentar as permissões ao seed**

Em `packages/database/prisma/seed.ts`, junto ao catálogo (~linha 126), na ordem alfabética da vizinhança:

```ts
  'engagement.read',
  'engagement.moderate',
```

Conceda as duas aos papéis que já têm `student.read` e `consent.manage` — moderar apelido é trabalho de recepção/operação, não de financeiro.

- [ ] **Step 4: Implementar o controller**

Padrão de `operations`: `@RequirePermissions('engagement.read')` no `GET`, `@RequirePermissions('engagement.moderate')` no `PATCH`. Zod no boundary. Erro em `application/problem+json` com `code` estável (`ALIAS_JA_APROVADO_PARA_OUTRO_ALUNO`, `RAZAO_DE_RECUSA_OBRIGATORIA`).

Registre `EngagementModule` em `app.module.ts`.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter api test -- engagement.controller`
Expected: PASS, 4 testes.

- [ ] **Step 6: Provar que a permissão existe de verdade**

```bash
grep -n "engagement.read\|engagement.moderate" packages/database/prisma/seed.ts
```
Expected: as duas linhas. Permissão ausente e permissão satisfeita são indistinguíveis num teste verde (memória `lint-verde-sem-canario`) — confira a concessão ao papel, não só a declaração.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/engagement packages/database/prisma/seed.ts apps/api/src/app.module.ts
git commit -m "feat(engagement): fila de moderacao de alias no painel"
```

---

### Task 8: Telas do totem

**Files:**
- Create: `apps/kiosk/components/preferencias.tsx`
- Create: `apps/kiosk/components/preferencias.spec.tsx`
- Modify: `apps/kiosk/components/minha-area.tsx`
- Modify: `apps/kiosk/lib/kiosk-client.ts`
- Modify: `apps/kiosk/lib/modulos.ts` (se o módulo `ranking` ainda não estiver mapeado)

**Interfaces:**
- Consumes: rotas da Task 6; `useSessao` e o cliente HTTP já existentes.
- Produces: componente `<Preferencias />` montado dentro de `minha-area.tsx`.

- [ ] **Step 1: Escrever o teste**

```tsx
it('o interruptor de ranking nasce LIGADO -- regime opt-out', async () => {
  // Se alguem inverter o default, o aluno abre a tela achando que esta fora
  // do ranking enquanto aparece nele. Este teste guarda a coerencia entre a
  // tela e o regime.
  render(<Preferencias {...props} />);
  expect(await screen.findByRole('switch', { name: /aparecer no ranking/i })).toBeChecked();
});

it('finalidade dormente nao aparece na tela', () => {
  // Interruptor que nao faz nada e pior que ausencia.
  render(<Preferencias {...props} />);
  expect(screen.queryByText(/desafio/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/notifica/i)).not.toBeInTheDocument();
});

it('apelido enviado mostra "em analise" e mantem o primeiro nome', async () => {
  render(<Preferencias {...props} />);
  await escolherApelido('Tigre');
  expect(await screen.findByText(/em análise/i)).toBeInTheDocument();
  expect(screen.getByTestId('nome-exibido')).toHaveTextContent('Ana');
});

it('erro da API vira toast, nunca alert', async () => {
  // `alert` e proibido pelas convencoes; e o toast precisa de efeito que
  // compare a mensagem, porque erro de action nao e evento.
  mockFalhaDaApi();
  render(<Preferencias {...props} />);
  await sair();
  expect(await screen.findByRole('status')).toHaveTextContent(/não foi possível/i);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter kiosk test -- preferencias`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar a tela**

Duas seções em `<Preferencias />`:

1. **Aparecer no ranking** — interruptor, ligado por padrão, com texto explicando que a saída vale a partir da próxima publicação.
2. **Meu nome no ranking** — três opções (primeiro nome · apelido · anônimo); escolhendo apelido, campo de texto com teclado na tela, e o selo *"em análise"* enquanto `PENDING`.

Regras de UI:
- **Só tokens.** Nada de hex literal — a lint proíbe, e `DS-TOTEM.md` é o contrato.
- Alvo de toque grande, contraste alto, texto legível a um metro (é totem, não desktop).
- Toast para info/aviso/erro. Reuse `components/toast.tsx`.
- Sessão efêmera: nada em `localStorage`.

Monte dentro de `minha-area.tsx` atrás do módulo `ranking`, no mesmo padrão de pagamento e saúde.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter kiosk test -- preferencias`
Expected: PASS, 4 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk
git commit -m "feat(kiosk): tela de preferencias e identidade publica"
```

---

### Task 9: Tela de moderação no painel

**Files:**
- Create: `apps/admin-web/app/(protected)/engagement/aliases/page.tsx`
- Create: `apps/admin-web/app/(protected)/engagement/aliases/fila-de-moderacao.tsx`
- Create: `apps/admin-web/app/(protected)/engagement/aliases/fila-de-moderacao.test.tsx`
- Create: `apps/admin-web/app/(protected)/engagement/aliases/aliases.module.css`
- Modify: `apps/admin-web/app/(protected)/navegacao.tsx`

**Interfaces:**
- Consumes: rotas da Task 7.
- Produces: rota `/engagement/aliases` no painel.

- [ ] **Step 1: Escrever o teste**

```tsx
it('mostra o alias pedido, o aluno e os sinais da triagem', () => {
  render(<FilaDeModeracao itens={[pendenteComSinal]} />);
  expect(screen.getByText('Tigre')).toBeInTheDocument();
  expect(screen.getByText(/parece e-mail/i)).toBeInTheDocument();
});

it('rejeitar exige razao categorizada antes de habilitar o botao', async () => {
  render(<FilaDeModeracao itens={[pendente]} />);
  await userEvent.click(screen.getByRole('button', { name: /rejeitar/i }));
  expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText(/motivo/i), 'OFENSIVO');
  expect(screen.getByRole('button', { name: /confirmar/i })).toBeEnabled();
});

it('fila vazia mostra estado vazio, nao tabela em branco', () => {
  render(<FilaDeModeracao itens={[]} />);
  expect(screen.getByText(/nenhum apelido aguardando/i)).toBeInTheDocument();
});

it('o moderador nao pode editar o alias -- so julgar', () => {
  render(<FilaDeModeracao itens={[pendente]} />);
  expect(screen.queryByRole('textbox', { name: /apelido/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter admin-web test -- fila-de-moderacao`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar a tela**

Server Component busca a fila; Client Component só para os botões. Componentes de `packages/ui`, tokens do `DS-PAINEL.md`, `state-labels.ts` para rótulo de estado. Sinais da triagem como chips legíveis (`PARECE_EMAIL` → *"parece e-mail"*), nunca o código cru.

Acrescente o item de navegação, visível só com `engagement.read`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter admin-web test -- fila-de-moderacao`
Expected: PASS, 4 testes.

- [ ] **Step 5: Commit**

```bash
git add "apps/admin-web/app/(protected)/engagement" "apps/admin-web/app/(protected)/navegacao.tsx"
git commit -m "feat(admin-web): fila de moderacao de apelido publico"
```

---

### Task 10: Verificação na tela e gate local

CI verde não prova a tela (memória `ci-verde-nao-prova-tela`).

**Files:** nenhum — verificação.

- [ ] **Step 1: Subir o ambiente com dado de demonstração**

```bash
pnpm db:demo && pnpm dev
```

Confira a **data do `dist`**, não só o processo vivo: build defasado já fingiu três bugs numa sessão (memória `build-defasado-antes-de-culpar-codigo`).

- [ ] **Step 2: Ligar o módulo `ranking`**

O módulo nasce desligado. Ligue na configuração do totem pelo painel (`/operations/kiosks`) e publique — senão a tela responde 404 e parece defeito.

- [ ] **Step 3: Percorrer o fluxo inteiro no totem**

Identifique-se por CPF, abra *Minhas preferências*, e confira:
1. O interruptor de ranking está **ligado**.
2. Desligar e reabrir a sessão mantém desligado.
3. Escolher apelido mostra *"em análise"* e o nome exibido continua o primeiro nome.
4. Desafio e notificação **não aparecem**.

- [ ] **Step 4: Moderar no painel e confirmar o efeito**

Aprove o apelido em `/engagement/aliases`, volte ao totem, reabra a sessão: o nome exibido virou o apelido. Rejeite outro e confira que o primeiro nome volta.

- [ ] **Step 5: Rodar o gate local completo**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:report
```

Os cinco verdes são o piso. `pnpm test:report` é obrigatório — `pnpm test` **não** roda integração.

---

### Task 11: ADR-046 e documentação

Escopo obrigatório da entrega, não melhoria adjacente.

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/CONVENTION.md`
- Modify: `docs/specs/SPEC-030-preferencias-e-identidade-publica.md`

- [ ] **Step 1: Escrever o ADR-046**

No formato dos vizinhos (ADR-042 a ADR-045): data, status `aceito`, decidido pelo PI em 26/08/2026, com os blocos **Emenda**, **Alcança** e **NÃO alcança**.

Três decisões:

1. **Superfície no totem, não no app.** A Slice 5.1 dizia "app"; `apps/mobile/` tem um `.gitkeep`. Emenda `MVP-05` §7 Slice 5.1 e §1 (dependências).
2. **O gate do MVP 5 não alcança esta fatia.** *"eventos confiáveis + app do MVP 4"* — a F30 não lê evento e não precisa do app. Emenda `MVP-05` §1. **NÃO alcança** F31–F35, que seguem no gate.
3. **Consentimento de ranking é opt-out.** Alunos já aceitos e autorizados. O aceite da Slice 5.1 muda de *"aluno não consentido nunca aparece"* para *"aluno que pediu para sair nunca aparece, a partir da próxima projeção"*.

Registre a consequência: a mesma tabela passa a guardar dois regimes, e os predicados vivem separados de propósito.

- [ ] **Step 2: `CONVENTION.md`**

Atualize a linha de `Consent` (§73) com as quatro finalidades e **o regime de cada uma**. Acrescente `PublicProfile` à tabela de entidades. Se algum `INV-nnn` novo nascer (candidato: "apelido não aprovado nunca é exibido"), numere na sequência e cite o teste que o prova.

- [ ] **Step 3: `STATUS.md` e `DEVELOPMENT.md`**

`STATUS.md`: a linha da F30 no Índice Fatia ↔ SPEC vira ✅ **entregue** com a data e o PR; nota curta no topo sobre o ADR-046. Se a `main` divergiu, **a versão da `main` vence** e o progresso se reaplica por cima (ADR-021).

`DEVELOPMENT.md`: acrescente a F30 na seção do MVP 5 com o que a fatia cumpriu, passo a passo, no formato das F49–F52.

- [ ] **Step 4: `TESTING.md`**

Linha da `SPEC-030` com as evidências. O campo do PR nasce `—` e **é preenchido depois do merge** — o `--check` não valida esse campo, e já falhei nisso duas vezes (memória `preencher-pr-no-tests-md-apos-merge`).

- [ ] **Step 5: `SPEC-030`**

Preencha §2 (decisões: as três do ADR-046), §3 (escopo negativo: a tabela do design §7), §4 (invariantes) e §5 (as perguntas respondidas pelo PI em 26/08).

- [ ] **Step 6: Commit**

```bash
git add docs
git commit -m "docs: ADR-046 e documentacao da F30"
```

---

### Task 12: Revisão e PR

- [ ] **Step 1: Revisão adversarial própria**

Rode `/code-review` e as skills de frontend (`/impeccable`, `frontend-design`) nas telas. **Nunca CodeRabbit** (memória `nunca-usar-coderabbit`).

Verifique com olhos de adversário:
- Existe caminho de exibição que **não** passa por `resolverExposicao()`?
- O predicado de engajamento continua separado do de biometria?
- Algum teste passa por motivo errado — lista vazia satisfazendo guarda de contagem?
- Erro de API vira toast, não `alert`?

- [ ] **Step 2: Gate local, de novo**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:report
```

- [ ] **Step 3: Abrir o PR**

```bash
git push -u origin feat/f30-preferencias-e-identidade-publica
gh pr create --title "[MVP5][SPEC-030][F30] Preferências e identidade pública" --body "..."
```

Corpo com: o que a fatia entrega, as três decisões do ADR-046, o escopo negativo, as decisões técnicas tomadas sem perguntar, e as evidências de teste. **`refs #30`**, nunca `closes #30`.

- [ ] **Step 4: Esperar o CI**

```bash
gh pr checks <n> --watch
```

`--watch` já saiu 0 com job vermelho (memória `gh-pr-checks-watch-mente-no-exit`): confira job a job com `gh run watch <id> --exit-status` antes de dizer que está verde.

- [ ] **Step 5: Mergear e fechar o ciclo**

Com CI verde, mergeie. Depois: `proplan:done` na issue com o link do PR, e preencha o campo do PR nas linhas do `TESTING.md`, `DEVELOPMENT.md` e `STATUS.md` (commit direto na `main`). **Confira se o merge fechou a issue sozinho** — fechar forja o aceite do PI (memória `merge-pode-fechar-issue-sem-closes`); se fechou, reabra.

- [ ] **Step 6: Perguntar ao PI sobre o grafo**

Pergunte se roda `/graphify . --update`.
