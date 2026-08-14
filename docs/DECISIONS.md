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
| [002](#adr-002) | Hierarquia Tenant → Academia → Unidade | `aberto` | F6 |
| [003](#adr-003) | Entitlement é o único controlador de acesso | `aceito` | — |
| [004](#adr-004) | Onde a decisão de acesso acontece | `aberto` | F9, F10 |
| [005](#adr-005) | Vocabulário único de decisão e campos de evento | `proposto` | F9 |
| [006](#adr-006) | Idempotência de todo efeito externo | `aceito` | — |
| [007](#adr-007) | Semântica de validade, carência e conflito offline | `aberto` | F10 |
| [008](#adr-008) | Regime de dado biométrico sob LGPD | `aceito` com pontos `abertos` | F8 |
| [009](#adr-009) | Entitlement multi-origem (convênio corporativo) | `proposto` | F7 |
| [010](#adr-010) | Dependência do SDK Topdata e a POC como portão | `aceito` | — |
| [011](#adr-011) | Ciclo de vida do edge-agent e versionamento do contrato Edge | `aberto` | F4, F10 |
| [012](#adr-012) | Escopo de operação offline no MVP 1 | `aberto` | F10 |
| [013](#adr-013) | Provedor de pagamento e contrato PaymentProvider | `aberto` | F12–F16 |
| [014](#adr-014) | Processo unificado no CLAUDE.md | `aceito` | — |
| [015](#adr-015) | Numeração: Slice = Fatia = SPEC | `aceito` | — |
| [016](#adr-016) | Estratégia de teste e piso de cobertura | `aceito` | — |
| [017](#adr-017) | Dublês de teste são obrigatórios no boundary | `aceito` | — |
| [018](#adr-018) | A Especificação Completa não é normativa | `aceito` | — |
| [019](#adr-019) | Contagem de carência e instante de bloqueio | `aberto` | F15 |
| [020](#adr-020) | Onde mora o schema Prisma | `proposto` | bootstrap |

---

<a id="adr-001"></a>
## ADR-001 — Monólito modular em monorepo

**Data:** 14/08/2026 · **Status:** `aceito` *(consolidação — `docs/prd/README.md` §5/§5.1)*

**Contexto.** Cinco superfícies (api, admin-web, kiosk, mobile, edge-agent) precisam
compartilhar contratos e evoluir junto. Time é pequeno. O gargalo real do produto é
integração com hardware de terceiro e conformidade, não escala de tráfego.

**Decisão.** Monólito modular em `apps/api` (NestJS), dentro de monorepo pnpm + Turborepo,
com `packages/api-contracts`, `packages/ui`, `packages/config` e `packages/testing` — mais
`packages/database`, que é acréscimo ao PRD e está pendente em **ADR-020**. **Sem microserviço antes de métrica que o justifique.**

**Consequências.** Deploy único e transação local para o caminho crítico. Em troca, a
disciplina de fronteira entre módulos precisa ser mantida por revisão — não pelo processo.
Módulo que lê tabela privada de outro é a forma como monólito modular vira monólito.

---

<a id="adr-002"></a>
## ADR-002 — Hierarquia Tenant → Academia → Unidade

**Data:** 14/08/2026 · **Status:** `aberto` · **Bloqueia:** F6 (core seguro e unidade)

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

**Recomendação técnica.** Opção A **com a Especificação §6 emendada** para parar de prometer
três níveis — a menos que o PI já tenha cliente de rede à vista. Renomear expectativa é mais
barato que carregar um nível vazio.

**Precisa do PI:** existe rede/franquia no horizonte de 12 meses?

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

**Data:** 14/08/2026 · **Status:** `aberto` · **Bloqueia:** F9 (decisão online), F10 (offline)

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

**Recomendação técnica.** Opção A, **medindo na POC (MVP 0) antes de fixar**. Se a medição
mostrar p95 acima de 300 ms com link real, migrar para B é decisão de produto — não de
implementação.

**Precisa do PI + evidência da POC.**

---

<a id="adr-005"></a>
## ADR-005 — Vocabulário único de decisão e campos de evento

**Data:** 14/08/2026 · **Status:** `proposto` · **Bloqueia:** F9

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
contrato de evento. Duas saídas possíveis, e é preciso escolher **antes de F9**:

- (a) renomear para `AccessAllowed` / `AccessDenied`, mantendo um vocabulário só; ou
- (b) manter os nomes de evento e fixar por escrito que `AccessGranted` **transporta**
  `outcome: ALLOW` — nome de evento é rótulo histórico, não enum.

*Recomendação: (b).* Nome de evento publicado é caro de mudar; o risco real era o `if`, e o `if`
usa o enum.

**Precisa do PI:** só ratificação — não há trade-off de produto aqui.

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

**Data:** 14/08/2026 · **Status:** `aberto` · **Bloqueia:** F10

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

**Pontos abertos — bloqueiam F8.**

- **Retenção.** Qual prazo de expurgo do template após encerramento do vínculo? A LGPD não fixa
  número; a prática é eliminar ao fim do vínculo. Precisa virar parâmetro com job verificável.
- **Menor de idade.** Academia tem aluno menor. Consentimento por responsável legal não está
  modelado em lugar nenhum. No caso PR, ser menor foi **agravante**.
- **Base legal.** Consentimento puro ou legítimo interesse com LIA documentada?
- **RIPD.** Relatório de impacto é provável exigência para facial em escala. Quem produz?
- **Papéis.** ArenaHub é operador e a academia controladora? Isso muda quem responde.
- **IA de saúde.** Se o provedor de IA estiver fora do Brasil, há transferência internacional
  de dado sensível a tratar.

---

<a id="adr-009"></a>
## ADR-009 — Entitlement multi-origem (convênio corporativo)

**Data:** 14/08/2026 · **Status:** `proposto` · **Bloqueia:** F7 (modelo de entitlement)

**Contexto.** Wellhub (ex-Gympass) e TotalPass colocam na catraca um aluno que **não existe no
financeiro da academia**. O Wellhub tem API pública documentada (`Access Control API` +
`Check-in Webhook` assinado com `X-Gympass-Signature`); o check-in validado é o evento que
dispara o repasse. Os concorrentes (Tecnofit, Pacto, Nextfit, ABC Evo, Cloud Gym) já integram
nativamente — não é diferencial, é requisito de entrada. Ver `docs/LANDSCAPE.md` §3.

A Especificação §19 **já pede** que o entitlement suporte "planos corporativos", mas nenhum
PRD modela isso.

**Proposta.** Tratar `Entitlement.source` como polimórfico desde F7, mesmo sem implementar a
integração:

```
SUBSCRIPTION | COURTESY | STAFF | TRAINER | VISITOR | TRIAL | DEPENDENT | CORPORATE
```

Com isso, quando a integração chegar (fatia futura), ela cria entitlement de curta duração via
webhook — sem tocar no motor de acesso. Consequências que **não** são de graça e precisam do PI:

1. **Receita por evento**, não por ciclo — convive com a recorrência, não substitui.
2. **Limite por aluno** (ex.: teto de dias/mês) precisa ser política configurável, não
   constante no código: há evidência pública de academias impondo teto quando o repasse cai.
3. **Idempotência do check-in** — o mesmo evento não pode gerar dois acessos nem dois repasses.

**Precisa do PI:** o Arena Positiva opera com Wellhub/TotalPass hoje? Se sim, isso sobe de
"campo preparado" para fatia com data.

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

**Data:** 14/08/2026 · **Status:** `aberto` · **Bloqueia:** F4, F10

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

**Perguntas que continuam abertas.**

1. **Máquina.** PC da recepção compartilhado ou mini-PC dedicado? Quem compra?
2. **Provisionamento inicial.** Como o agente ganha identidade na instalação — certificado
   emitido, código de pareamento, token de uso único? Quem instala fisicamente?
3. **Credencial.** `/api/v1/edge/*` usa "certificado **ou** segredo" — a barra é decisão não
   tomada. Rotação e revogação, como e por quem?
4. **PC desligado à noite.** O snapshot expira dormindo. Comportamento na primeira entrada da
   manhã seguinte?

**Sem 2 e 3, F10 é implementável mas não instalável em academia real.**

---

<a id="adr-012"></a>
## ADR-012 — Escopo de operação offline no MVP 1

**Data:** 14/08/2026 · **Status:** `aberto` · **Bloqueia:** F10 · **Registrado a pedido do PI**

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

**Recomendação técnica.** Opção B. O caminho manual já existe por requisito e cobre a queda de
link no piloto com uma academia. Construir cache, fila, assinatura de snapshot e reconciliação
antes de qualquer academia usar o sistema é otimizar para um problema ainda não observado.

**Contra-argumento honesto:** se o piloto for numa academia com internet ruim e alto fluxo em
horário de pico, a fila na recepção destrói a percepção do produto na primeira semana — e aí a
opção A era a certa. **A informação que decide isso é a qualidade do link do Arena Positiva.**

**Precisa do PI.**

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

**Precisa do PI:** provedor, e as duas políticas do `M2-COMPLIANCE-01`
(`KEEP_UNTIL_PERIOD_END` vs `SUSPEND_ON_CONFIRMATION` no refund; limites de desconto,
pagamento manual e step-up).

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

**Data:** 14/08/2026 · **Status:** `aberto` · **Bloqueia:** F15 (inadimplência e acesso)

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

**Recomendação técnica.** Bloqueio no primeiro instante do dia `due_date + grace_period`, no
timezone da **unidade** (é onde a catraca está), sem adiamento por feriado — e corrigir o
exemplo da Especificação §42, que está com a conta errada.

**Precisa do PI:** é regra comercial, não técnica.

---

<a id="adr-020"></a>
## ADR-020 — Onde mora o schema Prisma

**Data:** 14/08/2026 · **Status:** `proposto` · **Bloqueia:** bootstrap `[INFRA]`

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

**Recomendação técnica.** Opção A **com emenda formal ao `prd/README.md` §5** — porque o client
factory é código de aplicação, não infraestrutura, e separá-lo do schema espalha a regra de
isolamento de tenant por dois lugares. `infra/database/` continua existindo para o que é
realmente infra (compose, init de volume, backup).

**Enquanto este ADR não fecha:** os documentos que citam `packages/database` marcam a referência
como proposta, não como fato do PRD.

**Precisa do PI:** só ratificação — não há trade-off de produto.
