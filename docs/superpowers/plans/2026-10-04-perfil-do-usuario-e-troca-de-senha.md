# Perfil do usuário e troca de senha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** página `/perfil` no painel com os dados da conta e troca da própria senha, que encerra as outras sessões e mantém a atual.

**Architecture:** duas rotas novas no `AuthController` (`GET /auth/profile`, `POST /auth/password`), com a regra da troca em `AuthService.trocarSenha` numa transação interativa (hash condicionado + revogação das outras famílias + auditoria). No painel, uma Server Action `alterarSenha` e uma página Server Component com um formulário client; o chip da topbar vira link.

**Tech Stack:** NestJS + Prisma 7 + Zod (api, Jest + supertest); Next.js 16 App Router + Vitest + Testing Library (admin-web); Playwright (E2E).

**Spec:** [`docs/specs/SPEC-084-perfil-do-usuario-e-troca-de-senha.md`](../../specs/SPEC-084-perfil-do-usuario-e-troca-de-senha.md)

## Global Constraints

- Piso de senha **8**, teto **1024** — o mesmo `MINIMO_DE_SENHA` de `apps/admin-web/app/actions/usuarios.ts` e `esquemaDeAceite` de `apps/api/src/modules/iam/iam.controller.ts`.
- Zod `.strict()` em todo corpo; `unknown` antes de validar.
- Erro de domínio com código estável (`ErroDeDominio`), resposta `application/problem+json`.
- Nunca senha em log, auditoria, resposta ou prop serializada.
- Toast para erro e sucesso, nunca `Alert`. Validação em JS, nunca `required` nativo nos campos de senha.
- Data só por `TenantDateTime` (regra 5 do lint); cores só por token `--ah-*`.
- Identificadores em inglês, textos de interface em pt-BR.
- Sem migration.

## Review Focus

- **Duas trocas simultâneas com a mesma senha atual** — só uma grava; a outra recebe `AUTH_CURRENT_PASSWORD_INVALID`. Teste em Task 1, Step 1 (`Promise.all`).
- **Sessão atual já rotacionada** (o `sessionId` do access token aponta para elo `ROTATED` porque o painel renovou em paralelo) — a família continua sendo a mantida. Teste em Task 1 (refresh antes da troca).
- **Usuário em dois tenants** — a troca derruba as sessões do outro tenant também (senha é global). Teste em Task 1.
- **Campo extra no corpo** (`userId` tentando trocar a senha de outro) — `400`, nada muda. Teste em Task 1.
- **Erro de rede na Server Action** — Toast genérico, sem estourar a página. Teste em Task 3.

---

## File Structure

| arquivo | responsabilidade |
|---|---|
| `apps/api/src/common/http/erro-de-dominio.ts` | +4 erros da troca de senha |
| `apps/api/src/modules/auth/auth.service.ts` | `trocarSenha`, `perfilDaConta` |
| `apps/api/src/modules/auth/auth.controller.ts` | rotas `GET profile`, `POST password` |
| `apps/api/src/modules/auth/auth.controller.spec.ts` | **novo** — recusa em sessão de suporte |
| `apps/api/test/integration/troca-de-senha.int-spec.ts` | **novo** — contrato HTTP das duas rotas |
| `apps/api/test/integration/openapi.int-spec.ts` | +2 caminhos na lista |
| `packages/api-contracts/openapi/arenahub-v1.json` | snapshot regenerado |
| `apps/admin-web/app/actions/perfil.ts` (+ `.test.ts`) | **novo** — Server Action `alterarSenha` |
| `apps/admin-web/app/(protected)/usuario.tsx` | chip vira link; exporta `iniciais` |
| `apps/admin-web/app/(protected)/perfil/page.tsx` (+ `.test.tsx`) | **novo** — página |
| `apps/admin-web/app/(protected)/perfil/formulario-de-senha.tsx` | **novo** — formulário client |
| `apps/admin-web/app/(protected)/perfil/perfil.module.css` | **novo** — estilo da página |
| `apps/admin-web/tests/e2e/perfil.e2e-spec.ts` | **novo** — jornada ponta a ponta |
| `docs/DEVELOPMENT.md`, `docs/TESTS.md`, spec | registro da entrega |

---

### Task 1: API — troca de senha

**Files:**
- Modify: `apps/api/src/common/http/erro-de-dominio.ts` (acrescentar depois de `MfaBloqueadoPorTentativasError`)
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Create: `apps/api/src/modules/auth/auth.controller.spec.ts`
- Create: `apps/api/test/integration/troca-de-senha.int-spec.ts`

**Interfaces:**
- Produces: `POST /api/v1/auth/password` corpo `{ currentPassword: string; newPassword: string }` → `204`; erros `400` (Zod), `403 AUTH_PASSWORD_CHANGE_IN_SUPPORT`, `422 AUTH_CURRENT_PASSWORD_INVALID`, `422 AUTH_PASSWORD_UNCHANGED`, `429 AUTH_PASSWORD_CHANGE_RATE_LIMITED`.
- Produces: `AuthService.trocarSenha(sessao: { userId: string; tenantId: string; sessionId: string; correlationId: string }, senhaAtual: string, novaSenha: string): Promise<void>`.

- [ ] **Step 1: Escrever a suíte de integração (falha)**

