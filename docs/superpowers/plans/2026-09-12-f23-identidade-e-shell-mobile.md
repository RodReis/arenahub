# F23 — Identidade e shell mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O aluno ativa a própria conta por convite, entra no app, e volta depois sem digitar senha enquanto a sessão for válida e não revogada.

**Architecture:** O aluno vira um sujeito autenticável NOVO — `StudentAccount`, tabela própria com `tenant_id`, nunca o `User` do painel (que não tem tenant, carrega MFA/papéis e tem e-mail único global). A sessão reusa o padrão que o repositório já tem em `auth/`: refresh opaco, só o hash no banco, rotação por família, replay revoga a família inteira. O app guarda o refresh no SecureStore e o access token **só em memória**.

**Tech Stack:** NestJS + Prisma + Zod (API), Expo SDK 57 + expo-router + expo-secure-store (app), Jest (api e mobile), Testing Library React Native.

**Spec:** `docs/prd/academia/MVP-04-app-totem.md` §7 Slice 4.1 (requisitos `M4-FR-001`…`M4-FR-005`, `M4-BR-008`, `M4-NFR-002`, `M4-AC-001`, `M4-AC-002`) e `docs/specs/SPEC-023-identidade-e-shell-mobile.md`.

## Global Constraints

Valores fixados antes de começar. Toda task herda esta seção.

- **Idioma:** domínio e identificadores em **inglês**; texto de interface, comentário e commit em **pt-BR**.
- **Módulo da API é RASO**, como o resto do repositório: `modules/<nome>/` com controller + service + repository, e `domain/` só onde houver regra pura. **Não** criar `application/`, `infrastructure/` nem `ports/` — o plano antigo pedia isso e diverge da casa.
- **Tenant vem da identidade autenticada**, nunca do corpo (regra de arquitetura 2). Usar `TenantContextService` de `apps/api/src/common/tenant/tenant-context.service.ts`.
- **Validação no boundary com Zod `.strict()`** sobre `@Body() corpo: unknown`.
- **Erro de domínio** estende `ErroDeDominio` (`common/http/erro-de-dominio.ts`) e sai como `application/problem+json` pelo filtro existente.
- **Toda rota nova precisa de `@ApiOkResponse`** (ou equivalente), senão `apps/api/test/integration/openapi.int-spec.ts` reprova.
- **Nunca logar** senha, token, hash ou PII.
- **Access token: 10 min. Refresh: 30 dias.** Mesmos valores do painel.
- **Hash de token: SHA-256**, como `TokenService.calcularHashDeRefresh`. Hash de senha: o mesmo `PasswordService` do painel.
- **Resposta antienumeração:** login e recuperação respondem igual para identificador que existe e que não existe (`M4-FR-002`).
- **Cor e tamanho no app vêm de `useTema()`** — hex literal em `apps/mobile` é erro de lint (regra 1 do DS).

---

## Estrutura de arquivos

**API — módulo novo `apps/api/src/modules/student-identity/`**

| arquivo | responsabilidade |
|---|---|
| `domain/token-de-uso-unico.ts` | Regra pura: um token consumido/expirado/de outro aluno não ativa. Sem banco, sem relógio interno — o "agora" entra por parâmetro. |
| `domain/sessao-do-aluno.ts` | Regra pura da rotação: o que fazer quando chega refresh atual, já rotacionado (replay) ou de sessão revogada. |
| `student-account.repository.ts` | Acesso a `StudentAccount` e aos tokens de uso único. |
| `student-session.repository.ts` | Abrir, encontrar por hash, rotacionar e revogar sessão do aluno. Espelha `auth/session.repository.ts`. |
| `student-identity.service.ts` | Ativação, login, recuperação, rotação, logout, revogação, step-up. |
| `email-de-ativacao.service.ts` | Envio por Resend. Espelha `iam/email-de-convite.service.ts`, inclusive o degradar sem chave. |
| `student-auth.controller.ts` | `POST /api/v1/mobile/auth/*`. |
| `student-sessions.controller.ts` | `GET/DELETE /api/v1/mobile/sessions`. |
| `student-session.guard.ts` | Valida o access token do aluno e popula o contexto. |
| `student-identity.module.ts` | Registra tudo; importado no `AppModule`. |
| `dto/mobile-auth.dto.ts` | Schemas Zod. |

**App — `apps/mobile/`**

| arquivo | responsabilidade |
|---|---|
| `src/auth/armazenamento-seguro.ts` | Refresh no SecureStore; access **nunca** encostado no disco. |
| `src/auth/sessao.tsx` | Provider: access em memória, refresh sincronizado, limpeza em revogação. |
| `src/api/cliente.ts` | `fetch` com base URL, `Authorization` e uma única tentativa de refresh. |
| `app/(publico)/entrar.tsx` · `ativar.tsx` · `recuperar.tsx` | Telas fora do shell de abas. |
| `app/(protegido)/_layout.tsx` · `inicio.tsx` | Shell autenticado e Home mínima. |

---

### Task 1: Modelos de conta, token e sessão do aluno

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `apps/api/src/modules/student-identity/domain/token-de-uso-unico.ts`
- Create: `apps/api/src/modules/student-identity/domain/token-de-uso-unico.spec.ts`

**Interfaces:**
- Produces: `consumirTokenDeUsoUnico(entrada: EntradaDeConsumo, agora: Date): ResultadoDeConsumo` — onde `EntradaDeConsumo = { status: 'PENDING'|'CONSUMED'|'REVOKED'; expiresAt: Date; studentId: string }` e `ResultadoDeConsumo = { ok: true } | { ok: false; motivo: 'TOKEN_EXPIRADO'|'TOKEN_JA_USADO'|'TOKEN_REVOGADO' }`.

- [ ] **Step 1: Escrever os testes da regra pura**

