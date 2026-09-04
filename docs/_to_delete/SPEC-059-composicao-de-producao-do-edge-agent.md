# SPEC-059 — Composição de produção do edge-agent

| campo | valor |
|---|---|
| **Fatia** | F59 |
| **MVP** | 1 — fecha a Slice 1.4 na prática: o `main.ts` que roda na academia |
| **Slice do PRD** | não há Slice própria. O PRD assume que a F9 rodaria em produção; o que faltou é **composição**, não requisito. Escopo mora nesta spec |
| **Insumo** | [`docs/notes/composicao-do-edge-agent.md`](../notes/composicao-do-edge-agent.md) — escrito pelo Code em 15/08/2026, com as cinco perguntas ao PI já respondidas |
| **ADRs** | [ADR-010](../DECISIONS.md#adr-010) (ponte Windows), [ADR-011](../DECISIONS.md#adr-011) (ciclo de vida), [ADR-051](../DECISIONS.md#adr-051) (topologia) |
| **Superfície** | `apps/edge-agent`, `apps/edge-agent/native/easyinner-bridge`, `docs/operations/smart-access/` |
| **Card** | [#254](https://github.com/RodReis/arenahub/issues/254) |
| **Status** | `aprovada-pi` — escrita e aprovada pelo PI em 02/09/2026 |
| **Depende de** | **F58** para ter uma API pública para falar. Pode começar em simulador antes |

---

## 1. Objetivo em uma frase

O `edge-agent` que hoje só existe como bancada (`lab:run`) passa a ser **o processo que roda no
PC da recepção**: sobe como serviço Windows, se identifica na nuvem por pareamento, liga leitor e
catraca, decide pela nuvem, guarda evento na fila e reconcilia — sem ninguém abrir um terminal.

---

## 2. Pré-condições

| item | estado |
|---|---|
| Gate de entrada do MVP 1 | ✅ `GO_WITH_CONSTRAINTS` (ADR-029) |
| ADRs que bloqueiam | **nenhum para o código.** ADR-028 (`acionamento1`) bloqueia o **modo bloqueado**, que está fora daqui (§4) |
| Fatias anteriores | F1–F5 (adapters, ponte, fila, reconciliação — entregues); F8 (sync), F9 (decisão online), F11 (heartbeat/alertas) entregues na nuvem |
| Decisões do PI já tomadas | as cinco da `composicao-do-edge-agent.md` §5 (15/08/2026) — **não reabrir**; ADR-011: PC da recepção compartilhado, serviço Windows, DPAPI, rollback |

---

## 3. Decisões desta fatia

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | **Fatia própria, separada da implantação (F58)** — PI, 02/09/2026 | tudo na F58; deixar sem número | aceite diferente: F58 fecha de longe, esta só fecha na academia. Sem número a pendência ficou 18 dias invisível no board |
| 2 | **`main.ts` de produção reaproveita a composição do `lab:run`**; o `lab:run` continua existindo para bancada | reescrever a composição | *"Esta fatia é composição, não construção"* (insumo §2). Duas composições divergiriam |
| 3 | **Heartbeat vai para a nuvem** (`POST /api/v1/edge/heartbeat`, F11), não só para o log | manter só log | sem isso o alerta *Edge offline* do painel nunca dispara — e ele é obrigatório pelo ADR-011 |
| 4 | **Sem hardware real, o serviço sobe com simulador e diz isso no heartbeat** | falhar sem hardware | `M0-NFR-006`; permite instalar e homologar a nuvem antes da janela presencial |

O resto — ordem de inicialização, o que fazer quando um dispositivo não responde (falhar alto ou
degradar), nome do serviço, empacotamento — **já está decidido** nas respostas do PI de 15/08
(insumo §5) e no ADR-011. Onde o insumo e o ADR não dizem, decide o Code e registra no PR.

---

## 4. Escopo negativo

| não faz | vai para |
|---|---|
| Modo bloqueado da catraca (`ConfigurarAcionamento1`) | **ADR-028** — leitura do enum no manual, decisão do PI |
| Cache/operação offline | **F10 / ADR-012** |
| Sync físico de identidade e ciclo de vida facial no leitor real | **F2** (#2), `HW-GATE-01`, presencial |
| Detecção de órfãos via `senduser` | fatia futura, sem número (STATUS §1 linha 10) |
| Deploy da nuvem, bootstrap de tenant, totem | **F58** |
| Hardware dedicado | não — PC compartilhado é decisão do PI (ADR-011) |

---

## 5. Invariantes que esta fatia precisa preservar

- **Regra de arquitetura 3** — a nuvem decide; o Edge executa. O `main.ts` **não** contém regra de
  entitlement; chama a decisão online (F9) e aciona.
- **Regra 4 / `INV` de idempotência** — todo evento de acesso sai com `external_event_id`;
  reenvio pela reconciliação é seguro (F4).
- `M0-NFR-005` — segredo (`CLOUD_EDGE_SECRET`) nunca em log, nem mascarado; sai do DPAPI, não de
  arquivo. `descreverConfig` continua sendo o único caminho para imprimir config.
- `M0-NFR-007` — encerramento gracioso: SIGTERM drena a fila, fecha o SQLite, desconecta adapters.
  Hoje o `encerrar` tem um comentário no lugar dos três passos.
- `M0-BR-004` — `ocorridoEm` implausível preserva o original e ordena por `recebidoEm` (decisão do
  PI de 17/08).
- **Contrato Edge N e N-1** (ADR-011) — atualizar com rollback mantém o SQLite.

---

## 6. Contrato — o que passa a existir

**No agente**

- `main.ts` compõe: config (DPAPI + ambiente) → SQLite/fila → adapters (reais ou simulador,
  por `USE_SIMULATOR`) → `criarProcessadorDePassagem` → `command-poller` (F8) → heartbeat na nuvem
  a cada 30 s → encerramento gracioso.
- **Pareamento**: primeiro arranque sem credencial pede código de uso único (gerado no painel —
  a rota do lado da API é escopo desta fatia se ainda não existir; verificar `edge-auth`), troca por
  `CLOUD_EDGE_KEY_ID`/`CLOUD_EDGE_SECRET` e guarda no **Credential Manager**. Código morre no uso.
- **Serviço Windows** `ArenaHub Edge`: início automático, reinício em falha (1ª, 2ª, seguintes).
  Mecanismo (sc/nssm/node-windows) é do Code; **a ponte `EasyInnerBridge.exe` é filha do serviço**,
  não serviço separado — morrem e nascem juntas.
- **Pacote** instalável e **rollback** para a versão anterior mantendo `data/edge-agent.sqlite`
  (`M1-NFR-006`).

**Na nuvem** — só se faltar: rota de gerar código de pareamento no painel e de trocá-lo por
credencial. Se a F8/F11 já cobrem, nada muda.

**Docs** — `docs/operations/smart-access/install.md` e `upgrade-rollback.md` reescritos a partir
do que existe, e **ensaiados por pessoa diferente do autor** (Task 6 do plano da F11, nunca feita).

---

## 7. Critérios de aceite

**Em CI e bancada (fecham de longe)**

- [ ] AC-1 — `pnpm --filter @arenahub/edge-agent start` com `USE_SIMULATOR=true` sobe, envia
  heartbeat à API e o painel mostra o Edge **online** com `modo: simulador` em menos de 60 s.
- [ ] AC-2 — Sem credencial, o arranque pede pareamento; com código válido, grava no Credential
  Manager e sobe; o mesmo código usado de novo é recusado.
- [ ] AC-3 — `SIGTERM` com evento na fila: o processo só encerra depois de persistir; ao subir de
  novo, reconcilia sem duplicar (F4).
- [ ] AC-4 — Serviço Windows reinicia sozinho depois de `taskkill /F`; painel registra a lacuna
  de heartbeat e o retorno.
- [ ] AC-5 — Instalar versão N, atualizar para N+1, voltar para N: SQLite intacto, fila preservada,
  API aceita as duas versões (`MVP-01` §19).

**Na academia (fecham só presencialmente, com o PI)**

- [ ] AC-6 — `M1-AC-005`: aluno com entitlement é reconhecido, recebe `ALLOW`, passa, evento
  completo chega à nuvem com latência p50/p95/máx registradas (restrição 3 do ADR-029).
- [ ] AC-7 — `M1-AC-006`: aluno sem entitlement recebe `DENY` e o sistema **não aciona** a catraca.
  **Observação obrigatória no aceite:** com `acionamento1: 8` o braço gira livre — o que se prova
  aqui é que o comando não foi enviado, não que a pessoa não passou. `M0-AC-004` completo é o
  ADR-028, e continua sendo condição de saída do MVP 1 (restrição 2).
- [ ] AC-8 — `M1-AC-011`: desligar o PC da recepção faz o painel alertar *Edge offline*.
- [ ] AC-9 — Runbook executado por quem não o escreveu, com as lacunas anotadas no próprio arquivo.

---

## 8. Riscos e o que pode dar errado

| risco | sinal de que aconteceu | o que fazer |
|---|---|---|
| Reescrever a composição em vez de reaproveitar o `lab:run` | duas versões do mesmo fluxo; bancada e produção divergem | recusar no review; extrair função comum |
| PC da recepção desligado | catraca parada — **não é modo degradado** (ADR-011) | aviso físico na máquina; alerta do painel; liberação manual (`M1-FR-023`) |
| `ConfigurarAcionamento1(1, 5)` a cada reconexão destrava a catraca de volta (STATUS §1 linha 7) | catraca volta a girar livre depois de um restart | **não mexer aqui** — é o ADR-028. Registrar que esta fatia não altera o comportamento atual |
| Credencial em arquivo texto "por enquanto" | `.env` no PC da recepção com `CLOUD_EDGE_SECRET` | recusar; DPAPI é do ADR-011, não desta fatia |
| Instalador leva segredo | pacote circulando por e-mail com credencial | pareamento existe para isso — o pacote é inerte |

---

## 9. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Fatia própria ou dentro da F58? | **Própria** | 02/09/2026 |

As demais perguntas desta fatia foram respondidas em 15/08/2026 e vivem em
`docs/notes/composicao-do-edge-agent.md` §5. Não há pergunta em aberto.

---

## 10. Fora de dúvida

- **"Isso não era a F9?"** → a F9 entregou a decisão online na nuvem e o `orquestrar-acesso-online`
  no agente; ninguém a ligou ao `main.ts`. O STATUS registra a lacuna desde 15/08 sem número. Agora
  tem: F59.
- **"Pode rodar na Railway?"** → não. Windows x86 por causa da `EasyInner.dll` (ADR-010) e LAN da
  catraca. O serviço criado por engano na Railway em 02/09 foi apagado.
- **"Fecha antes da janela presencial?"** → AC-1 a AC-5 sim; AC-6 a AC-9 não. A issue fica
  `proplan:done` com o PR mergeado e só vira `finalizado` depois da academia.
- **"Modo bloqueado entra?"** → não. ADR-028.
