
---

<a id="adr-051"></a>
## ADR-051 — Topologia de implantação: nuvem na Railway, totem e edge-agent na academia

**Data:** 02/09/2026
**Status:** aceito *(decisão nova — **decidida pelo PI em 02/09/2026**)*
**Decisor:** Rodrigo Reis (PI)
**Contexto:** todas as issues de `admin-web` e `kiosk` fechadas; o PI pediu a spec de implantação
(`SPEC-058`) e, na mesma conversa, criou na Railway quatro serviços — `api`, `admin-web`, `kiosk`
e `edge-agent`. Dois deles não podiam existir ali, e a conversa que explicou por quê é este ADR.

**Por que é ADR e não decisão de spec:** contrato com terceiro (Railway) e escolha cara de desfazer
(onde mora o segredo do totem; onde ficam os arquivos) — o critério do `CLAUDE.md`.

### Decisão

| # | componente | onde roda | por quê |
|---|---|---|---|
| 1 | `apps/api` | **Railway**, serviço público (HTTPS), porta interna **3344** fixa | única superfície que totem e Edge alcançam de fora |
| 2 | `apps/admin-web` | **Railway**, mesmo projeto, fala com a API pela **rede privada** (`API_INTERNAL_URL`) | uma conta, uma fatura; o PI citou Vercel e decidiu Railway ao ver o projeto criado |
| 3 | Postgres, Redis | **Railway**, mesmo projeto | já eram a stack (`prd/README.md` §5) |
| 4 | Object storage | **Railway Bucket** (S3-compatível) | mesmo projeto; MinIO só em dev. R2 e S3 descartados por exigirem conta nova. Trocar é variável, não código |
| 5 | `apps/kiosk` | **PC do totem, na academia** — `next start --hostname 127.0.0.1 -p 3210` | ver *A decisão que importa* |
| 6 | `apps/edge-agent` + `EasyInnerBridge.exe` | **PC da recepção, Windows**, serviço | `EasyInner.dll` é Windows x86 (ADR-010); a catraca está na LAN. Composição é a **F59** |

### A decisão que importa: o totem NÃO vai para a nuvem

O ADR-045 aceitou a enumeração de CPF no totem **sob uma condição escrita**: a ponte HMAC
(`/api/kiosk/*`) fica em loopback, então enumerar exige estar fisicamente na frente do aparelho.
O próprio ADR diz que expor a ponte *"por reverse proxy... não é ajuste de infraestrutura: é
mudança do risco que o PI aceitou"*.

Publicar `apps/kiosk` na Railway ou na Vercel é exatamente isso: `POST /api/kiosk/sessions` na
internet, sem rate limit, devolvendo nome, plano e valor em aberto para qualquer CPF. O PI viu a
consequência e decidiu **local**. Esta decisão **preserva** o ADR-045 sem emendá-lo.

**Como o painel na nuvem controla um totem local:** não controla diretamente — controla a API. O
totem **puxa** `GET /api/v1/kiosk/config` e envia `POST .../heartbeat` pela ponte local; publicar
uma versão no painel muda a tela no próximo heartbeat (F50). Nada da nuvem entra na LAN. É o mesmo
sentido de tráfego do Edge.

### Consequências normativas

1. **O serviço `kiosk` e o serviço `edge-agent` criados na Railway em 02/09/2026 foram apagados**
   pelo PI na mesma conversa. Recriá-los reabre o ADR-045 (kiosk) ou contraria o ADR-010 (edge).
2. **A API continua em 3344.** A Railway injeta `PORT`; a solução é o *target port* do serviço,
   não a API ler `PORT`. Trocar a regra de porta é decisão registrada (`CLAUDE.md`), não ajuste.
3. **Esta implantação é PRÉ-PRODUÇÃO.** A restrição 1 do ADR-029 (*nenhuma unidade entra em
   operação real com a catraca em modo livre*) segue em vigor até o ADR-028 fechar e a F59 entrar.
   `SPEC-058` §7.3 exige que o aceite diga isso em texto.
4. **Antivírus: o dublê sobe** (`FakeMalwareScannerAdapter` é o único provider). Nenhum upload é
   escaneado em pré-produção. Risco aceito pelo PI em 02/09/2026; scanner real é card futuro, sem
   prazo fixado — **quem fixar o prazo é o PI**.
5. **Pagamento real desligado** até a F55; `FakePaymentProvider` nunca recebe CPF de aluno real.
6. **Banco de produção nasce com a base do Pacto** (F47 `CANCELLED` + F48 ativação), dentro de um
   tenant criado por bootstrap real — o seed de bancada não roda em produção.
7. **Perder `MFA_ENCRYPTION_KEY` invalida TOTP, credencial de totem e de Edge de uma vez.** Cópia
   fora da Railway, no cofre do PI, é critério de aceite da F58.

### O que este ADR não decide

- Como empacotar (Dockerfile vs. config Railway), como migrar (pre-deploy vs. job), números de
  rate limit, mecanismo de serviço Windows — **do Code**, registrado no PR.
- Domínios e DNS.
- Quando o scanner real entra — PI.

### Fatias

| fatia | spec | issue |
|---|---|---|
| F58 — Implantação: nuvem + totem local | [`SPEC-058`](specs/SPEC-058-implantacao-nuvem-e-totem-local.md) | [#253](https://github.com/RodReis/arenahub/issues/253) |
| F59 — Composição de produção do edge-agent | [`SPEC-059`](specs/SPEC-059-composicao-de-producao-do-edge-agent.md) | [#254](https://github.com/RodReis/arenahub/issues/254) |
