# Levantamento de campo — ciclo facial ao vivo (F2) e achado `senduser`

**Data:** 17/08/2026 · **Local:** rede da Arena Positiva · **Autor:** Claude Code, com o PI presente
**Natureza:** nota de campo (fato verificado ao vivo) + registro de correção de código autorizada pelo PI.

> **Fronteira deste documento.** Registra o que foi observado ao ligar o `TopdataFacialAdapter`
> real contra o leitor facial de produção, e o ajuste de código que a observação exigiu. Não é ADR
> nem spec. Complementa `docs/field-notes/2026-08-15-hardware-arena-positiva.md` (que só alcançou o
> webserver de admin) e o `docs/runbooks/POC-MVP-00-roteiro-de-execucao.md`.

## 0. O que esta janela conseguiu — inédito

Pela primeira vez o **ciclo facial rodou ponta a ponta** contra o equipamento real:

1. o leitor facial discou para o `edge-agent` (cutover de servidor no menu do leitor);
2. o `TopdataFacialAdapter` respondeu o handshake e **manteve a conexão estável**;
3. o ArenaHub **cadastrou** um usuário de teste (`setuserinfo` → confirmado pelo leitor);
4. a face foi capturada na câmera do leitor (associada ao enrollid);
5. ao passar o rosto, o leitor **reconheceu** e mandou `sendlog`;
6. o ArenaHub **recebeu o evento** com o `externalEnrollId` correto, método `facial` e horário do
   equipamento.

Isto exercita `M0-FR-002` (cadastro) e `M0-FR-004` (evento de reconhecimento) em hardware real —
antes só cobertos por simulador. **Não fecha o gate do MVP 0** (falta latência ponta a ponta com a
catraca no mesmo laço, `M0-AC-004`, e a assinatura do PI, `M0-AC-010`).

## 1. Como o cutover do facial foi feito

O leitor facial, como a catraca, é **cliente**: disca para o servidor gravado nele. A config está
no **menu físico do leitor** (`MENU → Rede → Servidor` ou `Acesso → Servidor`), **sem depender da
senha do webserver de admin** — o que destrava o que o field-note de 15/08 §5 dava como bloqueado.

Campos lidos no menu (17/08):

| campo | valor original | mudado para |
|---|---|---|
| Req. Servidor | Sim | Sim |
| Domínio | Não | Não |
| URL | `ws://facial.topdat...` | (mantida) |
| **IP** | `192.168.002.106` (legado) | **`192.168.002.190`** (edge-agent) |
| Porta | `7792` | `7792` |
| Heartbeat | `3` | `3` |

Com `Domínio: Não`, o leitor usa o campo **IP** — foi o IP que resolveu, não a URL. Ethernet do
leitor: `192.168.2.188`, DHCP, MAC `00:01:a9:03:25:78`. Capacidade lida: **200 usuários, 13 faces,
43 registros**. Firmware: **`ai518_fp26v_v2.16`**.

> **Devolução:** ao fim da janela, o IP do servidor do leitor deve voltar para `192.168.002.106` e
> o legado religado — mesmo procedimento da catraca (runbook §5).

## 2. 🔴 Achado que exigiu código — o `senduser` não documentado

Ao conectar, o leitor `v2.16` entra num **loop de reconexão de ~5 s** e nunca estabiliza. Causa,
diagnosticada ao vivo com um servidor de captura de metadados (sem logar valores — poderia conter
foto):

- logo após o `reg`, o leitor envia **`senduser`** — um por usuário cadastrado — sincronizando a
  base dele para o servidor. Chaves observadas: `cmd, sn, enrollid, name, backupnum, admin, record`.
- esse comando **não estava** no `esquemaMensagemDoEquipamento` (só `reg`, `sendlog`, `ret`),
  então caía em "mensagem fora do formato documentado" e **não era respondido**;
- como o `reg`, o `senduser` **exige ack**. Sem resposta, o leitor reenvia e derruba a conexão.

Os manuais que temos (`docs/vendor/topdata/PROTOCOLO-FACIAL.md`) descrevem revisões anteriores; o
`senduser` é comportamento do firmware `ai518_fp26v_v2.16`, não coberto por eles. **Este é um fato
de campo novo, análogo ao webserver de admin do field-note de 15/08.**

### Correção aplicada (autorizada pelo PI como escopo de F2)

Fora do fluxo normal de spec — o PI, presente, assumiu explicitamente a decisão de escopo. Feita
em branch própria (`feat/f2-facial-senduser`), com TDD (teste RED antes do fix):

- `protocolo.ts`: `esquemaSendUser` (`.loose()`, só o mínimo para identificar) + `respostaSendUser`;
  ambos adicionados ao union e às respostas;
