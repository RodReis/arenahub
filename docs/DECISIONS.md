# DECISIONS.md — ADRs do ArenaHub

Registro de decisões arquiteturais. **Leia antes de propor mudança estrutural.**

**Formato:** cada ADR tem contexto, decisão, consequências e — quando aberto — as opções em
disputa e o custo de cada uma.

**Status possíveis:**

| status | significado |
|---|---|
| `aceito` | vale agora. Contrariar exige ADR novo aprovado pelo PI. |
| `proposto` | recomendação técnica formulada, **aguardando o PI**. Não implemente. |
| `aberto` | decisão de produto não tomada. **Bloqueia a fatia que depende dela.** |
| `substituído` | vencido por outro ADR; fica no arquivo com o ponteiro. |

**Regra:** ADR não se apaga e não se reescreve. Mudou? Novo ADR, com `substitui ADR-0nn`.

**Sobre o aceite.** Um ADR fica `aceito` de duas formas, e a distinção importa:

- **Consolidação** — a regra **já estava fixada** no `docs/prd/README.md` ou nos PRDs, aprovados
  em 14/08/2026. O ADR só a registra num lugar citável. Não exige novo aceite do PI.
- **Decisão nova** — cria regra que não existia. **Exige aceite explícito do PI, com data**, e o
  ADR traz a linha *"Decidido pelo PI em DD/MM/AAAA"*.

ADR sem uma das duas marcas é aceite narrado — e aceite narrado é o defeito que o ADR-016
existe para expulsar deste repositório.

**Índice**

