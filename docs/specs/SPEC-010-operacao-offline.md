# SPEC-010 — Operação offline

| campo | valor |
|---|---|
| **Fatia** | F10 |
| **MVP** | 1.5 |
| **Slice do PRD** | **1.5** — `docs/prd/academia/MVP-01-smart-access.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-01-05-offline-operation.md` |
| **Status** | `aprovada-pi` |
| **ADRs que bloqueiam** | nenhum. **ADR-007 fechou em 16/08/2026**; o ADR-011 fechou em 14/08/2026 |
| **Criada em** | 14/08/2026 |
| **Aprovada pelo PI em** | 16/08/2026 · **completada em 17/08/2026** (§2, decisão 4 e §3) |
| **Card** | [#10](https://github.com/RodReis/arenahub/issues/10) |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M1-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 1.5. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> **Aprovada pelo PI em 16/08/2026**, com o fechamento do **ADR-007**. **Sem urgência:** esta
> fatia migrou para o MVP 1.5 por ADR-012 — o gate é o MVP 1 em piloto com incidente de link
> medido.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-01-smart-access.md` §7, Slice 1.5, e o plano de apoio acima.

**Enquanto esta fatia não existir, vale a `INV-145`:** a nuvem decide sempre (ADR-004); queda de
link ou Edge ausente caem em **liberação manual registrada** (`M1-FR-023`) — nunca em allow local.
Improvisar cache no meio do MVP 1 é violar o ADR-012.

### 1.1 Estado verificado em 04/10/2026

> Conferido no código e na documentação em 04/10/2026. **Não muda escopo**: registra o que mudou
> desde a aprovação de 16/08 e deixa as decisões para o PI (§5, perguntas 2 a 4).

- **Nada do escopo da F10 existe.** Sem snapshot assinado/versionado, sem `cache_validity` e
  `grace_period` por unidade, sem denylist, sem `ALLOWED_OFFLINE_CONFLICT`. O
  `cache-de-permissoes.ts` segue sendo o cache de laboratório da F4 e nenhum código de produção o
  importa. A F4 deixou fila SQLite durável e reconciliação idempotente — base reaproveitável, não
  snapshot.
- **MVP 1 em produção desde 01/10/2026** (Arena Positiva). **Nenhum incidente de link** consta em
  `docs/`: o gatilho do ADR-012 **não está comprovado**.
- **O registro das passagens offline já foi antecipado fora da F10**, por decisão do PI de
  30/09/2026 (#477, PR #479): rota `POST /api/v1/edge/offline-passages`, motivo
  `OFFLINE_DEVICE_DECISION`, evento `mode OFFLINE` com o horário do equipamento. Quem decidiu foi
  a **catraca**, não o ArenaHub. A F10 não refaz isso.
- **Dois decisores offline possíveis.** Desde o #470 o Edge mantém a catraca online por
  keep-alive; agente parado = a catraca volta ao modo offline em ~10 s e decide pela lista
  própria (runbook `operacao-edge-arena-positiva.md`). A decisão local do Edge (snapshot) é
  **outro** decisor. A spec não diz quem prevalece quando os dois existem.
- **ADR-064 (01/10/2026)** revogou a regra nº 7 e importa todo aluno da base do leitor com
  consentimento `ACCEPTED`. A revogação feita pelo painel continua bloqueando **na nuvem**
  (`IdentityResolver` exige identidade `ACTIVE`). A justificativa da denylist (§2, decisão 2) se
  apoia em base legal, e o `CLAUDE.md` afasta LGPD/consentimento do caminho de desenvolvimento —
  o item precisa de decisão do PI.
- **O gatilho "Edge instalado em cliente" da §2, decisão 4, já ocorreu** (01/10/2026). O primeiro
  ADR de contrato de Edge está devido, ou o PI o dispensa.
- **Razões de `DENY`:** o ADR-024 já fixou a lista canônica (seis razões de `DENY`). Falta
  conferir se a razão pós-carência e `ALLOWED_OFFLINE_CONFLICT` cabem nela ou exigem ADR novo.
- **`DataFreshness` (F11)** não foi conferido quanto a exibir a idade do snapshot.

## 2. Decisões específicas desta fatia

*(preencher quando houver — decisão com efeito além da fatia vira ADR, não fica aqui)*

As quatro decisões de semântica offline viraram **ADR-007**, fechado em 16/08/2026. Não se
repetem aqui. O que a fatia precisa absorver delas:

1. **Idade do snapshot é dado de operação.** A restrição da janela de carência (decisão 1) só não
   vira negativa frequente porque o stream mantém o snapshot fresco (decisão 4). O painel
   operacional precisa mostrar **a idade**, não apenas online/offline — senão falha de rede chega
   ao suporte disfarçada de bug de acesso. O `DataFreshness` de
   [`docs/design/DS-PAINEL.md`](../design/DS-PAINEL.md) §8.2 é o componente.
2. **Denylist de consentimento revogado no snapshot — campo que não existe.** A decisão 3 obriga
   o Edge a bloquear offline quem revogou consentimento biométrico. F8 entregou bloqueio lógico
   **na nuvem**; não há lista que o Edge carregue. **Ver a correção material da decisão 4 abaixo:
   isto é escopo virgem, não alteração de contrato.**
3. **`ALLOWED_OFFLINE_CONFLICT` registra a passagem, não revalida o direito.** O evento entra como
   fato ocorrido e sinalizado. Não cria entitlement, não reabre janela, não altera cobrança.

**Decisão 4 — do PI, em 17/08/2026, com uma correção material embutida.**

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 4 | **O contrato de snapshot nasce dentro de F10, já com a denylist, em `schemaVersion: 1`.** O versionamento fica registrado nesta spec; o **primeiro ADR de contrato de Edge nasce quando houver Edge instalado em cliente** | ADR novo de contrato antes da F10 · emendar o ADR-011 | não há Edge em campo para quebrar. Fechar por ADR a forma de um contrato que nunca saiu de casa é cerimônia sobre um artefato sem consumidor. Emendar ADR aceito é a erosão que o ADR-021 nomeia |

> 🔴 **Correção material — a premissa do ADR-007 está errada.** A "Consequência 2" do ADR-007 diz
> que a denylist *"provavelmente altera o contrato de snapshot que F4 já implementou"*.
> **Não existe esse contrato.** O que a F4 entregou é
> `apps/edge-agent/src/persistence/cache-de-permissoes.ts` — um **cache local de laboratório da
> Slice 0.4**, populado à mão, com três colunas (`external_enroll_id`, `valida_ate`,
> `sincronizado_em`) e **sem** `schemaVersion`, **sem** assinatura, **sem** `tenant_id`,
> **sem** `gym_unit_id` e **sem** expiração de snapshot. O próprio arquivo diz, no cabeçalho:
> *"quem vai populá-lo de verdade é a sincronização com a nuvem, em fatia futura"*.
>
> **Efeito prático:** o snapshot assinado e versionado exigido por `M1-FR-025`/`M1-FR-026` e por
> `INV-054`/`INV-055` é **escopo virgem de F10**. Não há bump, não há migração de contrato, não há
> compatibilidade retroativa a manter — a denylist entra como campo **de nascença**, o que é mais
> barato que qualquer das três opções que a pergunta original oferecia. Verificado no código em
> 17/08/2026.

## 3. Escopo negativo

*(o que esta fatia deliberadamente não faz, e para onde foi)*

| não faz | vai para |
|---|---|
| **Renderizar a idade do snapshot no painel.** F10 **publica o dado** (idade, versão, estado degradado); quem desenha é o `DataFreshness` | **F11**, já entregue (PR [#75](https://github.com/RodReis/arenahub/pull/75)). Se o campo não existir lá, é `[FIX]` de F11 com esta spec como fonte — não escopo de F10 |
| **Implementar a liberação assistida do operador.** Passado o `grace_period` o motor devolve `DENY`; o caminho humano **já existe** | **F9** — `M1-FR-023`, override com permissão, motivo e auditoria. F10 apenas **encaminha para ele**, não o reconstrói |
| **Fechar a lista canônica de razões de `DENY`.** `ALLOWED_OFFLINE_CONFLICT` e a razão da negativa pós-carência **entram** nela; não a definem | pendência do PI em `docs/DESIGN-UI.md` §17 item 2 (`INV-038`). ⚠️ **Se a lista não fechar antes de F10 codificar, o Code para e pergunta** — inventar razão estável é criar enum que vira contrato por acidente |
| **Mudar o caminho da revogação por pagamento.** Continua aceita e sinalizada como conflito normal | **lugar nenhum** — é a decisão 3 do ADR-007, e a exceção vale **só** para revogação de consentimento biométrico |
| **Propagar revogação por polling apenas.** O stream persistente é o que torna a decisão 1 barata | é a decisão 4 do ADR-007; o polling **reconcilia**, não substitui o stream |
| **Decidir offline fora da validade e da carência aprovadas** | **nunca.** `M1-BR-008` e `INV-053`; dado vencido **nunca** vira allow ilimitado |
| **Reaproveitar o `CacheDePermissoes` do MVP 0 como se fosse o snapshot** | ele é banco operacional descartável de bancada (`INV-057`). O snapshot de F10 é artefato novo, assinado e versionado |

## 4. Invariantes que esta fatia precisa preservar

*(listar os `INV-nnn` de `docs/CONVENTION.md` §4 que o código desta fatia toca — cada um precisa
de teste, conforme `docs/REVIEW.md` §3)*

**O bloco §4.8 inteiro (`INV-049` a `INV-058`) é desta fatia** — ele descreve o alvo que F10
realiza. Os que exigem teste com nome próprio, porque não caem de graça da implementação:

- **`INV-052`** — decidir offline **apenas** dentro da validade e da carência aprovadas.
- **`INV-053`** — **dado vencido resulta em negação ou fallback explícito, nunca em allow
  ilimitado.** Propriedade de teste, não asserção pontual.
- **`INV-054`** — snapshot tem integridade, tenant, unidade, versão e expiração **validados**;
  expirado **não é aceito**. É o campo que a decisão 4 diz nascer aqui.
- **`INV-055`** — snapshot é assinado ou autenticado.
- **`INV-056`** — modo degradado e idade do cache **visíveis para a operação**.
- **`INV-057`** — a nuvem é fonte de verdade; o SQLite do Edge é operacional e **descartável**.
- **`INV-058`** — nenhum evento persistido se perde no reinício do Edge.

Fora do §4.8, esta fatia toca:

- **`INV-018`** — **revogação produz bloqueio lógico imediato.** É a razão de a denylist existir:
  hoje o bloqueio é da nuvem, e offline a nuvem não está no laço. Sem a lista carregada, um giro
  biométrico depois da revogação é **tratamento de dado sem base legal** — não é conflito
  operacional (ADR-007 decisão 3, ADR-008 decisão 3).
- **`INV-043`** — evento de passagem é **imutável**; `ALLOWED_OFFLINE_CONFLICT` marca o fato, não
  corrige o anterior.
- **`INV-045`** — `idempotency_key` única por origem; **um** processamento lógico por evento.
- **`INV-048`** — backlog reconciliado com idempotência **mantendo o horário original**.
- **`INV-145`** — enquanto F10 não existir, a nuvem decide sempre. Esta fatia é o que **revoga**
  essa restrição, e só para a unidade com política offline habilitada (`INV-051`).

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | A denylist de consentimento revogado altera o contrato de snapshot da F4. Cria ADR novo, emenda o ADR-011, ou versiona dentro da fatia? | **Versiona dentro da F10**, registrado nesta spec. **E a premissa caiu:** não há contrato da F4 a alterar — o snapshot é escopo virgem e nasce com a denylist em `schemaVersion: 1` (§2, decisão 4) | 17/08/2026 |

| 2 | **O gatilho do ADR-012 está dado?** O MVP 1 está em produção, mas não há incidente de link registrado. F10 sai do Backlog agora ou espera o incidente? | **aberta** | — |
| 3 | **A denylist de consentimento revogado continua no escopo**, depois do ADR-064 e da diretriz de não tratar LGPD/consentimento como bloqueio? A revogação pelo painel já bloqueia na nuvem | **aberta** | — |
| 4 | **Quem prevalece offline: a lista da catraca ou o snapshot do Edge?** Hoje a catraca decide sozinha com o agente parado (#470/#477). O snapshot da F10 a substitui, convive com ela ou só vale com a catraca mantida online? | **aberta** | — |

**Perguntas 2 a 4 em aberto** (04/10/2026). Nenhuma bloqueia o desenvolvimento das demais fatias;
bloqueiam só o início da F10.

## 6. Antes de codificar, confirme

- [x] Status desta spec é `aprovada-pi`
- [x] Os ADRs listados acima estão resolvidos
- [ ] **O gate desta fatia não é de MVP, é de gatilho:** MVP 1 em piloto **com incidente de link
      medido** (ADR-012). Sem o incidente, o card não sai do Backlog — não por falta de spec
- [ ] **A lista canônica de razões de `DENY` cobre a negativa pós-carência e
      `ALLOWED_OFFLINE_CONFLICT`** (`INV-038`; ADR-024 já fixou seis razões de `DENY` —
      conferir, não presumir)
- [ ] **Perguntas 2 a 4 da §5 respondidas pelo PI**

## 7. Fora de dúvida

- **"Por que a carência não decide normalmente, se o snapshot ainda está lá?"** → Porque
  `cache_validity` e `grace_period` viram parâmetro decorativo se nada muda entre os dois, e o
  operador perde o único sinal de que está operando com dado velho (ADR-007, decisão 1).
- **"Negar um giro que fisicamente aconteceu não é mais seguro?"** → Não. Falsifica frequência e
  quebra a conciliação. `ALLOWED_OFFLINE_CONFLICT` **registra a passagem sem revalidar o direito**.
- **"E se a pessoa revogou o consentimento e passou offline?"** → Aí não é conflito operacional, é
  tratamento de dado sem base legal. Por isso a denylist, e só ela, é exceção à decisão 3.
- **"Por que o Edge é quem abre a conexão?"** → Ele está atrás de NAT, num PC compartilhado
  (ADR-011). Exigir que a nuvem o alcance significa porta de entrada, IP estável ou túnel — e a
  rede real do cliente não sustenta isso.
