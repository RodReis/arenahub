# Ponte EasyInner nativa (processo .NET x86) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o processo-ponte Windows .NET x86 que carrega a `EasyInner.dll` e implementa o contrato `PonteEasyInner` já definido em `apps/edge-agent/src/adapters/topdata/easyinner-ponte.ts`, permitindo ao edge-agent (Node) comandar a catraca Topdata Inner real por stdio.

**Architecture:** Um executável C# (.NET Framework 4.8, compilado x86 com `csc`) roda como processo filho do edge-agent. Comunicação por **stdio**: o edge-agent escreve comandos JSON (uma linha por comando) no stdin do processo; o processo responde JSON por stdout. Uma **única thread dedicada** serializa todas as chamadas à DLL (que é bloqueante e não thread-safe). O lado Node ganha uma implementação `PonteEasyInnerProcesso` de `PonteEasyInner` que lança e conversa com esse processo.

**Tech Stack:** C# / .NET Framework 4.8 (x86, via `C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe`); Node.js (`child_process`); TypeScript; Zod (contrato já existente); Jest.

**Spec:** Deriva da Slice 0.3 (`docs/prd/academia/MVP-00-poc-topdata.md` §7) e fecha o item aberto do ADR-010 (a forma da ponte). Protocolo: `docs/vendor/topdata/PROTOCOLO-CATRACA.md`. Contrato Node: `apps/edge-agent/src/adapters/topdata/easyinner-ponte.ts`. **Esta é uma fatia nova; requer card + spec `aprovada-pi` antes do merge (ver Constraints).**

## Global Constraints

- **Decisão do PI (15/08/2026):** transporte = **stdio**; runtime = **.NET Framework 4.x x86**. Registrar em ADR (emenda ao ADR-010 ou ADR novo) antes do merge.
- **Contrato imutável:** as mensagens seguem `esquemaComandoPonte` e `esquemaRespostaPonte` de `easyinner-ponte.ts` — 4 comandos (`testar-conexao`, `liberar`, `receber-evento`, `ping`), respostas (`retorno`, `evento`, `sem-evento`, `falha-da-ponte`). Não alterar o contrato; implementá-lo.
- **Assinaturas reais da DLL** (do wrapper oficial `Exemplos/CSharp/LabEasyInner/Fontes/COM/EasyInner.cs`), todas `CallingConvention.Winapi`, retorno `byte`:
  - `byte DefinirTipoConexao(byte Tipo)` — usar `2` (TCP/IP porta fixa)
  - `byte AbrirPortaComunicacao(int Porta)` — porta `3570`
  - `void FecharPortaComunicacao()`
  - `byte ConfigurarInnerOnLine()` — teste de conexão / modo online (retorno 0 = ok)
  - `byte HabilitarMudancaOnLineOffLine(byte Habilita, byte Tempo)` — `2, tempo` = online TCP com ping
  - `byte LiberarCatracaEntrada(int Inner)` / `LiberarCatracaSaida` / `LiberarCatracaDoisSentidos` / `LiberarCatracaEntradaInvertida` / `LiberarCatracaSaidaInvertida`
  - `byte PingOnLine(int Inner)`
  - `byte ReceberDadosOnLine(int Inner, ref byte Origem, ref byte Complemento, StringBuilder Cartao, ref byte Dia, ref byte Mes, ref byte Ano, ref byte Hora, ref byte Minuto, ref byte Segundo)`
- **Códigos de retorno:** `0`=OK, `1`=ERRO, `2`=porta não aberta, `3`=porta já aberta, `8`=GPF (DLL/registro/bitness). Ver `RETORNO` no contrato.
- **Origem de evento:** `6`=giro confirmado, `5`=fim de tempo (timeout), `1/2/3/21`=acessos. Ver `ORIGEM` no contrato.
- **Idempotência é nossa:** a DLL não aceita id de comando; `LiberarCatraca*` chamada 2× libera 2×. A prevenção de dupla passagem vive no adapter/orquestração (já implementado na F3), não aqui.
- **x86 obrigatório:** compilar com `/platform:x86`. Um processo x64 carregando a DLL de 32 bits retorna GPF (8).
- **Uma thread para a DLL:** todas as chamadas à `EasyInner.dll` numa única thread dedicada. Nunca chamar de threads concorrentes.
- **Comando fisicamente perigoso:** `liberar` gira a catraca. Testes que disparam giro real são manuais, com hardware liberado e fora do CI — nunca no CI. O CI usa só os testes de protocolo/parsing.
- **Idioma:** docs e comentários em PT-BR; identificadores em inglês/português conforme o código existente do edge-agent (que usa PT-BR nos domínios).

