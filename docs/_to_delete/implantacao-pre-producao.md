# Runbook — Implantação em pré-produção (F58)

**Para quem:** o PI, operando a Railway, e o operador técnico no PC do totem.
**Referência:** [`SPEC-058`](../specs/SPEC-058-implantacao-nuvem-e-totem-local.md) · [ADR-051](../DECISIONS.md#adr-051)
**Escrito em:** 02/09/2026, pelo Cowork, a pedido do PI. **Não ensaiado.**

> ⚠️ **Leia isto antes do passo 1.** Alguns passos dependem de código que **ainda não existe** e
> que a F58 entrega — estão marcados com ⚙️. Executar o runbook antes do PR da F58 mergear vai
> travar neles, e é o esperado. Os passos sem marca são ação no painel da Railway ou no PC, e podem
> ser feitos hoje.
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

## 1. Railway — infraestrutura (sem código)

1. No projeto, adicione **Postgres** e **Redis** (Add → Database).
2. Adicione um **Bucket** (Add → Storage Bucket). Anote `endpoint`, `region`, nome do bucket,
   `access key` e `secret key`.
3. Ligue o **backup automático** do Postgres no serviço (Settings → Backups). Sem isso o AC-8 da
   spec não fecha.
4. Anote as URLs privadas: `postgres.railway.internal`, `redis.railway.internal`, e a do `api`
   (`api.railway.internal`) — é por ela que o painel vai falar com a API.

## 2. Gerar os segredos — uma vez, e guardar fora da Railway

No seu computador, **não** no servidor:

```bash
# Par RSA para o JWT (a API exige em producao)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt-private.pem
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem

# Chave AES-256 do MFA e das credenciais de totem/Edge
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Guarde os três valores no cofre **antes** de colar na Railway. **Perder `MFA_ENCRYPTION_KEY`
invalida o TOTP de todo usuário e a credencial de todo totem e Edge de uma vez** — não há
recuperação; só reprovisionar tudo.

## 3. Railway — serviço `api`

1. **Settings → Source:** repositório, branch `main`, *Root Directory* = `/` (o build é do monorepo
   inteiro, não de `apps/api` sozinho — `packages/database` e `api-contracts` precisam estar no
   contexto).
2. ⚙️ **Build e start:** a F58 entrega o empacotamento (Dockerfile ou config). Até lá, o build
   padrão da Railway **não** vai gerar o client do Prisma nem incluir o `yt-dlp`. Não improvise
   aqui.
3. **Settings → Networking → Generate Domain**, porta **3344**. A API não lê `PORT`; a porta é
   fixa por regra do `CLAUDE.md`. Anote a URL pública (`https://api-xxxx.up.railway.app`).
4. **Settings → Healthcheck path:** `/health/ready`.
5. ⚙️ **Settings → Pre-Deploy Command:** o comando de migração que a F58 fixar
   (`pnpm --filter @arenahub/database exec prisma migrate deploy` ou equivalente). É o que garante
   que a migration roda **antes** do processo novo receber tráfego (Decisão 7 da spec).
6. **Variables:**

| variável | valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | referência ao Postgres (`${{Postgres.DATABASE_URL}}`), com `?schema=public` |
| `REDIS_URL` | referência ao Redis (`${{Redis.REDIS_URL}}`) |
| `JWT_PRIVATE_KEY` | conteúdo do `jwt-private.pem` (PEM inteiro, com quebras de linha) |
| `JWT_PUBLIC_KEY` | conteúdo do `jwt-public.pem` |
| `MFA_ENCRYPTION_KEY` | o base64 gerado |
| `STORAGE_ENDPOINT` | endpoint do Bucket |
| `STORAGE_REGION` | region do Bucket |
| `STORAGE_BUCKET` | nome do Bucket |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | credenciais do Bucket |
| `ANTHROPIC_API_KEY` | opcional. Sem ela o módulo de saúde usa o dublê e avisa no log |
| `YTDLP_BIN` | só se a imagem não colocar o `yt-dlp` no `PATH` |

**Não** defina `MEDIA_FETCHER_FAKE` — o totem serviria vídeo falso sem ninguém notar.

7. Deploy. Confira: `curl https://<api>/health/ready` → `200`, e `curl https://<api>/version` →
   SHA do commit da `main`. Se a API não subir por variável faltando, o log diz qual — é o
   comportamento certo.

## 4. Railway — serviço `admin-web`

1. **Source:** mesmo repo, `main`, *Root Directory* `/`.
2. ⚙️ **Build/start** conforme a F58 (`next build` / `next start -p 3000`).
3. **Networking → Generate Domain**, porta **3000**. Este é o endereço que a recepção vai usar.
4. **Variables:**

| variável | valor |
|---|---|
| `NODE_ENV` | `production` |
| `API_INTERNAL_URL` | `http://api.railway.internal:3344` — rede privada, sem passar pela internet |

5. Deploy. Abrir o domínio deve mostrar a tela de login. Ainda **não há usuário** — é o passo 5.

## 5. Banco — tenant real e base do Pacto

> Rode estes comandos **contra o Postgres da Railway**, a partir da sua máquina, com a
> `DATABASE_URL` pública do Postgres **passada por ambiente na linha de comando** — nunca colada no
> `.env` da raiz, que é o de desenvolvimento. Se o script ler o `.env` por engano, ele importa dado
> real no seu banco local.

1. ⚙️ **Bootstrap do tenant** — comando que a F58 cria (hoje não existe; o seed cria
   `dono@arena-positiva.test`, que **não pode** ir para produção). Ele cria `Tenant`, `GymUnit`
   com timezone e o primeiro `OWNER`, e imprime a senha inicial **uma vez**. Guarde-a no cofre.
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

4. Suba: `pnpm --filter @arenahub/kiosk start` — o script já é `next start --hostname 127.0.0.1`.
   Porta **3210**? Confira: o `start` do `package.json` não passa `-p`; se subir em 3000, pare e
   registre — é exatamente a colisão silenciosa que a issue #212 proibiu. ⚙️ A F58 fixa isso.
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

- [ ] Login errado 10 vezes seguidas no painel público → `429` (AC-7). ⚙️ Rate limit é entrega da F58.
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