```ts
import { consumirTokenDeUsoUnico } from './token-de-uso-unico.js';

const AGORA = new Date('2026-09-12T12:00:00Z');
const FUTURO = new Date('2026-09-12T13:00:00Z');
const PASSADO = new Date('2026-09-12T11:00:00Z');
const base = { status: 'PENDING' as const, expiresAt: FUTURO, studentId: 'aluno-1' };

describe('consumirTokenDeUsoUnico', () => {
  it('aceita token pendente dentro da validade', () => {
    expect(consumirTokenDeUsoUnico(base, AGORA)).toEqual({ ok: true });
  });

  it('recusa token ja consumido', () => {
    expect(consumirTokenDeUsoUnico({ ...base, status: 'CONSUMED' }, AGORA)).toEqual({
      ok: false,
      motivo: 'TOKEN_JA_USADO',
    });
  });

  it('recusa token revogado', () => {
    expect(consumirTokenDeUsoUnico({ ...base, status: 'REVOKED' }, AGORA)).toEqual({
      ok: false,
      motivo: 'TOKEN_REVOGADO',
    });
  });

  it('recusa token expirado', () => {
    expect(consumirTokenDeUsoUnico({ ...base, expiresAt: PASSADO }, AGORA)).toEqual({
      ok: false,
      motivo: 'TOKEN_EXPIRADO',
    });
  });

  it('trata o instante EXATO da expiracao como expirado', () => {
    // A borda importa: `<` em vez de `<=` deixa passar o token no milissegundo
    // da virada, e o teste que so usa "passado" e "futuro" nunca pega isso.
    expect(consumirTokenDeUsoUnico({ ...base, expiresAt: AGORA }, AGORA)).toEqual({
      ok: false,
      motivo: 'TOKEN_EXPIRADO',
    });
  });

  it('confere o estado ANTES da validade -- token usado e expirado acusa uso', () => {
    // Ordem de checagem e observavel: se o expirado vencesse, um atacante com
    // token usado saberia que ele existiu.
    expect(
      consumirTokenDeUsoUnico({ ...base, status: 'CONSUMED', expiresAt: PASSADO }, AGORA),
    ).toEqual({ ok: false, motivo: 'TOKEN_JA_USADO' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @arenahub/api test -- token-de-uso-unico`
Expected: FAIL — `Cannot find module './token-de-uso-unico.js'`.

- [ ] **Step 3: Implementar a regra pura**

```ts
/**
 * Um token de uso unico so ativa uma vez, dentro da validade, e so para o
 * aluno a quem foi emitido.
 *
 * Funcao PURA: sem banco, sem `new Date()` interno. O "agora" entra por
 * parametro porque teste que depende do relogio do processo envelhece sozinho
 * e fica vermelho no CI sem ninguem ter mexido no codigo.
 */
export type StatusDeToken = 'PENDING' | 'CONSUMED' | 'REVOKED';

export interface EntradaDeConsumo {
  readonly status: StatusDeToken;
  readonly expiresAt: Date;
  readonly studentId: string;
}

export type ResultadoDeConsumo =
  | { readonly ok: true }
  | { readonly ok: false; readonly motivo: 'TOKEN_EXPIRADO' | 'TOKEN_JA_USADO' | 'TOKEN_REVOGADO' };

export function consumirTokenDeUsoUnico(
  entrada: EntradaDeConsumo,
  agora: Date,
): ResultadoDeConsumo {
  // ESTADO antes de VALIDADE, e a ordem e observavel pelo chamador: um token
  // ja usado responde "usado" mesmo depois de vencer.
  if (entrada.status === 'CONSUMED') return { ok: false, motivo: 'TOKEN_JA_USADO' };
  if (entrada.status === 'REVOKED') return { ok: false, motivo: 'TOKEN_REVOGADO' };

  // `<=` e nao `<`: no instante exato da expiracao o token JA venceu.
  if (entrada.expiresAt.getTime() <= agora.getTime()) {
    return { ok: false, motivo: 'TOKEN_EXPIRADO' };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @arenahub/api test -- token-de-uso-unico`
Expected: PASS, 6 testes.

- [ ] **Step 5: Acrescentar os modelos ao schema**

Em `packages/database/prisma/schema.prisma`, acrescentar (todos com `tenant_id`, regra de arquitetura 2):

