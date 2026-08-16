# ArenaHub

SaaS multi-tenant de gestão para academias, começando pelo módulo **Academia**.
Cliente inaugural: Complexo Arena Positiva.

Costura numa cadeia só o que hoje vive em sistemas separados:

```
matrícula → cobrança → direito de acesso → catraca com reconhecimento facial
    → frequência → evolução corporal → retenção
```

## Subir o projeto

Um comando, do zero:

```bash
pnpm dev:setup
```

Ele cria o `.env`, instala dependências, sobe Postgres + Redis + MinIO, gera o
client Prisma, aplica as migrations, compila os pacotes e roda o seed.
É idempotente — rodar de novo não quebra nada e preserva o `.env` existente.

Depois:

```bash
pnpm dev
```

| serviço | endereço |
|---|---|
| API | http://localhost:3344 |
| Admin web | http://localhost:3000 |
| MinIO (console) | http://localhost:9001 |

Login de desenvolvimento, vindo do seed e **válido só localmente**:
`dono@arena-positiva.test` / `senha-de-bancada-arenahub`.

### Pré-requisitos

- **Node 22** (`.nvmrc`) — o repo declara `>=22 <23`
- **pnpm 10**
- **Docker** rodando (Postgres, Redis e MinIO sobem em container)

> `pnpm setup` **não** funciona: `setup` é comando nativo do pnpm e nunca chega
> ao script do repositório. Por isso o nome é `dev:setup`.

## Comandos

| comando | o que faz |
|---|---|
| `pnpm dev:setup` | prepara o ambiente inteiro, do zero |
| `pnpm dev` | sobe API e admin-web |
| `pnpm lint` | ESLint em todos os workspaces |
| `pnpm typecheck` | TypeScript estrito |
| `pnpm test` | testes de unidade |
| `pnpm test:integration` | testes que usam Postgres (exige containers de pé) |
| `pnpm test:e2e` | Playwright |
| `pnpm build` | compila tudo |
| `pnpm test:report` | regenera `reports/TESTS.md` — **o CI cobra** |
| `pnpm docker:up` / `docker:down` | containers, sem o resto do setup |
| `pnpm docker:reset` | derruba os containers **e apaga os volumes** |

A porta da API é **3344 fixa**: se estiver ocupada, o processo falha em vez de
escorregar para a próxima. Framework que troca de porta sozinho deixa dois
processos servindo, com o operador falando com um e lendo o log do outro.

## Estrutura

```
apps/
  api/          NestJS — monólito modular, REST /api/v1 + OpenAPI
  admin-web/    Next.js (App Router, Server Components por padrão)
  kiosk/        Next.js PWA em modo quiosque (totem)
  mobile/       React Native + Expo
  edge-agent/   Node.js no PC da academia + SQLite
packages/
  api-contracts/  tipos e schemas compartilhados (inclui a assinatura do Edge)
  database/       schema Prisma, migrations, client factory, seed
  ui/             design system
  config/         eslint, tsconfig, prettier
  testing/        utilitários de teste
infra/
  docker/         compose do ambiente local
```

## Os cinco pilares

1. **Gym Management** — tenant, unidades, perfis, alunos, planos, assinatura.
2. **Smart Access** — biometria facial, catraca, motor de decisão, operação offline.
3. **Smart Billing** — invoice, PIX, cartão recorrente, inadimplência, conciliação.
4. **Health Intelligence** — avaliação física, bioimpedância, histórico, análise assistiva.
5. **Engagement & Retention** — metas, XP, streak, ranking opt-in, risco de churn.

**O que o ArenaHub não é:** ERP contábil, emissor de nota fiscal, prontuário
médico, adquirente, nem substituto de prescrição profissional.

## Regras que não se negociam

Contrariar qualquer uma exige **ADR novo aprovado**, nunca um PR "porque ficou
mais simples assim". As nove completas estão no [`CLAUDE.md`](CLAUDE.md); as
que mais aparecem no dia a dia:

- **Pagamento não controla acesso. Entitlement controla.** A catraca nunca
  consulta assinatura nem invoice.
- **`tenant_id` em toda entidade de negócio**, vindo da identidade autenticada
  — nunca do corpo da requisição.
- **A nuvem é a fonte da verdade; o Edge é executor físico.**
- **Todo efeito externo é idempotente.** Reprocessar é sempre seguro.
- **Dinheiro é inteiro na menor unidade monetária.** Nunca `float`.
- **Biometria exige consentimento versionado e caminho alternativo funcional.**
  Recusar a biometria não pode negar o acesso.

## Documentação

| documento | o que responde |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | papéis, processo e as nove regras de arquitetura |
| [`docs/prd/README.md`](docs/prd/README.md) | contrato de produto e engenharia |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | desenho, módulos, dados, resiliência |
| [`docs/CONVENTION.md`](docs/CONVENTION.md) | entidades, estados e invariantes numeradas |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | ADRs |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | ordem de execução e status por fatia |
| [`docs/STATUS.md`](docs/STATUS.md) | kanban e **Índice Fatia ↔ SPEC** |
| [`docs/TESTING.md`](docs/TESTING.md) | estratégia de teste e guarda de evidência |

## Estado

**MVP 1 (Smart Access) em andamento.** F6 e F7 entregues; F8 (consentimento,
biometria e sync) fechou as Tasks 1 a 6 em `SIMULATOR_READY` — nada rodou em
hardware ainda, porque o gate `M1-HW-01` não foi atravessado.

Progresso por fatia em [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
