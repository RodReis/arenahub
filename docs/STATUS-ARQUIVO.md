# STATUS-ARQUIVO.md — histórico detalhado do ArenaHub

> Complemento do `docs/STATUS.md`. Lá mora a prosa curta; **aqui mora o detalhe**: por que uma
> decisão foi tomada, o que se descobriu no caminho, o que se tentou e não deu.
>
> Ordem **cronológica inversa** — o mais recente no topo. Entrada não se apaga e não se
> reescreve; corrige-se com entrada nova.
>
> **Regra de honestidade:** só entra aqui o que aconteceu. Este arquivo **não registra
> intenção, plano nem previsão** — para isso existem `DEVELOPMENT.md` e `STATUS.md`. Registro
> narrado como se fosse evidência é exatamente o defeito que motivou a reescrita do
> `TESTING.md` (ADR-016).

---

## 2026-08-14 — Oito decisões novas e duas ratificações

Segunda sessão do dia. Com a base documental aprovada e commitada (`0fef95d`), o PI tomou **oito
decisões novas** (ADR-002, 004, 008, 009, 011, 012, 013 parcial, 019) e **ratificou duas**
(ADR-005 e ADR-020), em três blocos, na ordem de bloqueio.

### As decisões

| ADR | decisão | consequência que ela cria |
|---|---|---|
| **ADR-011** | `edge-agent` no **PC da recepção**, compartilhado | a catraca passa a depender do uptime de um PC compartilhado |
| **ADR-002** | **dois níveis** (`Tenant` = academia, `GymUnit` = unidade) | multiunidade em uso desde o dia 1; Especificação §6 fica errada |
| **ADR-012** | **offline sai do MVP 1** e vira MVP 1.5 | F10 muda de MVP sem mudar de número |
| **ADR-009** | não opera com convênio hoje | `Entitlement.source` nasce extensível; integração fora do roadmap |
| **ADR-013** | provedor sai da **homologação**, com matriz de critérios | MVP 2 segue bloqueado, mas agora por um gate com critério |
| **ADR-019** | bloqueio em `due_date + grace_period`, **configurável**; timezone da unidade | `BillingSettings` ganha âncora de bloqueio explícita |
| **ADR-008** | expurgo de biometria em **30 dias**; **há aluno menor** | consentimento por responsável legal vira escopo obrigatório de F8 |
| **ADR-004** | **a nuvem decide sempre**, com gatilho de reabertura na medição da POC | o orçamento de 300 ms passa a incluir a internet da academia |
| **ADR-005** | ratificado | vocabulário único; eventos mantêm `AccessGranted`/`AccessDenied` |
| **ADR-020** | ratificado | `packages/database`; **exige emenda ao `prd/README.md` §5** |

### O risco que duas decisões criaram juntas

ADR-011 (PC compartilhado) e ADR-012 (sem offline no MVP 1) combinados produzem uma consequência
que nenhum dos dois tem sozinho: **a disponibilidade da catraca passa a ser exatamente o uptime
de um PC que outras pessoas usam.** Não é modo degradado — se a máquina desligar, a catraca não
decide nada.

Foi apresentado ao PI como consequência, não como erro, e ele escolheu **mitigar por processo**:
serviço Windows com início automático, alerta obrigatório de heartbeat em F11, regra escrita de
não desligar o PC, e liberação manual pela recepção como fallback declarado. **Risco residual
aceito conscientemente:** alguém tira da tomada. O primeiro incidente desse tipo é o gatilho
para priorizar o MVP 1.5 — registrado aqui para que, quando acontecer, ninguém trate como
surpresa.

### O que ficou aberto

Quatro pendências, duas delas parciais:

- ~~**ADR-011** — provisionamento de identidade do Edge e credencial de `/api/v1/edge/*`. Bloqueia F4.~~ **Fechado na segunda rodada do mesmo dia.**
- ~~**ADR-008** — base legal, RIPD e papéis controlador/operador. Bloqueia F8.~~ **Fechado na segunda rodada.** Sobrou transferência internacional de IA, que bloqueia F21.
- **ADR-013** — o provedor em si, que sai do card `[GATE]` de homologação. Bloqueia F12–F16.
- **ADR-007** — semântica offline. **Sem urgência**: migrou com F10 para o MVP 1.5.

