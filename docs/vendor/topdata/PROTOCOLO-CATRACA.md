# SDK Inner Acesso (EasyInner.dll) — o que o manual diz

> **Fonte:** *Manual de Integração SDK Inner Acesso Topdata — Guia Completo para Desenvolvedores*,
> Rev. 00 (23/07/2025). Recebido do PI em 14/08/2026.
>
> Resumo de leitura, não substitui o manual. Onde divergir, o manual vence.

---

## 🔴 O ADR-010 fecha aqui, e a resposta é: **sim, precisa de Windows**

> *"No coração da SDK está a **EasyInner.dll**, uma biblioteca de vínculo dinâmico (DLL) para
> ambiente Windows."*
>
> *"É fundamental entender que a SDK Inner Acesso **não é uma API REST** ou um serviço web."*
>
> *"A troca de informações ocorre através de um **protocolo binário proprietário** da Topdata."*

Três restrições que não se contornam:

| restrição | citação |
|---|---|
| **Windows-only** | *"biblioteca de vínculo dinâmico (DLL) para o ambiente Windows"* |
| **32 bits (x86)** | *"ela é uma biblioteca de 32 bits (x86)... mesmo que seu sistema operacional seja de 64 bits"* |
| **.NET Framework 3.5+** | *"é necessário que o ambiente de execução possua o .NET Framework 3.5 ou superior"* |

**O protocolo binário não está documentado.** O manual §6.7 menciona que a integração direta por
TCP/IP existe, *"conforme documentação de baixo nível e **solicitação de NDA**"* — ou seja,
reimplementar o protocolo em Node exigiria NDA com a Topdata.

### Consequência para o `edge-agent`

O caminho do **leitor facial** é WebSocket e roda em Node (ver `PROTOCOLO-FACIAL.md`). O caminho
da **catraca** não: precisa de um **processo Windows x86 com .NET** falando com a DLL.

O plano de apoio do MVP 0 já previa: *"serviço nativo p/ SDK Topdata"*. É esse o caminho — um
bridge, com o `edge-agent` comandando por stdin/stdout ou socket local.

**Decisão do PI (ADR-010).** O que o manual permite afirmar:

- não há como o Node chamar a DLL sem bridge nativo, e
- não há como falar com a catraca sem a DLL, sem NDA.

## Duas características da DLL que mandam na arquitetura

> *"a EasyInner.dll é uma biblioteca **bloqueante** e **não thread-safe**"*

| característica | consequência |
|---|---|
| **bloqueante** | a thread para até o comando terminar (sucesso, erro ou timeout) |
| **não thread-safe** | *"Múltiplas threads **não devem** chamar funções da EasyInner.dll simultaneamente"* |

> *"A arquitetura recomendada é criar uma **única thread dedicada** em sua aplicação
> especificamente para toda a comunicação com a EasyInner.dll."*

E o limite de escala: *"limitação prática e testada de gerenciar **aproximadamente 30
equipamentos** simultaneamente a partir de uma única instância da DLL"*. A bancada tem um.

## Nós somos o servidor — igual ao facial

> *"seu software assume o papel de um 'servidor' que fica escutando a porta de comunicação
> definida. As catracas são configuradas para 'apontar' para o IP e porta desse seu software"*

| | |
|---|---|
| porta padrão | **3570** (o facial usa 7792 — são portas diferentes) |
| tipo de conexão | `DefinirTipoConexao(2)` = TCP/IP com porta fixa |
| identificação | **Número do Inner**, de 1 a 99 — a bancada usa **1** |

O Número do Inner é **independente da porta**: várias catracas na mesma porta, cada uma com seu
número.

## As funções que a F3 precisa

### Liberação — o que o `M0-FR-006` pede

| função | o que faz |
|---|---|
| `LiberarCatracaEntrada(Inner)` | libera giro **no sentido de entrada** |
| `LiberarCatracaSaida(Inner)` | libera no sentido de saída |
| `LiberarCatracaDoisSentidos(Inner)` | libera nos dois |
| `LiberarCatracaEntradaInvertida(Inner)` | quando a instalação física inverte o sentido |

⚠️ **A bancada pode precisar da versão invertida.** O software de fábrica registra *"ao entrar, a
catraca está instalada à sua **esquerda**"* (F1) — o manual diz que a escolha *"depende da
orientação física da catraca"*. **Isso se verifica na bancada, não se adivinha.**

⚠️ **Não usar `ConfigurarAcionamento1/2` para girar.** O manual é explícito: *"Estes comandos não
devem ser utilizados em catracas se a intenção for acionar o mecanismo de giro. Para o giro de
catracas, utilize os comandos `LiberarCatraca...()`"*.

### Confirmação de giro — o `M0-FR-007` e o `M0-AC-005`

Não há callback. O desfecho chega pelo **polling** de `ReceberDadosOnLine`, no parâmetro
`Origem`:

| `Origem` | significa | para nós |
|---|---|---|
| **6** | `ORIGEM_GIRO_CATRACA_TOPDATA` — giro confirmado | desfecho `girou` |
| **5** | `ORIGEM_FIM_TEMPO_ACIONAMENTO` — tempo expirou, não girou | desfecho `timeout` |
| 2 / 3 | leitura no Leitor 1 / Leitor 2 | evento de acesso |
| 1 | teclado | evento de acesso |
| 21 | QR Code | evento de acesso |
| 12 | sensor biométrico (digital) | não usado na bancada |
| 7 / 20 | urna: cartão recolhido / urna cheia | não se aplica |

