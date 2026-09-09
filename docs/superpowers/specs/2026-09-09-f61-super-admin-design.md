# F61 — Super Admin e ciclo de vida do tenant (desenho)

| campo | valor |
|---|---|
| **Fatia** | F61 · `SPEC-061` |
| **Card** | [#284](https://github.com/RodReis/arenahub/issues/284) |
| **Fonte normativa** | ADR-052 §1–§4 · `docs/specs/SPEC-061-super-admin-e-ciclo-de-vida-do-tenant.md` |
| **Data** | 09/09/2026 |
| **Aprovação do desenho** | PI, 09/09/2026 (nesta conversa) |

> Este documento é **material de apoio do Code**, não contrato. Onde divergir do ADR-052, o ADR
> vence. As cinco decisões da §1 foram tomadas pelo PI porque o ADR não as fecha — cada uma diz
> o que o ADR deixou em aberto.

---

## 1. Decisões que o ADR-052 não fecha

O levantamento do código existente encontrou cinco pontos onde o ADR descreve o destino mas a
infraestrutura atual não comporta o caminho. Todos foram decididos pelo PI em 09/09/2026.

| # | o que o ADR pede | o que existe hoje | decisão do PI |
|---|---|---|---|
| 1 | auditar ato de plataforma (INV-005/INV-008) | `AuditLog.tenantId` é `NOT NULL` com FK cascade — não há linha possível para "criou o tenant X" | **tabela `PlatformAuditLog` separada.** Elevação grava nas duas: uma linha de plataforma e uma no tenant alvo com `actorType = SUPPORT` |
| 2 | `TenantStatus` = `ACTIVE` \| `INACTIVE` \| `SUSPENDED` | só `ACTIVE` \| `SUSPENDED`, e nada lê o status ainda | **`INACTIVE` = desligado pelo dono** (ato administrativo); **`SUSPENDED` = inadimplência** (F65/ADR-053 escreve). Efeito prático igual nesta fatia; a razão fica distinguível |
| 3 | MFA obrigatório para Super Admin (INV-007) | login não exige MFA de ninguém; `MfaObrigatorioError` nunca é lançada; pre-auth construído e morto | **exigir só para o Super Admin**, ligando `emitirPreAuth`/`verificarPreAuth`. Nenhum outro papel muda |
| 4 | papel de plataforma sem `tenant_id` | toda autorização passa por `Role.tenantId`; `@@unique([tenantId, name])` | **tabela `PlatformAdmin` separada**, sem papel nem permissão. `Role`/`Permission`/`UserRole` não são tocadas |
| 5 | sessão elevada com prazo | `Session.tenantId` é `NOT NULL`; token carrega tenant fixo | **`Session.tenantId` vira nullable**; elevação é registro próprio (`SupportElevation`) e emite novo par de tokens com o tenant alvo |

**Consequência para o ADR:** as decisões 1, 4 e 5 introduzem tabelas que o ADR-052 não nomeia. Não
contrariam nenhuma decisão dele — preenchem o "como". Registrar no PR; se o PI quiser, viram emenda
ao ADR-052 depois.

---

## 2. Dados — `packages/database`

Uma migration.

### 2.1 Tabelas novas

**`PlatformAdmin`** — quem é dono do SaaS.

```
id, userId (unique, FK→users), grantedByUserId? (FK→users, SetNull),
grantedAt, revokedAt?, createdAt, updatedAt
```

Revogar é escrever `revokedAt`, nunca deletar: o rastro de quem foi dono do SaaS não some. "Ativo"
é `revokedAt IS NULL`.

**`SupportElevation`** — uma entrada de suporte num tenant.

```
id, sessionId (FK→sessions), platformAdminUserId (FK→users),
tenantId (FK→tenants), reason (text), expiresAt,
endedAt?, endedReason?, createdAt
@@index([sessionId, expiresAt])
```

`reason` é texto livre validado no caso de uso (não-vazio, mínimo 10 caracteres — mesmo piso do
motivo de inativação de unidade). Viva = `endedAt IS NULL AND expiresAt > agora`.

**`PlatformAuditLog`** — auditoria de ato de plataforma.

```
id, actorUserId? (FK→users, SetNull), action, target, targetId?,
tenantId? (SEM FK), correlationId, ipAddress?, userAgent?,
metadata: Json?, occurredAt
@@index([occurredAt]) @@index([correlationId])
```

`tenantId` **sem foreign key** de propósito: é referência histórica e precisa sobreviver ao tenant.
Sem `updatedAt`, mesma razão do `AuditLog` (registro de auditoria não se edita).

`metadata` não carrega PII — mesma regra do `AuditLog` (`invitation.service.ts:73-74`).

### 2.2 Alterações

| tabela | alteração | por quê |
|---|---|---|
| `TenantStatus` (enum) | ganha `INACTIVE` | decisão 2 |
| `Session.tenantId` | `NOT NULL` → nullable | sessão de plataforma não tem tenant |
| `Tenant` | ganha `cnpj`, `timezone`, `responsavelNome`, `responsavelEmail` | o card pede no cadastro; nenhum existe hoje |

**O `Session.tenantId` nullable é a alteração de maior alcance desta fatia.** Hoje o `AuthGuard` lê
`claims.tenantId` e monta contexto sempre. Passa a existir um caminho — e só um — sem tenant, e ele
é rejeitado por toda rota que não seja de plataforma. `TenantContextService.require()` **continua
lançando** quando não há tenant: é o que segura INV-003, e afrouxá-lo faria o Prisma listar tudo.
Quem é de plataforma usa `PlatformContextService`, separado.

---

## 3. API — `apps/api/src/modules/platform`

Módulo novo. Não lê tabela privada de outro módulo (regra de arquitetura 9): fala com `iam` pelo
`InvitationService` público e com `tenancy` pelo `GymUnitRepository` público.

### 3.1 Contexto e guarda

```ts
interface PlatformContext {
  actorId: string;
  sessionId: string;
  platformAdminId: string;
}
```

`PlatformContextService` — request-scoped, `require()` lança `NaoAutenticadoError`. Espelha
`TenantContextService`, não o substitui.

**`AuthGuard` ganha um ramo:** token sem `tenantId` → consulta `PlatformAdmin` ativo → se não for,
401. Rotas de plataforma marcam `@PlatformRoute()`; um `PlatformGuard` exige a marca. Mesmo formato
do `@EdgeRoute()`/`EdgeAuthGuard` que já existe.

**Usuário de tenant em `/platform` → 403 `FORBIDDEN`.** Exceção consciente ao padrão "404 para
recurso de outro tenant": `/platform` não é recurso de tenant, não há existência a esconder.

### 3.2 Casos de uso

| caso de uso | o que faz |
|---|---|
| `CriarTenantUseCase` | uma transação: `tenant.create` + `gymUnit.create` (primeira unidade) + `role` OWNER com as permissões de `packages/database/src/permissoes.ts` + `invitation.create` para o OWNER + `platformAuditLog.create`. Resend **fora** da transação |
| `EditarTenantUseCase` | dados cadastrais; auditoria com `metadata: { campos }` |
| `AlterarStatusDoTenantUseCase` | motivo obrigatório ao sair de `ACTIVE`; motivo vazio na reativação **não** é gravado |
| unidades (criar/editar/inativar) | delegam ao `GymUnitRepository` existente, passando um `TenantContext` sintético do tenant alvo |

**A fonte única das permissões do OWNER é `packages/database/src/permissoes.ts`.** Duplicar essa
lista já produziu OWNER real sem `access.read` em produção — o comentário no topo do arquivo
registra o incidente.

### 3.3 Elevação

`ElevarUseCase(tenantId, reason, correlationId)`:
1. valida `reason` (não-vazio, ≥10 caracteres) e que o tenant existe;
2. grava `SupportElevation`;
3. grava **duas** linhas de auditoria — `PlatformAuditLog` e `AuditLog` do tenant alvo com
   `actorType: 'SUPPORT'` (o tenant enxerga que houve suporte);
4. emite novo par de tokens com `tenantId` preenchido.

`EncerrarElevacaoUseCase` escreve `endedAt`/`endedReason` e as duas linhas de saída (INV-008 pede
entrada **e** saída).

**No `AuthGuard`:** token com `tenantId` + usuário que é `PlatformAdmin` **e não tem
`TenantMembership`** naquele tenant → exige elevação viva. Expirada → o contexto volta a ser de
plataforma e a rota de tenant devolve 403. É aqui que o `supportElevation` do `TenantContext`
(declarado em `tenant-context.ts:21-22` e morto desde a "Task 5") finalmente é preenchido.

### 3.4 MFA

`AuthService.login` ganha um ramo: usuário que é `PlatformAdmin` ativo **não** recebe o par de
tokens. Recebe pre-auth:

- `mfaStatus === 'ENABLED'` → `purpose: 'MFA_VERIFY'`
- caso contrário → `purpose: 'MFA_SETUP'`

Endpoint de verificação troca o pre-auth pelo par definitivo. `emitirPreAuth`/`verificarPreAuth`
já existem em `token.service.ts` e nunca foram chamados. **Nenhum outro papel muda de
comportamento.**

---

## 4. Painel — `apps/admin-web`

Rota `/platform`, **fora** do grupo `(protected)`: aquele layout chama `/api/v1/units`, que exige
tenant. Grupo próprio `(platform)` com layout próprio.

| rota | tela |
|---|---|
| `/platform` | lista de tenants: status e contagem de unidades |
| `/platform/novo` | cadastro |
| `/platform/[tenantId]` | detalhe: editar, unidades, alternar status com motivo |
| `/platform/[tenantId]/elevar` | diálogo de justificativa |

Molde: o CRUD de unidades (`app/(protected)/units/`). `DataTable` com `columns[]` declarativas,
`EstadoSimples` para situação (texto + cor, WCAG), `EmptyState` com ação, `ProblemDetail` no erro
— **nunca tela vazia**. Server actions em `app/actions/platform.ts` com Zod espelhando a API
(server action é superfície pública tanto quanto um endpoint), `useActionState` + `useToastDeErro`,
e `valores` devolvidos para o formulário não perder o digitado no erro.

Ao confirmar a elevação, os cookies novos voltam por `cookiesDaApi` e o usuário é redirecionado
para `/dashboard` do tenant.

**Faixa de suporte.** `/auth/me` passa a devolver `supportElevation` quando presente; o
`(protected)/layout.tsx` renderiza faixa fixa no topo — *"você está operando como suporte em
&lt;tenant&gt; · encerra às HH:mm"* — com botão de sair. Componente novo em `@arenahub/ui`. **É a
única alteração no layout de tenant existente.**

`proxy.ts` ganha `/platform` como rota que exige sessão. O fluxo de refresh não muda: a rotação já
funciona para sessão sem tenant.

---

## 5. Testes

O aceite do card é a espinha.

**Integração (Jest + Postgres local):**
- segundo tenant criado inteiro pelo caso de uso, com `Invitation` gerada e OWNER com as permissões
  corretas — conferidas contra `permissoes.ts`, não contra lista repetida no teste;
- elevação sem justificativa → recusa;
- elevação expirada → 403 e contexto volta a plataforma;
- **INV-006:** Super Admin **não elevado** tenta ler aluno e unidade de um tenant → falha;
- usuário de tenant chama rota `/platform` → 403 `problem+json`.

**Unit (Vitest):** as server actions novas, incluindo motivo vazio.

**E2E (Playwright):** login de Super Admin passando pelo desafio MFA, criar tenant, elevar, ver a
faixa, sair. É o fluxo que muda de forma — `pnpm test` não roda E2E nem integração; rodar
`test:report` antes do commit.

### Canário

O teste de elevação expirada passa fácil **pelo motivo errado**: uma guarda anterior pode recusar a
requisição antes de ela alcançar a checagem de prazo, e o verde não prova nada. O cenário tem de
provar que a requisição chega lá: **elevação válida passa; a mesma requisição com `expiresAt` no
passado falha.** Sem o par, o teste não vale.

---

## 6. Escopo negativo

| não faz | vai para |
|---|---|
| identidade visual e login por slug | F62 |
| plano, contrato, fatura da plataforma | F63, F64 |
| efeito de `SUSPENDED` na catraca | F65 (ADR-053) |
| RLS | F66, F67 (ADR-054) |
| feature flag por plano | fora — flag continua coluna (ADR-049) |
| remover `bootstrap-tenant.ts` | o script fica: o **primeiro** Super Admin ainda nasce fora do painel. O ADR diz que o CRUD "substitui o script" para criar tenant, e é isso que a fatia entrega |

---

## 7. Tamanho

~1 migration · ~12 arquivos novos na API · ~8 no `admin-web` · 1 alteração no `AuthGuard` · 1 no
`AuthService` · 1 no `(protected)/layout.tsx`.
