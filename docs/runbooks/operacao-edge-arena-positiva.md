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
| log do agente | `C:\ArenaHub\arenahub\apps\edge-agent\data\edge-agent.log` (rotaciona na partida do agente — ver §6) |
| nuvem | API `arenahubapi-production.up.railway.app`, painel `arenahub.up.railway.app` (deploy automático da `main`, ~5 min) |
| leitor facial | Topdata AiFace `AYTI11108174`, disca para o PC na porta 7792 |
| **TopFace** (software da Topdata) | serviço `TopFaceService` **parado e desativado** desde 01/10/2026 — ele escuta a mesma porta 7792 e roubava o leitor do agente a cada boot (#504). Ver §7 |
| catraca | Topdata EasyInner (Inner Fit), **serial 247000797**, firmware 7.05.00, IP **192.168.2.187 por DHCP**, disca para o PC (192.168.2.106) na porta 3570. Configuração de acesso: Leitor 1 **entrada e saída invertido**, Acionamento 1 **giro de saída liberado**, tempo de acionamento **10** — gravada na página da catraca, **perdida se ela for desligada da tomada** (§8) |
| rede | leitor e catraca apontam para o IP **192.168.2.106** do PC. Se o roteador der outro IP ao PC, os dois param de falar com o agente — **reservar 192.168.2.106 para o PC no roteador** (e 192.168.2.187 para a catraca) |
| `.env` do PC (raiz do repo) | `CATRACA_INVERTIDA=true` · `CATRACA_TEMPO_LIBERADA_S=10` · `CATRACA_SERIAL=247000797` (#522) · `CATRACA_LEITOR1=4` `CATRACA_LEITOR2=0` `CATRACA_ACIONAMENTO1=6` (só depois de validado na bancada — §8, #507) · `LOG_LEVEL=info` · `FACIAL_MODE=real` · `CATRACA_MODE=real` |

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
   `leitor registrado` → **`base do leitor vinculada`** com `prontosNaCatraca` perto de 365.
   Para conferir quem está com o leitor: `netstat -ano | findstr 7792` — a linha `ESTABLISHED`
   tem de terminar no PID do `node.exe` (`tasklist /fi "pid eq NNNN"`).
2. Passe um aluno com plano. O esperado:
   `decisao de acesso ... outcome: ALLOW ... motivo: Plano válido ... estado: PASSAGE_CONFIRMED`
   com **`latenciaDecisaoMs` maior que zero** (zero = decisão velha repetida, o defeito do #495).
3. Painel → **Eventos de acesso**: o evento aparece com o nome do aluno e **Passou**.

## 4. Quando algo não funciona

| sintoma | causa provável | o que fazer |
|---|---|---|
| a recepção vê "Edge sem resposta" | agente parado ou PC fora da rede | `ver-log-edge.cmd`; se o log não anda, `schtasks /Run /TN "ArenaHub Edge"` |
| reconhece o rosto, **não libera**, nada no painel, e o log **nunca mostrou `leitor facial conectou`** desde a partida (ou mostra `leitor facial nao esta conectado ao agente`) | **outro programa está com o leitor** — em 01/10/2026 foi o `TopFace.exe` (serviço `TopFaceService`), que sobe no boot antes do agente e escuta a mesma porta 7792 | `netstat -ano | findstr 7792` → PID da linha `ESTABLISHED` → `tasklist /svc /fi "pid eq NNNN"`. Se for o TopFace: §7. Se não for nada: reiniciar o leitor na tomada e conferir nele o IP do PC |
| reconhece o rosto e mostra a foto, **não libera**, e **não há linha no log**, com o leitor conectado | o leitor **não mandou o registro**: intervalo de ~2 min entre registros da mesma pessoa (config do equipamento) | esperar o intervalo; **não é defeito do ArenaHub** |
| `outcome: DENY` + `motivo: Sem plano vigente, ou aluno não identificado` | o aluno **não tem plano ativo**, ou o número do leitor **não está na coluna CATRACA** de nenhum aluno | painel → Eventos de acesso: **com nome** = sem plano (cobrar/atribuir); **"não identificado"** = vincular o número ao aluno (lista de alunos → "Número da catraca" → "Do leitor", §5); com o número já no leitor o vínculo é imediato, sem reiniciar o agente |
| `ALLOW`, mas `PASSAGE_TIMED_OUT` / "Não passou", com `duracaoPassagemMs` perto de 5000 | a catraca está com o **tempo de acionamento** gravado nela (5 s de fábrica). O `CATRACA_TEMPO_LIBERADA_S` do `.env` **só chega ao equipamento** com `CATRACA_LEITOR1/LEITOR2/ACIONAMENTO1` definidos (#507) | trocar **Tempo de acionamento 1** na página da catraca (§8), ou definir as três variáveis (§8) |
| **entrada livre e saída travada**, ou rosto liberado (verdinho) mas a catraca não deixa passar | a catraca foi **desligada da tomada** e voltou com a configuração de fábrica | §8 |
| painel → Operação: **"Esta catraca não está liberando acesso"** | a catraca parou de responder ao agente por mais de 90 s (#522). Antes deste ajuste o alerta era permanente e falso | energia e cabo da catraca; `ver-log-edge.cmd` (`catraca nao respondeu ao ping`); se ela voltou desconfigurada, §8 |
| `liberacao recusada pelo equipamento — retorno 1 da DLL` logo após a partida | a catraca ainda estava conectando | raro; passar de novo após ~10 s |
| `vinculo da base do leitor nao chegou na nuvem` | nuvem fora ou lenta | o agente tenta de novo na próxima conexão do leitor (intervalo mínimo de 60 s) |
| `catraca nao respondeu ao ping` seguido de `voltou a responder` em ~5 s | a catraca redisca depois da partida | normal |
| `passagem antiga do leitor -- nao aciona a catraca` | backlog guardado enquanto o agente estava parado | normal: vira frequência, **nunca gira** |
| `Plano v├ílido` no terminal | terminal exibindo UTF-8 como CP850 | só aparência; o painel está certo |

**Parada de emergência:** `parar-edge.cmd`. A catraca volta ao modo offline e libera pela lista
própria. Para a recepção liberar à mão, use o caminho alternativo de acesso.

## 5. Cadastro de aluno novo

O número que o leitor facial reconhece (o "número da catraca", 12 dígitos) é **gerado pelo ArenaHub**
(não é sequencial do leitor). Nunca é preciso reiniciar o agente para vincular:

- número gravado no painel que o leitor **já tem** (aluno legado, aba "Do leitor") → o vínculo é
  **imediato**, no momento em que o número é salvo;
- aluno **novo** → o vínculo nasce quando o leitor informa a face nova, normalmente **alguns
  segundos** depois do cadastro no leitor.

**Aluno novo**

1. Cadastre o aluno no painel. Na ficha (aba Plano → "Número da catraca") o número aparece **em
   destaque**, em blocos de 3 dígitos, com o botão "Copiar número".
2. **Cadastre a face no leitor com esse número** (é o número que a recepção digita no teclado do
   leitor com o aluno na frente).
3. Plano → cobrança → pagamento. O acesso só libera com o direito ativo (o número sozinho não abre
   a catraca).

**Aluno que já tem rosto no leitor (caso legado)**

Lista de alunos → ação da linha **"Número da catraca"** (ícone de chave) → aba **"Do leitor"** →
escolha o número pelo **nome guardado no leitor** (há busca por número ou nome) → "Usar este número".
O vínculo é feito na hora. Se o leitor não informar o nome, a lista mostra **só o número** — nesse
caso confirme com quem cadastrou a face, ou peça ao aluno para passar no leitor e veja qual registro é
o dele. **Nunca escolha um número que você não consegue ligar a uma pessoa.**

A aba "Gerar novo" tem o botão **"Mostrar ou gerar número"**: ele **mostra** o número que o aluno já
tem. Não cria outro quando o aluno já tem número facial ou já está vinculado no leitor; só gera um
número novo quando não há nenhum dos dois.

**Segurança:** um número que ainda pertence a um aluno — mesmo que o número dele no painel tenha sido
trocado — **não aparece** em "Do leitor" e é **recusado** pelo sistema (409). Se a tela disser "Este número
já está vinculado a outro aluno", **não insista**: cadastre a face com outro número.

**Confirmar na bancada** (leitor AYTI11108174): a leitura do nome guardado no leitor (`getuserinfo`)
ainda **não foi verificada** nesse equipamento. Conferir, após a primeira conexão do leitor com o
agente novo: (a) o log não traz `getuserinfo sem nome`; (b) a aba "Do leitor" mostra nomes ao lado dos
números sem aluno. Se não mostrar, a função degrada para "só o número" — avise o desenvolvimento com a
linha do log (ela traz só os nomes dos campos).

## 5.1 Fotos dos alunos vindas do leitor (#503)

Depois de `base do leitor vinculada`, o agente importa a foto de cadastro do leitor para quem está
vinculado **e ainda não tem foto** no ArenaHub (aluno, professor ou funcionário). No log:

- `importando fotos do leitor` com `pendentes` — começou; uma foto por segundo, então ~365 fotos
  levam ~10 min. O leitor continua reconhecendo durante a importação (pausa de fração de segundo por
  foto).
- `fotos do leitor importadas` com `importadas`, `jaTinhamFoto`, `semFotoNoLeitor`, `falhas` —
  terminou. Com `falhas` maior que zero, tenta de novo na próxima conexão do leitor, só para quem
  continua sem foto.
- `getuserinfo sem foto no record` — o firmware mandou a foto em outro campo: avise o
  desenvolvimento com a linha (ela traz só os nomes dos campos).

A foto **não sobrescreve** a que a recepção já enviou pela ficha. Aparece no avatar da lista de
alunos. Cadastro novo feito no leitor ganha foto no próximo reinício do agente.

## 6. Limitações conhecidas

- **Só sobe quando a conta entra no Windows.** Com o login automático isso acontece no boot; se
  alguém trocar a conta ou ativar senha, o agente não sobe até entrar. Reinício validado em
  01/10/2026.
- **Rotação do log só na partida do agente.** Passou de 5 MB quando o agente (re)inicia, o log vira
  `edge-agent.log.old` (só um `.old` é guardado, o anterior é sobrescrito). Com o agente rodando
  direto por meses, o arquivo cresce (~0,3 MB/dia) até a próxima partida. (#499)
- **Não existe serviço do Windows.** O agente é só a tarefa agendada; `service:install` foi removido. (#499)
- **63 números do leitor sem aluno no ArenaHub** (ex.: 1558): o rosto é reconhecido e a entrada é
  negada. Vincule o número em quem for aluno ativo (lista de alunos → "Número da catraca" → "Do leitor", §5), ou apague do leitor.
- **Aluno não identificado aparece como "Sem plano vigente"** — o motivo é o mesmo no motor
  (ADR-024); distinguir é pelo nome no evento.
- **Termo biométrico:** versão 1 publicada em Administração → Termo biométrico. Todo aluno do leitor
  entra como consentimento aceito (ADR-064).

## 7. TopFace — desativado, e como voltar

**O que é:** o `TopFace.exe` é o software de gerenciamento da Topdata, instalado no PC junto com o
leitor (era o que o sistema anterior usava). Roda como **serviço do Windows** (`TopFaceService`),
sobe **no boot, antes do login** — e escuta a **mesma porta 7792** do agente. Os dois ficam
escutando; o leitor conecta em quem atender primeiro. Depois de um reinício, quem atende primeiro é
sempre o TopFace: o rosto é reconhecido no leitor, mas nada chega ao ArenaHub, a catraca não libera e
o painel não registra (#504, 01/10/2026).

**O que foi feito em 01/10/2026** (PowerShell de administrador):

```
sc.exe stop TopFaceService
sc.exe config TopFaceService start= disabled
```

Conferido: `netstat -ano | findstr 7792` passou a mostrar a conexão do leitor no `node.exe`.

**Sem o TopFace, o que muda:** nada na operação do ArenaHub. Cadastro facial continua no próprio
leitor (o ArenaHub recebe o número sozinho pelo `senduser`, #468) ou pelo painel do ArenaHub.

**Para voltar ao que estava** (por exemplo, para usar o TopFace numa manutenção). Atenção: com o
TopFace rodando, **o ArenaHub perde o leitor** — o agente só pega de volta depois de parar o TopFace
e reiniciar o leitor.

```
sc.exe config TopFaceService start= auto
```
```
sc.exe start TopFaceService
```

E para devolver o leitor ao ArenaHub depois da manutenção: `sc.exe stop TopFaceService`,
`sc.exe config TopFaceService start= disabled`, reiniciar o leitor na tomada, conferir com
`netstat -ano | findstr 7792`.

> Use `sc.exe`, não `sc`: no PowerShell `sc` é outro comando (`Set-Content`). O espaço depois
> de `start=` é obrigatório.

## 8. Catraca desconfigurada depois de desligar da tomada

**Sintoma:** depois de uma queda de energia (ou de desligarem a catraca), a **entrada fica livre e a
saída travada**; o rosto é reconhecido e acende o verde, mas o giro certo não destrava.

**Causa:** a configuração de acesso é gravada **na catraca**, e ela volta de fábrica quando perde
energia. Quem regravava a cada conexão era o TopFace (desativado, §7). O ArenaHub passou a poder
gravar (#507), **mas só se o `.env` do PC tiver `CATRACA_LEITOR1=4`, `CATRACA_LEITOR2=0` e
`CATRACA_ACIONAMENTO1=6`** — sem as três, o agente não grava nada. Achado em 02/10/2026.

**Gravação pelo agente (opt-in, #507):** com as três variáveis, o agente grava o modo de acesso
(com o tempo de `CATRACA_TEMPO_LIBERADA_S`) assim que a catraca disca, e de novo quando o ping volta
depois de cair. No log: `configuracao de acesso gravada na catraca`. ⚠️ **Ainda não validado no
equipamento**: o `EnviarConfiguracoes` grava o bloco inteiro e pode sobrescrever o que o modo
offline usa para o leitor facial. Antes de ligar no PC da recepção: testar na bancada, com o agente
parado depois da gravação, que a catraca ainda libera pela lista própria. Para ligar:
`atualizar-edge.cmd` (recompila a ponte) com as três variáveis no `.env`.

**Sem a gravação automática (ou se ela falhar), corrigir à mão (~3 min, a recepção libera à mão enquanto isso):**

1. `parar-edge.cmd` e esperar **20 s** — a catraca cai para o modo offline. Online, a página dela
   responde "Web server desabilitado... modo online".
2. Abrir `http://192.168.2.187` e entrar com o usuário e a senha da catraca (com o PI; **não
   anotar aqui**).
3. **Configurações de Acesso Avançadas** — deixar exatamente assim:

   | campo | valor |
   |---|---|
   | Leitor 1 | **ENTRADA E SAÍDA INVERTIDO** |
   | Leitor 2 | DESABILITADO |
   | Acionamento 1 | **GIRO DE SAÍDA LIBERADO** |
   | Tempo de acionamento 1 | **10** |
   | Acionamento 2 | DESABILITADO |

4. **Confirma**, e subir o agente: `schtasks /Run /TN "ArenaHub Edge"`.
5. Testar: a **saída** gira livre; a **entrada** só gira depois do reconhecimento, com 10 s para
   passar.

**O que estava de fábrica** (lido em 02/10/2026, para voltar se precisar): Acionamento 1 = **GIRO DE
ENTRADA LIBERADO**, tempo **5**, demais iguais.