`apps/api/test/integration/troca-de-senha.int-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Troca da propria senha e leitura do perfil -- SPEC-084.
 *
 * Cada usuario nasce no proprio teste: a troca muda a senha e conta
 * tentativas por usuario, e um usuario compartilhado faria um teste herdar
 * a senha (ou o bloqueio) do anterior.
 */
describe('troca de senha e perfil', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  const tenants: string[] = [];

  const SENHA = 'senha-de-teste-correta';
  const NOVA = 'senha-nova-de-teste';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDe = (resposta: request.Response, nome: string): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return (lista.find((c) => c.startsWith(`${nome}=`)) ?? '').split(';')[0] ?? '';
  };

  const criarTenant = async (): Promise<string> => {
    const sufixo = randomUUID().slice(0, 8);
    const tenant = await db.tenant.create({
      data: {
        slug: `senha-${sufixo}`,
        legalName: 'Academia Senha LTDA',
        displayName: `Academia Senha ${sufixo}`,
        timezone: 'America/Sao_Paulo',
      },
    });
    tenants.push(tenant.id);

    return tenant.id;
  };

  /** Usuario com papel OWNER num tenant novo. Devolve e-mail e ids. */
  const criarUsuario = async (): Promise<{ email: string; userId: string; tenantId: string }> => {
    const tenantId = await criarTenant();
    const email = `troca-${randomUUID().slice(0, 8)}@exemplo.test`;
    const usuario = await db.user.create({
      data: { email, passwordHash: await senhas.gerarHash(SENHA) },
    });
    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });
    const papel = await db.role.create({ data: { tenantId, name: 'OWNER', isSystem: true } });
    await db.userRole.create({ data: { tenantId, userId: usuario.id, roleId: papel.id } });

    return { email, userId: usuario.id, tenantId };
  };

  /** Loga e devolve os dois cookies prontos para `.set('Cookie', ...)`. */
  const logar = async (email: string, senha = SENHA): Promise<{ acesso: string; refresh: string; status: number }> => {
    const resposta = await request(servidor()).post('/api/v1/auth/login').send({ email, password: senha });

    return {
      status: resposta.status,
      acesso: cookieDe(resposta, 'arenahub_access'),
      refresh: cookieDe(resposta, 'arenahub_refresh'),
    };
  };

  const trocar = (acesso: string, corpo: unknown): request.Test =>
    request(servidor()).post('/api/v1/auth/password').set('Cookie', acesso).send(corpo as object);

  const renovar = (refresh: string): request.Test =>
    request(servidor()).post('/api/v1/auth/refresh').set('Cookie', refresh);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
  });

  afterAll(async () => {
    // Suite que cria tenant apaga o que criou: acumular tenant de teste ja
    // virou timeout que parecia defeito do codigo.
    if (db) {
      await db.session.deleteMany({ where: { tenantId: { in: tenants } } });
      await db.tenant.deleteMany({ where: { id: { in: tenants } } });
    }
    await app?.close();
  });

  describe('POST /api/v1/auth/password', () => {
    it('troca a senha: a antiga para de entrar e a nova entra', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const resposta = await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: NOVA });

      expect(resposta.status).toBe(204);
      expect((await logar(email, SENHA)).status).toBe(401);
      expect((await logar(email, NOVA)).status).toBe(200);
    });

    it('mantem a sessao atual e encerra as outras', async () => {
      const { email } = await criarUsuario();
      const atual = await logar(email);
      const outra = await logar(email);

      expect((await trocar(atual.acesso, { currentPassword: SENHA, newPassword: NOVA })).status).toBe(204);

      // A atual continua renovando: o refresh dela segue valendo.
      expect((await renovar(atual.refresh)).status).toBe(200);
      // A outra nao renova mais -- e isso que a derruba (o access token dela
      // vence em ate 10 min; o guard nao consulta a sessao, SPEC §8).
      expect((await renovar(outra.refresh)).status).toBe(401);

      const revogadas = await db.session.count({
        where: { revokedReason: 'password_changed', user: { email } },
      });
      expect(revogadas).toBeGreaterThan(0);
    });

    it('mantem a familia mesmo quando o elo do token ja foi rotacionado', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      // O painel renova em paralelo: o access ANTIGO aponta para um elo ROTATED.
      const renovada = await renovar(sessao.refresh);
      const refreshNovo = cookieDe(renovada, 'arenahub_refresh');

      expect((await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: NOVA })).status).toBe(204);
      expect((await renovar(refreshNovo)).status).toBe(200);
    });

    it('derruba as sessoes do mesmo usuario em outro tenant', async () => {
      const { email, userId } = await criarUsuario();
      const outroTenant = await criarTenant();
      await db.tenantMembership.create({ data: { tenantId: outroTenant, userId } });

      const sessao = await logar(email);
      const familiaDeFora = randomUUID();
      await db.session.create({
        data: {
          userId,
          tenantId: outroTenant,
          tokenHash: randomUUID(),
          familyId: familiaDeFora,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      expect((await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: NOVA })).status).toBe(204);

      const deFora = await db.session.findFirst({ where: { familyId: familiaDeFora } });
      expect(deFora?.status).toBe('REVOKED');
    });

    it('senha atual errada responde 422 e nao muda nada', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const resposta = await trocar(sessao.acesso, { currentPassword: 'errada-errada', newPassword: NOVA });

      expect(resposta.status).toBe(422);
      expect(resposta.body).toMatchObject({ code: 'AUTH_CURRENT_PASSWORD_INVALID' });
      expect((await logar(email, SENHA)).status).toBe(200);
    });

    it('recusa nova senha igual a atual', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const resposta = await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: SENHA });

      expect(resposta.status).toBe(422);
      expect(resposta.body).toMatchObject({ code: 'AUTH_PASSWORD_UNCHANGED' });
    });

    it('recusa nova senha abaixo de 8 caracteres', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      expect((await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: '1234567' })).status).toBe(400);
      // A fronteira: 8 passa.
      expect((await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: '12345678' })).status).toBe(204);
    });

    it('recusa campo desconhecido no corpo (INV-002)', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const resposta = await trocar(sessao.acesso, {
        currentPassword: SENHA,
        newPassword: NOVA,
        userId: randomUUID(),
      });

      expect(resposta.status).toBe(400);
      expect((await logar(email, SENHA)).status).toBe(200);
    });

    it('duas trocas simultaneas com a mesma senha atual: so uma grava', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const [a, b] = await Promise.all([
        trocar(sessao.acesso, { currentPassword: SENHA, newPassword: 'primeira-nova-senha' }),
        trocar(sessao.acesso, { currentPassword: SENHA, newPassword: 'segunda-nova-senha' }),
      ]);

      // O invariante, nao a ordem: exatamente um 204, e a senha final e a
      // daquele que venceu.
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([204, 422]);

      const venceu = a.status === 204 ? 'primeira-nova-senha' : 'segunda-nova-senha';
      expect((await logar(email, venceu)).status).toBe(200);
    });

    it('bloqueia com 429 na decima primeira tentativa do minuto', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      for (let i = 0; i < 10; i += 1) {
        await trocar(sessao.acesso, { currentPassword: `errada-${i}-xx`, newPassword: NOVA });
      }

      // Mesmo com a senha CERTA: o contador soma toda tentativa (molde do MFA).
      const resposta = await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: NOVA });

      expect(resposta.status).toBe(429);
      expect(resposta.body).toMatchObject({ code: 'AUTH_PASSWORD_CHANGE_RATE_LIMITED' });
    });

    it('audita a troca sem nenhum valor de senha', async () => {
      const { email, userId, tenantId } = await criarUsuario();
      const sessao = await logar(email);

      await trocar(sessao.acesso, { currentPassword: SENHA, newPassword: NOVA });

      const registro = await db.auditLog.findFirst({
        where: { tenantId, action: 'user.password_changed', targetId: userId },
      });
      expect(registro).not.toBeNull();
      expect(JSON.stringify(registro)).not.toContain(SENHA);
      expect(JSON.stringify(registro)).not.toContain(NOVA);
    });

    it('recusa sem sessao', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/auth/password')
        .send({ currentPassword: SENHA, newPassword: NOVA });

      expect(resposta.status).toBe(401);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (de `apps/api`): `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects integration test/integration/troca-de-senha`
Expected: FAIL — `404` em todas as chamadas a `/auth/password`.

- [ ] **Step 3: Erros de domínio**

Em `apps/api/src/common/http/erro-de-dominio.ts`, depois de `MfaBloqueadoPorTentativasError`:

```ts
/**
 * Troca da propria senha -- SPEC-084.
 *
 * `422` e nao `401`: no resto da API `401` quer dizer "sem sessao", e quem
 * troca a senha esta logado. O que falhou foi a conferencia de um campo.
 */
