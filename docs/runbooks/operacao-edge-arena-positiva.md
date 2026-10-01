# Runbook — Operação do Edge em produção (Arena Positiva)

**Para quem:** recepção e operador técnico da Arena Positiva; Claude Code no suporte.
**Estado verificado em:** 01/10/2026, em campo (reinício do Windows incluído).
**Contexto:** [nota de campo de 01/10/2026](../field-notes/2026-10-01-implantacao-arena-positiva.md) ·
instalação do zero: [`docs/operations/smart-access/install.md`](../operations/smart-access/install.md)

---

## 1. Como está rodando

| peça | onde / como |
|---|---|
| PC da recepção | Windows, **login automático sem senha** na conta usada no pareamento |
| agente (`edge-agent`) | tarefa agendada **`ArenaHub Edge`**, disparo `ONLOGON`, **sem janela**, laço que religa em 5 s |
| repositório no PC | `C:\ArenaHub\arenahub` |
| log do agente | `C:\ArenaHub\arenahub\apps\edge-agent\data\edge-agent.log` (sem rotação — ver §6) |
| nuvem | API `arenahubapi-production.up.railway.app`, painel `arenahub.up.railway.app` (deploy automático da `main`, ~5 min) |
| leitor facial | Topdata AiFace `AYTI11108174`, disca para o PC na porta 7792 |
| catraca | Topdata EasyInner, porta 3570, sentido invertido, destravada 10 s |
| `.env` do PC (raiz do repo) | `CATRACA_INVERTIDA=true` · `CATRACA_TEMPO_LIBERADA_S=10` · `LOG_LEVEL=info` · `FACIAL_MODE=real` · `CATRACA_MODE=real` |

**Quem decide o acesso:** a **nuvem** (regra de arquitetura nº 1 — entitlement, nunca a catraca).
O agente pergunta, a nuvem responde `ALLOW`/`DENY`, o agente manda a catraca liberar e confirma o
giro. Por isso, **agente parado = catraca no modo offline**: em ~10 s ela volta a decidir sozinha
pela lista própria (libera quem estiver nela, sem consultar plano), e o que ela guardar entra como
frequência quando o agente voltar (`OFFLINE_DEVICE_DECISION`).

> ⚠️ **Não é "catraca parada".** O ADR-011 dizia que Edge fora era catraca parada; com a operação
> offline (ADR-012 emenda) a catraca continua liberando pela lista dela. A diferença é que **não há
> verificação de plano** enquanto o agente estiver fora.

## 2. Scripts de dois cliques

Em `C:\ArenaHub\arenahub\apps\edge-agent\scripts\windows\` — **nenhum comando para copiar**
(copiar pelo WhatsApp apaga `_` e `*` e inverte a ordem de blocos):

| arquivo | uso |
|---|---|
| `instalar-edge.cmd` | botão direito → **Executar como administrador**. Cria a tarefa e inicia. Já foi rodado |
| `parar-edge.cmd` | para o agente e o laço. A catraca vai ao modo offline em ~10 s |
| `ver-log-edge.cmd` | log ao vivo; fechar a janela **não** para o agente |
| `atualizar-edge.cmd` | para → `git pull` → `pnpm install` → `bridge:build` → build do agente → sobe de novo. ~2 min com a catraca offline |

Subir sem reinstalar: `schtasks /Run /TN "ArenaHub Edge"`.

## 3. Conferir que está tudo certo (30 s)

1. `ver-log-edge.cmd` — procure, nesta ordem: `catraca conectada` → `leitor facial conectou` →
   **`base do leitor vinculada`** com `prontosNaCatraca` perto de 365.
2. Passe um aluno com plano. O esperado:
   `decisao de acesso ... outcome: ALLOW ... motivo: Plano válido ... estado: PASSAGE_CONFIRMED`
   com **`latenciaDecisaoMs` maior que zero** (zero = decisão velha repetida, o defeito do #495).
3. Painel → **Eventos de acesso**: o evento aparece com o nome do aluno e **Passou**.

## 4. Quando algo não funciona

| sintoma | causa provável | o que fazer |
|---|---|---|
| a recepção vê "Edge sem resposta" | agente parado ou PC fora da rede | `ver-log-edge.cmd`; se o log não anda, `schtasks /Run /TN "ArenaHub Edge"` |
| reconhece o rosto e mostra a foto, **não libera**, e **não há linha no log** | o leitor **não mandou o registro**: intervalo de ~2 min entre registros da mesma pessoa (config do equipamento) | esperar o intervalo; **não é defeito do ArenaHub** |
| `outcome: DENY` + `motivo: Sem plano vigente, ou aluno não identificado` | o aluno **não tem plano ativo**, ou o número do leitor **não está na coluna CATRACA** de nenhum aluno | painel → Eventos de acesso: **com nome** = sem plano (cobrar/atribuir); **"não identificado"** = cadastrar o número na coluna CATRACA do aluno e reiniciar o agente |
| `ALLOW`, mas `PASSAGE_TIMED_OUT` / "Não passou" | o aluno não girou nos 10 s | aumentar `CATRACA_TEMPO_LIBERADA_S` (máx. 50) no `.env`, `bridge:build` **não** é necessário, reiniciar o agente |
| `liberacao recusada pelo equipamento — retorno 1 da DLL` logo após a partida | a catraca ainda estava conectando | raro; passar de novo após ~10 s |
| `vinculo da base do leitor nao chegou na nuvem` | nuvem fora ou lenta | o agente tenta de novo na próxima conexão do leitor (intervalo mínimo de 60 s) |
| `catraca nao respondeu ao ping` seguido de `voltou a responder` em ~5 s | a catraca redisca depois da partida | normal |
| `passagem antiga do leitor -- nao aciona a catraca` | backlog guardado enquanto o agente estava parado | normal: vira frequência, **nunca gira** |
| `Plano v├ílido` no terminal | terminal exibindo UTF-8 como CP850 | só aparência; o painel está certo |

**Parada de emergência:** `parar-edge.cmd`. A catraca volta ao modo offline e libera pela lista
própria. Para a recepção liberar à mão, use o caminho alternativo de acesso.

## 5. Cadastro de aluno novo

A catraca/leitor usa **número sequencial próprio** (a coluna CATRACA do aluno, que é o ID do
leitor), **não** é sequencial no ArenaHub. A tela de cadastro **sugere o próximo número livre**
(#475) — o ArenaHub conhece todos os números que já estão no leitor. Cadastre o aluno **primeiro no
ArenaHub**, use o número sugerido no leitor, e o vínculo é feito sozinho na próxima conexão do leitor.

## 6. Limitações conhecidas

- **Só sobe quando a conta entra no Windows.** Com o login automático isso acontece no boot; se
  alguém trocar a conta ou ativar senha, o agente não sobe até entrar. Reinício validado em
  01/10/2026.
- **Log sem rotação** (~0,3 MB/dia). Com o agente parado, apague o arquivo de vez em quando. (#499)
- **`pnpm service:install` não funciona** — não usar. (#499)
- **63 números do leitor sem aluno no ArenaHub** (ex.: 1558): o rosto é reconhecido e a entrada é
  negada. Cadastre o número em quem for aluno ativo, ou apague do leitor.
- **Aluno não identificado aparece como "Sem plano vigente"** — o motivo é o mesmo no motor
  (ADR-024); distinguir é pelo nome no evento.
- **Termo biométrico:** versão 1 publicada em Administração → Termo biométrico. Todo aluno do leitor
  entra como consentimento aceito (ADR-064).
