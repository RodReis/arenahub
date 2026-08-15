# Evidência — SPEC-006 / F6 · Core seguro e unidade

> **Documento de evidência da fatia**, exigido pela Task 7 do plano de apoio
> (`docs/superpowers/plans/2026-08-14-mvp-01-01-core-security.md`).
>
> Os números abaixo vieram de **execução**, não de prosa (`docs/TESTING.md` §5). Data e SHA
> ficam no log do CI e no histórico do Git — gravá-los aqui tornaria o arquivo impossível de
> manter conferido.

## 1. Ambiente de verificação

| item | valor |
|---|---|
| PostgreSQL | 17.10 (`postgres:17-alpine`, `infra/docker/docker-compose.yml`) |
| Node local | v24.15.0 — **acima do pin do repositório** (`.nvmrc` = 22) |
| Node no CI | 22, via `.nvmrc` |
| Prisma | 7.9.1, driver adapter `@prisma/adapter-pg` |
| NestJS | 11.2.0 · Next.js 16.3.1 · Playwright 1.62.1 |

> ⚠️ **Divergência de runtime registrada.** O desenvolvimento local roda em Node 24 e o CI em
> Node 22. Decisão do PI em 15/08/2026: seguir assim e tratar **o CI como árbitro** antes do
> merge. Os avisos de `engines` antecedem esta fatia.

## 2. Suítes e contagem

| suíte | comando | testes |
|---|---|---|
| unitário — API | `pnpm --filter @arenahub/api test` | **42** |
| unitário — painel | `pnpm --filter @arenahub/admin-web test` | **2** |
| integração — API | `pnpm --filter @arenahub/api test:integration` | **58** |
| integração — banco | `pnpm --filter @arenahub/database test:integration` | **11** |
| E2E — painel | `pnpm --filter @arenahub/admin-web test:e2e` | **10** |
| | **total** | **123** |

## 3. Os oito comandos raiz

**Esta fatia fecha a lista de pendentes do CI**, aberta no card #44 e reduzida em duas etapas.

| comando | antes de F6 | depois |
|---|---|---|
| `pnpm install --frozen-lockfile` | ✅ | ✅ |
| `pnpm lint` | ✅ | ✅ |
| `pnpm typecheck` | ✅ | ✅ |
| `pnpm test` | ✅ | ✅ |
| `pnpm test:integration` | ❌ sem workspace | ✅ **Task 1** |
| `pnpm test:e2e` | ❌ sem workspace | ✅ **Task 6** |
| `pnpm build` | ✅ | ✅ |
| `pnpm dev` | ✅ | ✅ |

O passo `pendentes` do `ci.yml` — que **falhava se uma task pendente passasse** — foi
desmontado nas duas etapas, como o próprio comentário do arquivo instruía.

## 4. Rastreabilidade de requisitos

| requisito | como é verificado |
|---|---|
| `M1-FR-001` criar tenant e unidades com timezone e horário | `tenant-isolation.int-spec.ts` — criação, timezone IANA validado contra a base do runtime |
| `M1-FR-002` autenticar e rotacionar refresh | `auth.int-spec.ts` — rotação, reuso, revogação de família |
| `M1-FR-003` permissões por tenant e unidade | `tenant-isolation.int-spec.ts` — `@RequirePermissions`, escopo por `gymUnitId` |
| `M1-FR-004` MFA para perfis privilegiados | `iam-mfa.int-spec.ts`, `totp.service.spec.ts` — RFC 6238, anti-replay |
| `M1-FR-005` auditar login, convite, troca de função | `tenant-isolation.int-spec.ts`, `iam-mfa.int-spec.ts` — `AuditLog` na mesma transação |
| `M1-BR-006` política mais restritiva prevalece | `permissions.guard.ts` exige **todas** as permissões listadas |
| `M1-NFR-004` sem perda de evento | `OutboxEvent` gravado na transação da mudança de estado |
| `M1-NFR-007` isolamento multi-tenant testado | `core-isolation.int-spec.ts` (constraints) + `tenant-isolation.int-spec.ts` (comportamento) |
| `M1-NFR-008` WCAG 2.2 AA nos fluxos essenciais | `core-security.e2e-spec.ts` — teclado, `role="alert"`, tabela semântica, 390 px |
| `M1-AC-001` proprietário cria unidade e usuários sem cruzamento | `core-security.e2e-spec.ts` + `tenant-isolation.int-spec.ts` |

## 5. Varredura de vazamento

`vazamento.int-spec.ts` verifica o que **nenhuma rota pode fazer**:

- senha não aparece em log — nem a correta, nem a **tentada** (senha errada costuma ser a senha
  certa de outro sistema, digitada por engano);
