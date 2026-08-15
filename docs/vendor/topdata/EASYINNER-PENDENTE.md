# SDK EasyInner — o que falta para a F3 fechar

> **Status: documentação incompleta.** O `TurnstileAdapter` continua stub por falta de fonte, não
> por falta de trabalho.

## O que já se sabe

O SDK **EasyInner** está **instalado na máquina Windows da bancada** (informado pelo PI em
14/08/2026). É ele que comanda a catraca — os dois manuais do leitor facial cobrem apenas
cadastro de usuário e eventos, não o giro.

Do preview público do *MD EasyInner 01-03 English*:

- **cinco arquivos** necessários — indício de DLL nativa com dependências;
- **dois modos de comunicação: serial e TCP/IP** — a bancada é TCP/IP (F1);
- **dois modos de operação: offline e online**;
- o manual recomenda programar com **máquina de estado**;
- perda de conexão se detecta por comando **ping**.

Isso é orientação de arquitetura, não assinatura de função. **Não dá para escrever o adapter com
isso.**

## O que falta, exatamente

| # | o quê | por quê |
|---|---|---|
| 1 | **função de liberação** — nome, parâmetros, retorno | `M0-FR-006`: comandar uma única liberação |
| 2 | **confirmação de giro** — evento ou polling? | `M0-FR-007` e `M0-AC-005` |
| 3 | **timeout de passagem** — quem controla, nós ou o equipamento? | o `TurnstileAdapter` precisa saber quem manda |
| 4 | **modelo de idempotência** — o EasyInner tem id de comando? | `M0-AC-003`: sem dupla liberação |
| 5 | **a DLL é chamável de Node?** | se for COM/P-Invoke puro, precisa de bridge |

O item 5 é o que **reabre o ADR-010 pela porta dos fundos.** O caminho de dados do leitor facial
é WebSocket e não depende de Windows (ver `PROTOCOLO-FACIAL.md`). Mas se o EasyInner for DLL
nativa sem interface de rede, **a catraca volta a exigir processo Windows** — e aí o plano de
apoio do MVP 0 já previa: *"serviço nativo p/ SDK Topdata"* com bridge por stdin/stdout.

## Onde procurar

- **a pasta de instalação do SDK na máquina da bancada** — normalmente traz o manual em PDF,
  arquivos `.h`/`.pas`/`.cs` de declaração e exemplos. Os arquivos de declaração são a melhor
  fonte: trazem a assinatura exata;
- `https://integrador.topdata.com.br/topicos/api/` → *"Download do SDK para Catracas e Coletores
  da Linha Inner – SDK EasyInner"*;
- suporte da Topdata, com o número de série da catraca.

## O que NÃO fazer

**Não inventar assinatura a partir do preview.** O plano de apoio do MVP 0 é explícito: *"este
plano não inventa chamadas EasyInner ou protocolo facial"*.

Aqui o custo de errar é maior que no adapter facial: um comando inventado que funcione pela
metade **move uma catraca instalada e em uso**. "Parece que funcionou" é o pior resultado
possível.

## Enquanto isso

`TurnstileAdapter` tem porta definida, simulador que **conta acionamentos físicos**, e toda a
regra de decisão testada (F3, PR #57). Quando a documentação chegar, o adapter real se encaixa
numa interface que já tem cobertura — o mesmo que aconteceu com o leitor facial: os manuais
chegaram e o adapter saiu no mesmo dia.