- `topdata-facial-adapter.ts`: branch no `aoReceber` que responde o ack de `senduser`;
- teste `responde ao senduser` cobrindo o contrato.

**Efeito verificado ao vivo:** com o ack, **0 desconexões** e **0 mensagens fora do formato** (antes:
loop a cada ~5 s). A base do leitor **não** é importada — a nuvem é a fonte da verdade (regra de
arquitetura nº 3); o ack só confirma o recebimento.

> **Pendência para a spec de F2 (Cowork):** decidir se `senduser` deve algum dia ser consumido
> (reconciliação de órfãos entre leitor e nuvem) ou permanecer só-ack. Hoje é só-ack, que basta
> para a conexão viver. Também: registrar `senduser` no resumo verificável de
> `docs/vendor/topdata/` quando houver manual da revisão `v2.16`.

## 3. `lab:run` construído e a cadeia física ponta a ponta

Ainda na mesma janela, com o PI assumindo o escopo, o `lab:run` foi **construído** (antes não
existia — era o bloqueio nº 1 do runbook §0). Ele liga `facial.aoReconhecer` → decisão LOCAL
(`orquestrar-passagem`, MVP 0) → `catraca.liberar`, e coleta latência. Peça pura testada no CI
(`src/lab/lab-run.ts` + `.spec.ts`); wiring de I/O em `lab-run-cli.ts` (não roda no CI).

**Uso:** `pnpm --filter @arenahub/edge-agent lab:run -- --permitidos <enrollid> [--sentido saida] [--invertido]`

### 3.1. Bug de inicialização online — `retorno 1` no `liberar`

Primeira execução do `lab:run` recusava todo `liberar` com **`retorno 1`**. Causa: o
`TopdataInnerAdapter.testarConexao()` roda só `ConfigurarInnerOnLine` — **não** o
`ConfigurarAcionamento1`, que define o relé como catraca. Sem ele a catraca aceita a conexão mas
recusa o giro (comentário no `EasyInnerBridge.cs` já anotava isso). Os scripts manuais de F3
funcionavam porque mandavam o comando `conectar` (init completa); o adapter não o expunha.

**Fix (TDD):** comando `conectar` adicionado ao `esquemaComandoPonte` + método
`TopdataInnerAdapter.conectar(porta, tempo)` que dispara a init online completa. O `lab:run` chama
`conectar` antes do primeiro `liberar`. Verificado ao vivo: o `liberar` passou a ser aceito.

### 3.2. 🔴 Sentido de giro — dado de campo desta instalação

Provado ao vivo qual comando gira para dentro nesta catraca — **não se deduz, o manual é explícito**:

| `--sentido` | `--invertido` | lado físico que liberou |
|---|---|---|
| `entrada` | false | **saída** (invertido pela instalação) |
| `entrada` | true | **os dois** (`<>`) |
| **`saida`** | **false** | **ENTRADA (pra dentro)** ✅ |

**Configuração correta da bancada Arena Positiva: `--sentido saida --invertido` ausente.** A
saída física é livre pela própria catraca (giro solto no sentido de sair), então o ArenaHub só
comanda a entrada. Isto é dado de campo por instalação, **não** default universal — por isso o
`lab:run` mantém `--sentido` configurável em vez de fixar o valor no código.

### 3.3. Cadeia física ponta a ponta — provada

Com a combinação certa, a cadeia rodou num único laço automático, sem comando manual:

**rosto → facial reconhece → ArenaHub decide ALLOW (local) → catraca destrava (entrada) → giro →
sensor confirma (`origem:6`).**

Evidência da sessão: múltiplos `desfecho:"girou"` (giro confirmado), `desfecho:"timeout"` (destravou,
não passou a tempo), e a **janela anti-repique** negando rajadas (`DENY` por `REPETICAO`) — `M0-AC-003`
sustentado ao vivo, 0 duplas. `M0-AC-004`: os `DENY` não acionam a catraca (estrutura do
`orquestrar-passagem`).

> ⚠️ **A latência (`M0-NFR-001`) NÃO foi medida como ponta a ponta real.** A decisão é LOCAL e
> síncrona, então `latenciaDecisaoMs` arredonda a 0 — não há a rede da nuvem no laço (isso é F9,
> MVP 1). O que se provou é a CADEIA FÍSICA funcionando, não o número de latência do gate.

### 3.4. 🔴 Demora perceptível reconhecimento → liberação (observação do PI)

