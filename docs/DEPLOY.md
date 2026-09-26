# DEPLOY.md — ArenaHub

Documento de infraestrutura e deploy. Descreve **o que existe de verdade em produção hoje**,
levantado direto do Railway (MCP) em 24/09/2026 — não é plano nem aspiração. Onde algo ainda não
existe (CI/CD de deploy, ambiente de staging, domínio próprio), este documento diz isso
explicitamente em vez de omitir.

Este documento é sobre **infraestrutura e operação de deploy**. Para arquitetura de software,
módulos e fluxo de dados, ver `docs/ARCHITECTURE.md`. Para convenções de código e regras de
domínio, ver `docs/CONVENTION.md`. Para o estado corrente do roadmap, ver `docs/STATUS.md`.

## 1. Visão geral

```
                        ┌─────────────────────────┐
  navegador  ───────▶   │  @arenahub/admin-web     │  (Next.js, App Router)
  (público)             │  arenahub.up.railway.app │
                        └───────────┬──────────────┘
                                     │ rede privada Railway
                                     │ API_INTERNAL_URL
                                     ▼
                        ┌──────────────────────────┐
                        │  @arenahub/api            │  (NestJS)
                        │  arenahubapi.railway.internal
                        │  arenahubapi-production      │
                        │  .up.railway.app (público)   │
                        └───────┬──────────┬─────────┘
                                │          │
                    ┌───────────┘          └───────────┐
                    ▼                                    ▼
          ┌──────────────────┐                 ┌─────────────────┐
          │  Postgres          │                 │  Redis           │
          │  postgres-data (50GB)               │  fila/cache       │
          │  TCP proxy externo (ver §4)          └─────────────────┘
          └──────────────────┘
                    │
                    ▼
          ┌──────────────────────────┐
          │  arenahub-biometrics       │  (object storage / bucket)
          └──────────────────────────┘
```

**Fora do Railway** (não são serviços cloud, não têm deploy neste projeto):

- **`edge-agent`** — roda no PC físico de cada unidade da academia (executor da catraca).
  Distribuição é local à unidade, não cloud.
- **`kiosk`** — PWA em modo quiosque, roda no navegador do totem físico da academia.
- **`mobile`** — Expo/React Native, distribuído por build/loja, não por este pipeline.

Este documento cobre só o que roda no Railway: `admin-web`, `api`, `Postgres`, `Redis`.

## 2. Provedor e projeto

| Item | Valor |
|---|---|
| Provedor | Railway |
| Projeto | `arenahub` (`4a851f61-d68c-4bfe-85df-b82c16dc25cd`) |
| Workspace | Rodrigo Reis's Projects |
| Ambiente | `production` (`9b123277-c1d9-4f8f-afe9-1109228a0850`) — **único ambiente hoje, não há staging** |
| Região | `us-west2`, 1 réplica por serviço |
| Repositório | `RodReis/arenahub`, branch `main` (todos os serviços de app seguem `main`) |

**Não existe ambiente de staging/homologação no Railway.** Todo push na `main` vai direto para
produção. A separação atual entre "testado" e "não testado" é o CI do GitHub Actions (`gate local
antes do push` + `ci.yml`), não um ambiente intermediário.

## 3. Os quatro serviços

### 3.1 `@arenahub/api`

| Campo | Valor |
|---|---|
| ID | `ba0e4e21-82b7-474e-8b1b-f3733c20275e` |
| Builder | Railpack (`RAILPACK`, ambiente de build V3) |
| Build command | `pnpm exec turbo run build --filter=@arenahub/api` |
| Pre-Deploy | `pnpm --filter @arenahub/database migrate:deploy` — **roda migration automaticamente a cada deploy, antes do start** |
| Start command | `pnpm --filter @arenahub/api start` |
| Healthcheck | `GET /health/ready`, timeout 30s |
| Domínio público | `arenahubapi-production.up.railway.app` — **existe e responde** (`GET /health/ready` → `200`, verificado em 26/09/2026). Endpoint privado: `arenahubapi.railway.internal:3344` |
| Rede | Pública na internet **e** alcançável pela rede privada Railway. O `admin-web` usa a privada (`API_INTERNAL_URL`); o totem e o Edge, que rodam fora do Railway, usam a pública |
| Réplicas | 1, região `us-west2` |

