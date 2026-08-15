# Teste de giro da catraca — roteiro e evidência

Roteiro manual para exercitar a ponte EasyInner contra a catraca real e coletar
`M0-AC-003/004/005` (giro, confirmação, latência). **Nunca no CI** — gira a
catraca fisicamente.

## Pré-condições (todas obrigatórias)

- [ ] catraca liberada para teste, **sem alunos**;
- [ ] procedimento de parada de emergência à mão;
- [ ] software legado desligado no servidor `.106`;
- [ ] **catraca apontando para o edge-agent** — `ipServer` = IP desta máquina
  (não `.106`), `porta 3570`; a catraca reconectada após a mudança;
- [ ] firewall do edge-agent com a `3570` de entrada liberada.

> A catraca é **cliente**: ela disca para o `ipServer` configurado nela. Se esse
> valor não for o IP do edge-agent, a catraca nunca conecta na ponte e nenhum
> comando funciona (todos retornam 1, firmware volta `0.00.00`).

## Roteiro

Comandos (um JSON por linha), enviados pela ponte via `driver-teste.mjs`:

```
{"cmd":"conectar","porta":3570,"tempo":10}
{"cmd":"versao","inner":1}                     # sonda: retorno 0 e FW real = conectou
{"cmd":"liberar","inner":1,"sentido":"entrada","invertido":false}
{"cmd":"receber-evento","inner":1,"timeoutMs":3000}   # repetir ate origem 6 ou 5
```

Rodar:

```powershell
node native/easyinner-bridge/driver-teste.mjs `
  native/easyinner-bridge/bin/EasyInnerBridge.exe `
  <arquivo-de-comandos>
```

Coletar por liberação: retorno de `liberar` (espera 0), se a catraca destravou
(observação), e o evento — `origem:6` = girou (medir latência liberar→evento),
`origem:5` = timeout. Repetir 10× para `M0-AC-003`.

## Resultado em 15/08/2026 — GIRO BLOQUEADO POR CONFIG

Executado com o PI presente, catraca liberada, legado desligado. **A ponte
funcionou; o giro não ocorreu por configuração da catraca, não por código.**

Comprovado:
- ponte compila x86, carrega `EasyInner.dll` sem GPF (smoke `ping` → retorno 2);
- protocolo stdio OK (3 testes unitários verdes);
- `AbrirPortaComunicacao(3570)` → ponte em `LISTEN` na 3570;
- sequência de init online implementada (conforme `FrmOnlineController.cs`).

Bloqueio:
- `versao`/`liberar`/`acionar-rele` → retorno `1`, firmware `0.00.00`;
- `Get-NetTCPConnection 3570`: ponte em `LISTEN`, **sem `ESTABLISHED` com `.187`**
  — a catraca nunca discou;
- `GET /info` (API autenticada) revelou **`"ipServer":"192.168.2.106"`** — a
  catraca continua apontada para o legado.

O PI optou por **não alterar a config da catraca em produção**. Correto: mudar
`ipServer` é cutover, não teste. **A ponte fica pronta e comprovada; o giro real
aguarda a janela de cutover** (ver field-note §9 e
`docs/reports/MVP-00-relatorio-poc-topdata.md`).