export class SenhaAtualInvalidaError extends ErroDeDominio {
  constructor() {
    super('AUTH_CURRENT_PASSWORD_INVALID', 422, 'Senha atual incorreta');
  }
}

export class SenhaNovaIgualAAtualError extends ErroDeDominio {
  constructor() {
    super('AUTH_PASSWORD_UNCHANGED', 422, 'A nova senha precisa ser diferente da atual');
  }
}

/** Codigo proprio: nao e login, e quem le o log precisa saber qual rota travou. */
export class TrocaDeSenhaBloqueadaPorTentativasError extends ErroDeDominio {
  constructor() {
    super('AUTH_PASSWORD_CHANGE_RATE_LIMITED', 429, 'Muitas tentativas. Tente novamente em instantes');
  }
}

/**
 * Na elevacao de suporte o usuario da sessao e o Super Admin. Trocar a senha
 * de plataforma pelo painel do cliente, sem segundo fator, contornaria o
 * INV-007.
 */
export class TrocaDeSenhaEmSuporteError extends ErroDeDominio {
  constructor() {
    super('AUTH_PASSWORD_CHANGE_IN_SUPPORT', 403, 'Sessao de suporte nao troca senha');
  }
}
```

- [ ] **Step 4: `AuthService.trocarSenha`**

Em `auth.service.ts`, acrescentar os três erros novos ao import de `erro-de-dominio.js` e o método depois de `logout`:

```ts
  /**
   * Troca a propria senha e derruba as OUTRAS sessoes -- SPEC-084.
   *
   * A FAMILIA MANTIDA vem do elo do `sessionId` do access token, qualquer que
   * seja o status dele: o painel renova em paralelo, e o elo do token pode ja
   * estar `ROTATED` enquanto a familia segue viva.
   *
   * A ESCRITA E CONDICIONADA AO HASH LIDO (`updateMany ... passwordHash`):
   * duas trocas simultaneas com a mesma senha atual conferem as duas, e so a
   * primeira a gravar vence. Sem a condicao, a segunda sobrescreveria a
   * primeira e as duas responderiam sucesso.
   */
  async trocarSenha(
    sessao: { userId: string; tenantId: string; sessionId: string; correlationId: string },
    senhaAtual: string,
    novaSenha: string,
  ): Promise<void> {
    // Soma TODA tentativa, molde do MFA: um contador que so soma em erro nunca
    // travaria o acerto depois do limite -- e quem tem o cookie roubado
    // acertaria a senha na tentativa que funciona.
    const registro = await this.forcaBruta.increment(
      `senha:${sessao.userId}`,
      JANELA_DE_FORCA_BRUTA_MS,
      LIMITE_DE_TENTATIVAS_ERRADAS,
      BLOQUEIO_APOS_LIMITE_MS,
      'password-change-bruteforce',
    );

    if (registro.isBlocked) throw new TrocaDeSenhaBloqueadaPorTentativasError();

    const usuario = await this.db.user.findUnique({
      where: { id: sessao.userId },
      select: { passwordHash: true },
    });

    if (!usuario) throw new NaoAutenticadoError();

    if (!(await this.senhas.conferir(senhaAtual, usuario.passwordHash))) {
      throw new SenhaAtualInvalidaError();
    }

    if (senhaAtual === novaSenha) throw new SenhaNovaIgualAAtualError();

    const atual = await this.db.session.findUnique({
      where: { id: sessao.sessionId },
      select: { familyId: true },
    });

    if (!atual) throw new NaoAutenticadoError();

    const novoHash = await this.senhas.gerarHash(novaSenha);

    await this.db.$transaction(async (tx) => {
      const trocou = await tx.user.updateMany({
        where: { id: sessao.userId, passwordHash: usuario.passwordHash },
        data: { passwordHash: novoHash },
      });

      if (trocou.count === 0) throw new SenhaAtualInvalidaError();

      // Todas as familias do usuario, em QUALQUER tenant: a senha e global.
      await tx.session.updateMany({
        where: {
          userId: sessao.userId,
          familyId: { not: atual.familyId },
          status: { in: ['ACTIVE', 'ROTATED'] },
        },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'password_changed' },
      });

      await tx.auditLog.create({
        data: {
          tenantId: sessao.tenantId,
          actorType: 'USER',
          actorId: sessao.userId,
          action: 'user.password_changed',
          target: 'user',
          targetId: sessao.userId,
          correlationId: sessao.correlationId,
        },
      });
    });
  }
```

- [ ] **Step 5: Rota no controller**

Em `auth.controller.ts`: importar `ApiNoContentResponse` de `@nestjs/swagger` e `TrocaDeSenhaEmSuporteError` de `erro-de-dominio.js`; schema junto dos outros:

```ts
/*
 * 8 a 1024 -- o MESMO numero do `esquemaDeAceite` (iam.controller.ts) e de
 * `MINIMO_DE_SENHA` no painel (actions/usuarios.ts e actions/perfil.ts).
 * Decisao do PI em 05/09/2026 (#281). Mudou la, muda aqui.
 *
 * Sem campo de confirmacao: ela e so da tela, como no aceite de convite.
 */
const esquemaDeTrocaDeSenha = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: z.string().min(8).max(1024),
  })
  .strict();
```

Método depois de `logout`:

```ts
  /**
   * Troca a propria senha -- SPEC-084. Encerra as outras sessoes, mantem esta.
   *
   * SO SESSAO DE TENANT: `require()` recusa a de plataforma. E a de SUPORTE e
   * recusada explicitamente -- ver `TrocaDeSenhaEmSuporteError`.
   */
  @Post('password')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Senha trocada; as outras sessoes foram encerradas' })
  async trocarSenha(@Body() corpo: unknown, @Req() requisicao: Request): Promise<void> {
    const contexto = this.contexto.require();

    if (contexto.supportElevation) throw new TrocaDeSenhaEmSuporteError();

    const dados = esquemaDeTrocaDeSenha.parse(corpo);

    await this.auth.trocarSenha(
      {
        userId: contexto.actorId,
        tenantId: contexto.tenantId,
        sessionId: contexto.sessionId,
        correlationId: requisicao.correlationId ?? 'sem-correlacao',
      },
      dados.currentPassword,
      dados.newPassword,
    );
  }
```

- [ ] **Step 6: Rodar a suíte e ver passar**

Run: o mesmo comando do Step 2.
Expected: PASS em todos os testes do `describe('POST /api/v1/auth/password')`.

- [ ] **Step 7: Teste unitário da recusa em suporte (falha → passa)**

`apps/api/src/modules/auth/auth.controller.spec.ts`:

```ts
import { describe, expect, it, jest } from '@jest/globals';

import { TrocaDeSenhaEmSuporteError } from '../../common/http/erro-de-dominio.js';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