**Por que a API tem domínio público** (corrigido em 26/09/2026): a versão anterior deste documento
afirmava que a API não tinha domínio público e que só o `admin-web` a consumia. Isso estava errado
por omissão — o **totem** (`apps/kiosk`) e o **edge-agent** rodam no PC da academia, **fora** do
Railway (ADR-051), e `arenahubapi.railway.internal` não resolve de lá. A superfície pública é o
que torna a topologia do ADR-051 possível; sem ela, nem totem nem Edge alcançam a nuvem.

A redução de superfície continua valendo onde é de graça: o `admin-web`, que roda dentro do
Railway, segue falando pela rede privada (`API_INTERNAL_URL`), e não pela internet.

**Consequência prática**: dá para verificar a API de produção com `curl` de fora
(`GET https://arenahubapi-production.up.railway.app/health/ready` → `200`). Continuam valendo os
outros caminhos: (a) ler os logs via MCP do Railway, (b) consultar o Postgres via TCP proxy (§4),
(c) passar pela sessão autenticada do `admin-web` — este último é o único que prova o que a tela
mostra.

**Variáveis de ambiente** (nomes; valores nunca entram neste documento):
`ANTHROPIC_API_KEY`, `CONTRATADA_CNPJ`, `CONTRATADA_EMAIL`, `CONTRATADA_ENDERECO`,
`CONTRATADA_RAZAO_SOCIAL`, `CONTRATADA_REPRESENTANTE`, `DATABASE_URL`, `JWT_PRIVATE_KEY`,
`JWT_PUBLIC_KEY`, `MFA_ENCRYPTION_KEY`, `NODE_ENV`, `PORT`, `RAILPACK_DEPLOY_APT_PACKAGES`,
`REDIS_URL`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_BUCKET`, `STORAGE_ENDPOINT`, `STORAGE_REGION`,
`STORAGE_SECRET_ACCESS_KEY` — mais as `RAILWAY_*` injetadas automaticamente pela plataforma.

### 3.2 `@arenahub/admin-web`

| Campo | Valor |
|---|---|
| ID | `a255de1f-85aa-4d0d-9b24-c905b6b6948d` |
| Builder | Railpack, mesmo padrão da API |
| Build command | `pnpm exec turbo run build --filter=@arenahub/admin-web` |
| Start command | `pnpm --filter @arenahub/admin-web start` |
| Pre-Deploy | Nenhum (a migration já roda no Pre-Deploy da API) |
| Domínios públicos | `arenahub.up.railway.app` (principal); `arenahubadmin-web-production.up.railway.app` (fallback gerado pelo Railway, porta 3000) |
| Rede | Público na internet; fala com a API por rede privada via `API_INTERNAL_URL` |
| Réplicas | 1, região `us-west2` |

**Variáveis de ambiente**: `API_INTERNAL_URL` (aponta para `arenahubapi.railway.internal`),
`NODE_ENV`, `PORT` — mais as `RAILWAY_*` automáticas.

### 3.3 Postgres

| Campo | Valor |
|---|---|
| ID | `725b0536-0d7a-452e-956f-12b5848c98b4` |
| Imagem | `postgres` (oficial, sem Railpack) |
| Volume | `postgres-data`, 50.000 MB, `us-west2`, montado em `/var/lib/postgresql/data` |
| Domínio público | `postgres-production-ff63.up.railway.app` — **existe por acidente de operação** (ver nota abaixo), Postgres não fala HTTP, é inofensivo mas não deveria ter sido criado |
| TCP proxy | `sakura.proxy.rlwy.net:37662` → porta interna `5432` — **este é o caminho real de acesso externo ao banco**, usado para diagnóstico e scripts de manutenção pontuais |
| Rede interna | `postgres.railway.internal` — só resolve de dentro da rede Railway, nunca de fora |

> **Nota de segurança operacional**: o domínio HTTP (`postgres-production-ff63.up.railway.app`)
> foi criado sem querer ao rodar `railway domain` sem `-s/--service` (o comando aplicou no serviço
> linkado, que por acaso era o Postgres). É inofensivo — Postgres não fala o protocolo HTTP — mas
> é indevido e não deveria ter sido criado. Decisão registrada: não remover por ora (risco de mexer
> em produção sem necessidade); **nunca reproduzir esse padrão de comando sem `-s` explícito**.

**Variáveis de ambiente**: `DATABASE_URL`, `PGDATA`, `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD` — mais as `RAILWAY_*` automáticas.

### 3.4 Redis

| Campo | Valor |
|---|---|
| ID | `84b97dc4-824b-495a-b711-1b0f4e0661ee` |
| Imagem | `redis` (oficial) |
| Domínio público | Nenhum |
| Rede | Só interna, endpoint privado `redis` |
| Uso | Fila (BullMQ) e cache — "só quando comprovadamente necessário", conforme `CLAUDE.md` |

### 3.5 Object storage — `arenahub-biometrics`

Bucket visível no dashboard do projeto (95.6 KB no momento do levantamento). Guarda o que a
regra de arquitetura #7 exige ficar fora do banco relacional (ex.: mídia associada a biometria,
respeitando consentimento e caminho alternativo). Acessado pela API via `STORAGE_*` (S3-compatível
— o equivalente de produção do MinIO usado em desenvolvimento).

## 4. Acesso ao Postgres de produção (fora do Railway)

Não há forma de acessar `postgres.railway.internal` de fora da rede Railway — o hostname
simplesmente não resolve (`ENOTFOUND`). O caminho é sempre o **TCP proxy**:

```
sakura.proxy.rlwy.net:37662  →  porta 5432 do Postgres de produção
```

Uso típico, substituindo o host na `DATABASE_URL` de produção (nunca gravar a URL de produção em
arquivo permanente do repositório ou do ambiente local — passar só via variável de ambiente do
comando):

```bash
# DATABASE_URL de produção usa postgres.railway.internal — trocar pelo proxy:
DBURL=$(echo "$DATABASE_URL_DE_PRODUCAO" | sed 's#postgres.railway.internal:5432#sakura.proxy.rlwy.net:37662#')
PROD_DB_URL="$DBURL" node algum-script-de-leitura.cjs
```

**Alternativa mais simples para SQL ad-hoc**: o console do Railway no navegador (Postgres →
aba Console) já abre um shell **bash**, não um `psql` direto — é preciso rodar
`psql -U postgres -d railway` manualmente antes de colar SQL.

**Regras não-negociáveis ao usar este acesso**:

- Nunca rodar `railway domain` (ou qualquer comando de serviço) sem `-s/--service` explícito —
  ele aplica no serviço linkado, que pode não ser o pretendido (ver nota da §3.3).
- Nunca mandar comando de exclusão em produção sem antes dizer explicitamente **o que ele NÃO
  apaga** — a diferença entre apagar um domínio (inofensivo) e apagar um serviço (catastrófico,
  perde todos os dados) precisa estar clara antes de qualquer confirmação.
- `new URL()` com string inválida imprime a URL inteira (com senha) no erro do Node — sempre
  envolver o parse em `try/catch` que nunca relança a mensagem original quando a string pode
  conter credencial.

## 5. Como o deploy acontece

**Não há pipeline de CI/CD de deploy neste repositório.** `.github/workflows/ci.yml` roda lint,
typecheck, testes e build a cada PR/push — mas **não** faz deploy. O deploy é inteiramente
gerenciado pelo Railway:

1. Push (ou merge) na branch `main` do GitHub.
2. Railway detecta o push via a integração GitHub nativa (campo `source.repo`/`source.branch` de
   cada serviço) e dispara build + deploy automaticamente, **sem passo manual, sem aprovação**.
3. Para `@arenahub/api`: build (`turbo run build --filter=@arenahub/api`) → **Pre-Deploy**
   (`migrate:deploy`, aplica migrations pendentes do Postgres) → start → healthcheck
   (`/health/ready`) → tráfego passa a ir para a nova instância.
4. Para `@arenahub/admin-web`: build → start → tráfego. Sem Pre-Deploy (não tem migration própria).
5. Postgres e Redis não redeployam a cada push de código — só quando a própria imagem/config deles
   muda.

**Consequência prática de "sem staging, sem aprovação"**: todo merge na `main` é, de fato, um
deploy em produção. É por isso que o `CLAUDE.md` exige CI verde antes do merge e a skill de
finalização de branch confere os testes antes de propor merge — não existe uma segunda rede de
segurança depois do merge.

**Migration automática**: a cada push, `migrate:deploy` roda de novo, mesmo sem migration nova
pendente (é idempotente — Prisma só aplica o que falta). **Nunca afirmar "a migration está
pendente" sem checar o log do Pre-Deploy daquele deploy específico** — confiar de memória já
gerou afirmação errada antes.

## 6. Observabilidade disponível

Tudo abaixo é lido via Railway (MCP `plugin:claude_ai:Railway` ou dashboard), sem ferramenta de
observabilidade externa configurada (sem Sentry/Datadog neste projeto ainda):

- **Deploy logs** (`build`): saída do build de cada deployment.
- **Deploy logs** (`deploy`, runtime): stdout/stderr do processo rodando — inclui o log de boot do
  NestJS (`[Nest] ... Mapped {...} route`, `Nest application successfully started`).
- **HTTP logs**: requisições por rota, com filtro por path/status — mas só cobre tráfego que
  efetivamente passou pela API (nada aparece se ninguém bateu na rota).
- **Diagnóstico automático de deploy falho** (`get-deployment-diagnosis`): causa raiz sugerida
  quando um deploy falha — só existe depois que o deploy falhou, não substitui olhar o log.
- **Métricas de serviço** (`get-service-metrics`): CPU/memória/rede por serviço.

**O limite que sobra** (revisto em 26/09/2026 — a versão anterior dizia que não havia como bater
na API de fora, o que era consequência da afirmação errada sobre o domínio público): rota pública
sem sessão dá para conferir com `curl`, e é assim que se prova que a API está de pé. O que `curl`
**não** prova é o que a tela mostra: para isso, verificação pós-deploy continua sendo (1)
confirmar o deploy `SUCCESS` e o boot log limpo; (2) reproduzir a regra contra o dado real do
Postgres via TCP proxy; (3) pedir a alguém com sessão autenticada no `admin-web` que confirme
visualmente. Não há atalho que dispense o passo 3.

## 7. O que este documento não cobre (fora do escopo)

- **`edge-agent`**: instalação e operação no PC físico da academia — ver `docs/ARCHITECTURE.md`
  §Edge e o `README` do próprio pacote.
- **`kiosk`**: hospedagem do PWA no totem físico — não é um deploy cloud, é instalação local.
- **`mobile`**: pipeline de build/distribuição Expo — fora do escopo deste documento.
- **Rollback e disaster recovery**: o Railway permite `canRollback`/redeploy de qualquer
  deployment anterior por este mesmo MCP, mas o produto ainda não tem um runbook formal de
  incidente. Fica como pendência a registrar em `docs/STATUS.md` quando priorizado.
- **Custos e billing do Railway**: fora do escopo técnico deste documento.

## 8. Fonte da verdade

Levantado em **24/09/2026** via consulta direta ao Railway (MCP), com a §3.1 e a §6 **corrigidas
em 26/09/2026**: o serviço `api` tem domínio público (`arenahubapi-production.up.railway.app`,
`GET /health/ready` → `200`), e o documento afirmava o contrário. O erro foi descoberto ao
preparar a instalação do edge-agent na Arena Positiva, quando a afirmação virou um bloqueio
aparente — o Edge precisa alcançar a API de fora do Railway, e o documento dizia que isso não
existia.

**A lição, que vale mais que a correção**: este arquivo envelhece em silêncio. Configuração de
serviço, variáveis e domínios mudam sem que ele seja atualizado no mesmo commit. Em caso de
dúvida, o Railway (dashboard ou MCP) é sempre a fonte de verdade sobre o estado *atual*, e
**checar custa um `curl`**; este documento é a fonte de verdade sobre *como as coisas foram
desenhadas para funcionar* e o histórico de decisões operacionais (como a nota da §3.3).
