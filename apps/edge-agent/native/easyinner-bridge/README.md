# Ponte EasyInner (processo .NET x86)

Processo Windows que carrega a `EasyInner.dll` da Topdata e a expõe ao
edge-agent (Node) por **stdio**. É o executor físico da catraca Topdata Inner.

**Por que existe:** a `EasyInner.dll` é Windows x86, binária e não thread-safe;
Node não a chama direto. Ver `docs/vendor/topdata/PROTOCOLO-CATRACA.md` e a
emenda ao **ADR-010** (transporte stdio, runtime .NET Framework 4.x x86 —
decisão do PI em 15/08/2026).

O lado Node é `apps/edge-agent/src/adapters/topdata/ponte-easyinner-processo.ts`.

## Pré-requisitos

- **Windows** com **.NET Framework 4.x** (o `csc` em `C:\Windows\Microsoft.NET\Framework\v4.0.30319\`).
- **`EasyInner.dll`** disponível: registrada no sistema (`SysWOW64`) **ou** copiada
  para `bin/` ao lado do `.exe`. É binário licenciado da Topdata (Portal do
  Integrador) e **não vive no repositório** (ver `.gitignore`).

## Compilar

```
pnpm --filter @arenahub/edge-agent bridge:build
```

Gera `bin/EasyInnerBridge.exe` (x86). x86 é obrigatório — um `.exe` x64
carregando a DLL de 32 bits retorna GPF (código 8).

## Protocolo (stdio)

Uma linha JSON de comando entra por stdin; uma linha JSON de resposta sai por
stdout. Comandos e respostas seguem `esquemaComandoPonte` / `esquemaRespostaPonte`
de `easyinner-ponte.ts`. Comandos:

| comando | efeito | perigo |
|---|---|---|
| `{"cmd":"conectar","porta":3570,"tempo":10}` | setup: tipo de conexão, abre porta, modo online | conecta, não gira |
| `{"cmd":"testar-conexao"}` | `ConfigurarInnerOnLine` (0 = catraca respondeu) | leitura |
| `{"cmd":"ping","inner":1}` | `PingOnLine` (keep-alive) | leitura |
| `{"cmd":"receber-evento","inner":1,"timeoutMs":2000}` | lê evento (origem 6 = giro, 5 = timeout) | leitura |
| `{"cmd":"liberar","inner":1,"sentido":"entrada","invertido":false}` | **GIRA A CATRACA** | ⚠️ físico |

Códigos de retorno: `0`=OK, `1`=erro, `2`=porta não aberta, `3`=porta já aberta,
`8`=GPF (bitness/registro/.NET ausente).

## Testar sem catraca

```powershell
echo '{"cmd":"ping","inner":1}' | .\bin\EasyInnerBridge.exe
```

Espera `{"tipo":"retorno","retorno":2}` (porta não aberta) — prova que a DLL
carregou e o loop funciona, sem tocar em hardware.

## ⚠️ Testar giro real

O comando `liberar` **gira a catraca fisicamente**. Só executar com a catraca
liberada para teste, sem alunos, e com procedimento de parada de emergência
definido (gate do PRD §4). Ver `TESTE-GIRO.md`. **Nunca no CI.**
