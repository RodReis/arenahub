# Nota de campo — a Arena Positiva operou em produção com o ArenaHub (01/10/2026)

**Data:** 30/09 a 01/10/2026 · **Local:** PC da recepção e catraca da Arena Positiva · **Autor:** Claude Code, com o PI presente
**Natureza:** nota de campo (fato verificado ao vivo) + registro das correções que o campo exigiu.

> **Fronteira deste documento.** Conta o que aconteceu, na ordem, e por que cada defeito só
> apareceu com a academia real. Não é ADR nem spec: as decisões estão em `docs/DECISIONS.md`
> (ADR-012 emenda, **ADR-064**) e os registros por entrega em `docs/DEVELOPMENT.md` §5. Como operar
> o que ficou rodando: [`docs/runbooks/operacao-edge-arena-positiva.md`](../runbooks/operacao-edge-arena-positiva.md).

## 0. Resultado

Em 01/10/2026 o ArenaHub passou a **decidir a catraca** da Arena Positiva (primeira unidade real,
MVP 1 em campo). Quatro alunos de verdade passaram seguidos, todos `ALLOW` / *Plano válido*, com
giro confirmado pelo sensor, e os eventos apareceram no painel com nome e **Passou**. O Windows foi
reiniciado e o agente subiu sozinho.

| etapa da passagem | medido |
|---|---|
| reconhecimento → decisão da nuvem | 250 a 600 ms (`latenciaDecisaoMs`) |
| liberação → giro confirmado (Origem 6) | 1,6 a 3,1 s (`duracaoPassagemMs`) |
| base do leitor vinculada a aluno | 365 de 428 números |

## 1. A cadeia de defeitos — cada um escondia o seguinte

O leitor já reconhecia o rosto desde 17/08; o que faltava era a nuvem saber **quem era** e a catraca
**obedecer**. Cada correção abaixo destravou a etapa seguinte, e o defeito seguinte só existe porque
o anterior deixou de mascará-lo.

| # | sintoma em campo | causa | correção |
|---|---|---|---|
| #467 | nenhum evento chegava ao painel | o Edge mandava o próprio `EDGE_AGENT_ID` como dispositivo; a nuvem só conhece o `sn` do leitor | `deviceSerial` na decisão |
| #476 / #477 | passagens guardadas pelo leitor giravam a catraca / eram descartadas | `sendlog` com vários registros reusava um id só; backlog tratado como pessoa na frente | id por registro; passagem antiga nunca gira e vira **frequência** (`OFFLINE_DEVICE_DECISION`) |
| #470 | a catraca decidia sozinha | sem `PingOnline` a cada < 10 s ela cai para offline e usa a lista própria | keep-alive de 5 s no agente |
| #488 | vínculo dos alunos dava **404**; 1491 negado sem identificar | leitor cadastrado há 27 dias, **antes de o Edge existir**, ficou com `edgeNodeId` nulo e nada no produto ligava os dois | o Edge que apresenta o serial de um dispositivo **sem dono da própria unidade** passa a ser o dono, com auditoria |
| #491 | `vinculados: 0`, 366 números em `semTermoBiometrico` | o consentimento legado exige termo vigente, e **nenhuma tela publicava termo** | tela Administração → Termo biométrico |
| #493 | recusa/revogação antiga barraria o vínculo | regra nº 7 | **decisão do PI: regra revogada** (ADR-064); lote do vínculo de 1.000 → 50 (428 numa chamada passou dos 15 s do cliente) |
| #495 | tudo negado com `latenciaDecisaoMs: 0` | id do reconhecimento era `logindex-posicao`, e o `logindex` **recomeça a cada conexão**: a passagem nova repetia o id de uma antiga e o Edge devolvia a decisão guardada sem consultar a nuvem | id = `serial-enrollid-hora do registro` |
| #497 | liberado, mas "Não passou" | a ponte fixava 5 s destravada (`ConfigurarAcionamento1(1, 5)`); o leitor segura a mesma pessoa ~2 min | `CATRACA_TEMPO_LIBERADA_S`, padrão 10 |
| #504 | **depois de reiniciar o Windows**: rosto reconhecido, catraca parada, nada no painel, Edge "Respondendo" | o `TopFaceService` (software da Topdata, serviço do Windows) **escuta a mesma porta 7792** e, subindo no boot antes do login, ficou com o leitor; o agente esperava calado, e o heartbeat seguia informando o leitor como ativo | TopFace parado e desativado no PC (runbook §7, com a reversão); o agente avisa no log quando o leitor não chega em 2 min e para de informá-lo no heartbeat, o que dispara `DEVICE_OFFLINE` no painel |

**Lição que atravessa os nove defeitos:** nenhum deles aparece em simulador. Quatro dependiam de
**ordem de criação no mundo real** (leitor cadastrado antes do Edge), de **reinício do equipamento**
(`logindex`) e de **tempo físico** (5 s). O E2E verde não os cobria porque o dado de teste nascia já
na ordem certa — mesma família do buraco do #404.

## 2. O que não era defeito (e custou tempo diagnosticar)

- **"Reconhece mas não libera" na segunda tentativa** — o leitor tem um **intervalo de ~2 min** entre
  registros da mesma pessoa (configuração do equipamento). A tentativa não gera `sendlog`, então não
  há linha de log nem evento: não chega ao agente.
- **`Plano v├ílido` no terminal** — Git Bash exibindo UTF-8 como CP850. O valor gravado e o painel
  estão corretos.
- **Filtro De/Até de Eventos de acesso "vazio"** — a tela lia a hora no fuso do servidor (UTC) e
  deslocava o período em 3 h. Corrigido junto do #495 (`instanteNoFuso`).
- **`NO_ENTITLEMENT` para quem não foi identificado** — o motor devolve o mesmo motivo para "sem
  plano" e "número do leitor sem aluno"; o detalhe fica em `identityResolution`. Motivo próprio
  exige valor novo no enum (ADR-024) — **não feito**.

## 3. Como a Arena Positiva ficou rodando

Resumo — o procedimento completo está no runbook de operação.

- Agente = **tarefa agendada** `ArenaHub Edge` (criada pelo `instalar-edge.cmd`, rodado pelo PI antes do reinício), disparo `ONLOGON`, sem janela, sob a conta Windows do
  pareamento (a credencial é cifrada com DPAPI para essa conta). O PC faz login automático sem senha.
- O **serviço Windows** (`pnpm service:install`) **não funciona**: registra `node.exe` direto, que
  não responde ao Service Control Manager (erro 1053), e exige senha da conta. Issue **#499**,
  baixa prioridade — a tarefa agendada cobre o reinício.
- Comandos de PowerShell copiados pelo WhatsApp **perderam `_` e `*` e colaram em ordem inversa**
  (um `/Run` rodou antes do `/Create`). Por isso os procedimentos viraram **arquivos `.cmd`
  versionados** (`apps/edge-agent/scripts/windows/`), de dois cliques.

## 4. Pendente

| item | situação |
|---|---|
| 63 números do leitor sem aluno no ArenaHub (ex.: 1558) | negação correta; recepção cadastra o número na coluna CATRACA de quem for ativo, ou apaga do leitor |
| motivo próprio para "aluno não identificado" | não feito (enum, ADR-024) |
| partida do agente: leitor despeja o reconhecimento antes de a catraca conectar → `retorno 1 da DLL` | raro; só na partida |
| rotação do log do agente (~0,3 MB/dia) e limpeza do `install-service.ps1` | #499 |