### Segunda rodada de 14/08/2026 — o que foi decidido e o que isso custou

O PI abriu a sessão pedindo para "continuar". A leitura do repositório mostrou que **não havia
trabalho de Cowork pendente — havia bloqueio**: 8 specs aprovadas sem board onde criar card, e 33
travadas por decisão que só o PI toma. Documentar mais não moveria nada. A sessão virou, então,
uma rodada de decisão.

**ADR-011 fechou inteiro.** Pareamento por código de uso único → segredo por dispositivo no
mecanismo seguro do Windows; rotação automática pelo agente; revogação imediata no painel. mTLS
foi considerado e **recusado por custo de operar PKI** para uma unidade piloto — decisão datada,
com gatilho de reabertura escrito (escala multi-unidade ou exigência enterprise).

**Consequência que virou escopo:** o alerta de heartbeat de F11 passa a ter duas causas
distintas — Edge ausente e falha de renovação de credencial. Tratar as duas como um alarme só faz
a recepção ligar para a pessoa errada. Sem isso, a rotação automática se torna um jeito novo de a
catraca parar em silêncio.

**ADR-008 fechou em três dos quatro pontos — e corrigiu um erro material.** O ADR oferecia
"legítimo interesse com LIA" como alternativa ao consentimento. **Essa hipótese não existe para
dado biométrico:** é dado sensível (LGPD art. 5º, II) e o art. 11 é lista fechada onde legítimo
interesse não figura. Um documento de governança afirmando o contrário é exatamente o papel que
se entrega numa fiscalização — registrar o erro vale mais que apagá-lo.

Decidido: **consentimento específico e destacado** (art. 11, I), com a alínea "g" recusada por
ser estreita e por base legal ausente ter sido o fundamento nº 1 da suspensão no caso PR.
**Academia controladora, ArenaHub operador**, com a fragilidade anotada em vez de escondida — nós
definimos retenção, motor de decisão e política de log, e quem define meios é controlador; a
mitigação é virar essas decisões em parâmetro do cliente. **RIPD por template nosso**, assinado
pela academia, com revisão jurídica antes do primeiro cliente.

**O que ficou explicitamente fora.** O ADR-013 **não** foi levado ao PI: ele já havia decidido que
o provedor sai da homologação, e pedir a escolha agora seria fazê-lo desdizer o próprio ADR. O
que sobra ali é modelagem, não fornecedor — as duas políticas do `M2-COMPLIANCE-01` e o **modelo
de `Payment`, sem campos definidos em documento nenhum**: uma invoice paga em duas tentativas
(PIX falho + cartão) não cabe no modelo atual. Fica para a rodada seguinte.

**Correção de higiene documental.** O status `planejada` era definido como *"número reservado,
arquivo não existe"* — mas o ADR-022 criou os 41 ponteiros de uma vez, e 25 arquivos existiam com
esse status. A definição descrevia um mundo que tinha acabado no dia anterior. Redefinido para
**"ponteiro criado, MVP ainda não discutido com o PI"**.

**Fronteira respeitada.** O `docs/DEVELOPMENT.md` tem três referências obsoletas a ADR-011 e
ADR-008 (linhas 128, 147, 168). **Não foram corrigidas aqui:** ADR-021 não dá esse arquivo ao
Cowork, e ele é do Code. Fica como pendência declarada, não como conserto silencioso.

### Pendências criadas pelas próprias decisões

1. **Especificação §6** precisa de nota de emenda: promete três níveis de hierarquia que o
   modelo não tem (ADR-002).
2. **`prd/README.md` §5** precisa de emenda formal acrescentando `packages/database` (ADR-020).
3. **Especificação §42** tem a conta de carência errada (10 + 3 = 13, não 14) — ADR-019 já
   registra o correto, mas o texto de origem continua errado.

