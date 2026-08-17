# Roteiro de execução da POC física — MVP 0

> **Documento operacional.** Escrito para ser seguido no local, com a catraca à frente e o
> cronômetro correndo — não para ser lido antes. Cada passo diz **o que rodar**, **o que esperar**
> e **o que fazer quando não for isso**.
>
> **Data:** 15/08/2026 · **Dono:** Claude Code · **Fatias:** F2 (`SPEC-002`) e F3 (`SPEC-003`)
>
> Contexto e diagnóstico moram em `docs/field-notes/2026-08-15-hardware-arena-positiva.md`.
> Este arquivo **não repete** a análise: ele é a sequência de execução.

---

## 0. Antes de sair de casa — o que este roteiro **não** consegue fazer hoje

Leia isto primeiro. Ir ao local sem saber disso é perder a janela.

🔴 **O `lab:run` citado no gate do PRD e no field-note §8 não existe.** Não é um script quebrado —
não há script. O `apps/edge-agent/package.json` tem `dev`, `start`, `build`, `lint`, `typecheck`,
`test`, `diagnostico` e `bridge:build`. Não há `lab:run`.

🔴 **O `main.ts` não liga nos equipamentos.** Ele sobe, valida configuração e emite heartbeat a
cada 30 s. Só isso. O próprio arquivo declara: *"Adapter de dispositivo, fila e reconciliação são
das fatias seguintes"*. Os adapters existem, são testados e estão corretos — mas **nada os
instancia**. `grep` por `TopdataFacialAdapter` fora da própria pasta e dos testes retorna zero
usos.

**Consequência prática, e ela é grande:**

| o que você quer medir | dá para medir hoje? | por quê |
|---|---|---|
| giro da catraca (`M0-AC-003`/`004`/`005`) | ✅ **sim** | pelo `driver-teste.mjs`, que fala direto com a ponte |
| latência **da ponte** (liberar → giro) | ✅ **sim** | o driver já cronometra cada comando |
| ciclo facial: cadastrar/reconhecer/remover (`M0-AC-001`/`002`) | ❌ **não** | ninguém sobe o servidor WebSocket na 7792 |
| latência **ponta a ponta** (rosto → decisão → giro, `M0-NFR-001`) | ❌ **não** | exige os dois lados ligados no orquestrador |

> **Isto não é falha da POC — é escopo que ninguém alocou.** Ligar os adapters ao `main.ts` é
> trabalho de código, com PR e CI, não algo para improvisar na janela. Ver §6.

**Portanto:** esta janela colhe **F3 parcial** (giro + latência da ponte) e **não colhe F2**.
Se a decisão for colher tudo de uma vez, o passo §6 tem de vir antes da janela.

---

## 1. Pré-condições — todas, sem exceção

Nenhuma é negociável no local. Faltando uma, **a janela não abre.**

| # | pré-condição | quem cumpre | verificação |
|---|---|---|---|
| 1 | **Consentimento assinado** dos participantes | PI | papel assinado em mãos |
| 2 | **Legado desligado** no `192.168.2.106` | PI / operação | §2 passo 1 |
| 3 | **Janela combinada**, catraca sem alunos | PI / operação | acordo prévio |
| 4 | **Parada de emergência definida** — quem corta, como, em quanto tempo | PI | §1.1 |
| 5 | **Cutover**: `ipServer` da catraca → IP do edge-agent | PI decide, executa no local | §2 passo 3 |
| 6 | **Firewall** com a `3570` de entrada aberta | quem opera o PC | §2 passo 2 |
| 7 | *(só se for tentar F2)* leitor em **18 dígitos** + credencial de admin do facial | PI | §6 |

> ⚠️ **A nº 1 não tem contorno técnico.** Captura facial sem consentimento é tratamento de dado
> biométrico sem base legal — regra de arquitetura nº 7 e ADR-008 (art. 11, I da LGPD). Não existe
> "só um teste rápido".

### 1.1. Parada de emergência — defina **antes**, escreva aqui