```prisma
/// Conta de login do ALUNO -- separada de `User`, que e a pessoa do painel.
///
/// Tabela propria porque o aluno e sujeito de outro dominio: nunca tera
/// papeis, permissoes nem elevacao de suporte, e a conta morre com a
/// matricula. `User.email` e unico GLOBAL, o que impediria a mesma pessoa de
/// ter conta em duas academias -- aqui o unique e POR TENANT.
model StudentAccount {
  id           String               @id @default(uuid()) @db.Uuid
  tenantId     String               @map("tenant_id") @db.Uuid
  studentId    String               @unique @map("student_id") @db.Uuid
  /// E-mail ou telefone com que o aluno entra. Unico dentro do tenant.
  identifier   String
  passwordHash String?              @map("password_hash")
  status       StudentAccountStatus @default(PENDING)
  activatedAt  DateTime?            @map("activated_at")
  createdAt    DateTime             @default(now()) @map("created_at")
  updatedAt    DateTime             @updatedAt @map("updated_at")

  student  Student                 @relation(fields: [studentId], references: [id], onDelete: Cascade)
  tokens   StudentAccountToken[]
  sessions StudentSession[]

  @@unique([tenantId, identifier])
  @@index([tenantId])
  @@map("student_accounts")
}

enum StudentAccountStatus {
  PENDING
  ACTIVE
  DISABLED
}

/// Token de uso unico: ativacao de conta e recuperacao de senha.
///
/// Guarda SO o hash, como `Invitation` ja faz -- vazamento de banco nao pode
/// entregar um token utilizavel.
model StudentAccountToken {
  id        String                   @id @default(uuid()) @db.Uuid
  tenantId  String                   @map("tenant_id") @db.Uuid
  accountId String                   @map("account_id") @db.Uuid
  purpose   StudentAccountTokenPurpose
  tokenHash String                   @unique @map("token_hash")
  status    StudentAccountTokenStatus @default(PENDING)
  expiresAt DateTime                 @map("expires_at")
  consumedAt DateTime?               @map("consumed_at")
  createdAt DateTime                 @default(now()) @map("created_at")

  account StudentAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId, accountId, purpose])
  @@map("student_account_tokens")
}

enum StudentAccountTokenPurpose {
  ACTIVATION
  PASSWORD_RESET
}

enum StudentAccountTokenStatus {
  PENDING
  CONSUMED
  REVOKED
}

/// Sessao do app do aluno -- espelha `Session` do painel, inclusive a
/// FAMILIA de rotacao. Tabela separada porque o sujeito e outro: `Session`
/// aponta para `User`, e um join de sessao de aluno com usuario de painel
/// nao existe.
model StudentSession {
  id            String               @id @default(uuid()) @db.Uuid
  tenantId      String               @map("tenant_id") @db.Uuid
  accountId     String               @map("account_id") @db.Uuid
  tokenHash     String               @unique @map("token_hash")
  familyId      String               @map("family_id") @db.Uuid
  status        StudentSessionStatus @default(ACTIVE)
  /// Identificador do aparelho, para a lista de sessoes fazer sentido ao
  /// aluno ("iPhone de Ana"). Opaco: nunca IMEI nem nada que identifique.
  deviceLabel   String?              @map("device_label")
  /// Quando o aluno confirmou a senha de novo -- `M4-FR-005`, step-up.
  reauthenticatedAt DateTime?        @map("reauthenticated_at")
  expiresAt     DateTime             @map("expires_at")
  rotatedAt     DateTime?            @map("rotated_at")
  revokedAt     DateTime?            @map("revoked_at")
  revokedReason String?              @map("revoked_reason")
  createdAt     DateTime             @default(now()) @map("created_at")

  account StudentAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId, accountId])
  @@index([familyId])
  @@map("student_sessions")
}

enum StudentSessionStatus {
  ACTIVE
  ROTATED
  REVOKED
}
```

E acrescentar a relação inversa em `Student`:

```prisma
  account StudentAccount?
```

- [ ] **Step 6: Gerar a migration**

Run: `pnpm --filter @arenahub/database exec prisma migrate dev --name f23_identidade_do_aluno`
Expected: migration criada e aplicada, sem drift.

> Se o Prisma recusar por exigir consentimento humano, é o comportamento
> esperado do repositório — peça ao PI e use a variável que ele indicar.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/student-identity/domain
git commit -m "feat(identity): conta, token e sessao do aluno (refs #23)"
```

---

### Task 2: Rotação de sessão — a regra que decide o replay

**Files:**
- Create: `apps/api/src/modules/student-identity/domain/sessao-do-aluno.ts`
- Create: `apps/api/src/modules/student-identity/domain/sessao-do-aluno.spec.ts`

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces: `decidirRotacao(sessao: SessaoParaRotacao, agora: Date): DecisaoDeRotacao` — `SessaoParaRotacao = { status: 'ACTIVE'|'ROTATED'|'REVOKED'; expiresAt: Date; familyId: string }`, `DecisaoDeRotacao = { acao: 'ROTACIONAR' } | { acao: 'REVOGAR_FAMILIA'; motivo: 'REFRESH_REPLAY' } | { acao: 'RECUSAR'; motivo: 'SESSAO_REVOGADA'|'SESSAO_EXPIRADA' }`.

- [ ] **Step 1: Escrever os testes**

```ts
import { decidirRotacao } from './sessao-do-aluno.js';

const AGORA = new Date('2026-09-12T12:00:00Z');
const FUTURO = new Date('2026-10-12T12:00:00Z');
const PASSADO = new Date('2026-09-11T12:00:00Z');
const base = { status: 'ACTIVE' as const, expiresAt: FUTURO, familyId: 'fam-1' };