### Segunda exceção de escrita no Git

O PI autorizou, também pontualmente, que o Cowork commitasse na `main` os documentos alterados
pelo registro destas decisões.

**Observação que precisa ficar escrita, porque é desconfortável:** esta é a **segunda exceção em
poucas horas**. Duas exceções seguidas deixam de ser exceção e viram padrão não declarado — que é
exatamente o tipo de erosão silenciosa que este processo existe para impedir.

Se houver uma terceira, o certo não é abrir outra exceção: é **ampliar formalmente o escopo do
Cowork por ADR**, para que a regra escrita descreva o que de fato acontece. Regra que se
contorna toda vez já não é regra — é decoração.

Nenhuma linha de código foi escrita. Nenhum card foi criado.

---

## 2026-08-14 — Configuração da governança e crítica da base documental

**O que aconteceu.** O PI pediu análise, crítica e configuração dos documentos do projeto. A
base foi lida integralmente: Especificação Completa (3.114 linhas, 128 seções), `prd/README.md`,
os 7 PRDs de MVP, os 6 índices de plano, `TESTING.md`, `DESIGN-UI.md` e `CLAUDE.md`.

### Achados que motivaram mudança

**1. Dois processos incompatíveis coexistiam.** `docs/prd/README.md` §10–12 descrevia execução
com evidência no checklist do PRD, sem qualquer menção a Git, PR, issue ou board. O `CLAUDE.md`
descrevia spec + issue + PR + labels `proplan:*`. Os vocabulários eram disjuntos: `Slice N.M`
contra `[F<n>]`; `APROVADO`/`EM_DESENVOLVIMENTO`/`CONCLUÍDO` contra `aprovada-pi` +
`proplan:done`.

Pior: **nenhum dos dois era executável**. Não existia `docs/specs/`, `STATUS.md`, numeração de
SPEC, fatia `F<n>` nem `.github/`. A regra "sem spec `aprovada-pi` → não codificar" travava o
Claude Code na primeira instrução, porque nenhum documento do repositório carregava esse rótulo
— e os PRDs estavam "APROVADOS **para planejamento**", não para implementação.

→ Resolvido por **ADR-014** (vale o `CLAUDE.md`) e **ADR-015** (Slice = Fatia = SPEC).