/**
 * Sessao de suporte nao troca senha -- SPEC-084 AC-8.
 *
 * Unitario e nao integracao: montar uma elevacao viva pela rota exige Super
 * Admin, tenant e `ElevarUseCase` (ver `platform-elevacao.int-spec.ts`), e a
 * regra aqui e uma linha no controller. O que importa provar e que a troca
 * NUNCA chega ao servico.
 */
describe('AuthController.trocarSenha', () => {
  it('recusa sessao de suporte sem chamar o servico', async () => {
    const trocarSenha = jest.fn<AuthService['trocarSenha']>();
    const controller = new AuthController(
      { trocarSenha } as unknown as AuthService,
      {} as never,
      {
        require: () => ({
          tenantId: 't',
          actorId: 'u',
          sessionId: 's',
          permissions: new Set<string>(),
          allowedUnitIds: 'ALL' as const,
          supportElevation: { reason: 'suporte', expiresAt: new Date() },
        }),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.trocarSenha({ currentPassword: 'a', newPassword: 'bbbbbbbb' }, {} as never),
    ).rejects.toBeInstanceOf(TrocaDeSenhaEmSuporteError);
    expect(trocarSenha).not.toHaveBeenCalled();
  });
});
```

Run (de `apps/api`): `pnpm test -- auth.controller.spec`
Expected: PASS. Canário: comentar a linha `if (contexto.supportElevation) ...` → FAIL; restaurar.

- [ ] **Step 8: Canário da revogação**

Comentar o bloco `await tx.session.updateMany(...)` em `trocarSenha` e rodar a suíte do Step 2.
Expected: FAIL em "mantem a sessao atual e encerra as outras" e "derruba as sessoes do mesmo usuario em outro tenant". Restaurar e rodar de novo: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/common/http/erro-de-dominio.ts apps/api/src/modules/auth apps/api/test/integration/troca-de-senha.int-spec.ts
git commit -m "feat: troca da propria senha encerra as outras sessoes (api)"
```

---

### Task 2: API — leitura do perfil

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/test/integration/troca-de-senha.int-spec.ts`
- Modify: `apps/api/test/integration/openapi.int-spec.ts` (lista de `publica as rotas que a fatia entrega`)
- Modify: `packages/api-contracts/openapi/arenahub-v1.json` (regenerado)

**Interfaces:**
- Produces: `GET /api/v1/auth/profile` → `{ email: string; createdAt: string; roles: string[]; tenant: { displayName: string; timezone: string | null } }`.
- Produces: `AuthService.perfilDaConta(userId: string, tenantId: string): Promise<PerfilDaConta>`, `export interface PerfilDaConta` com a forma acima (`createdAt: Date`).

- [ ] **Step 1: Testes (falha)**

Acrescentar em `troca-de-senha.int-spec.ts`, depois do `describe` do password:

```ts
  describe('GET /api/v1/auth/profile', () => {
    it('devolve e-mail, papeis, academia e data de criacao', async () => {
      const { email, tenantId } = await criarUsuario();
      const sessao = await logar(email);

      const resposta = await request(servidor()).get('/api/v1/auth/profile').set('Cookie', sessao.acesso);

      expect(resposta.status).toBe(200);
      const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(resposta.body).toEqual({
        email,
        createdAt: expect.any(String),
        roles: ['OWNER'],
        tenant: { displayName: tenant.displayName, timezone: 'America/Sao_Paulo' },
      });
    });

    it('nunca devolve hash nem segredo de MFA', async () => {
      const { email } = await criarUsuario();
      const sessao = await logar(email);

      const corpo = JSON.stringify(
        (await request(servidor()).get('/api/v1/auth/profile').set('Cookie', sessao.acesso)).body,
      );

      expect(corpo).not.toMatch(/scrypt|passwordHash|mfaSecret/i);
    });

    it('recusa sem sessao', async () => {
      expect((await request(servidor()).get('/api/v1/auth/profile')).status).toBe(401);
    });
  });
```

Run: comando do Task 1 Step 2. Expected: FAIL (`404`).

- [ ] **Step 2: `perfilDaConta` no serviço**

Em `auth.service.ts`, exportar o tipo perto de `ParDeTokens` e o método depois de `perfil`:

```ts
/** O que a pagina `/perfil` le -- SPEC-084. So leitura. */
export interface PerfilDaConta {
  email: string;
  createdAt: Date;
  /** Nomes de papel distintos neste tenant (`OWNER`, ...); o painel traduz. */
  roles: string[];
  /** `timezone` segue o fallback Tenant -> primeira unidade de `cobranca()`. */
  tenant: { displayName: string; timezone: string | null };
}
```

```ts
  async perfilDaConta(userId: string, tenantId: string): Promise<PerfilDaConta> {
    const [usuario, papeis, tenant] = await Promise.all([
      this.db.user.findUnique({
        where: { id: userId },
        // `select` explicito: o objeto inteiro traria `passwordHash` e o
        // segredo do MFA para uma resposta HTTP.
        select: { email: true, createdAt: true },
      }),
      this.db.userRole.findMany({
        where: { userId, tenantId },
        select: { role: { select: { name: true } } },
      }),
      this.db.tenant.findUnique({
        where: { id: tenantId },
        select: {
          displayName: true,
          timezone: true,
          gymUnits: { take: 1, orderBy: { createdAt: 'asc' }, select: { timezone: true } },
        },
      }),
    ]);

    if (!usuario || !tenant) throw new NaoAutenticadoError();

    return {
      email: usuario.email,
      createdAt: usuario.createdAt,
      // `Set`: o mesmo papel em duas unidades e uma linha por unidade.
      roles: [...new Set(papeis.map((p) => p.role.name))].sort(),
      tenant: {
        displayName: tenant.displayName,
        timezone: tenant.timezone ?? tenant.gymUnits[0]?.timezone ?? null,
      },
    };
  }
```

- [ ] **Step 3: Rota no controller**

Schema OpenAPI junto de `ESQUEMA_DA_INSCRICAO`:

```ts
const ESQUEMA_DO_PERFIL = {
  type: 'object',
  properties: {
    email: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    roles: { type: 'array', items: { type: 'string' } },
    tenant: {
      type: 'object',
      properties: {
        displayName: { type: 'string' },
        timezone: { type: 'string', nullable: true },
      },
      required: ['displayName', 'timezone'],
    },
  },
  required: ['email', 'createdAt', 'roles', 'tenant'],
};
```

Método depois de `me`:

```ts
  /**
   * Dados da propria conta para a pagina `/perfil` -- SPEC-084.
   *
   * Rota PROPRIA, e nao `/me`: o layout chama `/me` em toda navegacao, e
   * papeis e academia so interessam a uma pagina.
   */
  @Get('profile')
  @ApiOkResponse({ schema: ESQUEMA_DO_PERFIL })
  async perfilDaConta() {
    const contexto = this.contexto.require();
    const perfil = await this.auth.perfilDaConta(contexto.actorId, contexto.tenantId);

    return { ...perfil, createdAt: perfil.createdAt.toISOString() };
  }
```

- [ ] **Step 4: Contrato OpenAPI**

Em `openapi.int-spec.ts`, no `arrayContaining` de `publica as rotas que a fatia entrega`, depois de `'/api/v1/auth/mfa/verify',`:

```ts
        // SPEC-084 -- perfil do usuario e troca da propria senha.
        '/api/v1/auth/profile',
        '/api/v1/auth/password',
```

Regenerar o snapshot (de `apps/api`):
`ATUALIZAR_OPENAPI=1 node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects integration test/integration/openapi`
Depois rodar sem a variável. Expected: PASS. Conferir no `git diff packages/api-contracts` que só entraram as duas rotas.

- [ ] **Step 5: Rodar a suíte inteira da fatia**

Run: comando do Task 1 Step 2. Expected: PASS em tudo.

- [ ] **Step 6: Commit**

```bash
git add apps/api packages/api-contracts
git commit -m "feat: rota de leitura do perfil da conta (api)"
```

---

### Task 3: Painel — Server Action `alterarSenha`

**Files:**
- Create: `apps/admin-web/app/actions/perfil.ts`
- Create: `apps/admin-web/app/actions/perfil.test.ts`

**Interfaces:**
- Consumes: `POST /api/v1/auth/password` (Task 1).
- Produces: `alterarSenha(anterior: EstadoDaSenha, formulario: FormData): Promise<EstadoDaSenha>` e `export interface EstadoDaSenha { erro?: string; sucesso?: number }` — `sucesso` é um carimbo (`Date.now()`) que muda a cada troca, para o efeito do formulário reagir a duas trocas seguidas. Campos do `FormData`: `senhaAtual`, `novaSenha`, `confirmacao`.

- [ ] **Step 1: Testes (falha)**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { alterarSenha } from './perfil';

function formulario(valores: Partial<Record<'senhaAtual' | 'novaSenha' | 'confirmacao', string>> = {}): FormData {
  const dados = new FormData();
  const completos = { senhaAtual: 'senha-atual-1', novaSenha: 'senha-nova-1', confirmacao: 'senha-nova-1', ...valores };

  for (const [chave, valor] of Object.entries(completos)) dados.set(chave, valor);

  return dados;
}

function recusa(code: string, status = 422) {
  return {
    ok: false,
    erro: { type: 'about:blank', title: 'Recusado', status, code, correlationId: 'teste' },
    cookiesDaApi: [],
  };
}

describe('alterarSenha', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('envia so a senha atual e a nova -- a confirmacao e da tela', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, cookiesDaApi: [] });

    const estado = await alterarSenha({}, formulario());

    expect(chamarApi).toHaveBeenCalledWith('/api/v1/auth/password', {
      metodo: 'POST',
      corpo: { currentPassword: 'senha-atual-1', newPassword: 'senha-nova-1' },
    });
    expect(estado.erro).toBeUndefined();
    expect(estado.sucesso).toEqual(expect.any(Number));
  });

  it.each([
    [{ novaSenha: '1234567', confirmacao: '1234567' }, 'A nova senha precisa ter ao menos 8 caracteres'],
    [{ confirmacao: 'outra-coisa' }, 'As senhas não conferem'],
    [{ novaSenha: 'senha-atual-1', confirmacao: 'senha-atual-1' }, 'A nova senha precisa ser diferente da atual'],
    [{ senhaAtual: '' }, 'Informe a senha atual'],
  ])('recusa %o sem chamar a API', async (valores, mensagem) => {
    const estado = await alterarSenha({}, formulario(valores));

    expect(estado.erro).toBe(mensagem);
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it.each([
    ['AUTH_CURRENT_PASSWORD_INVALID', 'Senha atual incorreta.'],
    ['AUTH_PASSWORD_UNCHANGED', 'A nova senha precisa ser diferente da atual'],
    ['AUTH_PASSWORD_CHANGE_RATE_LIMITED', 'Muitas tentativas. Aguarde um minuto e tente de novo.'],
    ['AUTH_PASSWORD_CHANGE_IN_SUPPORT', 'Em sessão de suporte não é possível trocar a senha.'],
    ['QUALQUER_OUTRO', 'Não foi possível trocar a senha. Tente de novo.'],
  ])('traduz %s', async (code, mensagem) => {
    vi.mocked(chamarApi).mockResolvedValue(recusa(code) as never);

    expect((await alterarSenha({}, formulario())).erro).toBe(mensagem);
  });

  it('falha de rede vira erro na tela, nao excecao', async () => {
    vi.mocked(chamarApi).mockRejectedValue(new Error('ECONNREFUSED'));

    expect((await alterarSenha({}, formulario())).erro).toBe('Não foi possível trocar a senha. Tente de novo.');
  });
});
```

Run (de `apps/admin-web`): `pnpm exec vitest run app/actions/perfil.test.ts`
Expected: FAIL — módulo `./perfil` não existe.

- [ ] **Step 2: Implementar**

`apps/admin-web/app/actions/perfil.ts`:

```ts
'use server';

import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Troca da propria senha -- SPEC-084.
 *
 * MINIMO 8: o mesmo numero de `actions/usuarios.ts`, do `esquemaDeAceite` e
 * do `esquemaDeTrocaDeSenha` na API (decisao do PI em 05/09/2026, #281).
 * Repetido aqui para dar a frase certa sem round-trip; mudou la, muda aqui.
 */
const MINIMO_DE_SENHA = 8;

const esquema = z
  .object({
    senhaAtual: z.string().min(1, 'Informe a senha atual').max(1024),
    novaSenha: z
      .string()
      .min(MINIMO_DE_SENHA, `A nova senha precisa ter ao menos ${MINIMO_DE_SENHA} caracteres`)
      .max(1024, 'Senha longa demais'),
    confirmacao: z.string(),
  })
  // A confirmacao e so da tela -- a API nao a recebe.
  .refine((d) => d.novaSenha === d.confirmacao, { message: 'As senhas não conferem' })
  .refine((d) => d.novaSenha !== d.senhaAtual, {
    message: 'A nova senha precisa ser diferente da atual',
  });

const MENSAGEM_POR_CODIGO: Record<string, string> = {
  AUTH_CURRENT_PASSWORD_INVALID: 'Senha atual incorreta.',
  AUTH_PASSWORD_UNCHANGED: 'A nova senha precisa ser diferente da atual',
  AUTH_PASSWORD_CHANGE_RATE_LIMITED: 'Muitas tentativas. Aguarde um minuto e tente de novo.',
  AUTH_PASSWORD_CHANGE_IN_SUPPORT: 'Em sessão de suporte não é possível trocar a senha.',
};

const MENSAGEM_GENERICA = 'Não foi possível trocar a senha. Tente de novo.';

export interface EstadoDaSenha {
  erro?: string;
  /**
   * Carimbo da troca bem-sucedida. Numero e nao booleano: duas trocas
   * seguidas precisam ser dois valores diferentes, senao o efeito que limpa
   * os campos e mostra o toast nao dispara na segunda.
   */
  sucesso?: number;
}

export async function alterarSenha(
  _anterior: EstadoDaSenha,
  formulario: FormData,
): Promise<EstadoDaSenha> {
  const texto = (campo: string): string => {
    const valor = formulario.get(campo);

    return typeof valor === 'string' ? valor : '';
  };

  const validado = esquema.safeParse({
    senhaAtual: texto('senhaAtual'),
    novaSenha: texto('novaSenha'),
    confirmacao: texto('confirmacao'),
  });

  // Nunca devolve senha no estado: prop serializada volta no HTML da pagina.
  if (!validado.success) return { erro: validado.error.issues[0]?.message ?? MENSAGEM_GENERICA };

  try {
    const resposta = await chamarApi('/api/v1/auth/password', {
      metodo: 'POST',
      corpo: { currentPassword: validado.data.senhaAtual, newPassword: validado.data.novaSenha },
    });

    if (!resposta.ok) {
      return { erro: MENSAGEM_POR_CODIGO[resposta.erro?.code ?? ''] ?? MENSAGEM_GENERICA };
    }
  } catch {
    return { erro: MENSAGEM_GENERICA };
  }

  return { sucesso: Date.now() };
}
```

- [ ] **Step 3: Rodar e ver passar**

Run: `pnpm exec vitest run app/actions/perfil.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/app/actions/perfil.ts apps/admin-web/app/actions/perfil.test.ts
git commit -m "feat: action de troca de senha do painel"
```

---

### Task 4: Painel — página `/perfil` e link na topbar

**Files:**
- Modify: `apps/admin-web/app/(protected)/usuario.tsx`
- Create: `apps/admin-web/app/(protected)/perfil/page.tsx`
- Create: `apps/admin-web/app/(protected)/perfil/formulario-de-senha.tsx`
- Create: `apps/admin-web/app/(protected)/perfil/perfil.module.css`
- Create: `apps/admin-web/app/(protected)/perfil/page.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/auth/profile` (Task 2), `alterarSenha`/`EstadoDaSenha` (Task 3), `rotuloDePerfil` de `src/iam/rotulos`, `TenantDateTime`, `PageHeader`, `ProblemDetail`, `Ausente`, `Field`, `Button`, `useToast`, `useToastDeErro` de `@arenahub/ui`.
- Produces: `export function iniciais(email: string): string` em `usuario.tsx`; testids `link-do-perfil`, `perfil-email`, `perfil-papeis`, `perfil-academia`, `perfil-criada-em`, `campo-senha-atual`, `campo-nova-senha`, `campo-confirmacao`, `salvar-senha`, toasts `erro-da-senha` e `senha-trocada`.

- [ ] **Step 1: Teste da página (falha)**

`apps/admin-web/app/(protected)/perfil/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('../../actions/perfil', () => ({
  alterarSenha: vi.fn(),
}));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDePerfil from './page';

const PERFIL = {
  email: 'douglas@arenapositiva.com.br',
  createdAt: '2026-08-20T15:00:00.000Z',
  roles: ['OWNER'],
  tenant: { displayName: 'Clínica da Musculação', timezone: 'America/Sao_Paulo' },
};

async function renderizar() {
  return render(<ToastProvider>{await PaginaDePerfil()}</ToastProvider>);
}

describe('PaginaDePerfil', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('mostra os dados da conta com o perfil em portugues', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: PERFIL, cookiesDaApi: [] });

    await renderizar();

    expect(screen.getByTestId('perfil-email')).toHaveTextContent(PERFIL.email);
    expect(screen.getByTestId('perfil-academia')).toHaveTextContent('Clínica da Musculação');
    expect(screen.getByTestId('perfil-papeis')).not.toHaveTextContent('OWNER');
    expect(screen.getByTestId('perfil-criada-em')).toHaveTextContent('20/08/2026');
    expect(screen.getByText('DO')).toBeInTheDocument();
  });

  it('oferece o formulario de troca de senha', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: PERFIL, cookiesDaApi: [] });

    await renderizar();

    expect(screen.getByLabelText('Senha atual')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Nova senha')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirmar nova senha')).toHaveAttribute('type', 'password');
  });

  it('sem fuso conhecido, a data aparece como ausente em vez de chutar um', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { ...PERFIL, tenant: { ...PERFIL.tenant, timezone: null } },
      cookiesDaApi: [],
    });

    await renderizar();

    expect(screen.getByTestId('perfil-criada-em')).not.toHaveTextContent('20/08/2026');
  });

  it('erro da API vira ProblemDetail, sem formulario', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: { type: 'about:blank', title: 'x', status: 401, code: 'AUTH_REQUIRED', correlationId: 't' },
      cookiesDaApi: [],
    });

    await renderizar();

    expect(screen.getByTestId('erro-do-perfil')).toBeInTheDocument();
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
  });
});
```

Run (de `apps/admin-web`): `pnpm exec vitest run "app/(protected)/perfil"`
Expected: FAIL — `./page` não existe.

- [ ] **Step 2: Exportar `iniciais` e transformar o chip em link**

Em `usuario.tsx`: `function iniciais` vira `export function iniciais`; importar `Link from 'next/link'`; o `<span className={estilos['chip']}>` externo vira:

```tsx
    <Link href="/perfil" className={estilos['chip']} data-testid="link-do-perfil">
      {/* ...conteúdo atual intacto, incluindo data-testid="usuario-logado" */}
    </Link>
```

Atualizar o comentário do componente: "O chip leva a `/perfil` (SPEC-084)". Em `usuario.module.css`, acrescentar ao `.chip` `text-decoration: none; border-radius: 999px; padding: 2px 8px 2px 2px;` e:

```css
.chip:hover {
  background: var(--ah-surface-chrome-hover, rgb(255 255 255 / 0.08));
}

.chip:focus-visible {
  outline: 2px solid var(--ah-accent-400);
  outline-offset: 2px;
}
```

Antes de usar `--ah-surface-chrome-hover`, conferir no `packages/ui` se o token existe (`grep -rn "surface-chrome" packages/ui/src`); se não existir, usar o token de hover do shell que o `AppShell.module.css` usa nos itens da navegação — sem hex literal (o fallback `rgb(...)` acima só vale se a lint aceitar; senão, o token do shell).

- [ ] **Step 3: Formulário client**

`apps/admin-web/app/(protected)/perfil/formulario-de-senha.tsx`:

```tsx
'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, useToast, useToastDeErro } from '@arenahub/ui';

import { alterarSenha, type EstadoDaSenha } from '../../actions/perfil';
import estilos from './perfil.module.css';

const ESTADO_INICIAL: EstadoDaSenha = {};

function BotaoDeSalvar() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="salvar-senha">
      {pending ? 'Salvando…' : 'Alterar senha'}
    </Button>
  );
}

/**
 * Troca da propria senha -- SPEC-084.
 *
 * CAMPOS NAO CONTROLADOS, e por isso o sucesso limpa pelo `form.reset()`: a
 * action nao devolve senha nenhuma (prop serializada volta no HTML), e quem
 * acabou de trocar nao deve ver a senha velha ainda digitada.
 *
 * SEM `required` nativo: a validacao e da action, com a frase certa em toast.
 */
export function FormularioDeSenha() {
  const [estado, acao] = useActionState(alterarSenha, ESTADO_INICIAL);
  const formulario = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useToastDeErro(estado.erro, 'error', 'erro-da-senha');

  useEffect(() => {
    if (!estado.sucesso) return;

    formulario.current?.reset();
    show('success', 'Senha alterada. As outras sessões serão encerradas.', 'senha-trocada');
  }, [estado.sucesso, show]);

  return (
    <form ref={formulario} action={acao} className={estilos['formulario']} noValidate>
      <Field
        id="senha-atual"
        name="senhaAtual"
        label="Senha atual"
        type="password"
        autoComplete="current-password"
        data-testid="campo-senha-atual"
      />
      <Field
        id="nova-senha"
        name="novaSenha"
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        data-testid="campo-nova-senha"
      />
      <Field
        id="confirmacao-de-senha"
        name="confirmacao"
        label="Confirmar nova senha"
        type="password"
        autoComplete="new-password"
        data-testid="campo-confirmacao"
      />
      <p className={estilos['dica']}>
        Mínimo de 8 caracteres. Ao alterar, você continua conectado aqui e as outras sessões são
        encerradas.
      </p>
      <div className={estilos['acoes']}>
        <BotaoDeSalvar />
      </div>
    </form>
  );
}
```

Antes de escrever, conferir em `packages/ui/src/components/Toast.tsx` que `ToastKind` tem `'success'`; se o nome for outro (`'info'`/`'ok'`), usar o que existir.

- [ ] **Step 4: Página**

`apps/admin-web/app/(protected)/perfil/page.tsx`:

```tsx
import type { Metadata } from 'next';

import { Ausente, PageHeader, ProblemDetail, TenantDateTime } from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { rotuloDePerfil } from '../../../src/iam/rotulos';
import { iniciais } from '../usuario';
import { FormularioDeSenha } from './formulario-de-senha';
import estilos from './perfil.module.css';

export const metadata: Metadata = {
  title: 'Meu perfil — ArenaHub',
};

interface PerfilDaConta {
  email: string;
  createdAt: string;
  roles: string[];
  tenant: { displayName: string; timezone: string | null };
}

/**
 * Perfil do usuario logado -- SPEC-084.
 *
 * SO LEITURA, alem da senha (decisao do PI em 04/10/2026). Avatar com
 * iniciais: a foto do leitor mora em `Student` e nao ha vinculo com `User`.
 */
export default async function PaginaDePerfil() {
  const resposta = await chamarApi<PerfilDaConta>('/api/v1/auth/profile');

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-perfil">
        <PageHeader id="titulo-perfil" title="Meu perfil" />
        <ProblemDetail
          testId="erro-do-perfil"
          problem={{
            ...(resposta.erro ?? { type: 'about:blank', status: 0, code: 'erro', correlationId: '' }),
            title: 'Não foi possível carregar o seu perfil.',
          }}
        />
      </section>
    );
  }

  const perfil = resposta.dados;

  return (
    <section aria-labelledby="titulo-perfil" className={estilos['pagina']}>
      <PageHeader id="titulo-perfil" title="Meu perfil" />

      <div className={estilos['grade']}>
        <article className={estilos['cartao']} aria-labelledby="titulo-conta">
          <div className={estilos['identidade']}>
            <span className={estilos['avatar']} aria-hidden="true">
              {iniciais(perfil.email)}
            </span>
            <h2 id="titulo-conta" className={estilos['email']} data-testid="perfil-email">
              {perfil.email}
            </h2>
          </div>

          <dl className={estilos['dados']}>
            <dt>Perfil</dt>
            <dd data-testid="perfil-papeis">
              {perfil.roles.length === 0 ? <Ausente /> : perfil.roles.map(rotuloDePerfil).join(', ')}
            </dd>

            <dt>Academia</dt>
            <dd data-testid="perfil-academia">{perfil.tenant.displayName}</dd>

            <dt>Conta criada em</dt>
            <dd data-testid="perfil-criada-em">
              {/* Sem fuso conhecido, ausente: chutar um fuso e o bug que o TenantDateTime existe para matar. */}
              {perfil.tenant.timezone ? (
                <TenantDateTime iso={perfil.createdAt} timeZone={perfil.tenant.timezone} format="date" />
              ) : (
                <Ausente />
              )}
            </dd>
          </dl>
        </article>

        <article className={estilos['cartao']} aria-labelledby="titulo-senha">
          <h2 id="titulo-senha" className={estilos['tituloDoCartao']}>
            Alterar senha
          </h2>
          <FormularioDeSenha />
        </article>
      </div>
    </section>
  );
}
```

`rotuloDePerfil` recebe `string` — conferir a assinatura em `src/iam/rotulos.ts`; se receber mais de um argumento, trocar `.map(rotuloDePerfil)` por `.map((papel) => rotuloDePerfil(papel))` (o mesmo padrão de `users/page.tsx`).

- [ ] **Step 5: Estilo**

`apps/admin-web/app/(protected)/perfil/perfil.module.css` — tokens do DS-PAINEL, sem hex. Conferir os nomes de token usados em `users/convite.module.css` e `dialogo.module.css` e reusar os mesmos (superfície elevada, borda, raio, espaçamento, tipografia):

```css
/* Perfil do usuario -- SPEC-084. Duas colunas no desktop, uma no estreito. */
.pagina {
  display: flex;
  flex-direction: column;
  gap: var(--ah-space-6);
}

.grade {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: var(--ah-space-6);
  align-items: start;
}

@media (max-width: 900px) {
  .grade {
    grid-template-columns: minmax(0, 1fr);
  }
}

.cartao {
  background: var(--ah-surface-raised);
  border: 1px solid var(--ah-border-subtle);
  border-radius: var(--ah-radius-lg);
  padding: var(--ah-space-6);
}

.identidade {
  display: flex;
  align-items: center;
  gap: var(--ah-space-4);
  margin-bottom: var(--ah-space-6);
}

.avatar {
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, var(--ah-accent-400), var(--ah-accent-700));
  color: var(--ah-surface-raised);
  font-size: 22px;
  font-weight: 700;
}

.email {
  margin: 0;
  font-size: var(--ah-type-title-size);
  line-height: var(--ah-type-title-lh);
  overflow-wrap: anywhere;
}

.dados {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--ah-space-3) var(--ah-space-6);
  margin: 0;
}

.dados dt {
  color: var(--ah-text-secondary);
}

.dados dd {
  margin: 0;
}

.tituloDoCartao {
  margin: 0 0 var(--ah-space-4);
  font-size: var(--ah-type-heading-size);
  line-height: var(--ah-type-heading-lh);
}

.formulario {
  display: flex;
  flex-direction: column;
  gap: var(--ah-space-4);
  max-width: 420px;
}

.dica {
  margin: 0;
  color: var(--ah-text-secondary);
  font-size: var(--ah-type-caption-size);
  line-height: var(--ah-type-caption-lh);
}

.acoes {
  display: flex;
  justify-content: flex-end;
}
```

Todo `--ah-*` acima precisa existir: `grep -rhoE -- "--ah-[a-z0-9-]+" packages/ui/src | sort -u` e trocar qualquer nome inexistente pelo equivalente real **antes** de rodar a lint (`--ah-text-primary` já se sabe que não existe).

- [ ] **Step 6: Rodar e ver passar**

Run (de `apps/admin-web`): `pnpm exec vitest run "app/(protected)"`
Expected: PASS na página nova e nos testes existentes do layout (o `usuario-logado` segue no DOM).

- [ ] **Step 7: Lint e typecheck do painel**

Run (raiz): `pnpm --filter @arenahub/admin-web lint && pnpm --filter @arenahub/admin-web typecheck`
Expected: sem erro (regra 5 de data, sem hex, sem `any`).

- [ ] **Step 8: Commit**

```bash
git add "apps/admin-web/app/(protected)"
git commit -m "feat: pagina de perfil com troca de senha no painel"
```

---

### Task 5: E2E — jornada da troca de senha

**Files:**
- Create: `apps/admin-web/tests/e2e/perfil.e2e-spec.ts`

**Interfaces:**
- Consumes: testids da Task 4; fluxo de convite de `usuarios.e2e-spec.ts` (`/users` → `convidar-usuario` → `link-do-convite` → aceite).

- [ ] **Step 1: Escrever o teste**

```ts
import { expect, test, type Page } from '@playwright/test';

/**
 * Perfil e troca de senha -- SPEC-084.
 *
 * USUARIO PROPRIO, criado por convite: trocar a senha do dono semeado
 * quebraria todas as outras suites, que entram com ela.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };
const SENHA_INICIAL = 'senha-inicial-do-e2e';
const SENHA_NOVA = 'senha-trocada-no-e2e';

async function entrarCom(page: Page, email: string, senha: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

async function criarContaPorConvite(page: Page, email: string): Promise<void> {
  await entrarCom(page, DONO.email, DONO.senha);
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto('/users');
  await page.getByTestId('convidar-usuario').click();
  await page.getByTestId('campo-email-do-convite').fill(email);
  await page.getByTestId('confirmar-convite').click();

  const link = page.getByTestId('link-do-convite');
  await expect(link).toBeVisible();
  const caminho = (await link.getAttribute('href')) ?? '';

  await page.goto(caminho);
  await page.getByLabel('Nova senha').fill(SENHA_INICIAL);
  await page.getByLabel('Repita a senha').fill(SENHA_INICIAL);
  await page.getByRole('button', { name: /criar senha/i }).click();
  await expect(page.getByTestId('aceite-concluido')).toBeVisible();
}

test('o chip da topbar abre o perfil e a senha trocada passa a valer', async ({ page }) => {
  const email = `perfil-e2e-${Date.now()}@exemplo.test`;

  await criarContaPorConvite(page, email);
  await entrarCom(page, email, SENHA_INICIAL);
  await expect(page).not.toHaveURL(/\/login/);

  await page.getByTestId('link-do-perfil').click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByTestId('perfil-email')).toHaveText(email);

  // Erro primeiro: a senha atual errada nao muda nada.
  await page.getByLabel('Senha atual').fill('senha-errada-qualquer');
  await page.getByLabel('Nova senha').fill(SENHA_NOVA);
  await page.getByLabel('Confirmar nova senha').fill(SENHA_NOVA);
  await page.getByTestId('salvar-senha').click();
  await expect(page.getByTestId('erro-da-senha')).toBeVisible();

  await page.getByLabel('Senha atual').fill(SENHA_INICIAL);
  await page.getByLabel('Nova senha').fill(SENHA_NOVA);
  await page.getByLabel('Confirmar nova senha').fill(SENHA_NOVA);
  await page.getByTestId('salvar-senha').click();
  await expect(page.getByTestId('senha-trocada')).toBeVisible();
  await expect(page.getByLabel('Senha atual')).toHaveValue('');

  // Esta sessao continua de pe.
  await page.reload();
  await expect(page).toHaveURL(/\/perfil$/);

  // A antiga nao entra; a nova entra.
  await page.context().clearCookies();
  await entrarCom(page, email, SENHA_INICIAL);
  await expect(page).toHaveURL(/\/login/);
  await entrarCom(page, email, SENHA_NOVA);
  await expect(page).not.toHaveURL(/\/login/);
});
```

- [ ] **Step 2: Rodar**

Antes: matar qualquer processo na `3000` que não seja deste repositório (conferir o dono do PID), e recompilar o painel se o E2E usar `next start`.
Run (de `apps/admin-web`): `pnpm test:e2e -- perfil`
Expected: PASS. Canário: trocar o `href` do chip para `/dashboard` → FAIL em `toHaveURL(/\/perfil$/)`; restaurar.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/tests/e2e/perfil.e2e-spec.ts
git commit -m "test: jornada e2e do perfil e troca de senha"
```

---

### Task 6: Gate, documentação e entrega

**Files:**
- Modify: `docs/DEVELOPMENT.md`, `docs/TESTS.md` (linha da entrega, PR preenchido depois do merge)
- Modify: `docs/specs/SPEC-084-perfil-do-usuario-e-troca-de-senha.md` (status `entregue` ao fim)

- [ ] **Step 1: Gate local** (raiz, `--force` para o cache do turbo não esconder lint vermelho)

```bash
pnpm lint --force && pnpm typecheck --force && pnpm build && pnpm test
```

E a integração da API pelo `test:report` (o `pnpm test` não roda integração). Conferir o total contra duas medições: o Jest de integração pode crashar no Windows **depois** de passar, e o relatório herda número velho.

- [ ] **Step 2: Ver na tela** — subir api (`3344`) e painel (`3000`) na branch, com `.next`/`dist`/`.tsbuildinfo` limpos; logar, clicar no chip, trocar a senha, conferir os toasts e o relogin. CI verde não prova a tela.

- [ ] **Step 3: Docs** — entrada em `DEVELOPMENT.md` (o que entrou, decisões §3 #5–#8 da spec, gate com números) e linha em `TESTS.md`. O número F/SPEC fica `XXX` até o Cowork alocar.

- [ ] **Step 4: PR** — `refs #N` do card (nunca `closes`), corpo com as decisões técnicas; `gh run watch <id> --exit-status` em background, conferir job a job; merge com CI verde; `proplan:done` com link do PR; perguntar ao PI se roda `/graphify . --update`.