Preencher antes da janela. Roteiro com este campo vazio não se executa.

```
Quem interrompe:      ______________________
Como (fisicamente):   ______________________   (ex.: desligar a fonte da catraca)
Onde fica:            ______________________
Tempo até parar:      ______________________
```

**Gatilhos de parada imediata**, sem discussão:

- catraca gira **sem** comando enviado;
- catraca gira **mais de uma vez** por comando (`M0-AC-003` violado ao vivo);
- pessoa não autorizada se aproxima do equipamento;
- qualquer comportamento não previsto neste roteiro.

---

## 2. Sequência de cutover — a ordem importa

**A ordem não é sugestão.** Trocar o `ipServer` antes de desligar o legado deixa dois cérebros
disputando a catraca, que é o cenário que o field-note §2.3 nomeia como risco operacional.

### Passo 1 — desligar o legado no `.106`

Sem isso, o passo 3 cria disputa. Confirmar que parou:

```powershell
Test-NetConnection 192.168.2.106 -Port 7792
```

**Esperado:** `TcpTestSucceeded : False`.
**Se der `True`:** o legado ainda serve. **Pare.** Não siga.

### Passo 2 — abrir a 3570 no firewall do PC do edge-agent

A catraca **disca para nós**. Porta fechada = ela nunca chega. Como admin:

```powershell
New-NetFirewallRule -DisplayName "ArenaHub POC EasyInner 3570" `
  -Direction Inbound -Protocol TCP -LocalPort 3570 -Action Allow
```

> Em 15/08 o perfil de rede era **Público** e bloqueava a entrada. Necessário — mas **não
> suficiente**: o bloqueio real era o `ipServer`.

Anote o IP desta máquina, é o que vai na catraca:

```powershell
ipconfig | Select-String "IPv4"
```

### Passo 3 — apontar a catraca para o edge-agent ⚠️ **ponto sem volta fácil**

**É este o cutover.** A catraca sai do controle do legado. Reverter significa repetir o passo com
o valor antigo.

> **Anote o valor atual antes de mudar:** `ipServer = 192.168.2.106`

Pelo painel físico: `MENU → configurações → rede`. Alterar:

| campo | de | para |
|---|---|---|
| **IP do Servidor** | `192.168.2.106` | **IP anotado no passo 2** |
| Porta Servidor | `3570` | `3570` *(não mudar)* |

Reiniciar a catraca ou forçar reconexão.

> Alternativa por API (credencial `ADMIN` / `C@traca`, cifra no field-note §3). **Prefira o
> painel:** menos caminho para errar com o equipamento em produção.

### Passo 4 — confirmar que a catraca discou

**É este o passo que faltou em 15/08.** Sem `ESTABLISHED`, todo comando retorna `1`.

Suba a ponte (§3) e, em outro terminal:

```powershell
Get-NetTCPConnection -LocalPort 3570
```

| o que você vê | significa | o que fazer |
|---|---|---|
| `LISTEN` **e** `ESTABLISHED` com `192.168.2.187` | ✅ conectada | siga para §3 |
| só `LISTEN` | a catraca não discou | revise passo 3: `ipServer` gravado? reiniciou? |
| nem `LISTEN` | a ponte não subiu | veja §3, erro de build ou DLL |

---

## 3. Subir a ponte

Só em **Windows x86 com .NET Framework 4.x** e a `EasyInner.dll` presente. A DLL é licenciada e
**não está no repositório** — copie da instalação Topdata.

```powershell
cd apps\edge-agent
pnpm bridge:build
```

**Esperado:** `EasyInnerBridge.exe` em `native/easyinner-bridge/bin/`.

Smoke antes de encostar na catraca — prova que a DLL carrega:

```powershell
# arquivo: smoke.txt
{"cmd":"ping","inner":1}
```

```powershell
node native/easyinner-bridge/driver-teste.mjs `
  native/easyinner-bridge/bin/EasyInnerBridge.exe smoke.txt
```

