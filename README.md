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

O `pnpm dev` sobe três processos: API, admin-web e edge-agent (este em modo
simulador, sem tocar equipamento real). Para mexer na bancada de verdade,
preencha `TENANT_ID` e `GYM_UNIT_ID` no `.env` — o `.env.example` explica de
onde tirar os UUIDs, que o seed gera.

### Login

Em http://localhost:3000, com o usuário que o seed cria:

| campo | valor |
|---|---|
| e-mail | `dono@arena-positiva.test` |
| senha | `senha-de-bancada-arenahub` |

É `OWNER` do tenant `arena-positiva`, com a unidade `MATRIZ` já criada — ou
seja, entra com todas as permissões.

> Esta senha está versionada no seed **de propósito**: é credencial de bancada
> e só existe no banco local. Produção e homologação usam secret manager.
> Se o login não aceitar, o seed não rodou nesse banco — `pnpm dev:setup`
> resolve, e rodar de novo é seguro.

Outros acessos locais: o console do MinIO usa `arenahub` /
`arenahub_dev_minio`, e o Postgres, `arenahub` / `arenahub_dev` (ambos vêm do
`.env.example`).

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
| `pnpm test:e2e` | Playwright — **recria o banco de E2E antes**, ver abaixo |
| `pnpm db:e2e` | recria o banco dedicado ao E2E; roda sozinho antes do `test:e2e` |
| `pnpm build` | compila tudo |
| `pnpm test:report` | regenera `reports/TESTS.md` — **o CI cobra** |
| `pnpm docker:up` / `docker:down` | containers, sem o resto do setup |
| `pnpm docker:reset` | derruba os containers **e apaga os volumes** |

A porta da API é **3344 fixa**: se estiver ocupada, o processo falha em vez de
escorregar para a próxima. Framework que troca de porta sozinho deixa dois
processos servindo, com o operador falando com um e lendo o log do outro.

**O E2E usa banco próprio.** A suíte cria aluno, plano e dispositivo e não
limpa o que criou — como um operador de verdade não apaga quem acabou de
cadastrar. Apontada para o banco de desenvolvimento, ela o enchia de resíduo
com epoch no nome, até a tela de Alunos exibir o rastro da própria suíte em vez
do produto.

Por isso existe `E2E_DATABASE_URL`, no `.env` (copie do `.env.example` e
**ajuste a porta** para a do seu Postgres). Mesmo servidor, banco separado,
recriado do zero antes de cada execução — recriar antes, e não limpar depois,
é o que faz suíte interrompida no meio não sujar a próxima. Sem a variável, o
E2E para e diz o que falta, em vez de escrever no banco errado.

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
