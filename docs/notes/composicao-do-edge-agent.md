# Insumo técnico — ligar os adapters ao `main.ts`

> **Isto não é spec nem issue.** É material técnico do Code para o Cowork consumir ao escrever a
> spec da fatia (ADR-023). O escopo de produto continua sendo do PI; o que este documento traz é
> **o que já existe pronto**, **o que falta compor** e **as decisões do PI já registradas** (§5).
>
> **Data:** 15/08/2026 · **Autor:** Claude Code, a pedido do PI
> **Atualizado em 15/08/2026:** as cinco perguntas da §5 foram respondidas pelo PI e viraram
> decisões. A §5.5 exigiu desambiguação — ver o fato de repositório registrado lá.
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
| 1 | **Falha alto**: dispositivo que não responde impede o agente de subir | sem `try/catch` que engula; o processo sai com código ≠ 0 e mensagem clara. ⚠️ **refinada na §5.1** — falha alto só depois de N tentativas |
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

## 5. Decisões do PI — respondidas em 15/08/2026

As cinco perguntas desta seção foram levadas ao PI e **estão fechadas**. Ficam registradas com o
raciocínio original preservado, porque a spec precisa do *porquê*, não só do *quê*.

> **Isto não substitui a spec.** São insumos decididos; a spec do Cowork os transcreve como
> requisito, com número e rastreabilidade.

### 5.1. ✅ Arranque: retry limitado, depois falha alto

**Era a mais importante.** O ADR-011 põe o `edge-agent` no **PC compartilhado da recepção**, com
**início automático** como serviço. O cenário que motivou a pergunta:

> O PC reinicia. O Windows sobe o serviço. A catraca ainda está bootando. O agente falha alto e
> morre. **Ninguém religa** — não há operador olhando, e o alerta de heartbeat (F11) ainda não
> existe.

"Falha alto" é a decisão certa para invocação manual — quem rodou está olhando a saída. No arranque
automático, ela transformava uma condição transitória (catraca lenta no boot) em parada permanente.

**Decisão:** o agente tenta conectar **N vezes com intervalo**; esgotado o limite, **falha alto** —
sai com código ≠ 0, sem `try/catch` que engula. Preserva a regra (nada de operar meio-morto) e
deixa de confundir *"ainda não subiu"* com *"não vai subir"*.

**Valor de partida:** 5 tentativas × 3 s (~15 s de janela). Veio da opção aceita, não de medição —
a spec deve expor os dois números em configuração e a POC física confirma se a janela cobre o boot
real da catraca.

### 5.2. ✅ Queda pós-arranque: a mesma política

Sem regra separada. Dispositivo que cai **depois** de o agente já ter subido entra no mesmo
retry limitado; esgotado, o processo encerra com código ≠ 0. Uma regra só, menos superfície de bug
— e o supervisor de serviço do ADR-011 é quem religa. O alerta de heartbeat continua nascendo em
F11, sem antecipação para esta fatia.

### 5.3. ✅ Evidência: JSON, um arquivo por execução

Estruturado e consumível por script, para alimentar o relatório de F5 **sem transcrição à mão**.

Segue o precedente já estabelecido pela guarda de evidência (`scripts/test-report.mjs`): arquivo
**gerado, nunca editado à mão, conferido pelo CI**. Caminho e nomeação ficam para a spec; o
princípio, não.

### 5.4. ✅ `lab:run`: os dois modos, por flag

- **Interativo** (padrão) — pausa entre passos esperando confirmação do operador: *"a catraca
  destravou?"*, *"girou no sentido esperado?"*. É este modo que satisfaz o `M0-AC-003`, que mede
  acionamento **físico observado**, não retorno de função.
- **Headless** (`--headless` ou equivalente) — roda ponta a ponta sem humano, com
  `FACIAL_MODE`/`CATRACA_MODE` simulados. É o que entra no CI.

Custa um pouco mais de código no runner. Compra as duas garantias sem escolher entre elas.

### 5.5. ✅ Reconciliação: **sim**, contra o `ColetorSimulado` — não contra a nuvem

A pergunta original tinha duas leituras, e o PI escolheu a executável. O que forçou a
desambiguação foi um fato do repositório, verificado em 15/08/2026:

- **`apps/api` está vazia** — zero arquivos `.ts`, nenhum `@Controller`. Não existe endpoint de
  ingestão;
- a única implementação de `Coletor` é o **`ColetorSimulado`**. Não há adapter HTTP.

**Decisão — leitura (a):** o `main.ts` drena a fila periodicamente via `reconciliar`, apontando
para o `ColetorSimulado`. Isso fecha a cadeia inteira — reconhecer → decidir → girar → enfileirar →
drenar — e exercita o `M0-AC-006` (sem duplicação lógica) usando peças que **já existem e já são
testadas**. A fatia continua sendo composição.

**Fora do escopo, explicitamente:** criar `ColetorHttp` e criar o endpoint de ingestão. Enviar de
verdade para a nuvem exigiria o bootstrap da API dentro de uma fatia de POC física do MVP 0 — duas
fatias grudadas. A regra de arquitetura nº 3 (a nuvem é a fonte da verdade) não muda isso: a fonte
da verdade ainda não foi construída.

---

## 6. O que esta fatia **não** deve fazer

Registrado para o escopo negativo da spec:

- **não** implementar o Access Decision Engine — ele vive na nuvem e nasce em **F9** (ADR-004,
  regra de arquitetura nº 1: a catraca nunca consulta assinatura nem invoice);
- **não** expandir o contrato da ponte — os quatro comandos foram deliberadamente estreitos,
  *"cada função da DLL exposta aqui é uma função que alguém pode chamar por engano num equipamento
  real"*;
- **não** mexer nos adapters — eles estão corretos; o que falta é composição;
- **não** adotar BullMQ/Redis — fila entra só com métrica que a justifique (`CLAUDE.md` → Stack);
- **não** criar `ColetorHttp` nem endpoint de ingestão na nuvem — decisão §5.5; a reconciliação
  desta fatia roda contra o `ColetorSimulado`;
- **não** antecipar o alerta de heartbeat — ele nasce em **F11** (decisão §5.2).

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

**O risco era de escopo, e foi fechado.** As cinco perguntas da §5 decidiam comportamento
operacional em produção — respondê-las com "o que for mais simples" é o que produz o serviço que
morre no boot e ninguém percebe. Foram ao PI e voltaram decididas em 15/08/2026.

Com a §5.5 resolvida na leitura (a), a fatia **permanece composição**. Sobra de construção nova,
pequena e delimitada: o laço de retry (§5.1), o runner do `lab:run` nos dois modos (§5.4) e o
escritor de evidência JSON (§5.3).

---

*Insumo datado de 15/08/2026, para a spec da fatia. Não é contrato: onde divergir do PRD ou de um
ADR, o documento mais específico vence.*