describe('decidirRotacao', () => {
  it('rotaciona a sessao ativa e dentro da validade', () => {
    expect(decidirRotacao(base, AGORA)).toEqual({ acao: 'ROTACIONAR' });
  });

  it('REVOGA A FAMILIA quando o refresh ja foi rotacionado -- e replay', () => {
    // O elo antigo so volta se alguem guardou uma copia. Revogar a familia
    // inteira e a resposta certa: nao da para saber se quem tem o token
    // atual e o dono ou o atacante.
    expect(decidirRotacao({ ...base, status: 'ROTATED' }, AGORA)).toEqual({
      acao: 'REVOGAR_FAMILIA',
      motivo: 'REFRESH_REPLAY',
    });
  });

  it('recusa sessao ja revogada, sem revogar de novo', () => {
    expect(decidirRotacao({ ...base, status: 'REVOKED' }, AGORA)).toEqual({
      acao: 'RECUSAR',
      motivo: 'SESSAO_REVOGADA',
    });
  });

  it('recusa sessao expirada', () => {
    expect(decidirRotacao({ ...base, expiresAt: PASSADO }, AGORA)).toEqual({
      acao: 'RECUSAR',
      motivo: 'SESSAO_EXPIRADA',
    });
  });

  it('replay em sessao EXPIRADA ainda revoga a familia', () => {
    // O ataque nao deixa de ser ataque porque o token venceu. Se o expirado
    // vencesse a checagem, um replay tardio passaria como recusa comum e
    // ninguem saberia que houve copia.
    expect(decidirRotacao({ ...base, status: 'ROTATED', expiresAt: PASSADO }, AGORA)).toEqual({
      acao: 'REVOGAR_FAMILIA',
      motivo: 'REFRESH_REPLAY',
    });
  });

  it('trata o instante EXATO da expiracao como expirado', () => {
    expect(decidirRotacao({ ...base, expiresAt: AGORA }, AGORA)).toEqual({
      acao: 'RECUSAR',
      motivo: 'SESSAO_EXPIRADA',
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @arenahub/api test -- sessao-do-aluno`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
/**
 * O que fazer quando chega um refresh token.
 *
 * Funcao PURA -- o "agora" entra por parametro (mesma razao do
 * `token-de-uso-unico.ts`).
 *
 * A ORDEM DAS CHECAGENS E A REGRA. Replay vem ANTES de expiracao: um token
 * ja rotacionado que chega de novo e copia, e continua sendo copia depois de
 * vencer. Se a expiracao viesse primeiro, o replay tardio sairia como
 * "expirado" -- recusa comum, sem revogar a familia, e sem deixar rastro de
 * que houve copia.
 */
export type StatusDeSessao = 'ACTIVE' | 'ROTATED' | 'REVOKED';

export interface SessaoParaRotacao {
  readonly status: StatusDeSessao;
  readonly expiresAt: Date;
  readonly familyId: string;
}

export type DecisaoDeRotacao =
  | { readonly acao: 'ROTACIONAR' }
  | { readonly acao: 'REVOGAR_FAMILIA'; readonly motivo: 'REFRESH_REPLAY' }
  | { readonly acao: 'RECUSAR'; readonly motivo: 'SESSAO_REVOGADA' | 'SESSAO_EXPIRADA' };

export function decidirRotacao(sessao: SessaoParaRotacao, agora: Date): DecisaoDeRotacao {
  if (sessao.status === 'ROTATED') {
    return { acao: 'REVOGAR_FAMILIA', motivo: 'REFRESH_REPLAY' };
  }
  if (sessao.status === 'REVOKED') {
    return { acao: 'RECUSAR', motivo: 'SESSAO_REVOGADA' };
  }
  if (sessao.expiresAt.getTime() <= agora.getTime()) {
    return { acao: 'RECUSAR', motivo: 'SESSAO_EXPIRADA' };
  }
  return { acao: 'ROTACIONAR' };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @arenahub/api test -- sessao-do-aluno`
Expected: PASS, 6 testes.

- [ ] **Step 5: Provar por canário que o teste de replay pega de verdade**

Inverta as duas primeiras checagens (`ROTATED` depois de `expiresAt`) e rode de novo.
Expected: o teste "replay em sessao EXPIRADA ainda revoga a familia" FALHA. Reverta.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/student-identity/domain
git commit -m "feat(identity): regra de rotacao e replay da sessao do aluno (refs #23)"
```

---

### Task 3: Repositórios e serviço de identidade

**Files:**
- Create: `apps/api/src/modules/student-identity/student-account.repository.ts`
- Create: `apps/api/src/modules/student-identity/student-session.repository.ts`
- Create: `apps/api/src/modules/student-identity/student-identity.service.ts`
- Create: `apps/api/src/modules/student-identity/email-de-ativacao.service.ts`
- Create: `apps/api/test/integration/student-identity.int-spec.ts`

**Interfaces:**
- Consumes: `consumirTokenDeUsoUnico` (Task 1), `decidirRotacao` (Task 2), `PrismaService`, `PasswordService` e `TokenService` de `modules/auth/`.
- Produces: `StudentIdentityService` com `ativar({ token, senha })`, `entrar({ tenantId, identificador, senha, deviceLabel })`, `renovar({ refreshToken })`, `sair({ refreshToken })`, `listarSessoes(ctx)`, `revogarSessao(ctx, sessaoId)`, `pedirRecuperacao({ tenantId, identificador })`, `confirmarRecuperacao({ token, senha })`, `reautenticar(ctx, senha)`.

- [ ] **Step 1: Escrever o teste de integração da jornada e dos abusos**

```ts
describe('F23 -- identidade do aluno', () => {
  it('ativa a conta com o token e permite entrar em seguida', async () => {
    const { token } = await emitirConviteParaAluno(alunoId);
    await servico.ativar({ token, senha: 'Senha#Forte1' });

    const sessao = await servico.entrar({
      tenantId, identificador: 'aluno@example.test', senha: 'Senha#Forte1', deviceLabel: 'Pixel',
    });
    expect(sessao.accessToken).toBeTruthy();
  });

  it('recusa o MESMO token de ativacao na segunda vez', async () => {
    const { token } = await emitirConviteParaAluno(alunoId);
    await servico.ativar({ token, senha: 'Senha#Forte1' });
    await expect(servico.ativar({ token, senha: 'Outra#Senha1' })).rejects.toMatchObject({
      codigo: 'TOKEN_JA_USADO',
    });
  });

  it('responde IGUAL para identificador que existe e que nao existe', async () => {
    // `M4-FR-002`. A afirmacao e sobre INDISTINGUIBILIDADE: mesmo codigo,
    // mesmo status, mesmo corpo. Comparar os dois resultados entre si prova
    // mais do que afirmar um valor fixo em cada.
    const conhecido = await capturarErro(() =>
      servico.entrar({ tenantId, identificador: 'aluno@example.test', senha: 'errada', deviceLabel: null }));
    const desconhecido = await capturarErro(() =>
      servico.entrar({ tenantId, identificador: 'ninguem@example.test', senha: 'errada', deviceLabel: null }));

    expect(conhecido.codigo).toBe(desconhecido.codigo);
    expect(conhecido.status).toBe(desconhecido.status);
    expect(JSON.stringify(conhecido.corpo)).toBe(JSON.stringify(desconhecido.corpo));
  });

  it('a recuperacao aceita qualquer identificador sem revelar nada', async () => {
    await expect(servico.pedirRecuperacao({ tenantId, identificador: 'ninguem@example.test' }))
      .resolves.toEqual({ aceito: true });
  });

  it('rotaciona o refresh e INVALIDA o anterior', async () => {
    const primeira = await entrarComoAluno();
    const renovada = await servico.renovar({ refreshToken: primeira.refreshToken });
    expect(renovada.refreshToken).not.toBe(primeira.refreshToken);

    await expect(servico.renovar({ refreshToken: primeira.refreshToken })).rejects.toMatchObject({
      codigo: 'REFRESH_REPLAY',
    });
  });

  it('o replay derruba a FAMILIA -- o refresh atual tambem para de valer', async () => {
    // Este e o ponto do modelo de familia, e o teste que o prova: depois do
    // replay, quem tem o token BOM tambem perde acesso. Sem esta assercao, um
    // codigo que so recusa o token velho passaria.
    const primeira = await entrarComoAluno();
    const renovada = await servico.renovar({ refreshToken: primeira.refreshToken });
    await capturarErro(() => servico.renovar({ refreshToken: primeira.refreshToken }));

    await expect(servico.renovar({ refreshToken: renovada.refreshToken })).rejects.toMatchObject({
      codigo: 'SESSAO_REVOGADA',
    });
  });

  it('sessao revogada deixa de renovar -- `M4-AC-002`', async () => {
    const sessao = await entrarComoAluno();
    await servico.revogarSessao(ctxDoAluno, sessao.sessionId);
    await expect(servico.renovar({ refreshToken: sessao.refreshToken })).rejects.toMatchObject({
      codigo: 'SESSAO_REVOGADA',
    });
  });

  it('um aluno NAO revoga a sessao de outro', async () => {
    const doOutro = await entrarComoOutroAluno();
    await expect(servico.revogarSessao(ctxDoAluno, doOutro.sessionId)).rejects.toMatchObject({
      codigo: 'SESSAO_NAO_ENCONTRADA',
    });
    // E a sessao do outro continua funcionando -- recusar sem vazar nao pode
    // significar "revogou mesmo assim".
    await expect(servico.renovar({ refreshToken: doOutro.refreshToken })).resolves.toBeTruthy();
  });

  it('nao guarda o refresh em claro -- so o hash', async () => {
    const sessao = await entrarComoAluno();
    const linha = await db.studentSession.findFirst({ where: { id: sessao.sessionId } });
    expect(linha?.tokenHash).not.toBe(sessao.refreshToken);
    expect(linha?.tokenHash).toHaveLength(64);
  });

  it('trocar a senha revoga TODAS as sessoes do aluno', async () => {
    const antiga = await entrarComoAluno();
    const { token } = await pedirResetParaAluno(alunoId);
    await servico.confirmarRecuperacao({ token, senha: 'Nova#Senha1' });
    await expect(servico.renovar({ refreshToken: antiga.refreshToken })).rejects.toMatchObject({
      codigo: 'SESSAO_REVOGADA',
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @arenahub/api test:integration -- student-identity`
Expected: FAIL — serviço inexistente.

- [ ] **Step 3: Implementar os repositórios**

`student-session.repository.ts` espelha `auth/session.repository.ts`: `abrir`, `encontrarPorHash`, `rotacionar` (em `$transaction`, marcando o elo atual como `ROTATED` e criando o próximo com o mesmo `familyId`), `revogarFamilia(familyId, motivo)`, `listarAtivas(accountId)`, `revogarPorId`.

`student-account.repository.ts`: `encontrarPorIdentificador(tenantId, identifier)`, `encontrarPorTokenHash(hash)`, `consumirToken(tokenId, agora)` e `definirSenha(accountId, hash, agora)` — os dois últimos na mesma transação onde forem usados juntos.

- [ ] **Step 4: Implementar o serviço**

Pontos que os testes cobrem e não podem ser suavizados:

```ts
/**
 * Login com resposta INDISTINGUIVEL -- `M4-FR-002`.
 *
 * Identificador inexistente e senha errada saem pelo MESMO caminho, com o
 * mesmo codigo. E a verificacao de senha roda mesmo sem conta, contra um hash
 * descartavel: sem isso o tempo de resposta separa os dois casos, e
 * enumeracao por cronometro dispensa a mensagem.
 */
const conta = await this.contas.encontrarPorIdentificador(tenantId, identificador);
const hashParaComparar = conta?.passwordHash ?? HASH_DESCARTAVEL;
const senhaConfere = await this.senhas.conferir(senha, hashParaComparar);
if (!conta || !senhaConfere || conta.status !== 'ACTIVE') {
  throw new FalhaDeAutenticacao();
}
```

```ts
/**
 * Consumir o token de ativacao e definir a senha na MESMA transacao.
 *
 * Separado, duas requisicoes simultaneas com o mesmo token passam as duas
 * pela leitura antes de qualquer escrita, e a conta ativa duas vezes -- o
 * mesmo defeito de contagem que ja cobrou aluno em dobro neste repositorio.
 * A exclusao mutua fica no `updateMany` CONDICIONADO ao status, nao num `if`.
 */
const atualizadas = await tx.studentAccountToken.updateMany({
  where: { id: tokenId, status: 'PENDING' },
  data: { status: 'CONSUMED', consumedAt: agora },
});
if (atualizadas.count === 0) throw new TokenJaUsado();
```

- [ ] **Step 5: Implementar o envio de e-mail**

`email-de-ativacao.service.ts` espelha `iam/email-de-convite.service.ts`: usa Resend, **nunca lança**, degrada com motivo quando falta `RESEND_API_KEY`.

```ts
/**
 * O Resend responde 200 COM `error` no corpo quando recusa o envio.
 * Sem checar esse campo, a tela afirma que mandou e o aluno nunca recebe.
 */
const { data, error } = await this.resend.emails.send({ ... });
if (error) return { enviado: false, motivo: 'RECUSADO_PELO_PROVEDOR' };
```

- [ ] **Step 6: Rodar os testes**

Run: `pnpm --filter @arenahub/api test:integration -- student-identity`
Expected: PASS, 10 testes.

- [ ] **Step 7: Provar o teste de família por canário**

Troque `revogarFamilia(familyId)` por revogar só a sessão do replay.
Expected: o teste "o replay derruba a FAMILIA" FALHA; os outros passam. Reverta.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/student-identity apps/api/test/integration/student-identity.int-spec.ts
git commit -m "feat(identity): ativacao, login, rotacao e revogacao do aluno (refs #23)"
```

---

### Task 4: Rotas mobile e contrato OpenAPI

**Files:**
- Create: `apps/api/src/modules/student-identity/student-auth.controller.ts`
- Create: `apps/api/src/modules/student-identity/student-sessions.controller.ts`
- Create: `apps/api/src/modules/student-identity/student-session.guard.ts`
- Create: `apps/api/src/modules/student-identity/student-identity.module.ts`
- Create: `apps/api/src/modules/student-identity/dto/mobile-auth.dto.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/integration/mobile-auth.int-spec.ts`

**Interfaces:**
- Consumes: `StudentIdentityService` (Task 3).
- Produces: rotas `POST /api/v1/mobile/auth/activate | login | refresh | logout | recovery/request | recovery/confirm | reauthenticate`; `GET /api/v1/mobile/sessions`; `DELETE /api/v1/mobile/sessions/:id`. Contexto `StudentChannelContext = { tenantId, studentId, accountId, sessionId, reauthenticatedAt: string | null }`.

- [ ] **Step 1: Escrever os testes HTTP**

```ts
it('login errado responde problem+json sem revelar existencia', async () => {
  const resposta = await request(app.getHttpServer())
    .post('/api/v1/mobile/auth/login')
    .send({ tenantSlug: 'arena-positiva', identificador: 'ninguem@example.test', senha: 'x' })
    .expect(401)
    .expect('Content-Type', /application\/problem\+json/);

  expect(resposta.body.code).toBe('AUTHENTICATION_FAILED');
  expect(JSON.stringify(resposta.body)).not.toMatch(/existe|cadastrad|encontrad/i);
});

it('rota protegida sem token responde 401', async () => {
  await request(app.getHttpServer()).get('/api/v1/mobile/sessions').expect(401);
});

it('o access token do aluno NAO abre rota do painel', async () => {
  // Guard trocado e o erro classico: dois sujeitos, um mesmo verificador.
  const { accessToken } = await entrarComoAluno();
  await request(app.getHttpServer())
    .get('/api/v1/students')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(401);
});

it('o access token do PAINEL nao abre rota mobile', async () => {
  const doPainel = await entrarComoUsuarioDoPainel();
  await request(app.getHttpServer())
    .get('/api/v1/mobile/sessions')
    .set('Authorization', `Bearer ${doPainel.accessToken}`)
    .expect(401);
});

it('o access token nao carrega PII', async () => {
  const { accessToken } = await entrarComoAluno();
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());
  const texto = JSON.stringify(payload);
  for (const proibido of [NOME_DO_ALUNO, CPF_DO_ALUNO, EMAIL_DO_ALUNO]) {
    expect(texto).not.toContain(proibido);
  }
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @arenahub/api test:integration -- mobile-auth`
Expected: FAIL — rotas inexistentes.

- [ ] **Step 3: Implementar DTOs com Zod `.strict()`**

```ts
export const LoginDto = z
  .object({
    tenantSlug: z.string().min(1),
    identificador: z.string().min(1),
    senha: z.string().min(1),
    deviceLabel: z.string().max(60).optional(),
  })
  .strict();
```

- [ ] **Step 4: Implementar controllers finos e o guard**

Controllers validam e delegam. O guard verifica o access token, confirma que o `purpose` é do canal mobile e popula o contexto — **o `tenantId` sai do token, nunca do corpo**.

Toda rota leva `@ApiOkResponse` (ou `@ApiCreatedResponse`), senão `openapi.int-spec.ts` reprova.

- [ ] **Step 5: Registrar no AppModule e gerar o contrato**

Run: `pnpm openapi:generate && pnpm openapi:check`
Expected: PASS, sem edição manual do JSON.

- [ ] **Step 6: Rodar os testes**

Run: `pnpm --filter @arenahub/api test:integration -- mobile-auth openapi`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/student-identity apps/api/src/app.module.ts packages/api-contracts apps/api/test/integration
git commit -m "feat(api): expoe as rotas de identidade mobile (refs #23)"
```

---

### Task 5: Armazenamento seguro e cliente de API no app

**Files:**
- Create: `apps/mobile/src/auth/armazenamento-seguro.ts`
- Create: `apps/mobile/src/auth/armazenamento-seguro.test.ts`
- Create: `apps/mobile/src/auth/sessao.tsx`
- Create: `apps/mobile/src/api/cliente.ts`
- Create: `apps/mobile/src/api/cliente.test.ts`
- Modify: `apps/mobile/package.json`

**Interfaces:**
- Consumes: as rotas da Task 4.
- Produces: `armazenamentoSeguro.{lerRefresh,salvarRefresh,limpar}`; `<ProvedorDeSessao>` e `useSessao()` devolvendo `{ estado, entrar, sair, chamarApi }`.

- [ ] **Step 1: Escrever o teste do armazenamento**

```ts
it('guarda SO o refresh no SecureStore -- o access nunca encosta no disco', async () => {
  await armazenamentoSeguro.salvarRefresh('refresh-secreto');
  const escrito = JSON.stringify((SecureStore.setItemAsync as jest.Mock).mock.calls);
  expect(escrito).toContain('refresh-secreto');
  expect(escrito).not.toContain('access-secreto');
});

it('limpar apaga a chave, nao grava string vazia', async () => {
  await armazenamentoSeguro.limpar();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('arenahub.refresh.v1');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith('arenahub.refresh.v1', '');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @arenahub/mobile test -- armazenamento-seguro`
Expected: FAIL.

- [ ] **Step 3: Instalar `expo-secure-store` e implementar**

Run: `pnpm --filter @arenahub/mobile add expo-secure-store@57.0.4`

```ts
const CHAVE_DO_REFRESH = 'arenahub.refresh.v1';

/**
 * O ACCESS TOKEN NAO ENTRA AQUI. Ele vive so em memoria, no provider: em
 * disco ele sobrevive ao fechamento do app e vira credencial de longa duracao
 * sem rotacao -- exatamente o que a rotacao de familia existe para evitar.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: nao viaja em backup de iCloud, e nao
 * volta a valer num aparelho restaurado.
 */
export const armazenamentoSeguro = {
  lerRefresh: () => SecureStore.getItemAsync(CHAVE_DO_REFRESH),
  salvarRefresh: (token: string) =>
    SecureStore.setItemAsync(CHAVE_DO_REFRESH, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  limpar: () => SecureStore.deleteItemAsync(CHAVE_DO_REFRESH),
};
```

- [ ] **Step 4: Escrever o teste do cliente — a corrida do refresh**

```ts
it('duas chamadas paralelas com 401 fazem UM refresh so', async () => {
  // Refresh rotativo: cada tentativa consome o token e invalida o anterior.
  // Reagir ao 401 em cada chamada derruba a familia inteira e desloga o
  // aluno -- o defeito exato que este teste existe para impedir.
  respostas401EmSeguida(2);
  await Promise.all([cliente.get('/a'), cliente.get('/b')]);
  expect(chamadasDeRefresh()).toBe(1);
});

it('limpa o armazenamento quando o refresh e recusado por replay', async () => {
  respostaDeRefresh({ status: 401, body: { code: 'REFRESH_REPLAY' } });
  await expect(cliente.get('/a')).rejects.toBeTruthy();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
});
```

- [ ] **Step 5: Implementar o cliente com refresh sincronizado**

```ts
/**
 * UMA tentativa de refresh por vez, compartilhada.
 *
 * A promessa em voo e reusada por todas as chamadas que levaram 401 ao mesmo
 * tempo. Sem isso, N chamadas paralelas disparam N refreshes, o segundo ja
 * chega com token rotacionado, o servidor le como replay e revoga a familia.
 */
let refreshEmVoo: Promise<string> | null = null;
```

- [ ] **Step 6: Rodar os testes**

Run: `pnpm --filter @arenahub/mobile test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src apps/mobile/package.json pnpm-lock.yaml
git commit -m "feat(mobile): armazenamento seguro e cliente com refresh sincronizado (refs #23)"
```

---

### Task 6: Telas de ativação, login e recuperação

**Files:**
- Create: `apps/mobile/app/(publico)/entrar.tsx`
- Create: `apps/mobile/app/(publico)/ativar.tsx`
- Create: `apps/mobile/app/(publico)/recuperar.tsx`
- Create: `apps/mobile/src/features/auth/formulario-de-login.tsx`
- Create: `apps/mobile/src/features/auth/formulario-de-login.test.tsx`
- Create: `apps/mobile/src/auth/link-de-ativacao.ts`
- Create: `apps/mobile/src/auth/link-de-ativacao.test.ts`
- Modify: `apps/mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `useSessao()` (Task 5), `Botao`, `Card`, `useTema` de `src/ui` (F43).
- Produces: `interpretarLink(url: string): { tipo: 'ATIVACAO'|'RECUPERACAO'; token: string }`.

- [ ] **Step 1: Escrever os testes de deep link**

```ts
it('aceita o esquema do proprio app', () => {
  expect(interpretarLink('arenahub://ativar?token=abc')).toEqual({ tipo: 'ATIVACAO', token: 'abc' });
});

it('RECUSA link de outro host -- nao seguir token de origem desconhecida', () => {
  expect(() => interpretarLink('https://evil.test/ativar?token=abc')).toThrow('LINK_NAO_PERMITIDO');
});

it('recusa link sem token', () => {
  expect(() => interpretarLink('arenahub://ativar')).toThrow('LINK_SEM_TOKEN');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @arenahub/mobile test -- link-de-ativacao`
Expected: FAIL.

- [ ] **Step 3: Implementar o interpretador e as telas**

Telas usam os componentes da F43 (`Botao`, `Card`, `Campo`), com `accessibilityLabel`, `autoComplete` correto (`username`, `current-password`, `new-password`) e foco no primeiro erro. **Nunca** registrar valor de senha ou token em log.

- [ ] **Step 4: Escrever o teste do formulário**

```ts
it('nao envia duas vezes com toque duplo', async () => {
  // Toque duplo em conexao lenta e o caso real; sem guarda, sao duas
  // tentativas de login e duas sessoes abertas.
  const entrar = jest.fn(() => new Promise(() => {}));
  renderizar(<FormularioDeLogin onEntrar={entrar} />);
  fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
  fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
  expect(entrar).toHaveBeenCalledTimes(1);
});

it('mostra a mensagem antienumeracao, nao "usuario nao encontrado"', async () => {
  renderizar(<FormularioDeLogin onEntrar={() => Promise.reject(new FalhaDeAutenticacao())} />);
  fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
  expect(await screen.findByText(/não foi possível entrar/i)).toBeTruthy();
  expect(screen.queryByText(/não encontrado|não cadastrado/i)).toBeNull();
});
```

- [ ] **Step 5: Rodar os testes**

Run: `pnpm --filter @arenahub/mobile test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app apps/mobile/src
git commit -m "feat(mobile): telas de ativacao, login e recuperacao (refs #23)"
```

---

### Task 7: Home mínima, política de versão e a jornada na tela

**Files:**
- Create: `apps/api/src/modules/student-mobile/mobile-home.controller.ts`
- Create: `apps/api/src/modules/student-mobile/mobile-home.service.ts`
- Create: `apps/api/src/modules/student-mobile/student-mobile.module.ts`
- Create: `apps/api/test/integration/mobile-home.int-spec.ts`
- Create: `apps/mobile/app/(protegido)/_layout.tsx`
- Create: `apps/mobile/app/(protegido)/inicio.tsx`
- Create: `apps/mobile/src/features/inicio/home.tsx`
- Create: `apps/mobile/src/features/inicio/home.test.tsx`
- Delete: `apps/mobile/app/index.tsx` (a vitrine da F43 cumpriu o papel)
- Modify: `docs/STATUS.md`, `docs/DEVELOPMENT.md`, `docs/specs/SPEC-023-identidade-e-shell-mobile.md`

**Interfaces:**
- Consumes: o guard e o contexto da Task 4; `useSessao()` da Task 5.
- Produces: `GET /api/v1/mobile/home` devolvendo `{ asOf, status: 'AVAILABLE'|'UNAVAILABLE', saudacao, versionPolicy: { state: 'SUPPORTED'|'GRACE'|'BLOCKED', updateUrl: string | null } }`.

- [ ] **Step 1: Escrever os testes do shell útil**

```ts
it('indisponivel mostra o shell, e NAO o dado antigo como se fosse atual', () => {
  // `M4-NFR-002`. O perigo nao e a tela vazia: e a tela que parece certa.
  renderizarHome({ status: 'UNAVAILABLE' });
  expect(screen.getByText(/não foi possível atualizar agora/i)).toBeTruthy();
  expect(screen.queryByText(NOME_DO_ALUNO_ANTERIOR)).toBeNull();
});

it('a Home NAO recalcula estado -- renderiza o enum do backend', () => {
  // `M4-BR-008`. Se a Home derivasse "vencida" de uma data, o app viraria
  // segunda autoridade sobre dinheiro.
  const { queryByText } = renderizarHome({ status: 'AVAILABLE', saudacao: 'Boa tarde, Ana' });
  expect(queryByText(/vencid|em atraso/i)).toBeNull();
});

it('versao BLOCKED impede seguir e oferece o caminho da atualizacao', () => {
  renderizarHome({ versionPolicy: { state: 'BLOCKED', updateUrl: 'https://exemplo.test' } });
  expect(screen.getByRole('button', { name: /atualizar/i })).toBeTruthy();
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @arenahub/mobile test -- home`
Expected: FAIL.

- [ ] **Step 3: Implementar o BFF mínimo**

```ts
export interface RespostaDaHome {
  readonly asOf: string;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly saudacao: string;
  readonly versionPolicy: {
    readonly state: 'SUPPORTED' | 'GRACE' | 'BLOCKED';
    readonly updateUrl: string | null;
  };
}
```

**Nada de dado de negócio nesta fatia** — plano, fatura e frequência são das Slices 4.2 e 4.3.

- [ ] **Step 4: Implementar as telas protegidas**

`(protegido)/_layout.tsx` redireciona para `/entrar` sem sessão. A Home usa `Card` e `Botao` da F43.

- [ ] **Step 5: Rodar tudo**

Run: `pnpm --filter @arenahub/api test:integration -- mobile-home student-identity && pnpm --filter @arenahub/mobile test`
Expected: PASS.

- [ ] **Step 6: Verificar a jornada NA TELA, no emulador**

Subir a API e o app, e percorrer no emulador:

1. Abrir o app sem sessão → cai em **Entrar**.
2. Ativar com o token do convite → define senha → entra.
3. Fechar o app e reabrir → **entra sem digitar senha** (`M4-AC-001`).
4. Revogar a sessão pela lista → a chamada seguinte falha e volta para **Entrar** (`M4-AC-002`).

> CI verde não prova a tela. Este passo é obrigatório antes do PR.

- [ ] **Step 7: Atualizar a documentação**

`STATUS.md`, `DEVELOPMENT.md` e a `SPEC-023` — a spec está `planejada` e precisa registrar o que a fatia decidiu.

- [ ] **Step 8: Gate local completo**

Run: `pnpm lint --force && pnpm typecheck --force && pnpm build --force && pnpm test && pnpm test:guardas && pnpm test:report --issue 23`

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/student-mobile apps/mobile docs reports
git commit -m "feat(mobile): home minima, politica de versao e evidencia (refs #23)"
```

---

## Autorrevisão

**Cobertura da spec.** `M4-FR-001` Task 1+3; `M4-FR-002` Task 3 (teste de indistinguibilidade) e Task 6 (mensagem na tela); `M4-FR-003` Task 5; `M4-FR-004` Tasks 3 e 4; `M4-FR-005` Tasks 1 (`reauthenticatedAt`), 3 (`reautenticar`) e 4 (rota); `M4-BR-008` Task 7; `M4-NFR-002` Task 7; `M4-NFR-006` Task 4 (autorização por objeto: um aluno não revoga sessão de outro); `M4-AC-001` e `M4-AC-002` Task 7 passo 6, na tela.

**Fora desta fatia, e dito:** `M4-NFR-008` entrega o *mecanismo* de versão mínima; a configuração por tenant é operação. Push (`M4-FR` de notificação) é da Slice 4.7. Biometria do aparelho como identidade é escopo negativo do PRD §6.

**Consistência de tipos.** `consumirTokenDeUsoUnico` e `decidirRotacao` mantêm nome e assinatura entre as Tasks 1–3. `StudentChannelContext` é definido na Task 4 e consumido na 7. `RespostaDaHome` só na Task 7.

**Um risco registrado:** o Resend em desenvolvimento só entrega para o endereço do dono da conta. A Task 3 trata isso como degradação explícita, e o teste afirma o caminho de recusa — mas a verificação da Task 7 passo 2 depende de ler o token no log da API, não na caixa de entrada.
