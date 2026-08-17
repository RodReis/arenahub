# SPEC-002 — Ciclo de vida facial

| campo | valor |
|---|---|
| **Fatia** | F2 |
| **MVP** | 0 |
| **Slice do PRD** | **0.2** — `docs/prd/academia/MVP-00-poc-topdata.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-00-poc-topdata.md` |
| **Status** | `aprovada-pi` |
| **ADRs que bloqueiam** | nenhum |
| **Criada em** | 14/08/2026 |
| **Aprovada pelo PI em** | 14/08/2026 · **ampliada em 17/08/2026** (§2, decisões 1 a 4) |
| **Card** | [#2](https://github.com/RodReis/arenahub/issues/2) |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M0-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 0.2. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> **Aprovada pelo PI em 14/08/2026** — via ADR-022, a Slice do PRD é a spec.
>
> ⚠️ **`aprovada-pi` não é `entregue`.** A janela física de 17/08/2026 provou **cadastro** e
> **reconhecimento** ao vivo, mas o aceite da Slice 0.2 é *"criar, reconhecer **e remover** três
> identidades sem colisão e sem deixar dado órfão"* (`M0-AC-001`/`M0-AC-002`) — a remoção com
> confirmação de ausência **não foi exercitada no equipamento**. Ver §7.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-00-poc-topdata.md` §7, Slice 0.2, e o plano de apoio acima.

**Ampliação de 17/08/2026 (decisão 1 abaixo):** a fatia passa a incluir **a composição de
laboratório** do `edge-agent` — o processo que instancia os adapters e liga
`facial.aoReconhecer → decisão local → catraca.liberar` (`lab:run`). Sem ele, `M0-AC-001` e
`M0-AC-002` não têm como ser exercitados: o leitor facial é **cliente** WebSocket e precisa de um
servidor na 7792 para discar.

## 2. Decisões específicas desta fatia

*(preencher quando houver — decisão com efeito além da fatia vira ADR, não fica aqui)*

Quatro decisões do PI em **17/08/2026**, na janela física, apresentadas pelo Cowork a partir do
field-note `docs/field-notes/2026-08-17-ciclo-facial-ao-vivo.md`.

> ⚠️ **Esse field-note ainda não está na `main`** — vive na branch `feat/f2-facial-senduser`, sem
> PR aberto. O link não é dado até a branch entrar. Registrado sem link de propósito: link quebrado
> em documento de governança ensina que os outros também podem estar.

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | **A "fatia nova de composição do edge-agent" não existe.** O `lab:run` construído em 17/08 é escopo de **F2 (bancada) e F5 (coleta)**; nenhum número novo é alocado | criar `F45` para a composição, como cogitado em 15/08 | a cadeia já roda; abrir fatia para o que está construído é cerimônia sobre fato consumado. **Consequência registrada em §3** |
| 2 | **`senduser` fica só-ack em F2; o consumo para detectar órfãos é escopo real, em fatia futura** | consumir já em F2 · nunca consumir | o ack é o que mantém a conexão viva e basta para a bancada. Consumir é **leitura de reconciliação** (quem está no leitor e não está na nuvem vira **alerta**, nunca cadastro) e pertence ao MVP 1 — ver §3 |
| 3 | **Relógio do leitor: acertar **e** carimbar fallback no Edge.** O Edge grava `recebidoEm` sempre e **ordena por ele** quando o `ocorridoEm` do equipamento for implausível — repetido, no futuro, ou anterior ao último visto. O `ocorridoEm` original **nunca é sobrescrito** | só acertar o relógio, sem código · confiar sempre no carimbo do Edge | acertar o relógio resolve **esta** bancada; não resolve o relógio errado do próximo cliente. Preservar o `ocorridoEm` mantém `M0-BR-004` intacto — o fallback decide **ordem**, não substitui **fato** |
| 4 | **O modo de acionamento da catraca não é escopo do ArenaHub.** `acionamento1: 8` (`CATRACA_LIBERADA_DOIS_SENTIDOS`) é **configuração do equipamento** | tratar como bug de F2/F3 e escrever a config por conta própria | escrever `acionamento` em catraca de produção com endpoint e valor **não confirmados** em manual é chute em equipamento em uso. Vira pré-condição de gate, não código — ver §3 e §7 |

**Fato de campo que virou código, com o PI presente (17/08/2026):** o firmware `ai518_fp26v_v2.16`
envia `senduser` logo após o `reg`, e **exige ack**. Sem resposta o leitor reenvia e derruba a
conexão a cada ~5 s. O comando **não está** nos manuais que temos
(`docs/vendor/topdata/PROTOCOLO-FACIAL.md` descreve revisões anteriores) — é observação de campo,
tratada como tal por `M0-BR-006`, **não** como contrato do fabricante.

## 3. Escopo negativo

*(o que esta fatia deliberadamente não faz, e para onde foi)*

| não faz | vai para |
|---|---|
| **Composição de produção do `edge-agent`** — ordem de inicialização, o que o agente faz ao subir, o que acontece quando um dispositivo não responde (falha alto ou degrada), supervisão e reinício | 🔴 **sem dono declarado.** A decisão 1 dissolveu a fatia que carregaria isto. São decisões de produto do MVP 1 e **precisam de número antes de F9 ir a piloto** — pendência aberta ao PI no `docs/STATUS.md` §1 |
| **Consumir o `senduser`** para reconciliar órfãos entre leitor e nuvem | fatia futura do **MVP 1**, ainda sem número (decisão 2). O alerta é de painel — parente de F11, mas F11 já está `done`; abrir dentro dela seria escopo por omissão |
| **Mudar `acionamento1` da catraca para modo bloqueado** | **pré-condição de gate** do `MVP-00` §4, com o manual do SDK em mãos (decisão 4). É de F3/F5 como *evidência*, de ninguém como *código* |
| **Latência ponta a ponta real** (`M0-NFR-001`) | **F9** (MVP 1) — exige a nuvem no laço. O `lab:run` decide **local** e síncrono, então `latenciaDecisaoMs` arredonda a 0; medir isso e chamar de ponta a ponta seria o número inventado que a guarda de evidência existe para barrar |
| **Importar a base de usuários do leitor** para a nuvem | **lugar nenhum, por princípio.** Regra de arquitetura nº 3: a nuvem é a fonte da verdade, o leitor é executor |
| **Ligar foto no `sendlog`** (`use_logphoto`, `stranger_photo`) | **decisão do PI com base legal antes**, nunca escolha de implementação. Foto de quem não consentiu é tratamento de dado biométrico sem base legal (regra nº 7, ADR-008) |

## 4. Invariantes que esta fatia precisa preservar

*(listar os `INV-nnn` de `docs/CONVENTION.md` §4 que o código desta fatia toca — cada um precisa
de teste, conforme `docs/REVIEW.md` §3)*

> **Recorte honesto:** F2 é MVP 0 — `edge-agent` isolado, sem nuvem e sem tenant. As invariantes
> de multi-tenant (INV-001 a INV-008) **não são tocadas por este código** e não estão listadas.
> Listar invariante que a fatia não toca é ruído que dilui o que o revisor tem de cobrar.

- **`INV-012`** — **CPF nunca é identificador técnico de dispositivo.** Concreto aqui: o
  `externalEnrollId` é numérico de 12 dígitos por exigência do equipamento, e **11 dígitos de CPF
  cabem folgados dentro dele** — o formato deixou de denunciar a violação sozinho. A rede de
  segurança (teste determinista, 5.000 gerações) é a única barreira. Não afrouxar.
- **`INV-016`** — identidade biométrica é entidade separada do cadastro administrativo. No MVP 0
  existe só o lado do dispositivo: `DeviceUser` e mapeamento local.
- **`INV-020`** — não armazenar template bruto quando o dispositivo não exigir. O leitor guarda a
  face; o ArenaHub guarda a correlação.
- **`INV-022`** — **template, token e cartão nunca aparecem em log.** Concreto aqui: o `sendlog`
  traz `image` em Base64 **inclusive de desconhecido** (`enrollid: 99999999`). O adapter desliga
  a foto no handshake (`use_logphoto: 0`, `stranger_photo: 0`) e **descarta sem persistir e sem
  logar** a que chegar mesmo assim. Teste verifica que o Base64 não vaza.
- **`INV-023`** — o protocolo facial **não tem operação em lote**; a fila é individual por
  construção, não por escolha de design.
- **`INV-024`** — uma operação de sync por usuário **e** por dispositivo.
- **`INV-025`** — `external_user_id` é único **por dispositivo**.
- **`INV-026`** — o mapeamento é `Student.id → DeviceUser → enrollid`. No MVP 0 a ponta esquerda é
  o identificador de bancada; a forma da cadeia não muda.
- **`INV-037`** — reconhecimento, decisão, comando e passagem são **correlacionáveis**. É o que a
  decisão 3 protege: `ocorridoEm` congelado embaralha a ordem e quebra a correlação por tempo.

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | A fatia nova de composição do `edge-agent`, decidida em 15/08, sobrevive depois de o `lab:run` ter sido construído dentro de F2? | **Não.** Absorvida por F2/F5; nenhum número novo. A composição **de produção** fica sem dono e volta como pendência ao PI (§3) | 17/08/2026 |
| 2 | O `senduser` do firmware v2.16 deve algum dia ser consumido, ou fica só-ack para sempre? | **Consumir para detectar órfãos** — como leitura de reconciliação que vira alerta, nunca cadastro. **Fora de F2**: fatia futura do MVP 1 | 17/08/2026 |
| 3 | O `ocorridoEm` do leitor veio congelado em `15:47:28`. Acertar o relógio basta, ou o Edge carimba fallback? | **Os dois.** Acertar o relógio **e** ordenar por `recebidoEm` quando o `ocorridoEm` for implausível, preservando o original | 17/08/2026 |
| 4 | Quem muda `acionamento1` de `8` para modo bloqueado? | **Ninguém, por código.** É config do equipamento e vira pré-condição de gate, com o manual do SDK em mãos | 17/08/2026 |

**Nenhuma pergunta em aberto.**

## 6. Antes de codificar, confirme

- [x] Status desta spec é `aprovada-pi`
- [x] Os ADRs listados acima estão resolvidos — **nenhum bloqueia**
- [ ] O gate de entrada do MVP tem evidência registrada — **parcial:** hardware, SDK e manuais
      existem; **rede isolada** não (`GO_WITH_CONSTRAINTS`, `docs/STATUS.md` §1)

## 7. O que falta para esta fatia virar `entregue`

Não é lista de desejo — é o que separa `aprovada-pi` de `entregue` (`docs/specs/README.md` §3:
*"PI aceitou a issue e aplicou `proplan:finalizado`"*).

| # | o que falta | natureza |
|---|---|---|
| 1 | **PR mergeado com CI verde.** O trabalho de 17/08 está na branch `feat/f2-facial-senduser`, **sem PR aberto**. Declarar F2 avançada com código fora da `main` é o *fechamento frágil* que o `CLAUDE.md` §3 nomeia | **Code** |
| 2 | **`M0-AC-002` — remover as três identidades e confirmar a ausência no dispositivo.** A janela de 17/08 provou criar e reconhecer; **remover não foi exercitado** | bancada |
| 3 | **Relógio do leitor acertado** e reavaliação do `ocorridoEm` (decisão 3) | bancada + código |
| 4 | **Aceite do PI na issue [#2](https://github.com/RodReis/arenahub/issues/2)** com `proplan:finalizado` | **só o PI** |

> ⚠️ **Correção de leitura que esta spec registra.** O §9.1 do
> `docs/reports/MVP-00-relatorio-poc-topdata.md`, na branch `feat/f2-facial-senduser`, marca
> `M0-AC-004` como **provado** ("desconhecido → `DENY`, catraca não acionada"). O §9.3 do **mesmo
> arquivo** e o §4 do field-note dizem que ele **não pode fechar** com a catraca em
> `acionamento1: 8`. **Vale o segundo.** Com a catraca liberada nos dois sentidos, *"a catraca não
> foi acionada"* é verdade sobre o **comando** e falsa sobre o **resultado observável** — a pessoa
> negada entra empurrando o braço. Critério de aceite é observável, não interno (ADR-016).

## 8. Fora de dúvida

Já respondido aqui para não reabrir em três meses.

- **"Por que não importamos os usuários que o leitor já tem?"** → Porque a nuvem é a fonte da
  verdade (regra de arquitetura nº 3). O `senduser` é ack hoje e **alerta** amanhã; nunca cadastro.
- **"O `enrollid` numérico não abriu brecha para CPF?"** → Abriu, e está registrado: 11 dígitos de
  CPF cabem nos 12 do `enrollid`. O formato não denuncia mais; o teste denuncia (`INV-012`).
- **"A demora que se vê na catraca é lentidão do ArenaHub?"** → Não. Medido em 17/08: do `sendlog`
  recebido ao `liberar` enviado são **0–1 ms**. A demora é o leitor processando o rosto — hardware
  Topdata, fora do nosso código.
- **"O `--sentido saida` está invertido por engano?"** → Não. Nesta instalação `--sentido saida`
  gira **para dentro**. É dado de campo **por instalação**, por isso o `lab:run` mantém o
  parâmetro configurável em vez de fixar o valor no código.