---

## Estrutura de arquivos

- **Criar** `apps/edge-agent/native/easyinner-bridge/EasyInnerBridge.cs` — o programa C#: loop stdio, thread única da DLL, os P/Invoke, tradução comando↔DLL.
- **Criar** `apps/edge-agent/native/easyinner-bridge/build.ps1` — compila com `csc /platform:x86` para `bin/EasyInnerBridge.exe`.
- **Criar** `apps/edge-agent/native/easyinner-bridge/README.md` — como compilar, dependências (DLL registrada, .NET 4.x), como testar manualmente.
- **Criar** `apps/edge-agent/src/adapters/topdata/ponte-easyinner-processo.ts` — implementação Node de `PonteEasyInner` que lança o `.exe` e troca JSON por stdio.
- **Criar** `apps/edge-agent/src/adapters/topdata/ponte-easyinner-processo.spec.ts` — testes com um processo-eco fake (não o .exe real), validando serialização/par-sing do protocolo stdio.
- **Modificar** `apps/edge-agent/package.json` — script `bridge:build` e (opcional) `lab:catraca` para teste manual.
- **Modificar** `docs/DECISIONS.md` — emenda ao ADR-010 registrando stdio + .NET 4.x x86.

---

### Task 1: Protocolo stdio no lado Node — `PonteEasyInnerProcesso`

**Files:**
- Create: `apps/edge-agent/src/adapters/topdata/ponte-easyinner-processo.ts`
- Test: `apps/edge-agent/src/adapters/topdata/ponte-easyinner-processo.spec.ts`

**Interfaces:**
- Consumes: `PonteEasyInner`, `ComandoPonte`, `RespostaPonte`, `esquemaComandoPonte`, `esquemaRespostaPonte` de `./easyinner-ponte.js`.
- Produces: `class PonteEasyInnerProcesso implements PonteEasyInner` com construtor `(opcoes: { comando: string; args?: string[] })`, e um construtor de teste que aceita um `child_process.ChildProcess` já criado (injeção), para o spec usar um processo-eco fake.

- [ ] **Step 1: Write the failing test** — protocolo: um comando vira uma linha JSON no stdin; uma linha JSON no stdout vira `RespostaPonte`.

```ts
import { describe, it, expect } from '@jest/globals';
import { spawn } from 'node:child_process';
import { PonteEasyInnerProcesso } from './ponte-easyinner-processo.js';

// processo-eco: para cada linha recebida, responde {"tipo":"retorno","retorno":0}
function ecoProcesso() {
  return spawn(process.execPath, ['-e', `
    let buf='';
    process.stdin.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\\n')) >= 0) {
        buf.slice(0, i); buf = buf.slice(i + 1);
        process.stdout.write(JSON.stringify({ tipo: 'retorno', retorno: 0 }) + '\\n');
      }
    });
  `]);
}

describe('PonteEasyInnerProcesso', () => {
  it('envia comando como JSON e traduz a resposta', async () => {
    const ponte = PonteEasyInnerProcesso.comProcesso(ecoProcesso());
    const r = await ponte.executar({ cmd: 'ping', inner: 1 });
    expect(r).toEqual({ tipo: 'retorno', retorno: 0 });
    await ponte.encerrar();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arenahub/edge-agent test ponte-easyinner-processo`
Expected: FAIL — `PonteEasyInnerProcesso` não existe.

- [ ] **Step 3: Write minimal implementation** — lança/recebe processo, escreve comando validado, casa resposta por ordem FIFO (a DLL é serial, então uma resposta por comando, em ordem).

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import {
  type PonteEasyInner,
  type ComandoPonte,
  type RespostaPonte,
  esquemaComandoPonte,
  esquemaRespostaPonte,
} from './easyinner-ponte.js';

