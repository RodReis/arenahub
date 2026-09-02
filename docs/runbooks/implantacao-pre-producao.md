# Runbook — Implantação em pré-produção (F58)

**Para quem:** o PI, operando a Railway, e o operador técnico no PC do totem.
**Referência:** [`SPEC-058`](../specs/SPEC-058-implantacao-nuvem-e-totem-local.md) · [ADR-051](../DECISIONS.md#adr-051)
**Escrito em:** 02/09/2026, pelo Cowork, a pedido do PI. **Não ensaiado.**

> ⚠️ **Atualizado pelo Code em 02/09/2026.** As peças de código da F58 (REDIS_URL obrigatória,
> rate limit, bootstrap de tenant, porta 3210 do kiosk) estão prontas na branch
> `feat/f58-implantacao-nuvem-totem-local`, ainda **sem PR mesclado na `main`**. A infraestrutura da
> Railway (Postgres, Redis, Bucket, variáveis, pre-deploy command, healthcheck) já foi provisionada
> e está persistida no projeto — falta só o primeiro deploy real, que espera o merge para não subir
> a `main` desatualizada. Passos ainda marcados com ⚙️ dependem do merge, não de código que falta
> escrever.
>
> ⚠️ **Isto é pré-produção.** Ao final, a catraca **continua livre** (ADR-029, restrição 1),
> pagamento real está **desligado** e nenhum upload é escaneado. §9 diz como registrar isso.

---

## 0. O que você precisa ter em mãos

- [ ] Acesso ao projeto **Railway** já criado (com `api` e `admin-web`; `kiosk` e `edge-agent`
  apagados em 02/09)
- [ ] Repositório `RodReis/arenahub` conectado à Railway (deploy a partir da `main`)
- [ ] Um cofre para guardar segredos fora da Railway (gerenciador de senhas do PI)
- [ ] Export **íntegro** do Pacto (`alunos.json`) e o `Pessoas1.csv` da catraca — o export de 19/08
  estava corrompido (nome truncado, endereço zerado, plano colapsado, datas trocadas); a F47 só
  aceita o refeito
- [ ] Dados reais do tenant: nome da academia, nome da unidade, timezone (`America/Sao_Paulo`),
  e-mail do primeiro `OWNER`
- [ ] PC do totem com Windows, Node 22 LTS, acesso à internet por HTTPS e o monitor 1080×1920

---

## 1. Railway — infraestrutura

**Feito em 02/09/2026** (provisionado via Railway MCP, projeto `arenahub`,
`4a851f61-d68c-4bfe-85df-b82c16dc25cd`, environment `production`):

- [x] **Postgres** (serviço `Postgres`) e **Redis** (serviço `Redis`) criados.
- [x] **Bucket** `arenahub-biometrics` criado (região `sjc`). Credenciais expostas via variável de
  referência — nunca lidas em texto claro por quem provisionou; ver §3.
- [x] Endpoint de rede privada da API: `arenahubapi.railway.internal`, porta **3344** (é o
  `privateNetworkEndpoint` do serviço — não precisa de "target port" porque rede privada não passa
  pelo proxy de borda; quem conecta em `arenahubapi.railway.internal:3344` já fala direto com o
  container).
- [x] Postgres com **volume** `postgres-data` em `/var/lib/postgresql/data` e `POSTGRES_PASSWORD`
  definida. A imagem `postgres` crua recusa iniciar sem essa variável, e sem volume os dados
  sumiriam a cada deploy — nenhuma das duas coisas vem pronta quando o serviço nasce de imagem em
  vez de template.
- [x] **`watchPatterns` removido dos dois serviços de app.** Estavam limitados a `/apps/api/**` e
  `/apps/admin-web/**`, o que é errado num monorepo: mudança em `packages/ui`, `api-contracts`,
  `database` ou `access-policy` nunca dispararia deploy de quem depende dela, e o serviço ficaria
  servindo código velho sem nenhum sinal. Agora todo push na `main` reconstrói os dois.

⚙️ **Falta:** ligar o **backup automático** do Postgres (Settings → Backups na GUI — o MCP da
Railway não expõe essa configuração). Sem isso o AC-8 não fecha. Ação do PI.

## 2. Gerar os segredos — uma vez, e guardar fora da Railway

**Feito em 02/09/2026:** o par RSA (`JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`) e a chave AES-256
(`MFA_ENCRYPTION_KEY`) foram gerados uma vez e já estão como variável no serviço `api` na Railway
(§3). Comandos equivalentes, para gerar de novo caso precise rotacionar:

```bash
# Par RSA para o JWT (a API exige em producao)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt-private.pem
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem

# Chave AES-256 do MFA e das credenciais de totem/Edge
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

⚙️ **Falta:** copiar os três valores para o cofre do PI. Eles só existem hoje como variável na
Railway — ninguém leu o texto claro durante o provisionamento (a leitura de variável foi bloqueada
de propósito e resolvida com referência `${{...}}`, nunca com o valor visível). **Perder
`MFA_ENCRYPTION_KEY` invalida o TOTP de todo usuário e a credencial de todo totem e Edge de uma
vez** — não há recuperação; só reprovisionar tudo. Buscar o valor real: Railway → serviço `api` →
Variables → revelar.

## 3. Railway — serviço `api`

**Feito em 02/09/2026:**

1. [x] **Source:** repositório `RodReis/arenahub`, branch `main` (já conectado antes da F58).
2. [x] **Build:** `pnpm exec turbo run build --filter=@arenahub/api`, root directory `/`.

   **O `--filter` do pnpm sozinho não serve** — foi o que derrubou as três primeiras tentativas de
   deploy da F58. `pnpm --filter @arenahub/api build` roda **só** o script daquele pacote, sem
   construir `@arenahub/database`, `access-policy` e `api-contracts`, que a API importa por
   `dist/`. O build passava e o processo morria no arranque com `ERR_MODULE_NOT_FOUND`, um pacote
   por vez. O turbo é quem conhece o grafo (`dependsOn: ["^build"]`) e constrói tudo na ordem —
   inclusive `@arenahub/database#generate`, declarado no `turbo.json` desde a F58.

   `RAILPACK_DEPLOY_APT_PACKAGES=yt-dlp` instala o `yt-dlp` via apt na imagem final (ADR-042
   Decisão 7).
3. [x] **Healthcheck path:** `/health/ready`, timeout 30s.
4. [x] **Pre-Deploy Command:** `pnpm --filter @arenahub/database migrate:deploy` — roda
   `prisma migrate deploy` antes do processo novo receber tráfego (Decisão 7 da spec).
5. [x] **Variables** (todas como referência, nunca lidas em texto claro por quem provisionou):

| variável | valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | par RSA 2048 gerado uma vez — **cópia no cofre do PI ainda pendente**, ver §2 |
| `MFA_ENCRYPTION_KEY` | base64 de 32 bytes gerado uma vez — **cópia no cofre do PI ainda pendente** |
| `STORAGE_ENDPOINT` / `STORAGE_REGION` / `STORAGE_BUCKET` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | `${{arenahub-biometrics.ENDPOINT}}` / `REGION` / `BUCKET` / `ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` |
| `ANTHROPIC_API_KEY` | confirmada pelo PI em 02/09/2026 |
| `PORT` | `3344` — **não** é lida pela API (que segue fixa em 3344 por regra do `CLAUDE.md`); é só o valor que a Railway usa para saber em qual porta bater o healthcheck, conforme a doc de Healthchecks da Railway ("se sua aplicação não escuta em `PORT`... defina manualmente a variável `PORT`") |
| `RAILPACK_DEPLOY_APT_PACKAGES` | `yt-dlp` |

**Não** foi definida `MEDIA_FETCHER_FAKE` — o totem serviria vídeo falso sem ninguém notar.

⚙️ **Falta:** o serviço `api` não tem domínio público gerado (não precisa — o painel fala com ele
por `arenahubapi.railway.internal:3344`) e ainda **não fez o primeiro deploy real**: espera o PR da
F58 mesclar na `main`, para o primeiro deploy já validar o código novo (REDIS_URL obrigatória, rate
limit, bootstrap) em vez da `main` anterior. Depois do merge: disparar redeploy e conferir
`GET /health/ready` → `200`, `GET /version` → SHA do commit.

## 4. Railway — serviço `admin-web`

**Feito em 02/09/2026:**

1. [x] **Source:** mesmo repo, `main`, root directory `/` (já conectado antes da F58).
2. [x] **Build:** `pnpm exec turbo run build --filter=@arenahub/admin-web` (mesma razão do §3 — o
   painel importa `@arenahub/ui` e `@arenahub/api-contracts`, e com `pnpm --filter` sozinho o
   Next falhava com 75 erros de `Module not found`). **Start:** `next start -p 3000`, porta já fixa
   antes da F58 — o `-p 3210` que a F58 mexeu foi no `kiosk`, não aqui.
3. [x] **Domínio público gerado:** `arenahubadmin-web-production.up.railway.app`, target port
   auto-detectado (o `admin-web` só escuta uma porta). Este é o endereço que a recepção vai usar.
4. [x] **Variables:**

| variável | valor |
|---|---|
| `NODE_ENV` | `production` |
| `API_INTERNAL_URL` | `http://arenahubapi.railway.internal:3344` — rede privada, sem passar pela internet |

⚙️ **Falta:** primeiro deploy real (mesma razão do §3 — espera o merge da F58). Depois do deploy,
abrir o domínio deve mostrar a tela de login. Ainda **não há usuário** — é o passo 5.

## 5. Banco — tenant real e base do Pacto

> Rode estes comandos **contra o Postgres da Railway**, a partir da sua máquina, com a
> `DATABASE_URL` pública do Postgres **passada por ambiente na linha de comando** — nunca colada no
> `.env` da raiz, que é o de desenvolvimento. Se o script ler o `.env` por engano, ele importa dado
> real no seu banco local.

1. **Bootstrap do tenant** — `pnpm --filter @arenahub/database bootstrap:tenant`, com as sete
   variáveis `BOOTSTRAP_*` exportadas antes (ver cabeçalho de
   `packages/database/prisma/bootstrap-tenant.ts` para a lista completa e um exemplo). Distinto do
   `seed.ts`, que cria `dono@arena-positiva.test` e **não pode** ir para produção. O comando cria
   `Tenant`, `GymUnit` com timezone e o primeiro `OWNER`, e imprime a senha inicial **uma vez** —
   idempotente: rodar de novo com os mesmos argumentos não duplica nem reemite senha. Guarde a
   senha no cofre assim que aparecer no terminal.
2. Faça login no painel com o `OWNER`. O primeiro login exige configurar **MFA** (F6). Confirme
   que entrou e que a lista de alunos está **vazia**.
3. ⚙️ **Importar o Pacto** (F47): `import-pacto.ts` com o export íntegro, apontando para o tenant
   criado. Anote a contagem de `CANCELLED` que o script imprime.
4. ⚙️ **Ativar a base corrente** (F48): `seed-ativos.ts` com o `Pessoas1.csv`. Anote a contagem de
   `ACTIVE` (~340).
5. Rode o import **de novo**. Contagens têm de ser iguais — é o AC-5. Se duplicou, pare: a F47 não
   está idempotente e o banco precisa ser recriado (é por isso que o backup do passo 1.3 já está
   ligado).
6. No painel: a lista de alunos mostra a base; abra três fichas aleatórias e confira nome completo
   e CPF contra o CSV.

## 6. Provisionar o totem no painel

1. Painel → **Operação → Totens** (`/operations/kiosks`) → novo dispositivo: nome (`TOTEM01`), unidade.
2. O painel exibe **`KIOSK_KEY_ID` e `KIOSK_SECRET` uma única vez** (F50). Copie para o cofre. Se
   fechar sem copiar, gere outra credencial — a antiga é revogada.
3. Configure a tela pública (blocos, mídia, patrocinadores) e **publique** uma versão. O totem vai
   buscá-la no passo 7.

## 7. PC do totem — instalar o kiosk LOCAL

> O totem **não** roda na nuvem. A ponte HMAC fica em loopback e isso é a condição do risco que o
> PI aceitou no ADR-045. Não "resolva" isso apontando o navegador do totem para um domínio público.

1. Instale **Node 22 LTS** e **pnpm 10** no PC do totem.
2. Clone o repositório (ou copie o pacote que a F58 definir) e rode, na raiz:
   `pnpm install --frozen-lockfile` e `pnpm --filter @arenahub/kiosk build`.
3. Crie as variáveis **de ambiente do usuário do totem** (não um `.env` dentro do repo — o
   `next.config.ts` do kiosk lê o `.env` da raiz, e um `.env` com segredo num PC de recepção é
   segredo em arquivo):

| variável | valor |
|---|---|
| `NODE_ENV` | `production` |
| `API_INTERNAL_URL` | URL **pública** da API na Railway (`https://api-xxxx.up.railway.app`) |
| `KIOSK_KEY_ID` | do passo 6 |
| `KIOSK_SECRET` | do passo 6 |

4. Suba: `pnpm --filter @arenahub/kiosk start` — o script é
   `next start --hostname 127.0.0.1 -p 3210` (a F58 fixou o `-p 3210` que faltava no `start`; o
   `dev` já tinha). Confirme a porta com `netstat` mesmo assim antes de seguir — é a verificação do
   passo 6, não uma suposição.
5. Abra `http://127.0.0.1:3210` no navegador do totem em modo quiosque (tela cheia, sem barra).
   A tela pública publicada no passo 6 deve aparecer.
6. **Verificação do ADR-045 (AC-11):** no PC do totem, `netstat -ano | findstr 3210` deve mostrar
   **só `127.0.0.1:3210`**. De **outro** computador da rede,
   `curl -X POST http://<ip-do-totem>:3210/api/kiosk/sessions` deve **falhar em conectar**. Se
   conectar, pare tudo — a ponte está exposta.
7. ⚙️ **Autostart:** navegador em quiosque + `next start` subindo com o Windows (Tarefa Agendada
   ou serviço). Reinicie o PC e confirme que a tela volta sozinha (AC-14).
8. No painel, o totem aparece **online** com heartbeat recente. Publique uma alteração pequena e
   veja a tela mudar sem tocar no PC (AC-10).

## 8. Verificações finais

- [ ] Login errado 10 vezes seguidas (mesmo e-mail, mesmo IP) no painel público → `429` na décima
  primeira tentativa (AC-7). Login com senha certa nunca conta contra o limite.
- [ ] Upload de foto de cadastro grava no Bucket; URL pré-assinada expira (AC-6).
- [ ] Área do aluno no totem com CPF real da base: mostra nome e plano; **pagamento aparece
  desabilitado** com mensagem neutra (AC-12). Se aparecer QR de PIX, o dublê de pagamento está
  ativo com aluno real — desligue antes de continuar.
- [ ] Desligue a internet do totem: tela neutra de indisponibilidade; painel marca offline em dois
  heartbeats (AC-13).
- [ ] **Restaure o backup** do Postgres num banco vazio (Railway → Backups → Restore para um novo
  serviço temporário) e aponte um `admin-web` de teste para ele: mesmos alunos (AC-8). Apague o
  temporário depois. Anexe a evidência à issue #253.
- [ ] Um dia de uso: procure nos logs da API por CPF, `Bearer`, `KIOSK_SECRET`. Zero ocorrências (AC-9).

## 9. Registrar o que NÃO foi implantado

Na issue [#253](https://github.com/RodReis/arenahub/issues/253), ao marcar `proplan:done`, o texto
precisa ter as três frases (AC-15). Copie:

> **Esta implantação é pré-produção.** (a) A catraca **não** é controlada por ela: a composição do
> edge-agent é a F59 (#254) e o modo bloqueado é o ADR-028 — restrição 1 do ADR-029 continua em
> vigor. (b) Pagamento real está **desligado** até a F55 (#158). (c) Nenhum upload é escaneado: o
> antivírus é o dublê, risco aceito pelo PI em 02/09/2026 (ADR-051).

## 10. Rollback

- **Release ruim na API ou no painel:** Railway → Deployments → *Redeploy* do deploy anterior.
  Migration não volta sozinha; se a release trouxe migration destrutiva, restaure o backup
  (passo 8) — por isso a regra é migration aditiva.
- **Totem quebrado:** `git checkout` da tag anterior no PC, `build`, `start`. A configuração está
  na nuvem, nada se perde.
- **Credencial do totem vazada:** painel → Operação → Totens → revogar → gerar nova → repetir o passo 7.3.

## 11. O que este runbook não cobre

- Instalação do **edge-agent** no PC da recepção → `docs/operations/smart-access/install.md`,
  reescrito na **F59**.
- Domínio próprio e DNS — decisão do PI, fora da F58.
- O scanner de malware real — card futuro.
