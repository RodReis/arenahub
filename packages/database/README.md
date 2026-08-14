# `@arenahub/database`

Schema Prisma, migrations, client factory e seed.

## Depois de clonar, rode `generate` antes de qualquer coisa

```bash
pnpm --filter @arenahub/database generate
```

**O client do Prisma é gerado, não versionado** — `src/generated/` está no `.gitignore`. Sem
rodar `generate`, `pnpm lint` e `pnpm typecheck` falham com erros que parecem de código
(`no-unsafe-call`, tipo não resolvido), mas são de arquivo ausente.

O CI faz isso automaticamente, num passo antes do lint. Este foi o primeiro defeito que o CI
pegou: passava na máquina de quem já tinha rodado `generate` e falhava no runner limpo — verde
local, vermelho remoto, o pior tipo de divergência.

## Comandos

| comando | o que faz |
|---|---|
| `generate` | gera o client em `src/generated` |
| `migrate` | aplica migrations em desenvolvimento |
| `migrate:deploy` | aplica migrations sem gerar novas (produção/CI) |
| `seed` | popula dado local de desenvolvimento |
| `studio` | abre o Prisma Studio |

Todos com `pnpm --filter @arenahub/database <comando>`. Precisam do Postgres de pé —
`pnpm docker:up` na raiz.

## O schema está vazio, e isso é deliberado

Nenhum `model`. Modelar entidade aqui seria assumir escopo de produto que pertence às fatias:
`Tenant` e `GymUnit` nascem em **F6** ([#6](https://github.com/RodReis/arenahub/issues/6)).

A migration inicial também é vazia. Ela existe para o histórico de migrations começar — sem ela,
a primeira migration real teria que ser também a que inicializa `_prisma_migrations`, acoplando
*"nascimento do histórico"* a *"nascimento da primeira entidade"*.

O `seed.ts` nasce vazio pelo mesmo motivo: o card criou o arquivo e o comando, o conteúdo vem
fatia a fatia.

## Quando a primeira entidade chegar

**Regra de arquitetura nº 2** (`CLAUDE.md`), sem exceção:

- `tenant_id` em **toda** entidade de negócio;
- `gym_unit_id` quando o dado é físico;
- o tenant vem da **identidade autenticada** — nunca do corpo da requisição nem do payload de
  webhook;
- repositório recebe `TenantContext` obrigatório.

O ponto de extensão para o filtro de tenant é `PrismaClient.$extends(...)`, aplicado **depois**
que `criarPrismaClient` devolve a instância. A factory não precisa saber de `TenantContext` para
não atrapalhar — e não sabe, de propósito.

## `criarPrismaClient` é factory, e quem chama é dono do pool

Cada chamada abre um pool `pg` próprio. É o que se quer para teste paralelo com Testcontainers, e
é o que **exige `await client.$disconnect()`** no encerramento:

- **NestJS:** `$disconnect()` no `OnModuleDestroy`;
- **script:** `try { ... } finally { await client.$disconnect(); }`;
- **teste:** `afterAll` / `afterEach`, conforme o escopo do client.

Esquecer segura o processo de pé e, em teste, vaza conexão até estourar o limite do Postgres.

## Prisma 7 — duas coisas que mudaram

**Driver adapter é obrigatório.** `datasources` deixou de existir. É efeito de o client ter
virado TypeScript puro, sem engine binário nativo: a conexão passa a ser de um driver do
ecossistema Node (`@prisma/adapter-pg`).

**`prisma.config.ts` substitui** a configuração que morava no schema, e aponta o `dotenv` para a
**raiz do monorepo** — o `.env` vive lá, junto do que o `docker-compose` usa. A ordem
`carregarEnv` → `defineConfig` no arquivo não pode ser trocada.