| retorno | leitura |
|---|---|
| `{"tipo":"retorno","retorno":2}` | ✅ **DLL carregou.** `2` = porta não aberta, correto antes do `conectar` |
| `{"tipo":"retorno","retorno":8}` | ❌ **GPF** — quase sempre ambiente: processo 64 bits, .NET ausente, DLL não registrada |
| `falha-da-ponte` | ❌ o `.exe` não subiu ou o protocolo quebrou |

---

## 4. F3 — giro, dupla liberação e latência

O que esta janela realmente colhe.

### 4.1. Sonda: a catraca responde?

```
{"cmd":"conectar","porta":3570,"tempo":10}
{"cmd":"versao","inner":1}
```

**Esperado:** retorno `0` e firmware **`7.05.00`**.
**`0.00.00` com retorno `1`:** ninguém do outro lado — volte ao §2 passo 4. **Não insista nos
comandos seguintes**; sem conexão eles não medem nada.

### 4.2. Primeiro giro — um só, com todo mundo olhando

**Antes de rodar:** parada de emergência à mão, ninguém na catraca.

```
{"cmd":"liberar","inner":1,"sentido":"entrada","invertido":false}
{"cmd":"receber-evento","inner":1,"timeoutMs":3000}
```

| `origem` | significa | anotar |
|---|---|---|
| **6** | ✅ **girou** — sensor óptico confirmou (`M0-AC-005`) | latência `liberar` → evento |
| **5** | liberou, ninguém passou (timeout) | conta como liberação, não como giro |
| nada em 3 s | repetir `receber-evento`; a catraca controla o prazo | — |

> **Se `invertido:false` não girar no sentido esperado**, tente `true`. O manual diz que a escolha
> *"depende da orientação física"* — a bancada tem a catraca à esquerda ao entrar. **Descobre-se
> testando; não se deduz.** Anote qual serviu: vira configuração.

### 4.3. `M0-AC-003` — dez liberações, nenhuma dupla

Repetir 4.2 **dez vezes**. Registre cada uma:

| # | retorno `liberar` | girou? | `origem` | latência (ms) | acionamentos observados |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| … | | | | | |
| 10 | | | | | |

**Critério:** dez comandos → **dez** acionamentos físicos. Onze reprova.

> A garantia de idempotência é **inteiramente nossa**: `LiberarCatracaEntrada(int Inner)` não tem
> id de comando. Duas camadas independentes protegem — janela anti-repique e `comandoId` derivado
> do `correlationId`. Esta é a hora de provar que funcionam **no equipamento**.

### 4.4. `M0-AC-004` — `DENY` não aciona nada

**Não há comando a enviar.** É esse o teste: no caminho de negativa, o orquestrador **retorna
antes** do único `liberar()`. Não é disciplina, é topologia do código.

Na janela, confirme o negativo: com a ponte conectada e **nenhum** `liberar` enviado, a catraca
**não pode** girar. Observe 60 s. Qualquer giro = **parada imediata** (§1.1).

### 4.5. Latência — o número que pode reabrir o ADR-004

O `driver-teste.mjs` já carimba `[Nms]` em cada linha. A medição é `liberar` → evento `origem:6`.

Das dez liberações, calcule **p50, p95 e máximo**.

> ⚠️ **Esta é latência da ponte, não ponta a ponta.** O `M0-NFR-001` pede rosto → decisão → giro,
> e o trecho facial não roda (§0). **Registre como parcial** — anotar no relatório como se fosse
> ponta a ponta seria exatamente o número inventado que a guarda de evidência existe para barrar.

**Se o p95 passar de 300 ms:** o ADR-004 reabre por gatilho automático. Não é falha da POC — é o
critério funcionando.

---

## 5. Encerrar a janela

**Não pule.** A catraca fica apontada para nós até que alguém a devolva.

1. Encerrar a ponte (`Ctrl+C` no driver);
2. **Decidir com o PI:** a catraca volta para o legado (`ipServer = 192.168.2.106`) ou fica no
   ArenaHub? *Ficar* significa que o legado não opera mais — decisão de produto, não de teste;