export class PonteEasyInnerProcesso implements PonteEasyInner {
  readonly nome = 'ponte-easyinner-processo';
  private buffer = '';
  private readonly pendentes: Array<(r: RespostaPonte) => void> = [];

  private constructor(private readonly processo: ChildProcess) {
    processo.stdout?.setEncoding('utf8');
    processo.stdout?.on('data', (d: string) => this.consumir(d));
  }

  static comProcesso(processo: ChildProcess): PonteEasyInnerProcesso {
    return new PonteEasyInnerProcesso(processo);
  }

  static lancar(opcoes: { comando: string; args?: string[] }): PonteEasyInnerProcesso {
    return new PonteEasyInnerProcesso(spawn(opcoes.comando, opcoes.args ?? [], { stdio: 'pipe' }));
  }

  private consumir(chunk: string): void {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const linha = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!linha) continue;
      const resolver = this.pendentes.shift();
      if (!resolver) continue;
      const parse = esquemaRespostaPonte.safeParse(JSON.parse(linha));
      resolver(
        parse.success
          ? parse.data
          : { tipo: 'falha-da-ponte', mensagem: `resposta invalida: ${linha}` },
      );
    }
  }

  executar(comando: ComandoPonte): Promise<RespostaPonte> {
    const validado = esquemaComandoPonte.parse(comando);
    return new Promise<RespostaPonte>((resolve) => {
      this.pendentes.push(resolve);
      this.processo.stdin?.write(JSON.stringify(validado) + '\n');
    });
  }

  async encerrar(): Promise<void> {
    this.processo.stdin?.end();
    this.processo.kill();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arenahub/edge-agent test ponte-easyinner-processo`
Expected: PASS.

- [ ] **Step 5: Add test for `falha-da-ponte` on invalid stdout**

```ts
  it('devolve falha-da-ponte quando o processo emite linha invalida', async () => {
    const p = spawn(process.execPath, ['-e', `
      process.stdin.on('data', () => process.stdout.write('nao-e-json\\n'));
    `]);
    const ponte = PonteEasyInnerProcesso.comProcesso(p);
    const r = await ponte.executar({ cmd: 'ping', inner: 1 });
    expect(r.tipo).toBe('falha-da-ponte');
    await ponte.encerrar();
  });
```

- [ ] **Step 6: Run and commit**

Run: `pnpm --filter @arenahub/edge-agent test ponte-easyinner-processo`
Expected: PASS.

```bash
git add apps/edge-agent/src/adapters/topdata/ponte-easyinner-processo.ts apps/edge-agent/src/adapters/topdata/ponte-easyinner-processo.spec.ts
git commit -m "feat(edge-agent): ponte EasyInner por stdio no lado Node"
```

---

### Task 2: Programa C# — P/Invoke, thread única e loop stdio

**Files:**
- Create: `apps/edge-agent/native/easyinner-bridge/EasyInnerBridge.cs`
- Create: `apps/edge-agent/native/easyinner-bridge/build.ps1`

**Interfaces:**
- Consumes: `EasyInner.dll` (registrada / em `SysWOW64` ou no diretório do .exe), pelas assinaturas em Global Constraints.
- Produces: `EasyInnerBridge.exe` que lê linhas JSON de stdin (`{cmd,inner,...}`) e escreve linhas JSON em stdout conforme `esquemaRespostaPonte`.

- [ ] **Step 1: Write the C# program** — thread dedicada com fila; P/Invoke; tradução dos 4 comandos. Ver Global Constraints para assinaturas exatas.

```csharp
using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization; // System.Web.Extensions

class EasyInnerBridge {
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte DefinirTipoConexao(byte Tipo);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte AbrirPortaComunicacao(int Porta);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern void FecharPortaComunicacao();
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte ConfigurarInnerOnLine();
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte LiberarCatracaEntrada(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte LiberarCatracaSaida(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte LiberarCatracaDoisSentidos(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte LiberarCatracaEntradaInvertida(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte LiberarCatracaSaidaInvertida(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte PingOnLine(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte ReceberDadosOnLine(int Inner, ref byte Origem, ref byte Complemento,
        StringBuilder Cartao, ref byte Dia, ref byte Mes, ref byte Ano,
        ref byte Hora, ref byte Minuto, ref byte Segundo);

    static readonly JavaScriptSerializer J = new JavaScriptSerializer();
    static readonly BlockingCollection<string> fila = new BlockingCollection<string>();

    static void Main() {
        var saida = Console.Out;
        // thread unica da DLL
        var worker = new Thread(() => {
            foreach (var linha in fila.GetConsumingEnumerable()) {
                string resp;
                try { resp = Tratar(linha); }
                catch (Exception e) { resp = Falha(e.Message); }
                lock (saida) { saida.Write(resp + "\n"); saida.Flush(); }
            }
        });
        worker.IsBackground = true;
        worker.Start();

        string entrada;
        while ((entrada = Console.In.ReadLine()) != null) {
            if (entrada.Trim().Length == 0) continue;
            fila.Add(entrada);
        }
        fila.CompleteAdding();
        try { FecharPortaComunicacao(); } catch { }
    }

    static string Falha(string msg) {
        return J.Serialize(new { tipo = "falha-da-ponte", mensagem = msg });
    }
    static string Retorno(byte r) {
        return J.Serialize(new { tipo = "retorno", retorno = (int)r });
    }

    static string Tratar(string linha) {
        var cmd = (System.Collections.Generic.IDictionary<string, object>)J.DeserializeObject(linha);
        string nome = Convert.ToString(cmd["cmd"]);
        int inner = cmd.ContainsKey("inner") ? Convert.ToInt32(cmd["inner"]) : 0;
        switch (nome) {
            case "ping":            return Retorno(PingOnLine(inner));
            case "testar-conexao":  return Retorno(ConfigurarInnerOnLine());
            case "liberar":         return Liberar(cmd, inner);
            case "receber-evento":  return Receber(inner);
            default:                return Falha("comando desconhecido: " + nome);
        }
    }

    static string Liberar(System.Collections.Generic.IDictionary<string, object> cmd, int inner) {
        string sentido = Convert.ToString(cmd["sentido"]);
        bool inv = cmd.ContainsKey("invertido") && Convert.ToBoolean(cmd["invertido"]);
        byte r;
        if (sentido == "entrada")     r = inv ? LiberarCatracaEntradaInvertida(inner) : LiberarCatracaEntrada(inner);
        else if (sentido == "saida")  r = inv ? LiberarCatracaSaidaInvertida(inner)   : LiberarCatracaSaida(inner);
        else                          r = LiberarCatracaDoisSentidos(inner);
        return Retorno(r);
    }

    static string Receber(int inner) {
        byte origem = 0, comp = 0, dia = 0, mes = 0, ano = 0, hora = 0, min = 0, seg = 0;
        var cartao = new StringBuilder(64);
        byte r = ReceberDadosOnLine(inner, ref origem, ref comp, cartao,
            ref dia, ref mes, ref ano, ref hora, ref min, ref seg);
        if (r != 0) return J.Serialize(new { tipo = "sem-evento" });
        string ocorrido = string.Format("20{0:D2}-{1:D2}-{2:D2}T{3:D2}:{4:D2}:{5:D2}",
            ano, mes, dia, hora, min, seg);
        return J.Serialize(new {
            tipo = "evento",
            evento = new {
                origem = (int)origem,
                complemento = (int)comp,
                cartao = cartao.ToString(),
                ocorridoEm = ocorrido
            }
        });
    }
}
```

- [ ] **Step 2: Write build.ps1**

```powershell
# Compila a ponte EasyInner para x86 (.NET Framework 4.x).
$csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
$out = "$PSScriptRoot\bin\EasyInnerBridge.exe"
New-Item -ItemType Directory -Force "$PSScriptRoot\bin" | Out-Null
& $csc /platform:x86 /nologo /out:$out `
  /reference:System.Web.Extensions.dll `
  "$PSScriptRoot\EasyInnerBridge.cs"
if ($LASTEXITCODE -ne 0) { throw "csc falhou ($LASTEXITCODE)" }
Write-Output "OK: $out"
```

- [ ] **Step 3: Compile**

Run: `pwsh apps/edge-agent/native/easyinner-bridge/build.ps1` (ou `powershell -File ...`)
Expected: `OK: ...\bin\EasyInnerBridge.exe`. Se `csc` reclamar de `System.Web.Extensions`, confirmar o caminho do assembly no GAC ou referenciar por caminho completo.

- [ ] **Step 4: Smoke de protocolo SEM catraca** — rodar o .exe e mandar um comando cuja resposta não dependa de hardware conectado. `ping` sem porta aberta deve retornar código != 0 (não pode travar nem crashar).

Run (manual):
```powershell
echo '{"cmd":"ping","inner":1}' | .\apps\edge-agent\native\easyinner-bridge\bin\EasyInnerBridge.exe
```
Expected: uma linha `{"tipo":"retorno","retorno":<n>}` — prova que a DLL carregou (não deu GPF/8) e o loop stdio funciona.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-agent/native/easyinner-bridge/EasyInnerBridge.cs apps/edge-agent/native/easyinner-bridge/build.ps1
git commit -m "feat(edge-agent): processo-ponte EasyInner em C# (.NET x86, stdio)"
```

---

### Task 3: Ciclo de conexão da ponte + script de teste manual

**Files:**
- Modify: `apps/edge-agent/native/easyinner-bridge/EasyInnerBridge.cs` (adicionar comando `abrir`/`conectar` de setup)
- Modify: `apps/edge-agent/package.json` (script `bridge:build`)
- Create: `apps/edge-agent/native/easyinner-bridge/README.md`

**Interfaces:**
- Consumes: assinaturas `DefinirTipoConexao`, `AbrirPortaComunicacao`, `HabilitarMudancaOnLineOffLine` (Global Constraints).
- Produces: comando de setup `{cmd:"conectar", porta:3570, tempo:10}` que faz `DefinirTipoConexao(2)` → `AbrirPortaComunicacao(porta)` → `HabilitarMudancaOnLineOffLine(2, tempo)` e retorna o pior código de retorno.

> **Nota de escopo:** o comando `conectar` é setup, não está no `esquemaComandoPonte` do contrato Node (que tem 4 comandos de operação). Ele existe só no processo C# e é chamado pela ponte Node no `lancar()`/inicialização — ou exposto como 5º comando interno. Decisão registrada no README; se virar contrato, é emenda ao `easyinner-ponte.ts` (fora desta task).

- [ ] **Step 1: Add `conectar` handler no C#**

```csharp
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte HabilitarMudancaOnLineOffLine(byte Habilita, byte Tempo);
    // no switch de Tratar():
    //   case "conectar": return Conectar(cmd);
    static string Conectar(System.Collections.Generic.IDictionary<string, object> cmd) {
        int porta = cmd.ContainsKey("porta") ? Convert.ToInt32(cmd["porta"]) : 3570;
        byte tempo = cmd.ContainsKey("tempo") ? Convert.ToByte(cmd["tempo"]) : (byte)10;
        byte r1 = DefinirTipoConexao(2);
        byte r2 = AbrirPortaComunicacao(porta);
        byte r3 = HabilitarMudancaOnLineOffLine(2, tempo);
        byte pior = Math.Max(r1, Math.Max(r2, r3));
        return Retorno(pior);
    }
```

- [ ] **Step 2: Recompile e smoke de conexão COM catraca (manual, hardware liberado)**

Run (manual, catraca liberada, sem alunos):
```powershell
$exe = ".\apps\edge-agent\native\easyinner-bridge\bin\EasyInnerBridge.exe"
"{`"cmd`":`"conectar`",`"porta`":3570,`"tempo`":10}","{`"cmd`":`"testar-conexao`"}" | & $exe
```
Expected: dois `{"tipo":"retorno","retorno":0}` — prova que a catraca `.187` conectou pela DLL. Retorno 8 = GPF (bitness/registro); 2 = porta; 1 = catraca não respondeu.

- [ ] **Step 3: Add package.json script**

```jsonc
    "bridge:build": "powershell -ExecutionPolicy Bypass -File native/easyinner-bridge/build.ps1",
```

- [ ] **Step 4: Write README** — pré-requisitos (DLL registrada / no PATH do .exe, .NET 4.x), como compilar (`pnpm --filter @arenahub/edge-agent bridge:build`), como testar manualmente, aviso de que `liberar` gira a catraca de verdade.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-agent/native/easyinner-bridge/ apps/edge-agent/package.json
git commit -m "feat(edge-agent): comando de conexao e build script da ponte EasyInner"
```

---

### Task 4: Teste de giro real da catraca (manual, evidência da POC) + ADR

**Files:**
- Create: `apps/edge-agent/native/easyinner-bridge/TESTE-GIRO.md` (roteiro manual de evidência)
- Modify: `docs/DECISIONS.md` (emenda ao ADR-010)

**Interfaces:**
- Consumes: `.exe` compilado, catraca `.187` conectada.

> ⚠️ **Este é o único passo que gira a catraca fisicamente.** Só executar com hardware liberado, sem alunos, com procedimento de parada de emergência definido (gate do PRD §4). Nunca no CI.

- [ ] **Step 1: Roteiro de evidência** — documento com a sequência: `conectar` → `testar-conexao` (espera 0) → `liberar entrada` → `receber-evento` em loop até `origem:6` (girou) ou `origem:5` (timeout). Registrar retorno de cada passo e a latência entre `liberar` e o evento `origem:6`. Isso produz `M0-AC-003/004/005` e parte de `M0-AC-008`.

- [ ] **Step 2: Executar o roteiro (manual, com o PI)** — coletar:
  - retorno de `liberar` (espera 0);
  - a catraca destravou fisicamente? (observação);
  - `receber-evento` trouxe `origem:6`? em quanto tempo?
  - repetir 10× para `M0-AC-003` (dez liberações, sem dupla liberação — a idempotência é do orquestrador).

- [ ] **Step 3: Preencher as células `PENDENTE-POC`** de `docs/reports/MVP-00-relatorio-poc-topdata.md` com os números reais coletados.

- [ ] **Step 4: Emenda ao ADR-010** em `docs/DECISIONS.md`: registrar que a ponte é **processo .NET Framework 4.x x86 por stdio**, decidido pelo PI em 15/08/2026, com o resultado do teste de giro como evidência.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-agent/native/easyinner-bridge/TESTE-GIRO.md docs/DECISIONS.md docs/reports/MVP-00-relatorio-poc-topdata.md
git commit -m "docs(mvp0): evidencia de giro real e emenda ADR-010 (forma da ponte)"
```

---

## Self-Review

**1. Spec coverage:**
- `M0-FR-006` (comando de liberação) → Task 2 (`LiberarCatraca*`) + Task 4 (giro real).
- `M0-FR-007`/`M0-AC-005` (confirmação de giro) → Task 2 (`ReceberDadosOnLine`, origem 6/5) + Task 4.
- Ponte Windows (ADR-010) → Tasks 1–3 + emenda na Task 4.
- Contrato `PonteEasyInner` → Task 1 implementa; Task 2 responde no formato.
- `PingOnline` (keep-alive) → Task 2 (`ping`) + Task 3 (`conectar` com tempo).
- Idempotência → constraint; já vive no adapter da F3, fora desta ponte (registrado).

**2. Placeholder scan:** sem TODOs; todo passo tem código real ou comando concreto. O único trabalho "manual" (Task 4) é assim por ser giro físico — documentado como roteiro, não código.

**3. Type consistency:** o protocolo stdio Node↔C# usa exatamente os campos de `esquemaComandoPonte`/`esquemaRespostaPonte`. C# emite `tipo` ∈ {retorno, evento, sem-evento, falha-da-ponte} e `evento` com {origem, complemento, cartao, ocorridoEm} — casando com `esquemaEventoCatraca`. `retorno` é int; `origem`/`complemento` são int. Consistente.

**Ponto de processo aberto (não é falha do plano):** esta fatia precisa de **card no board + spec `aprovada-pi`** antes do merge — o PI decidiu o escopo (stdio + .NET 4.x x86), o que destrava a implementação, mas a formalização (issue, spec, emenda ADR) acompanha a entrega. O comando `conectar` (Task 3) é setup fora do contrato de 4 comandos; se for promovido a contrato, é emenda ao `easyinner-ponte.ts`.