| # | título | status | bloqueia |
|---|---|---|---|
| [001](#adr-001) | Monólito modular em monorepo | `aceito` | — |
| [002](#adr-002) | Hierarquia Tenant → Academia → Unidade | `aceito` | — |
| [003](#adr-003) | Entitlement é o único controlador de acesso | `aceito` | — |
| [004](#adr-004) | Onde a decisão de acesso acontece | `aceito` | — |
| [005](#adr-005) | Vocabulário único de decisão e campos de evento | `aceito` | — |
| [006](#adr-006) | Idempotência de todo efeito externo | `aceito` | — |
| [007](#adr-007) | Semântica de validade, carência e conflito offline | `aberto` *(sem urgência)* | F10 (MVP 1.5) |
| [008](#adr-008) | Regime de dado biométrico sob LGPD | `aceito` com pontos `abertos` | F8 |
| [009](#adr-009) | Entitlement multi-origem (convênio corporativo) | `aceito` | — |
| [010](#adr-010) | Dependência do SDK Topdata e a POC como portão | `aceito` | — |
| [011](#adr-011) | Ciclo de vida do edge-agent e versionamento do contrato Edge | `aceito` com pontos `abertos` | F4 |
| [012](#adr-012) | Escopo de operação offline no MVP 1 | `aceito` | — |
| [013](#adr-013) | Provedor de pagamento e contrato PaymentProvider | `aberto` *(com caminho definido)* | F12–F16 |
| [014](#adr-014) | Processo unificado no CLAUDE.md | `aceito` | — |
| [015](#adr-015) | Numeração: Slice = Fatia = SPEC | `aceito` | — |
| [016](#adr-016) | Estratégia de teste e piso de cobertura | `aceito` | — |
| [017](#adr-017) | Dublês de teste são obrigatórios no boundary | `aceito` | — |
| [018](#adr-018) | A Especificação Completa não é normativa | `aceito` | — |
| [019](#adr-019) | Contagem de carência e instante de bloqueio | `aceito` | — |
| [020](#adr-020) | Onde mora o schema Prisma | `aceito` | — |
| [021](#adr-021) | Escopo de escrita do Cowork na `main` | `aceito` | — |

---

<a id="adr-001"></a>
## ADR-001 — Monólito modular em monorepo

**Data:** 14/08/2026 · **Status:** `aceito` *(consolidação — `docs/prd/README.md` §5/§5.1)*

**Contexto.** Cinco superfícies (api, admin-web, kiosk, mobile, edge-agent) precisam
compartilhar contratos e evoluir junto. Time é pequeno. O gargalo real do produto é
integração com hardware de terceiro e conformidade, não escala de tráfego.

**Decisão.** Monólito modular em `apps/api` (NestJS), dentro de monorepo pnpm + Turborepo,
com `packages/api-contracts`, `packages/ui`, `packages/config` e `packages/testing` — mais
`packages/database`, acréscimo ao PRD ratificado em **ADR-020** (falta a emenda ao §5). **Sem microserviço antes de métrica que o justifique.**

**Consequências.** Deploy único e transação local para o caminho crítico. Em troca, a
disciplina de fronteira entre módulos precisa ser mantida por revisão — não pelo processo.
Módulo que lê tabela privada de outro é a forma como monólito modular vira monólito.

---

<a id="adr-002"></a>
## ADR-002 — Hierarquia Tenant → Academia → Unidade

**Data:** 14/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 14/08/2026**)*

**Contexto.** A Especificação §6 desenha **três níveis**: `Tenant → Academia → Unidade A/B/C`.
O modelo de dados (§90, `MVP-01` §11) tem **dois**: `tenants` e `gym_units`. A §9 chama de
"Cadastro da Academia" o que parece ser o Tenant, e a §10 dá `tenant_id` — não `academia_id` —
à unidade. A entidade "Academia" **não existe** em lugar nenhum do modelo.

Isso não é detalhe de nomenclatura: decide se "rede com várias academias, cada uma com várias
unidades" é representável. Se a resposta vier depois de F6, é migração em tabela com
`tenant_id` em todo lugar.

**Opções.**

| | A — dois níveis | B — três níveis |
|---|---|---|
| modelo | `Tenant` = academia; `GymUnit` = unidade | `Tenant` (contratante) → `Gym` → `GymUnit` |
| custo agora | zero | +1 FK em quase toda entidade física, +1 nível de escopo em RBAC e relatório |
| custo depois | migração pesada se a rede aparecer | nenhum |
| quem precisa | academia única e rede pequena | franquia, grupo econômico, rede multi-marca |

**Decisão: opção A — dois níveis.** `Tenant` é a academia contratante; `GymUnit` é a unidade
física. O Complexo Arena Positiva tem mais de uma unidade sob o mesmo dono, o que cabe em dois
níveis sem forçar nada.

**Consequências.**

1. **A Especificação §6 fica errada** e precisa de nota de emenda: ela desenha três níveis que o
   modelo não tem e nunca teve.
2. **Multiunidade está em uso desde o dia 1** — não é cenário futuro. O teste de isolamento por
   `gym_unit_id` sobe de prioridade em F6, ao lado do isolamento por `tenant_id` (INV-006).
3. Se aparecer grupo econômico com marcas distintas sob um contratante, é ADR novo **e**
   migração pesada. O custo está aceito conscientemente.

---

<a id="adr-003"></a>
## ADR-003 — Entitlement é o único controlador de acesso

**Data:** 14/08/2026 · **Status:** `aceito` *(consolidação — `M1-BR-003`, Especificação §18/§125)*

**Contexto.** A tentação natural é a catraca perguntar "esse aluno pagou?". Isso acopla
acesso a financeiro e torna impossível representar cortesia, funcionário, personal, visitante,
aula experimental, dependente e convênio corporativo sem exceção no código.

**Decisão.** A cadeia é `Pagamento → Invoice → Subscription → Entitlement → Access Engine`.
**O motor de acesso consulta Entitlement e nunca Subscription ou Invoice.**

**Consequência que a Especificação viola e este ADR corrige.** A §20 lista "5. assinatura
válida" como regra **do motor**, e a §21 devolve `DENY / SUBSCRIPTION_OVERDUE`. Isso
reintroduz o acoplamento. A partir daqui:

- Inadimplência atua **suspendendo o entitlement**, não sendo consultada na catraca.
- `SUBSCRIPTION_OVERDUE` **pode continuar existindo como razão exibida** — mas é derivada de
  metadado gravado no entitlement no momento da suspensão, não de consulta à assinatura.

---

<a id="adr-004"></a>
## ADR-004 — Onde a decisão de acesso acontece

**Data:** 14/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 14/08/2026**)*

**Contexto.** A Especificação §26 roteia o caminho normal por `Gateway → Cloud → Access
Engine`; a §99 promete "decisão local < 300 ms"; a §125 diz que o Edge é "offline execution".
Os três textos não descrevem o mesmo sistema.

O orçamento de 300 ms **fim-a-fim** inclui: leitor reconhece → WebSocket → edge-agent →
internet da academia → API → Postgres → volta → comando na catraca. Em link residencial
brasileiro com jitter, isso é apertado.

**Opções.**

| | A — nuvem decide (Edge só no degradado) | B — Edge decide sempre com snapshot quente |
|---|---|---|
| latência | depende da internet da academia | previsível, local |
| frescor | sempre atual | atrasado pelo intervalo de sync |
| revogação | instantânea | leva até o próximo push/pull |
| complexidade | menor | snapshot precisa ser sempre válido, não só no apagão |
| risco | catraca lenta ou parada em queda de link | decisão com dado velho no caminho normal |

**Decisão: opção A — a nuvem decide sempre.** Coerente com o ADR-012: sem operação offline no
MVP 1, não existe snapshot para decidir localmente. O Edge executa e reporta; não julga.

**Gatilho de reabertura, escrito de propósito.** A POC (F3) mede a latência real ponta a ponta.
**Se o p95 medido com o link da academia passar de 300 ms, este ADR reabre automaticamente** e
volta a ser decisão do PI — não vira "a gente otimiza depois". Registrar a medição é entregável
de F3, não observação de rodapé.

**Consequência aceita:** o orçamento de 300 ms passa a incluir a internet do Arena Positiva.
Nenhuma promessa de latência pode ser feita a cliente antes dessa medição existir.

---

<a id="adr-005"></a>
## ADR-005 — Vocabulário único de decisão e campos de evento

**Data:** 14/08/2026 · **Status:** `aceito` *(ratificado pelo PI em 14/08/2026)*

**Contexto.** Quatro divergências de nome para a mesma coisa, entre a Especificação e os PRDs:

| conceito | Especificação | PRD/README |
|---|---|---|
| resultado da decisão | `GRANTED` / `DENIED` (§31) | `ALLOW` / `DENY` (§20, §21, `M1-FR-021`) |
| instante do evento | `timestamp` (§31) | `occurred_at` (`M1` §11) |
| unidade no evento | `unit_id` (§31) | `gym_unit_id` (`M1` §11, `Device` §28) |
| tabela de regras | `access_rules` (§90) | `access_policies` (`M1` §11) |

Divergência de vocabulário em código é bug esperando data: alguém compara `"GRANTED"` com
`ALLOW` e o `if` cai no lado errado silenciosamente.

**Proposta.** Vence sempre o PRD, por ser mais recente e mais específico:
`ALLOW`/`DENY`, `occurred_at`, `gym_unit_id`, `access_policies`. Um único enum
`AccessOutcome` em `packages/api-contracts`, sem alias e sem tradução na borda.

**Ressalva que o próprio PRD cria.** `MVP-01` §13 nomeia os eventos de domínio
**`AccessGranted`** e **`AccessDenied`** — vocabulário `GRANTED`/`DENIED` de volta, agora no
contrato de evento. Duas saídas foram consideradas:

- (a) renomear para `AccessAllowed` / `AccessDenied`, mantendo um vocabulário só; ou
- (b) manter os nomes de evento e fixar por escrito que `AccessGranted` **transporta**
  `outcome: ALLOW` — nome de evento é rótulo histórico, não enum.

**Escolhida: (b).** Nome de evento publicado é caro de mudar; o risco real era o `if`, e o `if`
usa o enum.

**Ratificado.** Valem `ALLOW`/`DENY`, `occurred_at`, `gym_unit_id`, `access_policies`, num
único enum `AccessOutcome` em `packages/api-contracts`. Os eventos mantêm os nomes
`AccessGranted` e `AccessDenied` (opção *b*): nome de evento publicado é rótulo histórico e caro
de mudar; o risco real era o `if`, e o `if` usa o enum.

---

<a id="adr-006"></a>
## ADR-006 — Idempotência de todo efeito externo

**Data:** 14/08/2026 · **Status:** `aceito` *(consolidação — `M2-FR-008`, `M1` §11, Especificação §84)*

**Decisão.** Toda entrada externa carrega chave de deduplicação persistida **antes** do efeito:

| origem | chave |
|---|---|
| webhook de pagamento | `(provider_account_id, external_event_id)` — único |
| evento de domínio | `(event_id, consumidor)` |
| evento de acesso vindo do Edge | `external_event_id` por origem |
| operação de API mutável | `Idempotency-Key` do cliente |

Reprocessar qualquer evento é seguro. Evento fora de ordem **não regride estado terminal
válido**. Evento externo desconhecido é armazenado com segurança **sem produzir efeito de
negócio**.

**Consequência.** Isto é o exemplo canônico de bug corrigível sem spec: se um webhook duplicado
produzir efeito duplo, o Code abre `[FIX]` citando este ADR e conserta.

---

<a id="adr-007"></a>
## ADR-007 — Semântica de validade, carência e conflito offline

**Data:** 14/08/2026 · **Status:** `aberto`, **sem urgência** *(decidido pelo PI em 14/08/2026
que migra junto com F10 para o MVP 1.5 — ADR-012)* · **Bloqueia:** F10

**Contexto.** A Especificação §27 dá o exemplo "cache válido 12 h, carência 24 h" e **não diz
o que acontece entre 12 h e 24 h**. Também não define o que fazer quando a nuvem já havia
revogado o direito de quem entrou offline.

**Perguntas que precisam de resposta antes de F10:**

1. Entre `cache_validity` e `grace_period`, o Edge (a) decide normalmente, (b) decide com
   aviso visível na recepção, ou (c) só permite quem já tem entitlement confirmado?
2. Passado o `grace_period` com `offline_access_enabled = true`, o comportamento é `DENY` ou
   "fallback operacional explícito"? Qual, exatamente — liberação assistida com registro?
3. Aluno entrou offline com entitlement revogado na nuvem: o evento entra como
   `ALLOWED_OFFLINE_CONFLICT` (aceito e sinalizado) ou é rejeitado? *(Recomendação técnica:
   aceito e sinalizado — negar um giro que fisicamente aconteceu é falsificar histórico.)*
4. O snapshot é **push** (nuvem empurra) ou **pull** (Edge busca)? Isso decide o tempo de
   propagação de uma revogação.

**Invariante já fixada e não sujeita a discussão:** dado offline vencido **nunca** resulta em
allow ilimitado (`M1-BR-008`).

---

<a id="adr-008"></a>
## ADR-008 — Regime de dado biométrico sob LGPD

**Data:** 14/08/2026 · **Status:** `aceito` na parte estrutural *(consolidação — `M1-BR-004`,
`M1-BR-005`, `M1-FR-014`, `prd/README.md` §6.4)*, com pontos `abertos` que **exigem o PI**

**Contexto — e por que isto não é burocracia.** Em **04/08/2026**, dez dias antes deste ADR, a
ANPD determinou por Despacho Decisório nº 2/2026/SFI a **suspensão imediata** do
reconhecimento facial na rede estadual do Paraná. Fundamentos: falta de base legal, ausência de
comprovação de segurança e falha no controle de acesso às imagens. A norma específica sobre
biometria (Agenda Regulatória 2025-2026, item 5) **ainda não foi publicada** — a ANPD está
atuando antes dela. Detalhe e fontes em `docs/LANDSCAPE.md` §4.

**Decisões aceitas.**

1. **Consentimento destacado, versionado e revogável**, com finalidade, versão do documento,
   ator, IP e dispositivo (`Consent`).
2. **Caminho alternativo não-biométrico de primeira classe.** QR, cartão, PIN e liberação
   assistida funcionam plenamente. Consentimento não é livre se recusar a biometria negar o
   acesso — e negar seria tratamento abusivo, não escolha comercial.
3. **Revogação = bloqueio lógico imediato**, mesmo com exclusão física pendente
   (`M1-BR-005`), seguido de `DeviceSyncJob DELETE` e auditoria.
4. **Não persistir template bruto** quando o dispositivo não exigir (`M1-FR-014`).
5. **Log de acesso a template e imagem** — quem viu o quê, quando. Foi uma das três causas da
   suspensão no caso PR.
6. **Ausência de consentimento impede o cadastro biométrico, não a matrícula** (`M1-BR-004`).

**Decidido pelo PI em 14/08/2026.**

7. **Retenção: expurgo em 30 dias** após o encerramento do vínculo. Job automático apaga o
   template do banco **e dos leitores**, com evidência auditável. A janela de 30 dias cobre
   rematrícula rápida sem transformar o sistema em arquivo permanente de biometria. O prazo é
   parâmetro, não constante — mas o padrão é 30 dias e mudá-lo é decisão registrada.
8. **Há aluno menor de 18 no Arena Positiva.** Consentimento por **responsável legal** vira
   **escopo obrigatório de F8**, não melhoria futura: quem é o responsável, como se vincula ao
   aluno, como se comprova, e o que acontece na virada dos 18 anos. No caso do Paraná, ser menor
   foi agravante — aqui é requisito de entrada.

**Pontos que continuam abertos — bloqueiam F8.**

- **Base legal.** Consentimento puro ou legítimo interesse com LIA documentada?
- **RIPD.** Relatório de impacto é provável exigência para facial em escala. Quem produz?
- **Papéis.** ArenaHub é operador e a academia controladora? Isso muda quem responde.
- **IA de saúde.** Se o provedor de IA estiver fora do Brasil, há transferência internacional
  de dado sensível a tratar.

---

<a id="adr-009"></a>
## ADR-009 — Entitlement multi-origem (convênio corporativo)

**Data:** 14/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 14/08/2026**)*

**Contexto.** Wellhub (ex-Gympass) e TotalPass colocam na catraca um aluno que **não existe no
financeiro da academia**. O Wellhub tem API pública documentada (`Access Control API` +
`Check-in Webhook` assinado com `X-Gympass-Signature`); o check-in validado é o evento que
dispara o repasse. Os concorrentes (Tecnofit, Pacto, Nextfit, ABC Evo, Cloud Gym) já integram
nativamente — não é diferencial, é requisito de entrada. Ver `docs/LANDSCAPE.md` §3.

A Especificação §19 **já pede** que o entitlement suporte "planos corporativos", mas nenhum
PRD modela isso.

**Modelagem adotada.** `Entitlement.source` é polimórfico desde F7, mesmo sem integração:

```
SUBSCRIPTION | COURTESY | STAFF | TRAINER | VISITOR | TRIAL | DEPENDENT | CORPORATE
```

Com isso, quando a integração chegar, ela cria entitlement de curta duração via webhook — sem
tocar no motor de acesso. **Os três pontos abaixo não são pendência de hoje: reabrem em ADR novo,
junto com a decisão comercial de entrar em convênio.**

1. **Receita por evento**, não por ciclo — convive com a recorrência, não substitui.
2. **Limite por aluno** (ex.: teto de dias/mês) precisa ser política configurável, não
   constante no código: há evidência pública de academias impondo teto quando o repasse cai.
3. **Idempotência do check-in** — o mesmo evento não pode gerar dois acessos nem dois repasses.

**Decisão.** O Arena Positiva **não opera com convênio hoje**. Então:

- `Entitlement.source` nasce como **enum extensível** em F7, com `CORPORATE` já previsto. Custo
  próximo de zero, e evita que a integração futura precise mexer no motor de acesso.
- **A integração fica fora do roadmap** até decisão comercial explícita. Não vira fatia, não
  entra no `STATUS.md`.
- **Aviso registrado, não recomendação:** Tecnofit, Pacto, Nextfit, ABC Evo e Cloud Gym já
  integram Wellhub/TotalPass de fábrica. Historicamente isso é questão de *quando*, não de *se*.
  Quando virar, é ADR novo — não emenda deste.

---

<a id="adr-010"></a>
## ADR-010 — Dependência do SDK Topdata e a POC como portão

**Data:** 14/08/2026 · **Status:** `aceito` *(consolidação — `MVP-00` §15, `MVP-01` §1)*

**Contexto.** Toda a arquitetura do Smart Access assenta em afirmações sobre o SDK Topdata que
a própria Especificação §4 admite não verificadas. Fatos apurados: existem três SDKs (Inner
REP, Inner Acesso, Leitor Facial); o de leitor facial usa **WebSocket** e tem documentação e
exemplo **apenas em C#**, distribuído como DLL. Condições de acesso ao Portal do Integrador
não foram determinadas.

**Decisão.** O MVP 0 é **portão, não aquecimento**. Nenhuma fatia de MVP 1 começa sem a
**decisão de saída do MVP 0** (`MVP-00` §15, exigida por `MVP-01` §1) registrada com evidência e
desfecho `GO` ou `GO_WITH_CONSTRAINTS`.

> **Não confundir dois portões.** `HW-GATE-01` é o portão de **entrada** da bancada (máquina
> Windows, rede isolada, inventário, consentimento) e existe **só no plano** do MVP 0 — não é
> termo do PRD. O portão de **saída** é a decisão `GO`/`GO_WITH_CONSTRAINTS`/`NO_GO` da
> `MVP-00` §15, e é esse que o roadmap usa.

A POC precisa produzir, no mínimo: latência medida ponta a ponta, comportamento do ciclo de
vida facial (cadastro, atualização, remoção), confirmação de giro, e **resposta sobre o
runtime**: o SDK exige Windows e processo nativo? Se sim, o `edge-agent` deixa de ser "Node.js"
e passa a ser "Node.js + serviço nativo", com impacto em stack, instalação e ADR-011.

**Consequência.** `NO_GO` é resultado válido. Um `NO_GO` na POC não é fracasso do projeto — é a
POC fazendo exatamente o que existe para fazer.

---

<a id="adr-011"></a>
## ADR-011 — Ciclo de vida do edge-agent e versionamento do contrato Edge

**Data:** 14/08/2026 · **Status:** `aceito` na máquina e na mitigação *(decidido pelo PI em
14/08/2026)*, com provisionamento e credencial ainda `abertos` · **Bloqueia:** F4

**Contexto.** O `edge-agent` é missão crítica — se ele para, a catraca para — e roda em
máquina que **não controlamos**, dentro da academia. A Especificação lhe dá 12
responsabilidades e **nenhuma** linha sobre onde ele roda.

**Já respondido pelo PRD — não reabrir** (por ADR-018, vence o PRD):

| tema | resposta | onde |
|---|---|---|
| SO e forma de execução | **serviço Windows** | `prd/README.md` §5; `MVP-00` §4; `MVP-01` §6 |
| Atualização | atualiza **com rollback para a versão anterior** | `M1-NFR-006`; `MVP-01` §19 |
| Janela de convivência do contrato | suporta **a versão atual e a imediatamente anterior** durante rollout | `MVP-01` §19 |
| Guarda do segredo | mecanismo seguro do Windows; nunca credencial de usuário comum | `MVP-01` §15 |

**Decidido pelo PI em 14/08/2026 — máquina.** O `edge-agent` roda no **PC da recepção,
compartilhado**. Sem hardware dedicado no piloto.

**A consequência, escrita para não ser descoberta em produção.** Como o ADR-012 tirou a operação
offline do MVP 1, **a disponibilidade da catraca passa a ser exatamente o uptime desse PC**. Não
é modo degradado: se alguém desligar a máquina, a catraca não decide nada. Isso é diferente de
"a internet caiu".

**Mitigação decidida — processo e alarme, não arquitetura.**

1. Serviço Windows com **início automático** e reinício automático em falha.
2. **Alerta operacional quando o Edge some** — o heartbeat já é exigido por `M1-FR-018`; o que
   este ADR acrescenta é que o alerta é obrigatório em F11, não opcional.
3. **Regra escrita na academia:** este PC não se desliga. Vai no material de implantação.
4. **Liberação manual pela recepção** como fallback declarado (`M1-FR-023`), com registro.

**Risco residual aceito conscientemente:** alguém tira da tomada. Nesse caso a fila na recepção
é o plano, e o incidente vira entrada para o MVP 1.5.

**Já respondido pelo PRD, agora completo:** serviço Windows, atualização com rollback, janela de
convivência de duas versões, segredo guardado pelo mecanismo seguro do Windows.

**Continuam abertos — bloqueiam F4.**

1. **Provisionamento inicial.** Como o agente ganha identidade na instalação: certificado
   emitido, código de pareamento, token de uso único? Quem instala fisicamente?
2. **Credencial.** `/api/v1/edge/*` usa "certificado **ou** segredo" — a barra continua sendo
   decisão não tomada. Rotação e revogação, como e por quem?

**Sem estes dois, F4 é implementável mas não instalável em academia real.**

---

<a id="adr-012"></a>
## ADR-012 — Escopo de operação offline no MVP 1

**Data:** 14/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 14/08/2026**)*

**Contexto.** A Especificação §104 põe no MVP 1 dezesseis itens, incluindo cadastro completo de
aluno, edge agent, motor de acesso e **operação offline com cache, fila e reconciliação** — que
é, isoladamente, o item mais caro do documento inteiro.

O critério de sucesso da própria Especificação §128 é *"um aluno é reconhecido e entra se
tiver entitlement válido"* — **não exige offline nem multiunidade**.

**Opções.**

| | A — manter offline no MVP 1 | B — offline vira MVP 1.5 |
|---|---|---|
| tempo até a primeira academia operando | maior | menor |
| risco | construir resiliência antes de saber o que quebra na prática | queda de link derruba a catraca no piloto |
| aprendizado | offline desenhado sobre suposição | offline desenhado sobre incidente real medido |
| mitigação da opção B | — | fallback operacional: recepção libera manualmente com registro (já previsto em `M1-FR-023`) |

**Decisão: opção B — offline sai do MVP 1 e vira MVP 1.5.**

O MVP 1 entrega acesso online com entitlement manual, que já satisfaz o critério de sucesso da
própria Especificação §128. A queda de link no piloto é coberta pela liberação manual da
recepção, que já é requisito (`M1-FR-023`).

**Consequências.**

1. **F10 sai do MVP 1** e passa a compor o **MVP 1.5**. O número da fatia **não muda** — ADR-015
   proíbe reaproveitar número. O `STATUS.md` registra F10 sob MVP 1.5.
2. **ADR-007** (semântica de validade × carência, conflito de reconciliação) migra junto e perde
   urgência.
3. **ADR-011 fica mais exposto:** sem offline, e com o agente num PC compartilhado, a catraca
   depende do uptime dessa máquina. Mitigação registrada no próprio ADR-011.

**Contra-argumento que permanece de pé:** se o link do Arena Positiva for ruim e o fluxo de pico
alto, a fila na recepção machuca a percepção do produto logo na primeira semana. O primeiro
incidente desse tipo é o gatilho para reavaliar a prioridade do MVP 1.5 — não para improvisar
cache no meio do MVP 1.

---

<a id="adr-013"></a>
## ADR-013 — Provedor de pagamento e contrato PaymentProvider

**Data:** 14/08/2026 · **Status:** `aberto` · **Bloqueia:** F12 a F16 (MVP 2 inteiro)

**Contexto.** O provedor não foi escolhido, mas o MVP 2 inteiro depende dele: formato e
garantia de entrega de webhook, recorrência de cartão, PIX, estorno parcial, tokenização,
split. Escolher é pré-requisito, não detalhe de implementação.

**Fato de mercado relevante (`docs/LANDSCAPE.md` §4.2).** O **Pix Automático** (BC, jun/2025)
está em adoção acelerada e é declarado por Pacto, Tecnofit, Nextfit e Cloud Gym. Ele traz um
estado que cartão não tem: **a autorização é gerenciável e cancelável pelo pagador no app do
próprio banco**. A academia perde a autorização sem ser avisada pelo cliente.

**Consequência de modelagem, independentemente do provedor escolhido:** `autorização revogada`
é estado de primeira classe, **distinto** de `pagamento falhou`. Tratar os dois igual gera
cobrança de quem não deve mais e churn silencioso.

**Divergência a resolver junto.** O contrato `PaymentProvider` tem duas versões: 7 métodos na
Especificação §38, 6 métodos com nomes diferentes em `MVP-02` §12, e 10 no índice do plano —
que ampliou contrato público sem emendar o PRD, exatamente o caso que `prd/README.md` §10.2
manda perguntar antes. **Vence o PRD**; o plano se ajusta.

**Também aberto:** o modelo de `Payment` **não tem campos definidos em documento nenhum**,
embora a tabela seja citada. Uma invoice paga em duas tentativas (PIX falho + cartão) não cabe
no modelo atual.

**Decidido pelo PI em 14/08/2026 — o caminho, não o nome.** O provedor **não** é escolhido por
marca: sai da **homologação**, que já estava prevista como card `[GATE]` do MVP 2. O gate produz
uma matriz comparativa e a escolha vem com dado.

**A matriz precisa cobrir, no mínimo:**

| critério | por que importa aqui |
|---|---|
| Pix Automático | adoção acelerando; o pagador pode **revogar a autorização** no app do banco |
| Cartão recorrente com tokenização hospedada | INV-098: nenhum dado de cartão toca o backend |
| Estorno total e parcial | `M2-FR`, política de refund do `M2-COMPLIANCE-01` |
| Garantia de entrega e **assinatura** de webhook | INV-077; sem HMAC verificável, o provedor está fora |
| Chave estável de evento externo | INV-076 depende de `external_event_id` confiável |
| Entrega fora de ordem | INV-079 |
| Taxa efetiva por método | TCO real, não tabela de vitrine |

**Candidatos levantados** (`docs/LANDSCAPE.md` §4.2): Asaas — único com documentação pública de
Pix Automático verificada; Pagar.me, Mercado Pago, Iugu, Vindi, Stone, Cielo. Nenhum eliminado.

**Continua aberto:** o provedor e as duas políticas do `M2-COMPLIANCE-01`
(`KEEP_UNTIL_PERIOD_END` vs `SUSPEND_ON_CONFIRMATION` no refund; limites de desconto, pagamento
manual e step-up). **MVP 2 segue bloqueado — mas agora por um gate com critério, não por uma
pergunta em aberto.**

---

<a id="adr-014"></a>
## ADR-014 — Processo unificado no CLAUDE.md

**Data:** 14/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 14/08/2026**

**Contexto.** O repositório operava **dois processos incompatíveis**: `docs/prd/README.md`
§10–12 (evidência no checklist do PRD, status `APROVADO`/`EM_DESENVOLVIMENTO`/`CONCLUÍDO`, sem
menção a Git, PR, issue ou board) e o `CLAUDE.md` (spec em `docs/specs/`, issue, PR com
`refs #N`, labels `proplan:*`, aceite exclusivo do PI). Nenhum dos dois era executável: não
existia `docs/specs/`, `STATUS.md`, numeração de SPEC, fatias `F<n>` nem `.github/`.

**Decisão.** Vale o `CLAUDE.md`. `docs/prd/README.md` §10–12 continua valendo como **contrato
técnico** (o que fazer, o que perguntar antes, o que nunca fazer, definição de pronto) — o que
muda é **onde a evidência mora**: na issue e no PR, com o checklist do PRD atualizado na mesma
entrega.

**Consequências.**

- `docs/specs/` passa a existir. A spec é **fina**: aponta para a slice do PRD e para o plano,
  e acrescenta só decisões, critérios de aceite e escopo negativo. **Não copia o PRD** — três
  cópias da verdade é pior que nenhuma.
- Status de PRD (`APROVADO`…) e labels de board (`proplan:*`) coexistem em camadas diferentes:
  o primeiro descreve o documento, o segundo o card.
- Commits em **PT-BR** a partir de agora. Os cinco commits iniciais em inglês ficam como estão
  — reescrever histórico para conformar a regra seria o tipo de gesto que este processo existe
  para evitar.

---

<a id="adr-015"></a>
## ADR-015 — Numeração: Slice = Fatia = SPEC

**Data:** 14/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 14/08/2026**,
como desdobramento do ADR-014)*

**Contexto.** Três vocabulários de unidade de trabalho conviviam: `Slice N.M` (PRD), `plano`
(`docs/superpowers/plans/`) e `[F<n>]` + `SPEC-<nnn>` (CLAUDE.md), sem tabela ligando um ao
outro.

**Decisão.** Cada **Slice N.M** do PRD recebe **um `F<n>` e um `SPEC-<nnn>` com o mesmo
número**, alocados uma vez no Índice Fatia ↔ SPEC do `docs/STATUS.md`. 41 fatias, F1 a F41.

Por que o mesmo número: dois contadores independentes para uma relação 1:1 só criam
oportunidade de divergir. Se uma spec precisar gerar duas fatias, isso é decisão do PI e gera
**nova spec com novo número** — nunca sufixo.

**Planos de gate** (`*-mvp-0[2-6]-00-*.md`) não são fatias: viram card `[GATE]`, sem SPEC e sem
F. **Cuidado com o glob:** `2026-08-14-mvp-00-poc-topdata.md` **não** é gate — é o plano das
fatias F1–F5.

**Exceção conhecida.** O índice do MVP 1 divide a Slice 1.3 em duas etapas com gates distintos
("cloud e simuladores" / "sync físico"). Fica **uma fatia (F8)** com a segunda etapa bloqueada
por `HW-GATE-01`. Se na prática ficar grande demais, o PI parte — com spec nova.

---

<a id="adr-016"></a>
## ADR-016 — Estratégia de teste e piso de cobertura

**Data:** 14/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 14/08/2026**

**Contexto.** O `docs/TESTING.md` anterior era material importado de outro produto (ProPlan):
citava `apps/web` (app inexistente nesta arquitetura), boundaries que não existem aqui, e
registrava como fato PRs, SPECs e "671 testes verdes" que **nunca ocorreram neste
repositório** — cujo histórico começa em 14/08/2026, sem uma linha de código. Também
contradizia o PRD: §9 exige 80% em regras de domínio, o arquivo dizia "report-only".

Um documento que governa "evidência de máquina, nunca narrada" contendo evidência narrada é o
pior tipo de dívida: ensina que o registro pode ser ficção.

**Decisão.** Reescrito do zero a partir de `docs/prd/README.md` §9. Piso de **80% em regras de
domínio** vale. Nenhuma evidência é registrada antes de existir execução real.

---

<a id="adr-017"></a>
## ADR-017 — Dublês de teste são obrigatórios no boundary

**Data:** 14/08/2026 · **Status:** `aceito` *(consolidação — `M0-NFR-006` já exige simulador em
CI sem hardware; o ADR só remove a contradição)*

**Contexto.** O `CLAUDE.md` dizia "nunca usar mock ou hardcode, sempre usar seed". Tomada ao
pé da letra, a regra proíbe o simulador contratual do leitor Topdata (que `M0-NFR-006`
**exige** rodar em CI sem hardware), o `FakePaymentProvider`, e os fakes de OCR, IA e
antivírus. Ou seja: proíbe o único jeito de testar hardware de terceiro e gateway financeiro.

**Decisão.** A regra vale onde faz sentido e vira precisa:

- **Proibido:** dado inventado no caminho de produção; valor fixo embutido no código onde
  deveria haver configuração; dado de desenvolvimento fora do seed.
- **Obrigatório:** dublê **no boundary** — processo externo, hardware, provedor. Vive atrás da
  porta (`FacialDeviceAdapter`, `TurnstileAdapter`, `PaymentProvider`, `DocumentExtractor`, `AIProvider`,
  `MalwareScanner`, `NotificationChannel`).
- **Proibido de novo:** dublar a própria regra de domínio. Teste que mocka o caso de uso não
  testa nada.

Seed mora junto do schema Prisma, não na raiz do repositório. **Onde** o schema mora é ADR-020.

---

<a id="adr-018"></a>
## ADR-018 — A Especificação Completa não é normativa

**Data:** 14/08/2026 · **Status:** `aceito` *(consolidação — `prd/README.md` §1 declara os PRDs
como documento aprovado; a Especificação nunca teve esse status)*

**Contexto.** `docs/Especificação Completa — Plataforma Inteligente de Gestão para
Academias.md` é o documento de origem: 128 seções, visão ampla, muito valor. Também contém
contradições internas conhecidas (entitlement vs assinatura, hierarquia de tenant, aritmética
de carência), entidades citadas sem modelo (Meta, Lead, Contrato, Desconto, Cupom, feriados) e
premissas não verificadas tratadas como fato.

**Decisão.** Precedência, do mais forte ao mais fraco:

```
ADR aceito  >  PRD (README + MVP-nn)  >  CONVENTION/ARCHITECTURE  >  Especificação Completa
```

A Especificação continua sendo a fonte de **intenção de produto** e o lugar onde se procura "o
que o PI quis dizer". Não é fonte de comportamento implementável.

**Consequência.** Quando o Code encontrar contradição, não escolhe sozinho: aplica a
precedência; se a precedência não resolver, **pergunta ao PI**.

---

<a id="adr-019"></a>
## ADR-019 — Contagem de carência e instante de bloqueio

**Data:** 14/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 14/08/2026**)*

**Contexto.** A Especificação §42 dá o exemplo: *"Vencimento 10/08, carência 3 dias, bloqueio
14/08"*. 10 + 3 = 13, não 14. Ou a carência é de 4 dias, ou o bloqueio ocorre no dia seguinte
ao fim da carência. O `M2-BR-007` diz "bloqueio no primeiro instante após vencimento +
carência, respeitando o timezone contratual" — que aponta para **13/08**.

Um dia de diferença × todo aluno inadimplente × todo mês é acesso indevido (ou negação
indevida) sistemática. É barato decidir e caro descobrir depois.

**Perguntas.**

1. Carência de 3 dias sobre vencimento 10/08 bloqueia em 13/08 00:00 ou em 14/08 00:00?
2. O timezone é o da **unidade** ou o do **tenant**? Os dois campos existem, sem regra de
   precedência (Especificação §9 e §10).
3. Dia de vencimento em fim de semana ou feriado adia?

**Decisão.**

1. **Padrão: bloqueio no primeiro instante de `due_date + grace_period`.** Vencimento 10/08 com
   carência de 3 dias bloqueia em **13/08 às 00:00**; o aluno tem 11 e 12 livres. Confirma o
   `M2-BR-007` e **corrige o exemplo da Especificação §42**, que erra a conta.
2. **Não é constante: é configuração.** `BillingSettings` ganha uma **âncora de bloqueio**
   explícita, com o padrão acima. O PI muda por academia sem tocar em código. Regra comercial que
   vive dentro de um `if` é regra que ninguém encontra depois.
3. **Timezone da unidade, sem fallback para o tenant.** É onde a catraca está e onde o aluno vive
   o horário — e regra financeira com fallback silencioso é exatamente onde bug de um dia se
   esconde. Consequência: toda consulta de data carrega o `gym_unit_id`, o que a INV-001 já exige
   de qualquer forma.
4. **Sem adiamento por feriado ou fim de semana** nesta versão. Se o PI quiser depois, é campo
   novo na mesma âncora — não regra escondida.

**O que a spec de F15 precisa fechar:** nome e formato do campo de âncora, e o comportamento
quando a academia troca o valor com aluno **já em carência**.

---

<a id="adr-020"></a>
## ADR-020 — Onde mora o schema Prisma

**Data:** 14/08/2026 · **Status:** `aceito` *(ratificado pelo PI em 14/08/2026)*

**Contexto.** O layout fixado em `docs/prd/README.md` §5 tem `packages/{api-contracts, ui,
config, testing}` e `infra/database/`. **`packages/database` não existe no PRD** — apareceu nos
índices de plano e foi absorvido pelos documentos de 14/08/2026 como se fosse do PRD. Não era.

A pergunta é concreta: onde ficam `schema.prisma`, as migrations, a factory do client (que
carrega o `TenantContext` obrigatório — INV-003) e o `seed.ts`?

**Opções.**

| | A — `packages/database` | B — `infra/database` |
|---|---|---|
| natureza | pacote versionado, importável por `api` e por workers | diretório de infraestrutura |
| client factory com `TenantContext` | mora junto do schema, um lugar só | precisa morar em outro pacote |
| aderência ao PRD | **exige emenda ao §5** | já está lá |
| `seed.ts` | junto do schema | junto do schema |

**Decisão: opção A**, com **emenda formal ao `prd/README.md` §5** — porque o client
factory é código de aplicação, não infraestrutura, e separá-lo do schema espalha a regra de
isolamento de tenant por dois lugares. `infra/database/` continua existindo para o que é
realmente infra (compose, init de volume, backup).

**Ratificado: opção A.** `packages/database` guarda schema, migrations, client factory e seed.
`infra/database/` fica com o que é realmente infraestrutura (compose, init de volume, backup).

**Pendência que a ratificação cria:** o `docs/prd/README.md` §5 precisa de **emenda formal**
acrescentando o pacote, com nota apontando para este ADR. Enquanto a emenda não sair, o layout
do PRD e o do repositório divergem — e divergência conhecida e não escrita é como a documentação
começa a mentir.

---

<a id="adr-021"></a>
## ADR-021 — Escopo de escrita do Cowork na `main`

**Data:** 14/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 14/08/2026**)*
· **Substitui** a regra de escopo do `CLAUDE.md` → *Dois atores escrevem no Git*

**Contexto.** O `CLAUDE.md` limitava a escrita do Cowork na `main` a **spec + a linha do Índice
Fatia ↔ SPEC**, com a frase *"qualquer ampliação desse escopo passa pelo PI"*.

Em 14/08/2026 o PI autorizou **três** ampliações em poucas horas: a base documental, o registro
das decisões de ADR, e os dois documentos que faltavam. Cada uma foi registrada como "exceção,
não precedente".

**Três exceções seguidas não são exceção — são a regra real, não escrita.** Manter a ficção
custa duas coisas: uma pergunta desnecessária a cada entrega, e a erosão da própria ideia de que
regra escrita significa alguma coisa. O `STATUS-ARQUIVO.md` já registrava que a terceira deveria
virar ADR em vez de exceção. Este é o ADR.

**Decisão.** O Cowork escreve direto na `main`, sem branch, sem PR, sem CI:

| escreve | por quê |
|---|---|
| `docs/specs/**` | é o artefato dele |
| Índice Fatia ↔ SPEC do `docs/STATUS.md` | fonte única da numeração, alocada por ele |
| `docs/DECISIONS.md` | registrar decisão do PI é função de planejamento |
| `docs/CONVENTION.md`, `docs/ARCHITECTURE.md` | contrato de domínio e desenho são documento, não implementação |
| `docs/STATUS.md`, `docs/STATUS-ARQUIVO.md`, `docs/LANDSCAPE.md`, `docs/REVIEW.md`, `docs/TESTING.md` | governança |
| `CLAUDE.md` | as regras do trio |

**O Cowork continua sem poder escrever:** qualquer coisa em `apps/`, `packages/`, `infra/`,
`.github/`, `docs/prd/**` e `docs/superpowers/**`. Ou seja: **código, configuração de build, CI e
os PRDs aprovados.** PRD só muda por emenda que o PI aprova explicitamente.

**O que a decisão não afrouxa — e é o ponto.**

1. **O Cowork continua sem implementar código.** Nunca.
2. **O aceite continua sendo só do PI.** Nenhuma issue fecha sem ele.
3. **Toda entrega de código continua por PR com CI verde.** O caminho sem PR vale só para
   documento.
4. **Decisão de produto continua sendo do PI.** O Cowork registra decisão; não a toma.

A garantia do processo nunca esteve no *quem commita documento* — esteve em **quem aceita** e em
**o código não entrar sem PR**. Essas duas não se moveram.

**Conflito no Git.** A divisão por seção do `docs/STATUS.md` some: agora o Cowork escreve o
arquivo inteiro. Vale a regra inversa e explícita: **se o Code encontrar `STATUS.md` divergente,
a versão da `main` vence e ele reaplica o próprio progresso por cima** — nunca desfaz linha do
Cowork.