3. Se voltar: refazer §2 passo 3 com `192.168.2.106`, reiniciar, confirmar que o legado a vê;
4. Religar o legado no `.106`;
5. Remover a regra de firewall, se o PC não for o edge-agent definitivo:
   ```powershell
   Remove-NetFirewallRule -DisplayName "ArenaHub POC EasyInner 3570"
   ```
6. **`M0-AC-009`** — se algum dado biométrico de teste foi criado, remover conforme o termo
   assinado. Sem dado criado nesta janela (F2 não roda), nada a expurgar: **registre isso**.

---

## 6. O que falta construir para a POC ficar completa

Trabalho de código, com PR e CI. **Não improvisar na janela.**

| # | o quê | destrava | tamanho |
|---|---|---|---|
| 1 | **`lab:run`**: script que instancia os adapters, liga no orquestrador e grava evidência | latência ponta a ponta (`M0-NFR-001`) | fatia |
| 2 | **Servidor WebSocket 7792 ligado no `main.ts`** — o adapter existe, ninguém o sobe | F2 inteira (`M0-AC-001`/`002`) | fatia |
| 3 | **Credencial de admin do facial** — `ADMIN`/`C@traca` foi recusado; senha é própria | 18 dígitos, `use_logphoto:0` | PI |

> **Ordem sugerida:** 1 e 2 juntos (o mesmo `main.ts` liga os dois lados), depois a janela colhe
> F2 e F3 de uma vez. Fazer duas janelas custa duas negociações com a operação.

**Isto é decisão do PI**, não do Code: são fatias novas, com escopo de produto. Reclassificar como
correção para pular a spec é o que o `CLAUDE.md` proíbe explicitamente.

---

## 7. Evidência — o que sai desta janela

O que não for anotado **não aconteceu**. O gate §15 exige evidência auditável.

- [x] tabela de dez liberações (§4.3) preenchida — **três séries, 30 comandos** (relatório §9)
- [x] p50, p95, máximo — coletados e **marcados como latência da ponte + tempo humano**, não ponta a ponta (relatório §3)
- [x] `origem` de cada evento (6 = giro, 5 = timeout) — 28 × `origem:6`, 2 × `origem:5`
- [x] sentido que funcionou — `invertido:false` para entrada **e** saída dirigidas
- [ ] observação do `M0-AC-004` (60 s sem comando, sem giro) — **não rodou**: catraca em `acionamento1:8` (gira livre), exige modo bloqueado (relatório §9.2)
- [x] estado final: **catraca devolvida ao legado** (`ipServer` → `192.168.2.106`, legado religado)
- [x] **o que não foi medido e por quê** — F2 inteira (facial), latência ponta a ponta (relatório §9.2)

> **Janela de 17/08/2026 executada.** Resultado consolidado em
> [`docs/reports/MVP-00-relatorio-poc-topdata.md`](../reports/MVP-00-relatorio-poc-topdata.md) §9.
> `M0-AC-003` (sem dupla) e `M0-AC-005` (giro confirmado) provados; `M0-AC-004`, F2 e latência
> ponta a ponta seguem pendentes. **O gate §15 não fecha** — falta o ciclo facial e a assinatura
> do PI.

Depois da janela: atualizar `docs/reports/MVP-00-relatorio-poc-topdata.md` (as células
`PENDENTE-POC`), o `STATUS.md` e o `DEVELOPMENT.md`, e comentar nas issues #2 e #3.

> **O gate §15 não fecha só com isto.** `M0-AC-001`/`002` (ciclo facial) continuam sem evidência,
> e `M0-AC-010` exige assinatura de tecnologia **e** operação. Esta janela move F3, não o MVP 0.

---

*Roteiro datado de 15/08/2026. Vale para o estado do código e da rede nesta data — a §0 muda
quando o item 1 ou 2 da §6 for entregue.*
