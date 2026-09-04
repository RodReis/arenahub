# SPEC-058 — Implantação: API e painel na Railway, totem local, pré-produção

| campo | valor |
|---|---|
| **Fatia** | F58 |
| **MVP** | 1 *(posição na fila)* — é o passo 3 do `MVP-01` §19 (*unidade piloto em modo observação*), com as restrições do ADR-029 |
| **Slice do PRD** | não há. Escopo mora nesta spec (regra reaberta em 23/08/2026) |
| **ADR** | [ADR-051](../DECISIONS.md#adr-051) — topologia de implantação |
| **Superfícies** | `apps/api`, `apps/admin-web` (nuvem) · `apps/kiosk` (local) · `infra/`, `.github/` |
| **Card** | [#253](https://github.com/RodReis/arenahub/issues/253) |
| **Status** | `aprovada-pi` — escrita e aprovada pelo PI em 02/09/2026 |
| **Depende de** | nada para começar. **F59** ([`SPEC-059`](SPEC-059-composicao-de-producao-do-edge-agent.md)) para a catraca entrar; **ADR-028** para a operação ser real |

---

## 1. Objetivo em uma frase

A academia abre o painel num endereço público, o totem da recepção mostra a tela pública e a
área do aluno lendo da nuvem, e os dados reais do Pacto estão no banco — **sem que a catraca
dependa disso ainda**: esta fatia é pré-produção, e o §7 diz o que "implantado" significa e o
que não significa.

---

## 2. Pré-condições

| item | estado |
|---|---|
| Gate de entrada do MVP 1 | ✅ atendido — `GO_WITH_CONSTRAINTS` (ADR-029) |
| ADRs que bloqueiam | **nenhum**. ADR-051 registra a topologia; ADR-028 (`acionamento1`) **não bloqueia esta fatia** — bloqueia a operação real (§7.3) |
| Fatias anteriores | todas as de `admin-web` e `kiosk` entregues (F6–F9, F11–F22, F30–F39, F41, F42, F44–F57). Verificado no board em 02/09/2026: as nove issues abertas são F2, F10, F23–F26, F29, F43 e F55 |
| Decisões dos PRDs | `M1-NFR-006` (rollback do Edge) e `MVP-01` §19 passos 1–3; §20 itens *backup e restauração* e *alertas e contatos* entram aqui |

---

## 3. Decisões desta fatia — 02/09/2026, PI

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | **Nuvem inteira na Railway**: API, painel, Postgres, Redis, Bucket num projeto só | painel na Vercel | uma conta, uma fatura; o painel fala com a API pela rede privada da Railway (`API_INTERNAL_URL`) e não precisa de URL pública para isso. O PI chegou a citar Vercel e decidiu Railway ao ver o projeto criado |
| 2 | **Totem roda LOCAL, no PC do totem** — `next start --hostname 127.0.0.1 -p 3210` | `apps/kiosk` na Railway/Vercel | a ponte HMAC em loopback é a **condição** do risco aceito no ADR-045. Na nuvem, `POST /api/kiosk/sessions` fica na internet sem rate limit: qualquer pessoa com um CPF recebe nome, plano e valor em aberto. Publicar o kiosk reabriria o ADR-045 |
| 3 | **`edge-agent` não é serviço de nuvem** — sai do projeto Railway | criar serviço `edge-agent` na Railway (foi criado e será apagado) | precisa de Windows x86 (`EasyInner.dll`, ADR-010) e de estar na LAN da catraca. Composição de produção é a **F59** |
| 4 | **Storage de produção: Railway Bucket** (S3-compatível) | Cloudflare R2, AWS S3 | mesmo projeto, sem conta nova. `STORAGE_*` já são variáveis; MinIO segue só em dev |
| 5 | **Antivírus: sobe com o dublê** (`FakeMalwareScannerAdapter`), risco registrado | scanner real antes de subir; bloquear upload por flag | atrasaria a implantação por um módulo (laudos) que a recepção usa pouco. **Nenhum arquivo enviado é escaneado** enquanto isso valer — ver §8 e o card futuro |
| 6 | **Banco de produção nasce com a base do Pacto**: F47 (import como `CANCELLED`) + F48 (ativação dos ~340) | banco vazio + cadastro manual; só os ativos | o objetivo declarado da importação (ADR-033) é histórico + reativação rápida; sem ele a recepção recadastra quem já existe |
| 7 | **Migração de banco roda como passo de deploy**, antes do processo novo receber tráfego | migrar no arranque da API; migrar à mão | migrar no arranque com duas réplicas corre a mesma migration duas vezes; à mão vira passo esquecido. Como (pre-deploy command da Railway, job, script) é do Code |
| 8 | **Esta implantação é PRÉ-PRODUÇÃO por definição** — ver §7.3 | chamar de produção | restrição 1 do ADR-029: *nenhuma unidade entra em operação real com a catraca em modo livre*. A catraca continua em `acionamento1: 8` até o ADR-028 fechar |

Decisões 1–4 e 8 estão no **ADR-051**; a spec só aponta.

---

## 4. Escopo negativo

| não faz | vai para |
|---|---|
| Ligar adapters, fila e reconciliação ao `main.ts` do edge-agent; serviço Windows; pareamento; DPAPI; instalador | **F59 / SPEC-059** |
| Modo bloqueado da catraca (`acionamento1`) | **ADR-028** — decisão do PI com o manual em mãos |
| Sync físico de identidade facial (`M1-AC-004`) e ciclo de vida facial | **F2** (#2) e F8 etapa 2 — `HW-GATE-01`, presencial |
| Operação offline do Edge | **F10 / ADR-012** |
| Adapters reais Sicoob e Getnet — pagamento com dinheiro real | **F55** (#158), presa em credencial e mTLS. Em pré-produção o `FakePaymentProvider` **não** pode estar ativo com aluno real: pagamento fica **desligado** no totem e no balcão até a F55 (ver §7.2) |
| Scanner de malware real | card futuro `[MVP3][FIX]` ou fatia, a critério do PI. Registrado no ADR-051 |
| Rate limit em `/auth/login` e nas rotas do kiosk | **fica dentro desta fatia** para o login público (§6); para o kiosk não é necessário enquanto a ponte estiver em loopback (ADR-045) |
| App mobile | MVP 4 |
| Observabilidade além de log estruturado + alerta de Edge/totem offline | fatia futura; `infra/observability` continua vazia até lá |

---

## 5. Invariantes que esta fatia precisa preservar

Deploy não cria regra de domínio, mas tem três invariantes que ele **pode quebrar por
configuração**, e cada uma tem verificação no §7:

- `INV-001`–`INV-008` (tenant) — o import do Pacto roda **dentro de um tenant** criado antes, nunca
  com `tenant_id` inventado. O bootstrap do tenant real é passo desta fatia (§6).
- **Segredo nunca no Git nem no bundle** (`prd/README.md` §5 linha 146; ADR-045) — `KIOSK_SECRET`
  só no PC do totem; `JWT_*`, `MFA_ENCRYPTION_KEY`, `STORAGE_*` só nas variáveis da Railway.
  `MEDIA_FETCHER_FAKE` **nunca** ligado em produção (o totem serviria vídeo falso).
- **Contrato Edge N e N-1** (`MVP-01` §19, ADR-011) — a nuvem sobe antes do Edge e não remove
  campo que o Edge N-1 envia. Vale desde o primeiro deploy, porque o `lab:run` da bancada já fala
  com a API.

---

## 6. Contrato — o que muda no repositório

**Nada muda no domínio nem na API pública.** Muda como o sistema é empacotado, configurado e
ligado. Lista do que **precisa existir**; *como* é do Code (`CLAUDE.md`, *O que pode bloquear*).

**Empacotamento (`infra/`, raiz, `.github/`)**

- Build reproduzível de `apps/api` e `apps/admin-web` a partir do monorepo pnpm (Dockerfile ou
  config da Railway — o Code escolhe). `prisma generate` faz parte do build. `yt-dlp` entra na
  imagem da API (ADR-042 Decisão 7); sem ele a rota responde `503 EXTRATOR_INDISPONIVEL`, que é
  degradação aceitável mas não pode ser o estado permanente.
- A API escuta em **3344 fixa** (`CLAUDE.md`). A Railway injeta `PORT`; a solução é apontar o
  target port do serviço para 3344, **não** fazer a API ler `PORT` — trocar a regra de porta é
  decisão registrada, não ajuste.
- Node 22 LTS (`engines` do `package.json`).

**Configuração — obrigatória em produção, e a API já derruba o arranque sem elas**

| variável | quem lê | origem em produção |
|---|---|---|
| `NODE_ENV=production` | API, painel | Railway |
| `DATABASE_URL` | API, migrations | Postgres da Railway |
| `REDIS_URL` | API (device-sync, desafios, gate Anthropic) | Redis da Railway. O padrão `127.0.0.1` **não** falha em produção hoje — o Code deve fazê-lo falhar, mesma regra do storage |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | API | gerados uma vez, guardados só na Railway |
| `MFA_ENCRYPTION_KEY` | API | idem. **Perder esta chave invalida TOTP de todo usuário e a credencial de todo totem e Edge** — guardar cópia fora da Railway, no cofre do PI |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | API | Railway Bucket |
| `API_INTERNAL_URL` | painel | URL privada da API na rede da Railway |
| `ANTHROPIC_API_KEY` | API | opcional; sem ela o módulo de saúde usa o dublê e loga aviso |
| `YTDLP_BIN` | API | caminho na imagem, se não estiver no `PATH` |

Totem (PC local): `API_INTERNAL_URL` = URL **pública** da API (HTTPS), `KIOSK_KEY_ID` e
`KIOSK_SECRET` gerados pelo painel (F50, `POST /admin/kiosk-devices`), `NODE_ENV=production`.

**Banco**

- Migrations aplicadas por `prisma migrate deploy` como passo de deploy (Decisão 7).
- **Bootstrap do tenant real**: comando idempotente que cria `Tenant`, `GymUnit` (com timezone) e o
  primeiro usuário `OWNER` a partir de argumentos/variáveis — **nunca** do seed, que cria
  `dono@arena-positiva.test` com senha de bancada. Hoje esse comando **não existe**; é a única
  peça de código nova desta fatia além do empacotamento. Senha inicial gerada e exibida uma vez;
  MFA obrigatório no primeiro login já é comportamento da F6.
- Carga: `import-pacto.ts` (F47) e `seed-ativos.ts` (F48) contra o banco de produção, com o tenant
  do bootstrap. **Os dois scripts hoje leem `DATABASE_URL` do `.env` da raiz** — rodar contra
  produção exige que aceitem a URL por ambiente sem tocar no `.env` de dev, e que recusem rodar
  duas vezes (idempotência por `legacyExternalId`, ADR-033).
- **Backup automático do Postgres ligado e restauração demonstrada uma vez** em banco vazio,
  com evidência (`MVP-01` §20). Sem isso a fatia não fecha.

**Segurança mínima que a nuvem pública exige e hoje não existe**

- Rate limit em `POST /api/v1/auth/login` (e `/auth/mfa`, se separado). Sem isso o painel
  público aceita força bruta ilimitada. Números são do Code.
- Cookies do painel já saem `secure` + `sameSite: strict` com `NODE_ENV=production` — verificar,
  não reimplementar.
- CORS: a API **não** é chamada pelo navegador (painel e totem falam com ela pelo servidor). Não
  abrir CORS "por precaução".

**Operação**

- Log estruturado (JSON) na API — hoje é `console.log`. O `edge-agent` já usa `pino`; a API
  segue o mesmo formato. Sem Sentry nesta fatia.
- Alerta de **Edge offline** e **totem offline** já existe na F11 (`/operations`); a fatia só
  confirma que ele dispara com o totem real desligado.
- Runbook **[`docs/runbooks/implantacao-pre-producao.md`](../runbooks/implantacao-pre-producao.md)**
  — escrito pelo Cowork em 02/09/2026 a pedido do PI, com os passos que dependem de código da F58
  marcados ⚙️. O Code **atualiza esse arquivo** conforme fixa empacotamento, migração e autostart;
  não cria um segundo. O de Edge continua em `docs/operations/smart-access/install.md` e é
  **reescrito na F59**, quando o instalador existir.
- **`apps/kiosk` `start` não fixa a porta** (`next start --hostname 127.0.0.1`, sem `-p 3210`): em
  produção sobe em 3000 calado — a colisão silenciosa que a issue #212 proibiu. Fixar `-p 3210`.
- Health: `GET /health/live` e `GET /health/ready` já existem; a Railway usa `/health/ready`
  como healthcheck do serviço.

---

## 7. Critérios de aceite

### 7.1 Nuvem

- [ ] AC-1 — Push na `main` com CI verde produz deploy da API e do painel; `GET /health/ready`
  responde `200` com banco e Redis verdes; `GET /version` mostra o SHA do commit.
- [ ] AC-2 — API sem `JWT_*`, `MFA_ENCRYPTION_KEY`, `STORAGE_*` **ou `REDIS_URL`** não sobe, e o
  log diz qual falta. (Hoje `REDIS_URL` passa em silêncio — é o que a fatia corrige.)
- [ ] AC-3 — Migration nova entra pelo passo de deploy e o processo antigo continua servindo até
  o novo ficar pronto. Evidência: deploy de uma migration real com `select count(*)` antes e depois.
- [ ] AC-4 — Bootstrap cria tenant, unidade e `OWNER` real; login no painel público exige MFA no
  primeiro acesso; **nenhum** usuário `*.test` existe no banco de produção.
- [ ] AC-5 — Base do Pacto carregada: contagem de `CANCELLED` e de `ACTIVE` bate com o relatório
  da F47/F48; rodar o import de novo **não** duplica ninguém.
- [ ] AC-6 — Upload de foto de cadastro e de laudo grava no Railway Bucket e a URL pré-assinada
  expira no TTL configurado.
- [ ] AC-7 — Dez tentativas de login erradas em sequência no endereço público recebem `429`
  antes da décima primeira.
- [ ] AC-8 — Backup do Postgres restaurado num banco vazio; painel aberto contra a cópia mostra
  os mesmos alunos. Evidência anexada à issue.
- [ ] AC-9 — Log da API em JSON, com `correlationId`, **sem** CPF, token ou template biométrico
  em nenhuma linha de erro (busca por regex nos logs de um dia de uso).

### 7.2 Totem local

- [ ] AC-10 — Totem no PC da recepção mostra a tela pública configurada no painel; publicar uma
  versão nova no painel muda a tela no próximo heartbeat, sem ninguém tocar no PC.
- [ ] AC-11 — `netstat` no PC do totem mostra a porta 3210 **só em 127.0.0.1**. De outro host da
  LAN, `POST http://<ip-do-totem>:3210/api/kiosk/sessions` **não conecta**. (Condição do ADR-045.)
- [ ] AC-12 — Área do aluno funciona com CPF real da base importada; pagamento aparece
  **desabilitado** com mensagem neutra enquanto a F55 não entregar adapter real — nunca com o
  `FakePaymentProvider` recebendo CPF de aluno de verdade.
- [ ] AC-13 — Desligar a internet do totem: a tela mostra estado de indisponibilidade neutro e o
  painel marca o totem **offline** dentro de dois heartbeats.
- [ ] AC-14 — Reiniciar o PC do totem sobe a tela sozinho, sem login nem clique.

### 7.3 O que "implantado" NÃO afirma — e fica escrito na issue

- [ ] AC-15 — A issue de fechamento carrega, em texto, as três frases: *(a)* a catraca **não** é
  controlada por esta implantação (F59 + ADR-028 pendentes, restrição 1 do ADR-029); *(b)* pagamento
  real está **desligado** (F55); *(c)* nenhum upload é escaneado (Decisão 5). Aceite sem essas
  três linhas é o *aceite narrado* que o ADR-016 proíbe.

---

## 8. Riscos e o que pode dar errado

| risco | sinal de que aconteceu | o que fazer |
|---|---|---|
| Alguém "resolve" a porta 3344 lendo `PORT` para agradar a Railway | API sobe em porta aleatória; o `check-port` de dev perde sentido | reverter; target port no serviço |
| Alguém tira o totem do loopback para diagnosticar de outra máquina | AC-11 falha | reverter na hora; **reabre o ADR-045** |
| `MFA_ENCRYPTION_KEY` rotacionada ou perdida | todo TOTP e toda credencial de totem/Edge voltam `401` de uma vez | restaurar a cópia do cofre; se perdida, reprovisionar totens e refazer MFA de todos — por isso a cópia fora da Railway é aceite, não sugestão |
| Import do Pacto rodado contra o `.env` de dev por engano, ou duas vezes | alunos duplicados; dev com dado real | scripts só aceitam URL explícita por ambiente e recusam repetição (§6) |
| Dublê de antivírus em produção por meses | ninguém percebe — é o ponto | card futuro com prazo dado pelo PI; a issue desta fatia lembra |
| Dublê de pagamento acessível a aluno real | aluno "paga" e nada acontece; ou pior, entitlement restaurado sem dinheiro | AC-12; pagamento desligado por configuração de tenant até a F55 |
| Instagram sem `yt-dlp` na imagem | `503 EXTRATOR_INDISPONIVEL` permanente; painel só oferece MP4 | incluir na imagem; não é opcional em produção |
| Railway Bucket menos maduro que S3 | falha em pré-assinatura ou `ListObjects` | o contrato é S3; trocar de bucket é variável, não código — foi por isso que a decisão coube num ADR pequeno |

---

## 9. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Totem na nuvem ou local? | **Local**, no PC do totem, ponte em loopback | 02/09/2026 |
| 2 | Painel na Vercel ou Railway? | **Railway**, tudo num projeto | 02/09/2026 |
| 3 | Composição do edge-agent entra aqui ou em fatia própria? | **Fatia própria — F59** | 02/09/2026 |
| 4 | Storage de produção? | **Railway Bucket** | 02/09/2026 |
| 5 | Antivírus: dublê, real ou bloquear upload? | **Aceitar o dublê**, risco registrado | 02/09/2026 |
| 6 | O que entra no banco no primeiro deploy? | **Base do Pacto** (F47 + F48) | 02/09/2026 |

---

## 10. Fora de dúvida

- **"Quem controla o totem se o painel está na nuvem?"** → a API. O totem **puxa** `GET
  /api/v1/kiosk/config` e manda `POST .../heartbeat` pela ponte local; o painel grava na API e
  nunca fala com o totem. Nada da nuvem entra na LAN da academia. Está assim desde a F50.
- **"Por que não Vercel, que é Next nativo?"** → uma conta e rede privada entre painel e API. O
  PI decidiu ao ver o projeto Railway já criado. Reabrir só se a Railway falhar no build do Next 16.
- **"Por que o edge-agent apareceu como serviço na Railway?"** → foi criado por engano em
  02/09/2026 e será apagado. Não existe cenário em que ele rode fora da academia (ADR-010, ADR-011).
- **"Isso é produção?"** → **Não.** É o passo 3 do `MVP-01` §19: piloto em observação, sem comandar
  catraca. Produção exige F59 entregue, ADR-028 fechado e `M0-AC-004` provado (restrições 1 e 2 do
  ADR-029).
- **"E se a internet da academia cair?"** → o totem cai junto — não há offline no kiosk, e o
  ADR-012 é sobre o Edge. O painel fica acessível de qualquer lugar. A catraca, quando a F59 entrar,
  segue o ADR-012 (sem cache até o piloto medir incidente).
