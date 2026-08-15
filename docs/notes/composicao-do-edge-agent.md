# Insumo técnico — ligar os adapters ao `main.ts`

> **Isto não é spec nem issue.** É material técnico do Code para o Cowork consumir ao escrever a
> spec da fatia (ADR-023). O escopo de produto continua sendo do PI; o que este documento traz é
> **o que já existe pronto**, **o que falta compor** e **as perguntas que a spec precisa fechar**.
>
> **Data:** 15/08/2026 · **Autor:** Claude Code, a pedido do PI
> **Origem:** achado do PR [#64](https://github.com/RodReis/arenahub/pull/64) — o `main.ts` não
> liga nos equipamentos e o `lab:run` do gate não existe.

---

## 1. O problema, em uma frase

Os adapters estão prontos, testados e desacoplados. **Ninguém os instancia.**

```
$ grep -rn "TopdataFacialAdapter" apps/edge-agent/src --include=*.ts \
    | grep -v "\.spec\.ts" | grep -v "adapters/topdata/"
apps/edge-agent/src/domain/facial-device.ts:4: * O `TopdataFacialAdapter` e o simulador implementam esta interface.
```

Só o comentário. O `main.ts` sobe, valida config, emite heartbeat a cada 30 s e encerra
graciosamente — e o próprio arquivo declara que *"adapter de dispositivo, fila e reconciliação são
das fatias seguintes"*.

**Consequência:** `M0-AC-001`, `M0-AC-002` e a latência ponta a ponta do `M0-NFR-001` não têm como
ser exercitados, mesmo com o hardware liberado e o cutover feito.

---

## 2. O que já existe — e é bastante

Esta fatia é **composição**, não construção. Nada abaixo precisa ser escrito de novo.

| peça | onde | estado |
|---|---|---|
| `FacialDeviceAdapter` (porta) | `domain/facial-device.ts` | contrato fechado, 5 métodos |
| `TopdataFacialAdapter` | `adapters/topdata/topdata-facial-adapter.ts` | protocolo dos manuais, testado |
| `FacialSimulator` | `adapters/facial-simulator.ts` | contratual, roda em CI |
| `TurnstileAdapter` (porta) | `domain/turnstile.ts` | contrato fechado |
| `TopdataInnerAdapter` | `adapters/topdata/topdata-inner-adapter.ts` | sobre a ponte, testado |
| `TurnstileSimulator` | `adapters/turnstile-simulator.ts` | **conta acionamentos físicos** |
| `PonteEasyInnerProcesso` | `adapters/topdata/ponte-easyinner-processo.ts` | stdio, .NET x86 (PR #62) |
| `criarProcessadorDePassagem` | `application/orquestrar-passagem.ts` | **o caminho de produção** — serializa por pessoa |
| `sincronizarIdentidade` | `application/sincronizar-identidade.ts` | ciclo de vida facial |
| `FilaDeEventos` | `persistence/fila-de-eventos.ts` | SQLite durável, `synchronous = FULL` |
| `reconciliar` | `application/reconciliar.ts` | reenvio idempotente |
| `resumirLatencia` | `application/orquestrar-passagem.ts` | p50/p95/máx, nearest-rank |
| `montarHeartbeat` | `health/health-check.ts` | já usado pelo `main.ts` |

**O desenho já antecipou esta fatia.** `criarProcessadorDePassagem` documenta: *"Quem conectar
`aoReconhecer` do dispositivo usa isto, não `processarReconhecimento` direto"*. O ponto de conexão
está nomeado e avisado — só não foi conectado.

---

## 3. O que falta compor

### 3.1. A montagem

Um módulo que, a partir da `Config`, escolha real ou simulador para cada dispositivo, instancie o
que for preciso e devolva as peças ligadas. É o único lugar do `edge-agent` que conhece as duas
implementações de cada porta.

Fluxo a ligar:

```
leitor facial  --aoReconhecer-->  processadorDePassagem  --liberar-->  catraca
                                          |
                                          +--> fila de eventos (SQLite)
                                          +--> medições de latência
```

### 3.2. Ordem de inicialização

A ordem importa e não é arbitrária:

1. **catraca antes do facial.** O leitor pode disparar reconhecimento assim que conecta; se o
   processador ainda não tem catraca, o primeiro evento se perde ou explode;
2. **`aoReconhecer` por último.** Registrar o ouvinte é o que "liga a chave" — tudo a jusante
   precisa estar pronto antes;
3. **encerramento na ordem inversa**, drenando a fila (`M0-NFR-007`).

### 3.3. `lab:run`

Script que sobe a composição em modo bancada, roda o roteiro e **grava evidência**
(decisão do PI, §5). É o comando que o gate do PRD e o field-note §8 já citam e que não existe.

---

## 4. Decisões do PI — tomadas em 15/08/2026

Registradas aqui como insumo; a spec as formaliza.

| # | decisão | consequência técnica |
|---|---|---|
| 1 | **Falha alto**: dispositivo que não responde impede o agente de subir | sem `try/catch` que engula; o processo sai com código ≠ 0 e mensagem clara. ⚠️ ver §6 |
| 2 | **Um flag por dispositivo** — `FACIAL_MODE` e `CATRACA_MODE`, cada um `real \| simulador` | substitui o `USE_SIMULATOR` booleano; permite ensaiar o facial real com catraca simulada, sem girar nada |
| 3 | **Grava arquivo de evidência** por execução | tentativas, decisões, latências e percentis; alimenta o relatório F5 sem transcrição à mão |

**Coerência da nº 1 com o que já existe:** o `TopdataFacialAdapter` já lança
`TopdataAdapterNaoImplementadoError` em vez de devolver `{ confirmado: false }`, justamente para
que erro de programação não se disfarce de erro de operação. Falhar alto no arranque é a mesma
regra, um nível acima.

**Efeito da nº 2 na compatibilidade:** `USE_SIMULATOR` é usado hoje pelo `main.ts`, pelo
`descreverConfig` e pelos testes de `env`. Trocar por dois campos toca esses três pontos. O padrão
de ambos deve continuar **simulador**, para o CI seguir rodando sem hardware (`M0-NFR-006`).

**Sobre a nº 3, uma restrição que a spec precisa carregar:** o arquivo de evidência **não pode
conter PII nem template biométrico** (`CLAUDE.md` → Convenções). `externalEnrollId` e rótulo
operacional entram; nome, CPF e foto, não.

---

## 5. Perguntas abertas — a spec precisa fechá-las

### 5.1. 🔴 O arranque automático contradiz o "falha alto"?

**A mais importante.** O ADR-011 põe o `edge-agent` no **PC compartilhado da recepção**, com
**início automático** como serviço. O cenário:

> O PC reinicia. O Windows sobe o serviço. A catraca ainda está bootando. O agente falha alto e
> morre. **Ninguém religa** — não há operador olhando, e o alerta de heartbeat (F11) ainda não
> existe.

"Falha alto" é a decisão certa para invocação manual — quem rodou está olhando a saída. No arranque
automático, ela transforma uma condição transitória (catraca lenta no boot) em parada permanente.

**Sugestão do Code, não decisão:** falha alto **depois** de um número limitado de tentativas de
conexão, com intervalo. Isso preserva a regra — o agente não opera meio-morto — sem confundir
*"ainda não subiu"* com *"não vai subir"*. Quantas tentativas e em que intervalo é do PI.

### 5.2. Qual o comportamento quando o dispositivo cai **depois** de subir?

A decisão nº 1 cobre o **arranque**. Queda em operação é outro caso, e o ADR-011 já obriga alerta
de heartbeat em F11. Encerrar o processo? Marcar indisponível e seguir? A spec decide.

### 5.3. Onde vive o arquivo de evidência, e qual formato?

JSON estruturado (consumível por script) ou Markdown (legível na hora)? Caminho fixo ou por
configuração? Um por execução ou acumulado?

> A guarda de evidência (`scripts/test-report.mjs`) já estabelece um precedente no repositório:
> arquivo gerado, nunca editado à mão, conferido pelo CI. Vale considerar o mesmo princípio.

### 5.4. O `lab:run` roda o roteiro sozinho ou é interativo?

O roteiro da POC exige **observação humana** entre passos — *"a catraca destravou?"*, *"girou no
sentido esperado?"*. Um script que dispara dez liberações seguidas sem pausa não deixa ninguém
verificar, e `M0-AC-003` mede acionamento **físico** observado, não retorno de função.

### 5.5. Esta fatia inclui a reconciliação com a nuvem?

`FilaDeEventos` e `reconciliar` existem (F4), mas o `COLLECTOR_URL` é opcional e a POC roda em
modo bancada. Ligar a fila local é claramente escopo; **enviar para a nuvem** talvez não seja.

---

## 6. O que esta fatia **não** deve fazer

Registrado para o escopo negativo da spec:

- **não** implementar o Access Decision Engine — ele vive na nuvem e nasce em **F9** (ADR-004,
  regra de arquitetura nº 1: a catraca nunca consulta assinatura nem invoice);
- **não** expandir o contrato da ponte — os quatro comandos foram deliberadamente estreitos,
  *"cada função da DLL exposta aqui é uma função que alguém pode chamar por engano num equipamento
  real"*;
- **não** mexer nos adapters — eles estão corretos; o que falta é composição;
- **não** adotar BullMQ/Redis — fila entra só com métrica que a justifique (`CLAUDE.md` → Stack).

---

## 7. Invariantes e requisitos que a fatia toca

Para a §4 da spec (`docs/CONVENTION.md` §4) e a rastreabilidade do PRD:

| requisito | como esta fatia o toca |
|---|---|
| `M0-FR-002`/`003`/`004` | passam a ser exercitáveis contra o leitor real |
| `M0-FR-006` | o comando de liberação sai do processador, não de teste manual |
| `M0-NFR-001` | latência **ponta a ponta** passa a ser medível |
| `M0-NFR-004` | `correlationId` precisa atravessar a composição inteira |
| `M0-NFR-006` | o padrão dos dois flags continua simulador — CI sem hardware |
| `M0-NFR-007` | encerramento gracioso ganha o que drenar: fila, adapters, ponte |
| `M0-AC-001`/`002` | destravados por esta fatia |
| `M0-AC-003`/`004` | já garantidos no código; passam a ser verificáveis no equipamento |

---

## 8. Tamanho e risco

**Composição, não construção.** As peças difíceis — protocolo, idempotência, anti-repique,
serialização por pessoa, fila durável — já estão feitas e testadas.

**O risco não é técnico, é de escopo:** as perguntas da §5, sobretudo a §5.1, decidem
comportamento operacional em produção. Respondê-las com "o que for mais simples" é o que produz o
serviço que morre no boot e ninguém percebe.

---

*Insumo datado de 15/08/2026, para a spec da fatia. Não é contrato: onde divergir do PRD ou de um
ADR, o documento mais específico vence.*