O PI observou ao vivo uma **demora perceptível entre o rosto ser reconhecido e a catraca
liberar**. O dado é real e precisa de investigação — mas o `latenciaDecisaoMs: 0` do log prova que
**a demora NÃO está na decisão do ArenaHub** (local, síncrona). Ela está num dos trechos que o
`lab:run` hoje **não instrumenta**:

1. **leitor facial**: tempo entre ver o rosto e emitir o `sendlog` (processamento no equipamento);
2. **rede WebSocket**: o `sendlog` viajando do leitor `.188` até o edge-agent;
3. **ponte + catraca**: o `liberar` chegando à DLL e a catraca destravando.

**Medição por etapa feita ao vivo (17/08)** — instrumentado com timestamps em cada ponto:

| etapa | medido |
|---|---|
| `sendlog` recebido → `liberar` enviado (**o ArenaHub**) | **0–1 ms** |
| `liberar` → catraca confirmou giro | 2600–5076 ms (**inclui tempo humano** de girar) |

**Conclusão: o ArenaHub NÃO é o gargalo.** Do reconhecimento recebido ao comando da catraca são
0–1 ms. A demora perceptível está **no leitor facial** — o tempo entre a pessoa aparecer na câmera
e o equipamento processar o rosto e emitir o `sendlog`. Isso é interno ao hardware Topdata, **fora
do nosso código**; não há o que otimizar no ArenaHub para reduzi-la.

### 3.5. 🔴 Achado extra — `ocorridoEm` do leitor congelado

Em todas as medições o `sendlog` trouxe **o mesmo `ocorridoEm` (`2026-08-17T15:47:28`)**, apesar
de os reconhecimentos ocorrerem minutos depois. O leitor está emitindo um timestamp **fixo** — ou o
relógio dele está parado/errado, ou o firmware `v2.16` reusa o horário do último cadastro. Isto
importa: o `M0-FR-004` usa `ocorridoEm` do equipamento para ordenar eventos, e um timestamp
congelado **embaralha a ordem**. **Pendência:** acertar o relógio do leitor (menu `Sistema → Data
e Hora`) e reavaliar se o `ocorridoEm` passa a variar; se não variar mesmo com relógio certo, o
edge-agent precisa carimbar o horário de recebimento como fallback — decisão para a spec de F2.

## 4. 🔴 A catraca deixa entrar SEM reconhecimento — furo de config, não de código

Achado crítico, confirmado ao vivo pelo PI: **sem passar o rosto, a pessoa entra empurrando a
catraca.** A regra "entrada exige decisão" **não está valendo** na config atual da bancada.

Causa: `acionamento1: 8` (`CATRACA_LIBERADA_DOIS_SENTIDOS`) — a catraca está em modo **liberada
nos dois sentidos** em repouso. O `liberar` do ArenaHub não *destrava* nada, porque a catraca
nunca esteve travada. Todos os giros provados hoje são reais, mas teriam acontecido **mesmo sem o
comando** — o `origem:6` prova que a pessoa girou, não que só quem é reconhecido entra.

**Para a regra valer**, a catraca precisa ir para **modo bloqueado** (travada em repouso, destrava
só com o `liberar`). Isso é mudar `acionamento1` de `8` para o modo bloqueado — **config do
equipamento, não do ArenaHub**. O modo **não aparece no menu do painel** desta catraca; só se muda
pela API/SDK. Não foi feito nesta janela: o endpoint de escrita e o valor exato do modo bloqueado
**não estão confirmados** nos manuais que temos (só o `GET /configuracaoacesso`), e chutar escrita
de `acionamento` em catraca de produção foi recusado. **Pendência para a próxima janela, com o
manual do SDK na mão.** Reversão é trivial: voltar `acionamento1` para `8`.

> **Consequência para o gate:** o `M0-AC-004` (entrada não abre sem comando) **não pode fechar**
> enquanto a catraca estiver em `acionamento1:8`. A cadeia de código está provada; a *garantia
> física* de que ninguém entra sem direito depende deste ajuste de config.

## 5. O que ainda falta para o gate

- **modo bloqueado da catraca** (`acionamento1:8` → bloqueado) — §4, pré-requisito de `M0-AC-004`;
- **latência ponta a ponta REAL** (`M0-NFR-001`): exige a decisão pela nuvem (F9, MVP 1), não a
  local do `lab:run`. Medido hoje: o ArenaHub responde em 0–1 ms; a demora percebida é do leitor;
- **relógio do leitor** (`ocorridoEm` congelado, §3.5) — afeta ordenação de eventos;
- **devolução dos equipamentos ao legado** (facial e catraca em `.190` ao fim desta janela);
- **assinatura do PI** (`M0-AC-010`).

---

*Artefato de campo, datado. Vale para o estado da rede e do firmware em 17/08/2026.*