> *"Se um evento Origem 5 for recebido antes da Origem 6, significa que o tempo de liberação
> expirou e o giro não ocorreu."*

### Timeout de passagem — quem manda é o equipamento

> *"O tempo que a catraca permanece destravada após um comando de liberação é definido nas
> configurações de acionamento... **O 'tempo de giro' não é uma configuração separada**, mas sim a
> duração em que o relé de liberação permanece acionado."*

Ou seja: o **equipamento** controla o prazo, via `ConfigurarAcionamento1/2` (0 a 50 s). O nosso
`timeoutMs` é o teto do **nosso** polling, não do equipamento — os dois têm de ser coerentes, e o
nosso precisa ser maior.

### Idempotência — o EasyInner **não tem**

⚠️ **Nenhuma função de liberação aceita id de comando.** A assinatura é
`LiberarCatracaEntrada(int Inner)` e nada mais. Chamar duas vezes **libera duas vezes**.

Isso confirma que a idempotência tem de viver do nosso lado — que é o que a F3 já faz, com o
`comandoId` no adapter e a serialização por pessoa. A diferença é que agora sabemos: **o
equipamento não ajuda**, a garantia é inteiramente nossa.

## Retornos

| valor | significado |
|---|---|
| `0` | `RET_COMANDO_OK` — sucesso |
| `1` | `RET_ERRO` — erro genérico (timeout, parâmetro inválido, estado errado) |
| `2` | porta não foi aberta |
| `3` | porta já está aberta |
| `8` | **GPF** — DLL não registrada, .NET 3.5 ausente, ou app 64 bits carregando DLL 32 bits |
| `128`–`130` | parâmetro inválido em lista offline (padrão, dígitos, horário) |

> *"A principal fonte para consultar a lista completa de códigos de retorno... são os **exemplos
> de código** da SDK."* O manual não é exaustivo.

## Máquina de estados — o fluxo que o manual prescreve

```
CONECTAR ─(TestarConexaoInner=0)→ ENVIAR_CFG_OFFLINE → CONFIGMUD_ONLINE_OFFLINE
   ↑                                                             ↓
RECONECTAR ←──────────────── (erro em qualquer passo) ───── ENVIAR_CFG_ONLINE
                                                                 ↓
                                                    CONFIGURAR_ENTRADAS_ONLINE
                                                                 ↓
                                                          ENVIAR_MSG_PADRAO
                                                                 ↓
   ┌──────────────────────────────────────────────────────→ POLLING
   │                                                             ↓
   │                                          (evento) → VALIDAR_ACESSO
   │                                                       ↙          ↘
   │                                      LIBERAR_CATRACA          MSG_ACESSO_NEGADO
   │                                              ↓                        │
   └──────── (Origem 6 ou 5) ── MONITORA_GIRO_CATRACA                      │
   └─────────────────────────────────────────────────────────────────────┘
```

`AbrirPortaComunicacao` é chamada **uma vez**, antes do loop.

## `PingOnline` — o keep-alive que impede a catraca de cair para offline

> *"sua aplicação... deve enviar o comando `PingOnline(NumeroInner)` regularmente (em um intervalo
> **menor que o Tempo** configurado na mudança automática). A falta do PingOnline fará com que a
> catraca **mude para o modo offline**."*

`HabilitarMudancaOnLineOffLine(2, tempo)` = modo online TCP com ping, `tempo` de 1 a 50 s.

## Modo online vs. offline — e o que o MVP 0 usa

| | online | offline |
|---|---|---|
| quem decide | **nosso software** | a própria catraca (lista branca/negra na memória) |
| eventos | tempo real, `ReceberDadosOnLine` | ficam como **bilhetes**, coletados por `ColetarBilhete` |
| exige | conexão contínua + ping | nada |

**A POC usa online:** a decisão é nossa (`M0-FR-005`), e o manual recomenda online justamente para
*"integração com leitores faciais ou QR Code que dependem de validação externa"*.

O **offline importa para a F4** (Slice 0.4, reconciliação): quando a conexão cai, a catraca guarda
bilhetes, e `ColetarBilhete` os recupera — com `Tipo` 10/11 (entrada/saída por cartão), 12/13
(negados) e **128 = bilhete repetido**, que é o sinal de deduplicação que a F4 precisa.

## O manual confirma o que a F2 já fez

> §5.4: *"a comunicação com o leitor facial é feita diretamente entre o software de integração e o
> leitor, **não passando pela EasyInner.dll** ou pela placa controladora da catraca"* — WebSocket,
> JSON, porta 7792.

Dois caminhos independentes, dois protocolos, duas portas. É por isso que `FacialDeviceAdapter` e
`TurnstileAdapter` são portas separadas desde a F2.

## O que ainda falta para o adapter real rodar

1. **decisão do PI sobre o ADR-010** — o bridge Windows é obrigatório, mas a forma (serviço .NET
   com stdio? socket local? fila?) é decisão de arquitetura;
2. **os exemplos de código da SDK** — o manual manda consultá-los para códigos de retorno e para a
   montagem exata da configuração. Estão no portal do integrador, em C#/Java/Delphi/VB6;
3. **cadastro de integrador na Topdata** — §8.2: o suporte exige empresa cadastrada;
4. **janela combinada + parada de emergência** — girar a catraca é efeito físico.