- nenhuma resposta de erro carrega hash, string de conexão, chave privada ou stack trace;
- o corpo `problem+json` tem **exatamente** cinco campos — campo extra é informação que ninguém
  decidiu publicar;
- `AuditLog.metadata` não contém e-mail nem CPF;
- `Session.tokenHash` e `Invitation.tokenHash` são sempre SHA-256 hexadecimal;
- `User.passwordHash` é sempre envelope `scrypt`, e o segredo TOTP nunca é base32 legível.

## 6. Contrato OpenAPI

Snapshot em [`packages/api-contracts/openapi/arenahub-v1.json`](../../../packages/api-contracts/openapi/arenahub-v1.json),
**gerado do runtime** e conferido por `openapi.int-spec.ts`: se as rotas mudarem sem o snapshot
mudar junto, o teste quebra.

14 rotas publicadas, todas dentro de `/api/v1`, `/health` ou `/version` — há teste que falha se
alguma escapar do prefixo.

Para regerar: `ATUALIZAR_OPENAPI=1 pnpm --filter @arenahub/api test:integration`.

## 7. Decisões de segurança e o porquê

| decisão | motivo |
|---|---|
| **RS256**, não HMAC | quem só precisa *verificar* token recebe a chave pública e não ganha o poder de *emitir*. Com segredo compartilhado, verificar e forjar são a mesma capacidade |
| `algorithms` fixo no verificador | aceitar o algoritmo declarado pelo token é o ataque `alg: none` |
| **scrypt** com envelope versionado | parâmetros gravados em cada senha: subir o custo no futuro não invalida as senhas existentes |
| `timingSafeEqual` em senha e TOTP | `===` sai no primeiro byte diferente e vaza o segredo byte a byte |
| resposta única para senha errada e e-mail inexistente | distinguir transforma o login em oráculo de quem tem conta |
| conferência contra envelope falso quando o usuário não existe | sem ela, o **tempo** de resposta vira o mesmo oráculo |
| refresh **opaco** + SHA-256 no banco | vazar a tabela não entrega sessão |
| reuso de refresh derruba a **família** | não há como distinguir a vítima do ladrão — os dois apresentam credencial legítima |
| **404, nunca 403**, para recurso de outro tenant | 403 confirma que o UUID foi acertado |
| permissões lidas do **banco**, não do token | token vale 10 min; ler dele faria permissão revogada sobreviver a esse prazo |
| `updateMany` com `tenantId` no filtro | `update` por id acharia a linha de qualquer tenant e só depois falharia |
| **SHA-1 no TOTP** | não depende de resistência a colisão, e é o que Google Authenticator/Authy/1Password implementam. SHA-256 daria conformidade no papel e um fator ilegível pelo app do usuário |
| contador TOTP **estritamente maior** | barrar só o igual permitiria voltar no tempo dentro da janela de tolerância |
| **AES-256-GCM**, não CBC | a tag transforma adulteração em erro; sem ela, byte trocado vira código errado e o usuário leva a culpa |
| MFA nasce `PENDING` | ativar antes da confirmação trancaria o usuário fora da própria conta |
| cookies `HttpOnly` + `SameSite=Strict` | `HttpOnly` é a diferença entre um XSS que rouba a sessão e um que não rouba |
| token nunca no corpo da resposta | JSON com token acaba em `localStorage`, legível por qualquer script |
| `server-only` no cliente de API | importá-lo de um Client Component **quebra o build** em vez de publicar `API_INTERNAL_URL` |
| lista fixa de cookies repassados | cookie novo emitido pela API não entra na sessão sem alguém decidir |

## 8. Limites conhecidos desta fatia

Registrados para não parecerem esquecimento:

- **MFA ainda não é obrigatório no login.** O fluxo de inscrição e verificação existe e está
  testado, mas o `AuthGuard` não recusa perfil privilegiado sem MFA confirmado. O token pre-auth
  está implementado e testado no `TokenService`, sem estar ligado ao fluxo de login.
- **Sem rate limit.** `@nestjs/throttler` não foi instalado; login e refresh aceitam tentativas
  sem limite.
- **Sem CSRF por token.** A proteção hoje vem de `SameSite=Strict`, que cobre o caminho comum
  mas não substitui o token por sessão descrito no plano.
- **Sem `bootstrap-platform-admin`.** O primeiro tenant é criado pelo seed de bancada, não por
  CLI com prompt mascarado.
- **Sem tela de criação de unidade no painel.** A rota `POST /api/v1/units` existe e está
  testada; a interface só lista.
- **Sem `AuditLog` imutável no banco.** A imutabilidade é convenção do código (sem `updatedAt`,
  sem rota de update); falta o `GRANT` que a impõe no PostgreSQL.

Cada item acima é escopo do PI decidir: entram como correção nesta fatia, viram fatia própria,
ou são aceitos como estão para o MVP 1.