**2. `docs/TESTING.md` continha evidência fabricada.** O documento que governa *"evidência de
máquina, nunca narrada"* registrava como fato ocorrido: achado do PI em 22/07/2026; entregas
SPEC-027 (#103) e SPEC-022 (#106, #109) mergeadas com CI verde; "671 testes verdes"; um bug que
apagou o registro da SPEC-016 depois de "CI verde em 3 PRs seguidos"; e dois critérios de aceite
marcados `[x]`.

Nada disso pode ter ocorrido: o histórico deste repositório começa em 14/08/2026 e não há uma
linha de código. O texto era importado do produto **ProPlan**, incluindo `.proplan/` e o app
`apps/web` — que **não existe** nesta arquitetura, cujo web administrativo é `apps/admin-web`.
O arquivo ainda contradizia o PRD §9 (80% de cobertura em regras de domínio) ao declarar
"cobertura report-only, não barra o merge".

→ Resolvido por **ADR-016**: reescrito do zero.

**3. `CLAUDE.md` estava contaminado por outro projeto e apontava para o vazio.** Título
"hubarena"; duas menções a **"Brabolão"**; três seções vazias (`## O que é`, `## Regras de
arquitetura`, `## Stack`); e **nove documentos referenciados que não existiam**. Chamava
`DESIGN-SYSTEM.md` de "aprovado" quando o arquivo real (`DESIGN-UI.md`) está em `RASCUNHO`, com
8 decisões abertas na §17 — entre elas a lista canônica de razões de `DENY`, que a fatia do
motor de acesso precisa.

→ Reescrito. Documentos criados. Ponteiro corrigido para `docs/DESIGN-UI.md`, com o status real
declarado.

**4. A regra "nunca usar mock" proibia a própria estratégia de testes.** Os PRDs **exigem**
simulador contratual do leitor Topdata rodando em CI sem hardware (`M0-NFR-006`),
`FakePaymentProvider`, fakes de `MalwareScanner` e `DocumentExtractor`, e golden files
anonimizados. A regra literal do `CLAUDE.md` tornava tudo isso ilegal — ou seja, proibia o único
jeito de testar hardware de terceiro e gateway financeiro. A regra também mandava `prisma/seed.ts`
na raiz — e onde o schema Prisma deve morar (`packages/database` ou `infra/database`) **não está
definido no PRD**, o que virou ADR-020.

→ Resolvido por **ADR-017**: a proibição vale para o caminho de produção; o dublê é obrigatório
**no boundary** e proibido dentro da regra de domínio.

### Achados na Especificação Completa que viraram ADR aberto

| achado | seção | ADR |
|---|---|---|
| A entidade "Academia" é desenhada em três níveis e não existe no modelo de dados | §6 vs §10/§90 | ADR-002 |
| O motor de acesso consulta assinatura, desfazendo o princípio da própria §125 | §20 regra 5, §21 | ADR-003 (resolvido) |
| "Decisão local < 300 ms" convive com caminho normal roteado pela nuvem | §26 vs §99 | ADR-004 |
| `GRANTED/DENIED` × `ALLOW/DENY`; `timestamp` × `occurred_at`; `unit_id` × `gym_unit_id` | §31 vs PRD | ADR-005 |
| Cache válido 12 h com carência de 24 h — 12 h de semântica indefinida | §27 | ADR-007 |
| Carência de 3 dias sobre vencimento 10/08 resultando em bloqueio 14/08 (10+3=13) | §42 | ADR-019 |

Além disso: **`tenant_id` obrigatório pela §6 está ausente** em `Subscription`, `Invoice`,
`BodyAssessment`, `HealthMeasurement`, `Consent`, `DeviceUser` e `AIAnalysis`;
`BiometricIdentity.external_enroll_id` é único e não tem `device_id`, embora o `enrollid` do
Topdata seja por dispositivo — dois leitores na mesma unidade não cabem no modelo; e
**Meta, Lead, Contrato, Desconto, Cupom, feriado, `Payment` e `Passage`** aparecem em telas,
menus e regras **sem entidade nem campo**. Tudo catalogado em `docs/CONVENTION.md` §5.

### Pesquisa de mercado — o que mudou a leitura de risco

Levantamento datado em `docs/LANDSCAPE.md`. Dois fatos alteraram prioridade:

**Regulatório.** Em **04/08/2026** — dez dias antes desta entrada — a ANPD determinou, por
Despacho Decisório nº 2/2026/SFI, **suspensão imediata** do reconhecimento facial na rede
estadual do Paraná. Fundamentos: falta de base legal, ausência de comprovação de segurança e
falha no controle de acesso às imagens. A norma específica sobre biometria (Agenda Regulatória
2025-2026, item 5) **ainda não saiu** — a ANPD está agindo antes dela. Isso transforma a LGPD
de seção de conformidade em **requisito funcional com risco corrente**, e é a razão de o
caminho alternativo não-biométrico ter virado invariante (INV-022b) e não recomendação.

**Competitivo.** Controle de acesso facial integrado **não é diferencial em 2026** — Tecnofit,
Pacto, Nextfit, ABC Evo e Cloud Gym já entregam de fábrica, com SDKs de fabricante públicos e
documentados (a Control iD publica API REST aberta, sem login). Ranking e gamificação também já
existem no líder de base. O espaço plausível está em conformidade como produto, entitlement
multi-origem de verdade (Wellhub/TotalPass — ADR-009) e tratamento do ciclo de vida da
autorização do Pix Automático, que pode ser revogada pelo pagador no app do banco sem aviso à
academia.

### Decisões do PI nesta sessão

1. **Processo unificado no `CLAUDE.md`** → ADR-014.
2. **`TESTING.md` reescrito do zero** → ADR-016.
3. **Escopo de offline no MVP 1 registrado como decisão aberta**, não cortado nem confirmado →
   ADR-012.
4. **Conjunto completo de documentos criado**: `CLAUDE.md` (reescrito), `ARCHITECTURE.md`,
   `DECISIONS.md`, `CONVENTION.md`, `STATUS.md`, `DEVELOPMENT.md`, este arquivo, `TESTING.md`
   (reescrito), `LANDSCAPE.md`, `REVIEW.md` e `docs/specs/`.

### Exceção de escrita no Git — autorizada pelo PI

O `CLAUDE.md` limita o push do Cowork na `main` à spec e à linha do Índice Fatia ↔ SPEC, e diz
que *"qualquer ampliação desse escopo passa pelo PI"*. Os doze documentos desta sessão são
governança, não spec.

**O PI aprovou os documentos e autorizou explicitamente, em 14/08/2026, que o Cowork os
commitasse direto na `main` — uma vez, para esta entrega.**

Motivo prático: não existe `.github/`, board nem comando `pnpm`, então não há PR possível
(*exceção de arranque*, `DEVELOPMENT.md` §2), e manter onze documentos de governança fora do
controle de versão é risco maior que a exceção.

**Isto não é precedente.** A próxima escrita do Cowork na `main` volta ao escopo do
`CLAUDE.md`: spec e a linha do Índice. Qualquer coisa além disso pede autorização de novo.

**Ficaram deliberadamente de fora**, por não estarem na lista aprovada: `docs/DESIGN-UI.md` e a
`Especificação Completa`, ambas ainda *untracked*, e `README.md`, que apareceu modificado só por
normalização de fim de linha. Consequência aceita e registrada: os documentos commitados
referenciam dois arquivos que ainda não estão no repositório. Fecha no item 8 do bootstrap.

### O que ficou aberto

Dez ADRs aguardando o PI, conforme o `docs/STATUS.md` daquela data, mais as decisões já declaradas pendentes nos
**planos** (`M2-COMPLIANCE-01`, `M3-CLINICAL-01`, `M3-STUDENT-AI-01`, `M4-DIST-01`,
`M5-RULES-01`) e as 8 de `docs/DESIGN-UI.md` §17.

**Nenhuma linha de código foi escrita.** Nenhum card foi criado. Nenhum gate foi atendido.

---

## 2026-08-14 — Base documental anterior (registro do que já existia)

Onze commits de documentação, todos empurrados direto na `main`, todos com mensagem em inglês:

```
f985011  Initial commit
d0393fb  docs: add technical MVP PRDs for academy module
d7de0ad  docs: approve academy MVP PRDs
7c5849d  docs: add MVP zero Topdata implementation plan
6e437cd  docs: add MVP 01 smart access implementation plans
8ebf0ed  docs: add MVP 02 smart billing implementation plans
980497f  docs: add MVP 03 health intelligence implementation plans
2666631  docs: add MVP 04 app and kiosk implementation plans
c688198  docs: add MVP 05 engagement implementation plans
99f99cb  docs: add MVP 06 retention AI technical design
4b7691e  docs: add MVP 06 retention AI implementation plans
```

Produziram: `docs/prd/README.md` (contrato de produto e engenharia, 280 linhas), 7 PRDs de MVP
(2.666 linhas somadas, com FR/NFR/BR/AC numerados), 6 índices de plano com ~32 gates nomeados, e
os planos por slice.

**Observação para o futuro:** o `CLAUDE.md` diz que o Cowork escreve na `main` apenas spec e a
linha do Índice Fatia ↔ SPEC. Os planos em `docs/superpowers/plans/` foram além disso — são
material de apoio valioso, mas nasceram fora do escopo definido para o papel. Ficam como estão,
classificados em `CLAUDE.md` como **apoio do Code, não contrato**: onde divergirem do PRD, o PRD
vence.
