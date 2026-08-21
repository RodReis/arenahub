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
| [007](#adr-007) | Semântica de validade, carência e conflito offline | `aceito` *(fechado pelo PI em 16/08/2026)* | — |
| [008](#adr-008) | Regime de dado biométrico sob LGPD | `aceito` *(1 ponto remanescente)* | **F21** |
| [009](#adr-009) | Entitlement multi-origem (convênio corporativo) | `aceito` | — |
| [010](#adr-010) | Dependência do SDK Topdata e a POC como portão | `aceito` | — |
| [011](#adr-011) | Ciclo de vida do edge-agent e versionamento do contrato Edge | `aceito` **completo** | — |
| [012](#adr-012) | Escopo de operação offline no MVP 1 | `aceito` | — |
| [013](#adr-013) | Provedor de pagamento e contrato PaymentProvider | `aberto` *(com caminho definido)* | F13–F16 *(o modelo de `Payment` saiu para o ADR-027)* |
| [014](#adr-014) | Processo unificado no CLAUDE.md | `aceito` | — |
| [015](#adr-015) | Numeração: Slice = Fatia = SPEC | `aceito` | — |
| [016](#adr-016) | Estratégia de teste e piso de cobertura | `aceito` | — |
| [017](#adr-017) | Dublês de teste são obrigatórios no boundary | `aceito` | — |
| [018](#adr-018) | A Especificação Completa não é normativa | `aceito` | — |
| [019](#adr-019) | Contagem de carência e instante de bloqueio | `aceito` | — |
| [020](#adr-020) | Onde mora o schema Prisma | `aceito` | — |
| [021](#adr-021) | Escopo de escrita do Cowork na `main` | `aceito` | — |
| [022](#adr-022) | A Slice do PRD é a spec; o arquivo em `docs/specs/` é ponteiro | `aceito` | — |
| [023](#adr-023) | Card `[INFRA]` é do Cowork; metadados de board também | `aceito` | — |
| [024](#adr-024) | Lista canônica de razões de decisão de acesso | `aceito` | — |
| [025](#adr-025) | MVP 2.5: o design system é fatia, não `[INFRA]` | `aceito` | — |
| [026](#adr-026) | `docs/design/**` é fonte de verdade de design | `aceito` | — |
| [027](#adr-027) | Modelo de `Payment` e `PaymentAttempt` | `aceito` | — |
| [028](#adr-028) | Modo de acionamento da catraca é código, não config do equipamento | `proposto` | — *(virou restrição 2 do ADR-029)* |
| [029](#adr-029) | Gate §15 do MVP 0: `GO_WITH_CONSTRAINTS` | `aceito` | — **destrava o MVP 1** |
| [030](#adr-030) | Aprovação antecipada das SPEC-012 a 016, com o ADR-013 aberto | `aceito` | — |
| [031](#adr-031) | Tailwind e shadcn/ui no `admin-web` | `aceito` | — |
| [032](#adr-032) | Dois provedores: Sicoob para PIX, Getnet para cartão | `aceito` | — **fecha o ADR-013 e destrava F14–F16** |

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

**Data:** 14/08/2026 · **Status:** `aceito` *(as quatro perguntas foram **respondidas pelo PI em
16/08/2026**; migrou com F10 para o MVP 1.5 em 14/08/2026 — ADR-012)* · **Bloqueia:** nada.
**F10 destravada**

**Contexto.** A Especificação §27 dá o exemplo "cache válido 12 h, carência 24 h" e **não diz
o que acontece entre 12 h e 24 h**. Também não define o que fazer quando a nuvem já havia
revogado o direito de quem entrou offline.

**Invariante já fixada e não sujeita a discussão:** dado offline vencido **nunca** resulta em
allow ilimitado (`M1-BR-008`).

**Decidido pelo PI em 16/08/2026.**

1. **Entre `cache_validity` e `grace_period`: decide, sinaliza e restringe.** O Edge decide com
   aviso visível na recepção, **mas só para entitlement que estava `ACTIVE` no snapshot e cuja
   validade não termina dentro da janela de carência**. O evento é marcado como degradado.

   *Por que não a opção (a).* "Decide normalmente" tornaria `cache_validity` e `grace_period`
   indistinguíveis — se nada muda às 12 h, o segundo parâmetro é decorativo e o operador não tem
   como saber que está operando com dado velho. A opção (c) foi descartada por ambiguidade:
   offline, tudo que o Edge tem **é** o snapshot, então "entitlement confirmado" não se
   distingue de "entitlement em cache" sem uma definição extra que ninguém pediu.

2. **Passado o `grace_period`: `DENY` do motor, liberação assistida do operador.** A pergunta
   original oferecia uma dicotomia falsa. `DENY` e fallback não competem: **o motor nunca se
   autoautoriza** (`M1-BR-008`), e o caminho humano — liberação assistida com identificação do
   operador, motivo e auditoria — já é exigido como caminho de primeira classe pela decisão 2 do
   **ADR-008**. `DENY` puro, sem caminho humano, não é mais seguro: empurra a recepção para
   destravar a catraca na mão, sem registro nenhum.

3. **Conflito offline: aceito e sinalizado — com uma exceção.** O evento entra como
   `ALLOWED_OFFLINE_CONFLICT`. Negar um giro que fisicamente aconteceu falsifica frequência e
   quebra a conciliação. **Aceitar registra a passagem; não revalida o direito.**

   **Exceção — revogação de consentimento biométrico.** O **ADR-008** decisão 3 exige bloqueio
   lógico **imediato** na revogação. Um giro biométrico depois da revogação não é conflito
   operacional, é tratamento de dado sem base legal. Logo: revogação de consentimento entra numa
   **denylist carregada no snapshot** e bloqueia mesmo offline. Revogação de direito por
   pagamento continua no caminho normal — aceita e sinalizada.

4. **A conexão é sempre iniciada pelo Edge: stream persistente + polling de reconciliação.** A
   pergunta confundia quem inicia a *conexão* com quem inicia a *mensagem*. O Edge está atrás de
   NAT, num PC compartilhado (**ADR-011**) — exigir que a nuvem o alcance significa porta de
   entrada, IP estável ou túnel, e a rede real do cliente não sustenta isso. O Edge abre a
   conexão; o stream dá propagação de revogação em segundos; o polling periódico reconcilia e
   cobre a queda do stream.

**Duas consequências que a spec de F10 precisa absorver.**

1. **A decisão 1 depende da decisão 4 para ser barata.** Restringir o allow na carência a
   entitlement que não expira dentro da janela só não vira negativa frequente porque o stream
   mantém o snapshot fresco. Se o link do Arena Positiva cair muito, o sintoma vai parecer bug de
   acesso e não de rede. **Requisito derivado:** o painel operacional (F11) mostra a **idade do
   snapshot**, não apenas online/offline — o `DataFreshness` de `docs/design/DS-PAINEL.md` §8.2 já
   pede exatamente isso.
2. **A decisão 3 exige campo que não existe.** Não há hoje denylist de consentimento revogado no
   contrato de snapshot: F8 entregou bloqueio lógico **na nuvem**, não uma lista que o Edge
   carregue. Isso é escopo real de F10 e provavelmente altera o contrato de snapshot que F4 já
   implementou — alteração de contrato Edge é versionada por **ADR-011**.

---

<a id="adr-008"></a>
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

**Correção de premissa — a alternativa que este ADR oferecia não existia.**

A versão anterior colocava a escolha como *"consentimento puro **ou** legítimo interesse com LIA
documentada"*. **Legítimo interesse não está disponível para dado biométrico.** Biometria é dado
pessoal **sensível** (LGPD art. 5º, II), e o art. 11 é **lista fechada** — legítimo interesse
(art. 7º, IX) não figura nela. Registrar aqui porque documento errado sobre base legal é pior que
documento ausente: é o que se entrega numa fiscalização.

As hipóteses realmente disponíveis eram duas: consentimento específico e destacado (art. 11, I)
ou a alínea "g" do art. 11, II — prevenção à fraude e segurança do titular em processo de
identificação e autenticação.

> **Não somos advogados.** Esta leitura precisa de confirmação de profissional habilitado antes
> de ir para contrato ou para resposta à ANPD. O que este ADR fixa é a **direção de produto**, e
> a direção existe para o advogado revisar — não para substituí-lo.

**Decidido pelo PI em 14/08/2026 — segunda rodada.**

9. **Base legal: consentimento específico e destacado (art. 11, I).** É a única coerente com o
   que já estava decidido: o caminho alternativo não-biométrico de primeira classe (decisão 2) é
   exatamente o que torna o consentimento **livre**. Sem ele não haveria consentimento válido, e
   sim coação comercial. A contrapartida é assumida: consentimento é revogável a qualquer tempo,
   e o produto tem que aguentar — a decisão 3 (bloqueio lógico imediato) já é essa capacidade.
   **Não usar a alínea "g" como base.** Ela é estreita, traz ressalva expressa de direitos
   fundamentais no próprio texto, e no caso PR o fundamento nº 1 da suspensão foi ausência de
   base legal. Apostar nela é apostar contra o precedente mais recente.

10. **Papéis: academia é controladora, ArenaHub é operador.** Leitura padrão de SaaS — a academia
    decide coletar biometria dos seus alunos e para quê; o ArenaHub trata em nome dela. **Exige
    contrato de tratamento (art. 39) com instruções documentadas**, e isso é entregável de F8,
    não papelada de contrato comercial.

    **Fragilidade registrada, não escondida:** o ArenaHub define retenção de 30 dias, o motor de
    decisão e o que é logado. Quem define finalidade **e meios** é controlador. A ANPD pode
    reclassificar. **Mitigação de produto:** as decisões que hoje são nossas viram *parâmetro do
    cliente* com padrão seguro (retenção, política de log, razões de `DENY`), alinhando o papel
    jurídico ao fato técnico em vez de escolher entre os dois. Gatilho de revisão: primeiro
    cliente que exigir controladoria conjunta em contrato.

11. **RIPD: ArenaHub produz o template, a academia adota e assina.** Só quem conhece o fluxo do
    dado consegue descrevê-lo tecnicamente; a academia, como controladora, responde por ele.
    Vira ativo comercial — cliente que exige RIPD já recebe pronto. **Não adiar até a norma da
    ANPD sair:** a ANPD está atuando **antes** dela (04/08/2026 é a prova). RIPD é o documento
    que se quer já ter no dia em que perguntam, não o que se começa nesse dia.
    **Risco assumido:** template errado escala o erro para todo cliente futuro — por isso ele
    passa por revisão jurídica antes do primeiro cliente, não depois.
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

**Data:** 14/08/2026 · **Status:** `aceito`, **completo** *(máquina e mitigação decididas pelo PI
em 14/08/2026; provisionamento e credencial na segunda rodada do mesmo dia)* · **Bloqueia:**
nada — **F4 destravada**

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

**Decidido pelo PI em 14/08/2026 — provisionamento e credencial.** Eram as duas perguntas que
faziam F4 implementável mas não instalável em academia real. Fechadas juntas porque são a mesma
decisão vista de dois ângulos: como o agente *ganha* identidade e o que ele *apresenta* depois.

**1. Provisionamento: código de pareamento de uso único.** O painel gera um código com TTL curto,
vinculado a `tenant_id` + `gym_unit_id`. Quem instala digita uma vez; o agente troca o código por
um **segredo próprio, por dispositivo**, e o código morre no primeiro uso. Não há segredo dentro
do instalador — o pacote de instalação é inerte e pode circular por e-mail sem ser credencial.

**2. Credencial: segredo por dispositivo, guardado pelo mecanismo seguro do Windows.** Resolve a
barra do `certificado **ou** segredo`: é **segredo**. A guarda é DPAPI/Credential Manager, como
`MVP-01` §15 já exigia. `/api/v1/edge/*` autentica por esse segredo.

**Por que não mTLS.** Certificado por dispositivo é mais forte — segredo copiado do disco não
basta. Mas exige operar uma CA: emissão, renovação, CRL ou OCSP. Para **uma** unidade piloto, num
PC de recepção sem TI, o custo de operar PKI supera o ganho. **Decisão datada, não permanente:**
multi-unidade em escala, ou exigência de cliente enterprise, reabre isto.

**3. Rotação: automática, pelo próprio agente.** A credencial de uso é de vida curta e o agente a
renova sozinho contra o segredo de dispositivo. Segredo que nunca muda em máquina compartilhada é
achado de auditoria — e o caso PR mostrou que controle de acesso é o que a ANPD olha.

**4. Revogação: imediata, pelo admin do tenant, no painel.** Sem chamado e sem suporte no
caminho. Revogar o dispositivo invalida o segredo na hora; o agente volta a precisar de novo
pareamento.

**Consequência que precisa virar escopo, não descoberta em produção.** Renovação automática que
falha silenciosamente derruba a catraca — e sem offline no MVP 1 (ADR-012), derruba de verdade.
O alerta de heartbeat obrigatório em **F11** (`M1-FR-018`) passa a ter **duas causas distintas**:
Edge ausente e **falha de renovação de credencial**. Tratar as duas como um alarme só faz a
recepção ligar para a pessoa errada.

**Risco residual aceito:** um segredo de dispositivo exfiltrado do PC vale até ser revogado.
Mitigação é a rotação curta e o log de uso por dispositivo, não a arquitetura.

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

**Data:** 14/08/2026 · **Status:** `fechado` em 19/08/2026 pelo **ADR-032** · **Bloqueia:** nada

> ✅ **Fechado em 19/08/2026.** O PI escolheu **Sicoob para PIX e Getnet (Santander) para
> cartão** — ver **[ADR-032](#adr-032)**, que carrega a decisão, a matriz de verificação e as
> duas políticas do `M2-COMPLIANCE-01` que continuam abertas. O texto abaixo fica como
> **histórico**: é o raciocínio que levou ao gate, e a matriz de critérios que ele produziu.

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
`.github/`, ~~`docs/prd/**`~~ e `docs/superpowers/**`. Ou seja: **código, configuração de build, CI e
os PRDs aprovados.** PRD só muda por emenda que o PI aprova explicitamente.

> ### Emenda de 19/08/2026 — o Cowork passa a escrever emenda de PRD
>
> **Autorizado pelo PI em 19/08/2026.** Não virou ADR novo: desde o corte de 18/08 o `CLAUDE.md`
> diz que **decisão sobre o próprio processo não vira ADR** — muda-se o arquivo. Fica registrado
> aqui porque a linha riscada acima estava neste ADR, e deixá-la de pé criaria duas verdades.
>
> **O que mudou.** O Cowork escreve em `docs/prd/**` **apenas** para materializar decisão do PI
> **já registrada em ADR aceito**, citando o ADR dentro da própria emenda. Requisito novo, escopo
> novo, ou comportamento que não venha de um ADR: continua sendo do Code ou do PI.
>
> **Por que.** A regra original protegia contra o Cowork inventar escopo de produto — risco real.
> Mas ela também impedia o Cowork de **transcrever** para o PRD uma decisão que o próprio PI já
> tinha tomado e que o próprio Cowork já tinha escrito no ADR. O efeito prático em 19/08 foi um
> ADR-035 correto no `DECISIONS.md` e um `MVP-03` §6 dizendo o **oposto** dele, com a
> reconciliação virando tarefa de outro agente. Documento que contradiz documento é o defeito que
> o ADR-022 e o ADR-018 já tentaram matar duas vezes.
>
> **A cláusula "PRD só muda por emenda que o PI aprova explicitamente" não se moveu** — o que
> mudou é quem digita. O ADR aceito **é** a aprovação explícita; sem ele, o Cowork não escreve
> uma linha lá.
>
> **Risco assumido.** Se um ADR estiver mal escrito, o erro agora se propaga para o PRD sem
> passar por revisão do Code. Mitigação: toda emenda cita o ADR de origem, então o caminho de
> volta é um `grep` — e reverter documento é barato.
>
> Primeira aplicação: `MVP-03` §6, §12 e §16 (ADR-035 e ADR-036), em 19/08/2026.

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

---

<a id="adr-022"></a>
## ADR-022 — A Slice do PRD é a spec; o arquivo em `docs/specs/` é ponteiro

**Data:** 14/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 14/08/2026**)*
· **Emenda** o `CLAUDE.md` → *Ciclo de vida de uma fatia*, passo 1

**Contexto.** O ADR-014 criou `docs/specs/` como artefato próprio. Na prática, o repositório já
tem **três camadas** descrevendo cada fatia: o PRD (FR/BR/NFR/AC numerados, gates, checklist), o
plano em `docs/superpowers/plans/` (passos e arquivos) e agora a spec. Escrever uma quarta
descrição do mesmo escopo produz divergência garantida — é o que o próprio `docs/specs/README.md`
já alertava.

O gatilho foi concreto: o PI declarou as specs aprovadas quando **nenhuma existia**. Duas saídas
possíveis: fingir que existiam, ou fazer a afirmação virar verdade. A primeira é exatamente o
"fechamento frágil" que este processo combate.

**Decisão.**

1. **A `Slice N.M` do PRD é a spec da fatia.** Escopo, requisitos e critérios de aceite moram lá,
   e só lá.
2. **`docs/specs/SPEC-<nnn>-<slug>.md` é um ponteiro fino**, com: fatia, MVP, slice, plano de
   apoio, **status**, **ADRs que bloqueiam**, e quatro seções que o PRD não cobre — decisões
   específicas da fatia, escopo negativo, invariantes tocadas, perguntas ao PI.
3. **O arquivo existe para todas as 41 fatias desde já.** Isso torna o token `[SPEC-<nnn>]` do
   título de issue **verdadeiro** — a regra de ouro do `CLAUDE.md` continua de pé.
4. **O status é que autoriza, não a existência.** `aprovada-pi` só quando não há ADR aberto
   bloqueando **e** o PI olhou a fatia de verdade.

**Estado inicial, registrado com honestidade:**

| status | quantas | quais | por quê |
|---|---|---|---|
| `aprovada-pi` | 8 | F1, F2, F3, F5, F6, F7, F9, F11 | MVP 0 e MVP 1 sem ADR aberto bloqueando |
| `em-revisao` | 8 | F4, F8, F10, F12–F16 | dependem de ADR-007, ADR-008, ADR-011 ou ADR-013 |
| `planejada` | 25 | F17–F41 | MVP 3 a 6. **O PI não pode aprovar hoje o que ainda não foi discutido** |

**Atualização de 14/08/2026, segunda rodada.** Com ADR-011 e ADR-008 fechados, **F4 e F8 foram
aprovadas pelo PI** e passaram a `aprovada-pi`; F10 fica com ADR-007 apenas. O quadro vira
**10 `aprovada-pi`** (F1–F9 e F11), **6 `em-revisao`** (F10 e F12–F16) e 25 `planejada`.

**As 41 issues foram criadas em 14/08/2026**, todas em Backlog, conforme este ADR. O PI decidiu
explicitamente pela leitura do ADR-022 contra a definição antiga de Backlog no `STATUS.md` §2,
que dizia *"spec aprovada, card criado"* — corrigida na mesma data.

O status `planejada` também mudou de
significado — não é mais "arquivo não existe", já que os 41 ponteiros foram criados pelo ADR-022;
hoje quer dizer **"MVP ainda não discutido com o PI"**. Ver `docs/specs/README.md` §3.

**Consequência no ciclo de vida.** O card de fatia passa a ser criado para **todas** as fatias,
em Backlog. O que muda é a saída: **o card só vai para `proplan:todo` se a spec estiver
`aprovada-pi` e os ADRs listados nela estiverem resolvidos.** Backlog vira estacionamento
visível; o portão não se moveu, só ficou mais cedo.

**O que este ADR não afrouxa.** Continua proibido codificar fatia com spec fora de
`aprovada-pi`; continua valendo que decisão de produto é do PI; continua valendo que o Code
pergunta em vez de assumir. A mudança é de **onde o escopo mora**, não de **quem decide**.

---

<a id="adr-023"></a>
## ADR-023 — Card `[INFRA]` é do Cowork; metadados de board também

**Data:** 14/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 14/08/2026**,
terceira rodada)* · **Emenda** o **ADR-021** e o `CLAUDE.md` → *Ciclo de vida de uma fatia*

**Contexto.** O ADR-021 deu ao Cowork a escrita de documento na `main` e listou o que ele **não**
escreve: código, build, CI, PRD e planos. Ele **não disse nada sobre criar issue que não seja de
fatia** — a omissão apareceu na prática, quando o PI pediu os cards `[INFRA]` de bootstrap.

O Cowork preparou o texto dos seis cards e **parou**, entregando-os como arquivo fora do
repositório, com a justificativa de que criar seria a quarta ampliação de escopo em dois dias.
O PI então autorizou a criação **e** pediu o registro — que é este ADR.

**O ADR-021 previu exatamente isto.** Ele nasceu porque *"três exceções seguidas não são exceção
— são a regra real, não escrita"*. Autorizar de novo sem escrever repetiria o erro que ele
diagnosticou.

**Decisão.** Acrescenta-se ao escopo do Cowork:

| ato | por quê |
|---|---|
| **Criar issue `[INFRA]`** (processo e infraestrutura, sem `F` e sem `SPEC`) | é planejamento de execução, não implementação — o Code continua sendo quem constrói |
| **Criar e ajustar metadados do board**: labels `proplan:*`, cor, descrição, milestone | são pré-requisito do ato de criar card; sem a label `Backlog` não há Backlog |

**A fronteira que não se moveu, e é o ponto inteiro:**

1. **O Cowork continua sem implementar código.** Criar o card `[INFRA]` do CI **não é** escrever
   o `ci.yml` — `.github/**` segue proibido ao Cowork pelo ADR-021.
2. **O aceite continua exclusivo do PI.** Nenhuma issue fecha sem ele; `proplan:finalizado` é só
   dele.
3. **Todo código continua entrando por PR com CI verde.**
4. **Decisão de produto continua do PI.** O Cowork registra; não decide.

**Criar issue ≠ fechar issue.** A garantia deste processo nunca esteve em *quem abre o trabalho*
— esteve em **quem o aceita** e em **o código não entrar sem PR**. Ampliar a abertura não toca
nenhuma das duas.

**Custo assumido conscientemente.** O PI perde um ponto de atrito: antes, o card `[INFRA]` só
existiria se ele ou o Code o criasse, o que o obrigava a olhar. Agora o Cowork pode encher o
board sozinho. **Mitigação:** card `[INFRA]` nasce sempre em **Backlog** com assignee **PI** —
nunca em `todo` — e o Cowork nunca move card para frente. Se o board virar depósito, o problema
aparece no Backlog, que é onde dá para varrer, e não em trabalho iniciado.

**Consequência imediata registrada.** Em 14/08/2026 foram criados os seis cards de bootstrap —
[#42](https://github.com/RodReis/arenahub/issues/42) a
[#47](https://github.com/RodReis/arenahub/issues/47) — correspondendo aos itens 1 a 6 de
`docs/DEVELOPMENT.md` §4. **O item 7 (board) não recebeu card** — a *exceção de arranque* impede,
e não há como criar um card para criar o board. **O item 8 (versionar untracked) já estava
cumprido** e não recebeu card: `git status --untracked-files=all` retorna vazio.

**Divergência de ordem, deixada para o PI.** O `DEVELOPMENT.md` §2 diz que a exceção de arranque
*"morre no item 7"* — o board — mas o board é o **penúltimo** da lista da §4. Na ordem escrita, os
itens 1–6 rodam sob regime reduzido e o item 8 cai depois da exceção já morta. O board deveria ser
o **primeiro**: é ele que faz o resto virar processo normal. Reordenar a §4 é do Code, dono do
arquivo.

---

<a id="adr-024"></a>
## ADR-024 — Lista canônica de razões de decisão de acesso

**Data:** 16/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 16/08/2026**)* ·
**Complementa** o **ADR-005** · **Fecha** `docs/DESIGN-UI.md` §17, item 2

**Contexto.** A pendência estava registrada há dois dias e a fatia F9 esbarrou nela na primeira
linha de código. O `reason` de uma decisão de acesso não é rótulo de tela: ele é **gravado no
`AccessEvent`, que é imutável** (`M1-BR-009`). Escolher errado não custa um rename — custa
migração de dado histórico e reinterpretação de auditoria já entregue.

Três documentos davam três listas diferentes, e nenhuma cobria tudo:

| fonte | razões | buraco |
|---|---|---|
| `docs/prd/README.md` §8 | `NO_ENTITLEMENT`, `OUTSIDE_SCHEDULE`, `ADMIN_BLOCK` | estado do aluno não tem rótulo |
| plano `2026-08-14-mvp-01-04`, Task 1 | acrescenta `STUDENT_INACTIVE`, `STUDENT_BLOCKED` | unidade errada não tem rótulo |
| `M1-FR-020` | manda avaliar **5 dimensões**: entitlement, status do aluno, unidade, horário, bloqueio | não nomeia nenhuma |

O `M1-FR-020` é o mais exigente dos três e o único normativo sobre *o que avaliar* — mas é mudo
sobre *como chamar*. As duas listas que nomeiam ficam devendo uma dimensão cada.

**Decisão.** Sete rótulos — um de `ALLOW`, seis de `DENY`:

```ts
outcome: 'ALLOW' | 'DENY'

ACTIVE_ENTITLEMENT   // ALLOW — único caminho de entrada
ADMIN_BLOCK          // DENY  — bloqueio administrativo vigente
STUDENT_BLOCKED      // DENY  — aluno BLOCKED
STUDENT_INACTIVE     // DENY  — aluno em qualquer outro estado ≠ ACTIVE
NO_ENTITLEMENT       // DENY  — nenhum direito vigente na data
WRONG_UNIT           // DENY  — há direito vigente, mas não para esta unidade
OUTSIDE_SCHEDULE     // DENY  — há direito para esta unidade, fora da janela
```

**Por que `WRONG_UNIT` existe separado de `NO_ENTITLEMENT`.** As duas negativas exigem **ações
opostas na recepção**: *"não tem plano"* manda vender; *"tem plano de outra unidade"* manda
conferir se a pessoa errou de porta. Colapsar as duas economiza um rótulo e custa a ação certa —
e o operador não tem como distinguir sem consultar o banco, que é exatamente o que o
`M1-AC-011` proíbe.

**Por que `STUDENT_BLOCKED` existe separado de `STUDENT_INACTIVE`.** `BLOCKED` é decisão
deliberada sobre a pessoa; `ARCHIVED` é consequência administrativa. `M1-BR-002` trata os dois
como negativa, mas a recepção age diferente em cada um.

**Ordem de precedência — é a regra `M1-BR-006`, não convenção de código.** Bloqueio
administrativo → aluno `BLOCKED` → aluno não-`ACTIVE` → sem direito vigente → unidade errada →
fora da janela. Cada degrau é uma restrição que nenhuma checagem posterior afrouxa.

**Extensão sem migração.** O MVP 2 acrescenta inadimplência (`PAYMENT_OVERDUE`) — **acrescenta,
não renomeia**. Por isso nenhum rótulo aqui carrega numeração, posição ou prefixo de MVP: a lista
cresce pelo fim sem tocar no que já foi persistido.

**Relação com o ADR-005.** O ADR-005 fixou o enum `AccessOutcome` (`ALLOW`/`DENY`) em
`packages/api-contracts` e manteve os nomes de evento `AccessGranted`/`AccessDenied` como rótulo
histórico. Este ADR **não mexe em nada disso** — só preenche o campo que o ADR-005 deixou vazio:
*qual* é a razão que acompanha o `outcome`. Os eventos continuam se chamando `AccessGranted` e
`AccessDenied`, transportando `outcome` **e agora `reason`**.

**Onde a lista mora.** Em `packages/access-policy/src/types.ts`, junto do motor que a produz —
não em `api-contracts`. Motivo: o motor precisa rodar **também no Edge** (Slice 1.5), onde não há
Prisma nem NestJS, e `api-contracts` depende de Zod. `api-contracts` re-exporta para quem só
precisa do tipo. Um enum de domínio mora com a regra que o decide.

**Consequência para o `DESIGN-UI.md`.** O item 2 da §17 sai de *pendente* para *fechado por este
ADR*. O dicionário de rótulos em pt-BR — o texto que a tela pública mostra — continua sendo
trabalho de UI e **não é decidido aqui**: este ADR fixa o **código estável**, não a frase.

### Emenda de 16/08/2026 — o oitavo rótulo: `MANUAL_OVERRIDE`

**Decidida pelo PI em 16/08/2026**, durante a implementação da F9.

**O que apareceu.** A lista acima foi fechada olhando o **motor**, que decide a partir de
entitlement. Mas o `AccessEvent.reason` é gravado também pela **liberação manual da recepção**
(`M1-FR-023`), que não passa pelo motor — e nenhum dos sete rótulos a descreve.

Escrever `ACTIVE_ENTITLEMENT` num override seria **gravar mentira num fato imutável**: a recepção
abre a catraca justamente para quem o motor negou, então na maioria dos casos **não há direito
ativo nenhum**. O defeito não é estético — todo relatório de "acessos por direito válido"
precisaria lembrar de excluir `mode = OVERRIDE`, e quem esquecesse contaria exceção como regra.

**Decisão.** Acrescenta-se `MANUAL_OVERRIDE` como oitavo rótulo, **exclusivo de
`mode = OVERRIDE`**:

```ts
ACTIVE_ENTITLEMENT   // ALLOW — decidido pelo motor
MANUAL_OVERRIDE      // ALLOW — gravado pelo caso de uso de override  ← novo
// ... as seis razões de DENY seguem inalteradas
```

**O motor nunca produz este valor**, e isso é garantido por tipo, não por convenção: o tipo
`EngineAllowReason` (em `packages/access-policy/src/types.ts`) exclui `MANUAL_OVERRIDE`, e
`AccessPolicyResult` usa ele — um `evaluateAccess` que tentasse devolvê-lo **não compila**.

**Isto é exatamente o crescimento que o ADR previu.** O corpo acima diz: *"a lista cresce pelo fim
sem tocar no que já foi persistido"*. `MANUAL_OVERRIDE` entra por `ALTER TYPE ... ADD VALUE` — uma
linha de migration, zero dado reescrito. A previsão era sobre `PAYMENT_OVERDUE` no MVP 2; valeu
antes, e pelo mesmo motivo.

**O que não mudou:** as seis razões de `DENY`, a ordem de precedência, e a regra de que só entra
rótulo que é verdade.

---

<a id="adr-025"></a>
## ADR-025 — MVP 2.5: o design system é fatia, não `[INFRA]`

**Data:** 16/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 16/08/2026**)*
· **Emenda** o **ADR-015** e o `CLAUDE.md` → *Padrão de título de issue*

**Contexto.** O PR #76 entregou a interface da recepção e registrou uma dívida: o `admin-web`
está na `main` com F6, F7 e F11 **sem uma linha de CSS**. O Toast exigido pelo `CLAUDE.md` não
foi implementado, e a entrega sugeriu resolver com um card `[INFRA]`.

`[INFRA]` pula spec e pula o aceite do PI. Um design system decide a aparência de toda tela
existente e fixa os **rótulos pt-BR de enum de domínio** — isso é decisão de produto. Empacotar
como infraestrutura é a mesma reclassificação que o `CLAUDE.md` já proíbe no `[FIX]`: trocar o
rótulo do card para escapar do portão.

Do outro lado, o pipeline de build — JSON de token virando `theme.css` e `tokens.ts` — não tem
decisão nenhuma a tomar. Mandá-lo para uma spec só atrasa mecânica pura.

**Decisão 1 — o trabalho se parte em dois.**

| parte | forma | por quê |
|---|---|---|
| Pipeline de tokens (`primitive`/`semantic`/`expression.json` → `theme.css` + `tokens.ts`), Tailwind v4 `@theme`, esqueleto de `packages/ui`, as 6 regras de lint | card **`[INFRA]`** | mecânica de build, zero decisão de produto |
| Componentes, `state-labels.ts`, Toast, superfícies | **fatia com spec** | aparência e texto de tela são produto |

**Decisão 2 — cria-se o MVP 2.5, Design System.** Mesmo padrão do MVP 1.5 (ADR-012): numeração
com meio para não renumerar o que já está escrito em documento e PRD. Três Slices, **definidas
aqui** porque o design system não tem PRD:

| Slice | fatia | spec | superfície | fonte de verdade |
|---|---|---|---|---|
| **2.5.1** | F42 | SPEC-042 | `admin-web` | `docs/design/DS-PAINEL.md` |
| **2.5.2** | F43 | SPEC-043 | `mobile` | `docs/design/DS-APP.md` |
| **2.5.3** | F44 | SPEC-044 | `kiosk` | `docs/design/DS-TOTEM.md` |

**Decisão 3 — emenda ao ADR-015.** O ADR-015 dizia *"41 fatias, F1 a F41"* e amarrava fatia a
Slice do PRD. Passa a valer: **a fatia nasce de uma Slice; a Slice normalmente mora no PRD, e
excepcionalmente num ADR**, quando o trabalho é de plataforma e não tem PRD que o descreva. O que
**não** muda: um número por Slice, alocado uma vez no Índice do `STATUS.md`, nunca reaproveitado,
nunca sufixado. A contagem vai de 41 para **44 fatias**.

**Decisão 4 — dois tokens novos de título.** `[MVP1.5]` e `[MVP2.5]`. O `[MVP1.5]` estava
pendente desde a criação do MVP 1.5: a issue #10 (F10) ficou sem token de MVP porque o
`CLAUDE.md` só previa `[MVP0]`…`[MVP6]`, e inventar violaria a regra de ouro *"só entra token
que é verdade"*. Agora é verdade — o MVP existe e está escrito.

**Gate de entrada, por fatia — e é aqui que mora o risco.**

- **F42 não tem gate.** A dívida é ativa: cada fatia de UI nova aprofunda o retrofit.
- **F43 e F44 têm gate: o PI priorizar o MVP 4.** As superfícies `mobile` e `kiosk` **não
  existem** — `apps/mobile` e `apps/kiosk` não foram criados, e as features que as usariam são
  F23–F29.

**Risco registrado, não escondido.** F43 e F44 constroem componente sem consumidor. Componente
sem uso real erra em silêncio: só a tela que o usa revela que o token está errado, que o alvo de
toque não cabe, que o estado que faltava era outro. A mitigação é o gate — as duas ficam
`aprovada-pi` para não precisarem de nova rodada, mas **não se pegam antes do MVP 4**. Se na
prática forem reescritas ao entrar o MVP 4, o erro terá sido nosso e está previsto aqui.

**O que este ADR não faz.** Não aprova o MVP 4 e não antecipa nenhuma feature dele. Aprova o
**contrato de design** das três superfícies, que já estava escrito, e dá a ele numeração e
portão.

---

<a id="adr-026"></a>
## ADR-026 — `docs/design/**` é fonte de verdade de design

**Data:** 16/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 16/08/2026**)*
· **Emenda** o **ADR-021** · **Rebaixa** `docs/DESIGN-UI.md`

**Contexto.** O PI produziu e colocou no repositório seis arquivos em `docs/design/`: três
contratos por superfície (`DS-PAINEL.md`, `DS-APP.md`, `DS-TOTEM.md`) e três protótipos
navegáveis (`.dc.html`). Eles são mais completos e mais específicos que o `docs/DESIGN-UI.md`,
que segue `RASCUNHO` com 8 pendências.

**Decisão 1 — os três `.md` de `docs/design/` são o contrato de implementação de UI.** Onde
divergirem do `DESIGN-UI.md`, **eles vencem**. O `DESIGN-UI.md` passa a ser documento de
**direção** — de onde saiu Carbono Adaptativo e o pipeline de accent —, não de contrato. As specs
042–044 apontam para `docs/design/`, nunca para o `DESIGN-UI.md`.

**Decisão 2 — os `.dc.html` são referência visual, não código a instalar.** São bundles
autocontidos, com CSS, fontes e imagens **inline**. Colar isso em `packages/ui` produz
exatamente o hex literal espalhado que a regra 1 de lint (`DS-PAINEL.md` §11) existe para
proibir. Servem para conferir intenção; a implementação nasce dos tokens.

**Decisão 3 — `docs/design/**` entra no escopo de escrita do Cowork.** O ADR-021 listou o que o
Cowork escreve na `main` e `docs/design/` não existia. Fica somado à tabela, pelo mesmo critério
dos outros: é documento, não implementação. **`apps/`, `packages/`, `infra/`, `.github/`,
`docs/prd/**` e `docs/superpowers/**` continuam fora.**

**Ressalva — o que "fonte de verdade de design" não alcança.**

Design decide cor, tipo, espaço, componente, layout, movimento, tom de voz e regra de lint.
**Não decide enum de domínio.** Enum é contrato: mora no `CONVENTION.md` e nos ADRs, é gravado em
tabela e, no caso de `AccessEvent`, é **imutável** (`M1-BR-009`).

O caso concreto que motivou a ressalva: os três documentos listam as razões técnicas de `DENY`
como `NO_ENTITLEMENT`, `OUTSIDE_SCHEDULE`, `WRONG_UNIT`, `ADMIN_BLOCK` e `SUBSCRIPTION_OVERDUE`.
O **ADR-024** fixou seis razões de `DENY`, e `SUBSCRIPTION_OVERDUE` não é uma delas; faltam
`STUDENT_BLOCKED` e `STUDENT_INACTIVE`, que a **F9 já entregou** e que o código já grava.

Os documentos de design foram escritos a partir da Especificação e do `ARCHITECTURE.md` §4.3, os
dois desatualizados — é **omissão herdada, não decisão de design**. Tratá-la como fonte de
verdade apagaria dois rótulos já persistidos em evento imutável, que é precisamente o custo que o
ADR-024 nomeia: *"não custa um rename — custa migração de dado histórico"*.

**Portanto:** neste ponto quem cede é o documento de design. `docs/design/DS-PAINEL.md` §8.5,
`docs/design/DS-TOTEM.md` §8 e `docs/ARCHITECTURE.md` §4.3 são corrigidos para as oito razões do
ADR-024. `SUBSCRIPTION_OVERDUE` **não é razão do motor** — a permissão do ADR-003 era para razão
*exibida*, derivada de metadado gravado no entitlement na suspensão, e isso é assunto do MVP 2,
não do dicionário de acesso.

**Regra geral que fica:** quando um documento de design e um ADR de domínio divergirem sobre
**nome de estado, razão ou enum**, o ADR vence e o documento de design é corrigido. Sobre
qualquer outra coisa, o documento de design vence.

---

<a id="adr-027"></a>
## ADR-027 — Modelo de `Payment` e `PaymentAttempt`

**Data:** 18/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em
18/08/2026**; as quatro perguntas respondidas e a emenda ao PRD aplicada no mesmo dia)*
· **Recorta** o **ADR-013** · **Emenda** o `MVP-02` §7 e §11 · **Bloqueia:** nada

**Contexto — e a correção que este ADR carrega.** O ADR-013 empacotou duas coisas de natureza
diferente: **qual provedor** (que sai da homologação, card `[GATE]`) e **como o pagamento é
modelado** (que não depende de provedor nenhum). Enquanto as duas viveram no mesmo ADR, a F12
apareceu bloqueada por um gate que não a alcança:

- o `MVP-02` §5 diz *"Antes da **Slice 2.2**, uma decisão registrada deve comparar ao menos…"* —
  o gate é pré-requisito da **2.2**, não da 2.1;
- os cinco itens da Slice 2.1 (configurações financeiras por tenant, invoice/itens/numeração,
  criação pelo ciclo da assinatura, **pagamento manual com dupla permissão**, timeline e
  auditoria) não chamam um único método de `PaymentProvider`;
- o *pagamento manual* é precisamente um pagamento **sem adapter** — dinheiro ou transferência
  reconhecidos na recepção.

**Decidido pelo PI em 18/08/2026:** partir. O ADR-013 segue `aberto` só para o provedor e as duas
políticas do `M2-COMPLIANCE-01`, bloqueando F13–F16. O modelo vem para cá.

**O que já está fixado e não se reabre.** O `MVP-02` §11 já separa `payments` de
`payment_attempts` — a forma de duas tabelas **não é invenção deste ADR**, é leitura do PRD. O
`CONVENTION.md` §2.3 e §3.5 registram as duas como `[indefinido]` em campo e em grafo de estado;
é esse vazio que este ADR fecha. Também continuam valendo, sem reabertura: **dinheiro é inteiro
na menor unidade** (`M2-BR-001`), **moeda e valor não mudam depois que a invoice abre**
(`MVP-02` §11), **`PAID` nunca volta a `OPEN`** (INV-069) e **idempotência por
`(provider_account_id, external_event_id)`** (ADR-006, INV-076).

### Recomendação técnica

**1. As duas tabelas respondem perguntas diferentes.**

| entidade | pergunta que responde | cardinalidade |
|---|---|---|
| `PaymentAttempt` | *o que eu tentei?* — uma tentativa contra um método/provedor, com sua chave de idempotência | invoice 1 → N |
| `Payment` | *que dinheiro foi reconhecido?* — fato consumado contra a invoice | invoice 1 → 0..N |

Isso resolve o caso que o próprio ADR-013 levantou — **invoice paga em duas tentativas (PIX falho
+ cartão)**: as duas tentativas ficam em `payment_attempts`, com a falha preservada; só a segunda
produz um `payment`. Sucesso posterior não apaga o histórico da falha.

**2. Campos propostos.**

`payments`: `id`, `tenant_id`, `invoice_id`, `amount_minor` (inteiro), `currency`, `method`,
`status`, `paid_at`, `recognized_by_user_id` (preenchido só quando `method = MANUAL`),
`attempt_id` (nulável — pagamento manual não tem tentativa), `provider_account_id` e
`external_payment_id` (nuláveis, pelo mesmo motivo), `created_at`.

`payment_attempts`: `id`, `tenant_id`, `invoice_id`, `payment_method_id`, `idempotency_key`,
`status`, `provider_account_id`, `external_payment_id`, `failure_code`, `failure_is_permanent`,
`requested_at`, `settled_at`.

**Sem `gym_unit_id` em nenhuma das duas** — pagamento não é dado físico (`CLAUDE.md`, regra de
arquitetura 2). O enum `method` inclui `MANUAL`, e é ele que faz a Slice 2.1 fechar sem adapter
nenhum.

**3. Os dois grafos do `CONVENTION.md` §3.5 são de entidades diferentes, não versões concorrentes
do mesmo.** Leitura proposta:

- `Payment`: `PENDING → CONFIRMED → REFUND_PENDING → REFUNDED`, com `FAILED` e `CANCELLED` como
  saídas de `PENDING`. `CONFIRMED` não volta atrás — é o par de INV-069 do lado do pagamento.
- `PaymentAttempt`: `CREATED → REQUIRES_ACTION → PROCESSING → SUCCEEDED | FAILED`.

**4. `autorização revogada` não é estado de `Payment`.** O ADR-013 observou, com razão, que o Pix
Automático traz um estado que cartão não tem: o pagador cancela a autorização no app do banco. Mas
quem é revogado é o **mandato**, não o pagamento. O lugar é o `PaymentMethod`
(`ACTIVE | REVOKED_BY_PAYER | EXPIRED`), e o efeito é *a próxima cobrança não acontece* — distinto
de *a cobrança aconteceu e falhou*. Tratar como falha de pagamento é exatamente o erro que o
`LANDSCAPE.md` §4.2 nomeia: cobrança indevida e churn silencioso. **Esta parte é decidível agora
porque não depende de qual provedor implementa o mandato.**

### Perguntas ao PI — respondidas em 18/08/2026

| # | pergunta | resposta do PI |
|---|---|---|
| 1 | Pagamento parcial existe? | **Não.** A invoice só vira `PAID` com o valor **integral**; registro parcial é rejeitado. Não existe saldo devedor no MVP 2 |
| 2 | Limite da dupla permissão do pagamento manual e quem aprova | **Sai do MVP 2.** ⛔ Isso **contradiz o `MVP-02` §7, Slice 2.1**, que é PRD aprovado — o PI decidiu **emendar o PRD**. Enquanto a emenda não estiver no arquivo, este ADR não fecha |
| 3 | Pagamento manual pode ser estornado pelo sistema? | **Não.** Só **contra-lançamento auditado**, com motivo e autor. O `payment` original nunca muda de estado; a devolução física acontece fora do sistema |
| 4 | Sobrepagamento | **Aceita e vira crédito** do aluno, abatido na próxima invoice |

### Consequências dessas respostas

**1. A resposta 4 cria uma tabela que o PRD não lista.** O `MVP-02` §11 enumera as tabelas do
MVP 2 e **não tem crédito de aluno**. Acrescentar é ampliar modelo aprovado — o mesmo caso que o
ADR-013 apontou no contrato `PaymentProvider`, e que o `prd/README.md` §10.2 manda perguntar antes
de fazer. **Vai na mesma emenda da resposta 2.** Campos propostos:

`account_credits`: `id`, `tenant_id`, `student_id`, `origin_payment_id`, `amount_minor`,
`currency`, `status` (`AVAILABLE | APPLIED | EXPIRED`), `applied_to_invoice_id`, `created_at`.
Crédito **não é dinheiro devolvível** no MVP 2 — só abate invoice.

**2. Assimetria deliberada entre as respostas 1 e 4.** R$ 119 de uma mensalidade de R$ 120 é
**rejeitado**; R$ 121 é **aceito** e gera R$ 1 de crédito. Isso só é coerente se a política da
academia for **não aceitar pagamento parcial no balcão**. Se na prática a recepção aceita, a
resposta 1 precisa ser reaberta: dinheiro que entra sem registro é pior que modelo complicado.

**3. Risco de controle interno — registrado porque não pode ficar implícito.** Com a dupla
permissão fora (2), sem desfazimento pelo sistema (3) e com crédito gerado por sobrepagamento (4),
**some o único gate de dois olhos do fluxo de dinheiro manual**: um recepcionista sozinho registra
um pagamento manual inflado, gera crédito e não há aprovação na entrada nem estorno na saída — só
contra-lançamento posterior, se alguém perceber.

**Mitigação mínima que este ADR carrega:** todo `payment` com `method = MANUAL` grava
`recognized_by_user_id` e entra na timeline de auditoria financeira da Slice 2.1; todo
`account_credit` guarda `origin_payment_id`. **Isso detecta depois — não impede antes.** A
diferença é deliberada e é do PI.

### Emenda ao PRD — aplicada em 18/08/2026

O `MVP-02` foi emendado no mesmo dia. O `§7` foi escrito pelo PI; o `§11` foi aplicado pelo Cowork
com **autorização explícita do PI, válida só para esta emenda** — exceção pontual ao ADR-021,
registrada aqui com data para não virar precedente:

1. **§7, Slice 2.1** — *"pagamento manual com dupla permissão quando acima do limite"* passou a
   *"pagamento manual com registro auditado do operador"*. O controle deixa de ser preventivo e
   passa a ser detectivo. **A consequência 3 acima é o preço dessa troca, e é conhecido.**
2. **§11** — `account_credits` acrescentado ao modelo de dados.

Com isso o ADR-027 fecha. **A F12 deixa de ter ADR bloqueando.** O que ainda falta nela é
preencher a `SPEC-012` (§3, §4 e §5 vazias) e a **entrada do MVP 2**, que exige MVP 1 estável e
não depende de decisão nenhuma deste arquivo.

### Escopo negativo

Este ADR **não** escolhe provedor, **não** define o contrato `PaymentProvider` (isso é ADR-013 +
`MVP-02` §12) e **não** decide as políticas de refund do `M2-COMPLIANCE-01`. Ele também **não
torna a F12 pegável**: a entrada do MVP 2 exige MVP 1 estável, e o MVP 1 depende do gate §15 do
MVP 0, hoje aberto pelo modo `acionamento1: 8` da catraca.

---

<a id="adr-028"></a>
## ADR-028 — O modo de acionamento da catraca é código do edge-agent, não configuração do equipamento

**Data:** 18/08/2026 · **Status:** `proposto` *(correção factual com uma decisão pendente —
**aguardando o PI**)* · **Corrige** a *decisão 4* da `SPEC-002` · **Bloqueia:** `M0-AC-004`, logo
o **gate §15 do MVP 0**, logo o **MVP 1 inteiro**

**Contexto.** Desde 17/08/2026 o repositório registra, em quatro lugares (`STATUS.md` §1 linha 7,
field-note de 17/08 §4, relatório de POC §9.2 e `SPEC-002` decisão 4), que a catraca em
`acionamento1: 8` (`CATRACA_LIBERADA_DOIS_SENTIDOS`) deixa entrar sem reconhecimento, e que
mudar isso é *"configuração do equipamento, não do ArenaHub"*, *"de ninguém como código"*,
pendente de *"o manual do SDK na mão"*.

**Três achados de 18/08/2026 dizem que essa leitura está errada.**

**1. O ArenaHub já escreve o acionamento — em toda conexão.** A ponte nativa
(`apps/edge-agent/native/easyinner-bridge/EasyInnerBridge.cs`) declara
`ConfigurarAcionamento1(byte Funcao, byte Tempo)` e a chama dentro do `Conectar`:

```csharp
pior = Math.Max(pior, ConfigurarAcionamento1(1, 5)); // ACIONA_REGISTRO_ENTRADA_OU_SAIDA, 5s
```

O modo **não é um valor achado no equipamento**: é um literal no nosso código, passado a cada
`conectar`. O comentário do próprio arquivo já listava parte do enum
(`ACIONA_REGISTRO_ENTRADA_OU_SAIDA = 1`).

**2. A Topdata documenta que a config do SDK sobrescreve a do WebServer.** A base de
conhecimento do integrador é explícita: no momento em que o equipamento entra em modo online via
SDK, a DLL envia o conjunto de parâmetros do buffer e substitui o que foi configurado à mão;
*"o software é sempre a fonte de verdade das configurações"*; e **não há forma** de manter a
configuração feita pelo WebServer depois que o equipamento entra em online pelo SDK.

**Consequência direta:** procurar o modo bloqueado *"no menu do painel"* era caminho morto por
construção. Mesmo que estivesse lá, o `conectar` do ArenaHub apagaria na conexão seguinte.

**3. O `acionamento1: 8` lido em 15/08 é config do software legado, não do equipamento.** A
leitura foi feita com a catraca ainda apontada para o `.106` — o legado — e antes de a ponte
existir. Não é padrão de fábrica nem escolha de instalação: é o que o software anterior mandava.

**O que isto muda, na prática.** A pendência sai de *"tarefa de hardware sem manual, para a
próxima janela"* e vira **um parâmetro de código do `edge-agent`**, com reversão trivial (voltar o
literal) e sem tocar em nada no equipamento. Deixa de depender de janela física para **decidir**;
a janela continua necessária só para **provar**.

### O que continua desconhecido, e é honesto dizer

**A tabela completa do enum `Funcao` não está no repositório.** O que temos é o comentário da
ponte, com um único valor de acionamento (`=1`). Não sabemos:

- se `Funcao = 1` **já é** o modo travado-em-repouso — o nome *"aciona no registro de entrada ou
  saída"* sugere que o relé só atua quando há registro, o que seria exatamente o comportamento
  desejado — e, se for, o furo de 17/08 tem outra causa (mecânica ou de sentido de instalação);
- ou qual outro valor corresponde a **bloqueada em repouso**.

**Onde a resposta está:** no manual do SDK Inner Acesso e na ferramenta `Lab EasyInner`, ambos no
portal do integrador Topdata — que o `PROTOCOLO-CATRACA.md` §"o que ainda falta" já listava como
pendência (*"os exemplos de código da SDK"* e *"cadastro de integrador"*). **Isto é obtenção de
documento, não janela de bancada.**

### Decisão pedida ao PI

| # | pergunta |
|---|---|
| 1 | Autoriza tratar o modo de acionamento como **escopo de código** (parâmetro configurável da ponte, com default explícito e registrado), corrigindo a *decisão 4* da `SPEC-002`? |
| 2 | Quem busca o enum no portal do integrador — e o cadastro de integrador Topdata está feito? Sem isso, o valor continua desconhecido e nenhuma janela resolve |

### Escopo negativo

Este ADR **não** afirma qual valor de `Funcao` é o correto — afirma que a pergunta é respondível
por documento, não por tentativa em equipamento de produção, e que a resposta se aplica por
código. Também **não** altera a `SPEC-002` por conta própria: a decisão 4 é do PI e só ele a
revisa.

---

<a id="adr-029"></a>
## ADR-029 — Gate §15 do MVP 0: `GO_WITH_CONSTRAINTS`

**Data:** 18/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 18/08/2026**)*
· **Fecha** o gate §15 do `MVP-00` · **Destrava:** MVP 1 (F6–F9, F11)

**Decisão.** `GO_WITH_CONSTRAINTS`. **O MVP 1 começa.** O `M0-AC-010` — *"a decisão final e suas
restrições são aprovadas por tecnologia e operação"* — está satisfeito por **Rodrigo Reis (PI)**,
acumulando os dois papéis, em 18/08/2026.

**Evidência que sustenta.** Duas janelas físicas em 17/08/2026, registradas no field-note
`docs/field-notes/2026-08-17-ciclo-facial-ao-vivo.md` e no relatório
`docs/reports/MVP-00-relatorio-poc-topdata.md`:

- a catraca girou por comando — 30 comandos, **28 giros confirmados por sensor** (`origem:6`),
  2 timeouts (`origem:5`), **0 duplas**, entrada e saída → `M0-AC-003`;
- o **ciclo facial rodou ponta a ponta**: leitor conecta → ArenaHub cadastra → rosto reconhecido →
  `sendlog` recebido → decisão local → catraca destrava → giro confirmado;
- cutover `.106` → `.190` → `.106` executado e o legado religado ao fim da janela.

**O que não fechou — e não se finge que fechou.**

| critério | por que não fechou | vira |
|---|---|---|
| `M0-AC-004` — *acessos negados não acionam fisicamente a catraca* | **a medição está confundida**, não o critério: com a catraca em `acionamento1:8` o braço gira livre, e giro observado não distingue "o sistema acionou" de "a pessoa empurrou". A causa **ainda não está diagnosticada** — ver ADR-028 | **restrição 1 e 2** |
| `M0-AC-002` — remoção dos três usuários confirmada no dispositivo | não executado | **restrição 4** |
| `M0-AC-008` — p50/p95/máximo reais | **impossível dentro do MVP 0**: a latência ponta a ponta depende da decisão pela nuvem, que é F9, do MVP 1. Um critério de saída mensurável só no MVP seguinte não pode travar o anterior — é exatamente o caso que o `GO_WITH_CONSTRAINTS` existe para resolver | **restrição 3** |
| relógio do leitor facial (`ocorridoEm` congelado) | achado de 17/08, já decidido: acertar o relógio **e** carimbar `recebidoEm` como critério de ordenação quando o `ocorridoEm` for implausível | escopo de **F2** |

### As restrições — são normativas, não recomendação

1. **Nenhuma unidade entra em operação real com a catraca em modo livre.** Bancada e piloto
   interno, sim. Academia com aluno pagante, **não**, enquanto o braço girar sem comando.
2. **`M0-AC-004` é condição de saída do MVP 1.** O MVP 1 não fecha sem evidência de que acesso
   negado não abre a catraca, **com a catraca em modo bloqueado**.
3. **`M0-AC-008` real é medido na F9**, com decisão pela nuvem, e entra no relatório do MVP 1 —
   p50, p95, máximo, taxa de erro e limitações por equipamento.
4. **`M0-AC-002` roda antes** de qualquer dado biométrico de pessoa real entrar na bancada.

### O que esta decisão afirma, e o que não afirma

**Não afirma** que a garantia física de que só quem tem direito entra está provada. Ela **não
está**. Afirma que a falha é **conhecida, nomeada, datada e carregada como restrição escrita**, e
que o custo de segurar o MVP 1 inteiro por ela é maior que o de carregá-la — **sob a condição de
que nada vá a produção antes de fechá-la** (restrição 1).

Quem ler este ADR depois de um incidente vai encontrar a falha descrita aqui antes de ela
acontecer. Essa é a diferença entre `GO_WITH_CONSTRAINTS` e um `GO` que teria dito que estava tudo
certo.

---

<a id="adr-030"></a>
## ADR-030 — Aprovação antecipada das SPEC-012 a 016, com o ADR-013 aberto

**Data:** 18/08/2026 · **Status:** `aceito` *(decisão nova — **decidida pelo PI em 18/08/2026**)*
· **Contraria** o checklist §6 das próprias specs e o `CLAUDE.md` → *Antes de codificar*

**Decisão do PI.** As `SPEC-012` a `SPEC-016` passam a `aprovada-pi` **agora**, sem esperar o
ADR-013 nem o preenchimento das seções vazias.

**O que isso contraria, textualmente.** O §6 de cada spec exige três marcas antes de codificar:
status `aprovada-pi`, **"os ADRs listados acima estão resolvidos"** e evidência do gate de entrada
do MVP. A segunda **não está satisfeita** para F13–F16: o **ADR-013 continua `aberto`**, e a
`SPEC-015` depende também do campo de âncora do ADR-019. As `SPEC-012` a `016` também estão com
**§2, §3, §4 e §5 vazias** — não têm escopo negativo, invariantes tocadas nem perguntas ao PI.

**A recomendação do Cowork foi contrária**, e fica registrada: aprovar não destrava fatia nenhuma
— F13–F16 continuam impegáveis pela **entrada do MVP 2** (MVP 1 estável + provedor homologado), e
o efeito prático é só a mudança do rótulo. O risco é o *aceite narrado* que o ADR-016 existe para
expulsar: um `aprovada-pi` que não significa "revisado", e sim "carimbado".

**Por que fica assim mesmo.** Aprovar spec é prerrogativa exclusiva do PI (`ADR-014`, `ADR-021`).
O Cowork registra a decisão e a divergência; não a bloqueia.

### Consequências, e o que continua valendo

1. **O `[ ] Os ADRs listados acima estão resolvidos` permanece desmarcado** nas `SPEC-013` a
   `016`. `aprovada-pi` **não** o marca, e nenhum PR de F13–F16 abre com ele desmarcado.
2. **Nenhum card sai do Backlog por causa desta decisão.** O gate de entrada do MVP 2 é o que
   segura, e ele não é spec.
3. As seções vazias continuam sendo dívida. Preenchê-las é trabalho do Cowork **quando a fatia for
   entrar em execução** — antes do PR, não antes do rótulo.
4. Se a homologação do ADR-013 mudar o desenho de alguma dessas fatias, **a spec aprovada não vira
   escudo**: vale o desenho novo, e a spec é corrigida.

---

## ADR-031 — Tailwind e shadcn/ui entram no `admin-web`, com o design system próprio mantido

**Data:** 18/08/2026 · **Decisor:** PI · **Status:** aceito

### Contexto

A F46 aplicava o DS-PAINEL nas telas do `admin-web`. Faltavam dois componentes que o inventário do
§9 nunca listou — `select` e `textarea` — e cinco dos seis formulários dependiam deles: cada tela
remontava `<p><label><select>` por conta própria, produzindo 53 controles crus com altura medida
entre 19 e 24 px contra os 36 px do contrato.

O Code havia escrito `SelectField` e `TextareaField` reusando o CSS do `Field`. O PI determinou o
uso do shadcn/ui para componentes.

**A decisão contraria dois documentos**, e os dois foram corrigidos em vez de ignorados: o
`PRODUCT.md` listava "shadcn copiado inteiro" como anti-referência, e o `DESIGN-UI.md` §3.4 dizia
`packages/ui` próprio sem copiar shadcn.

### Decisão

Tailwind v4, PostCSS e shadcn/ui entram no `admin-web`. O design system próprio **permanece** como
fonte do que é específico do produto.

O que ficou do `init`: Tailwind, PostCSS, a fonte `Geist` em `--font-sans` e a paleta do shadcn
(`--primary`, `--chart-*`, `--sidebar-*`) no `globals.css`.

**Os dois sistemas convivem porque os prefixos não colidem.** O painel lê `--ah-*` e continua em
Inter Variable — medido no navegador, o `body` renderiza `"Inter Variable"` e o canvas segue
`#F5F7F9`. A inversão carbono/accent, que era a preocupação do `PRODUCT.md`, sobrevive por isso.

**Regra que a decisão cria:** componente do shadcn que quebre teclado, leitor de tela ou E2E não
entra. Foi o que barrou o `Select` dele — é `<div role="combobox">` com zero `<option>`, e
derrubaria os oito `selectOption` da suíte mais o teste que lê `<option>` para conferir que só
transições válidas aparecem.

### Consequências

**Positivas.** O ecossistema shadcn fica disponível para o que o `packages/ui` não cobre.

**Negativas, medidas.**

- **Uma regressão real.** O Preflight do Tailwind zerou os controles ainda não migrados: borda
  0 px, fundo transparente, 20 px de altura. Antes eram feios com a borda do navegador; depois
  ficaram invisíveis. Isso transformou a migração dos seis formulários de melhoria em conserto
  obrigatório — feito no mesmo PR.
- **Duas fontes de verdade para cor** no `globals.css`, e 135 linhas somadas.
- **O lint de design não enxerga classe utilitária.** As regras 1, 2 e 3 do DS-PAINEL §11 são
  aplicadas por seletor de AST em JS/TS; um hex literal escrito em `className` passa direto. O gate
  de contraste do build também não cobre o que o Tailwind pinta.
- **Nenhum componente do shadcn está em uso.** Os três instalados (`select`, `textarea`, `button`)
  foram removidos por não passarem no critério acima, e com eles saíram `@base-ui/react`,
  `lucide-react` e `tw-animate-css`, que ficaram órfãos.

### Alternativa descartada

Migrar com os componentes do shadcn e reescrever os nove testes que dependem de `<select>` nativo.
Descartada pelo PI: o escopo da F46 é aplicar o design system, não reescrever a suíte de
acessibilidade.

---

<a id="adr-032"></a>
## ADR-032 — Dois provedores de pagamento: Sicoob para PIX, Getnet para cartão

**Data:** 19/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 19/08/2026**
· **Fecha** o [ADR-013](#adr-013) · **Emenda** o `MVP-02` §5 · **Destrava:** F14, F15 e F16

**Contexto.** O ADR-013 mandou a escolha do provedor sair de um card `[GATE]` de homologação,
com matriz comparativa. Esse card **nunca chegou a ser criado**, e F14–F16 ficaram paradas no
Backlog por um portão que não existia no board.

Em 19/08 o PI trouxe o fato que faltava e que **não estava em documento nenhum** — nem no
`LANDSCAPE.md` §4.2, nem no ADR-013: **a Arena Positiva já recebe pela Sicoob.**

**Decisão.** **PIX pelo Sicoob. Cartão tokenizado e recorrência pela Getnet (Santander).**

O gate deixou de ser competição entre marcas e virou **verificação** dos dois escolhidos, feita
em [`docs/reports/MVP-02-matriz-de-homologacao-de-provedor.md`](reports/MVP-02-matriz-de-homologacao-de-provedor.md).

**Por que dois, e não um.** O Sicoob é **banco, não adquirente**: as APIs públicas cobrem Pix
recebimentos, cobrança bancária e pagamentos/transferências. **Não há cartão tokenizado, cofre
de tokens nem assinatura.** O `MVP-02` §5 exige as três capacidades do provedor único —
logo, provedor único é impossível com o Sicoob, e trocar o Sicoob custaria à academia o
relacionamento bancário que ela já tem.

**Emenda ao `MVP-02` §5.** Onde se lia *"Um segundo provedor não faz parte deste MVP"*, passa a
valer: **PIX e cartão podem vir de provedores distintos, cada um atrás da mesma porta
`PaymentProvider`.** A vedação original continua válida no que importava — não existem **dois
adapters concorrentes para a mesma capacidade**, que era o custo que ela evitava.

### Consequência estrutural: a porta já comportava dois

A F13 acertou a forma sem saber. `ProviderAccount` tem coluna `provider` com
`@@unique([provider, externalAccountId])`; a rota é `/api/v1/webhooks/payments/:provider`; e o
provedor é injetado por **token** (`PAYMENT_PROVIDER`), não por classe.

O que muda: a escolha do adapter deixa de ser **por ambiente** e passa a ser **por método** —
`createPix` → Sicoob; `createTokenizedSubscription` e `cancelSubscription` → Getnet. Roteamento
é decisão técnica do Code, registrada no PR da fatia.

### A regra que a fatia de cartão não pode violar (INV-098)

A Getnet tem **dois caminhos** de tokenização, e só um satisfaz o INV-098:

- 🔴 `POST /v1/tokens/card` **chamado pelo backend** recebe `card_number` cru — o PAN passaria
  pelo nosso servidor e jogaria o `apps/api` para dentro do escopo PCI DSS;
- ✅ **Get Checkout / iframe / SDK no cliente** — o dado vai do navegador direto para a Getnet e
  o backend recebe **só o token**.

**O ArenaHub implementa exclusivamente o segundo.** Variável com `cardNumber`, `pan` ou `cvv` em
`apps/api` é defeito de PCI, não campo faltando.

### O achado que ainda pode voltar à mesa

**A assinatura de webhook não está confirmada em nenhum dos dois provedores.** O ADR-013 é
categórico — *"sem HMAC verificável, o provedor está fora"* — e o INV-077 exige verificar
assinatura e origem antes de qualquer processamento.

Isso **não bloqueia a F14**, que cria e cancela assinatura: confirmação por webhook é caminho da
F13 e da F15. Mas **bloqueia dinheiro real em produção**, e precisa de resposta com credencial
em mãos. Se um dos dois não assinar, a saída não é aceitar: é **consulta ativa**
(`getPaymentStatus`) como fonte de verdade, com o webhook tratado como gatilho não confiável —
forma que a F13 já implementou.

### Limite de confiança desta decisão

A matriz foi montada a partir de **documentação pública e fontes secundárias**. Os dois portais
de desenvolvedor exigem credencial (`developers.sicoob.com.br` é SPA;
`developers.getnet.com.br` devolve **403** a cliente automatizado), então **nada foi verificado
em sandbox**. Os itens marcados ❓ na matriz — estorno parcial, chave estável de evento, entrega
fora de ordem, assinatura de webhook — precisam de confirmação antes de virar código de adapter.

**Registrado também:** há relato público de desenvolvedores a quem o suporte do Sicoob respondeu
que *"não há documentação, trabalhem por tentativa e erro"*. Contra o critério *"sandbox e
qualidade da documentação"* do ADR-013, é dado ruim — e é a razão de a matriz marcar tanto item
como ❓ em vez de assumir paridade com um gateway maduro.

### O que continua aberto

As **duas políticas do `M2-COMPLIANCE-01`**, que já estavam abertas no ADR-013 e **não** são
resolvidas aqui: `KEEP_UNTIL_PERIOD_END` vs `SUSPEND_ON_CONFIRMATION` no refund, e os limites de
desconto, pagamento manual e step-up. São decisão de produto, e bloqueiam **F16**, não F14.

**Pix Automático não entra no MVP 2.** A recorrência vem do cartão, pela Getnet. Não foi
confirmado se o Sicoob o oferece. A consequência de modelagem registrada no ADR-013 permanece
válida para quando entrar: `autorização revogada` é estado de primeira classe, **distinto** de
`pagamento falhou`.

---

## ADR-033 — Importação da base legada do Pacto: 1.926 alunos entram como `CANCELLED`

**Data:** 19/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 19/08/2026**
· **Destrava:** F47 · **Depende de** `Plan` "Programa Adultos e Idosos" já cadastrado

**Contexto.** A Arena Positiva opera hoje no Pacto. O acervo é de **1.926 alunos**, dos quais
**258 ativos** segundo o relatório e **347** segundo o CSV da catraca. O PI quer o acervo inteiro
no ArenaHub — inativo, para histórico e para que o retorno de um ex-aluno seja reativação e não
recadastro.

Migração de dado histórico é, pelo `CLAUDE.md`, caso de ADR: é cara de desfazer e outro sistema
(a catraca) já consome o resultado.

**A fonte não é um banco, é um PDF.** O Pacto entrega o *Relatório Geral de Clientes* em 243
páginas. Um primeiro extrator produziu 1.934 registros que **pareciam corretos e não eram**:
nome truncado no primeiro token em 1934/1934, endereço zerado em 1934/1934, nome de plano
colapsado (15 valores no lugar de 29 — `PLANO INDIVIDUAL 3X` e `7X` viraram a mesma string), e
as colunas `data_nascimento` e `data_matricula` **invertidas**. O defeito comum era ler o PDF
com `extract_text()`, que descarta as coordenadas: sem coordenada não há coluna, e sem coluna
todo campo vira adivinhação posicional. O extrator atual lê por caractere e agrupa por posição
X; entrega **1.926 registros** com 8 rejeitados (2 nascimentos impossíveis — `14/03/0056`,
`14/03/1191` — e 6 nomes que no Pacto são só `K`, `MARRYY`, `teste`).

**Consequência para o processo:** nenhuma importação entra sem **relatório de preenchimento por
campo**. Foi o `logradouro 0/1934` que denunciou o extrator quebrado. Importação que só grava e
diz "sucesso" é como esses registros viraram lixo no Pacto.

### Decisões

| # | decisão | por quê |
|---|---|---|
| 1 | **Status `CANCELLED`, nunca `ARCHIVED`** | `ARCHIVED` é terminal (`ARCHIVED: new Set([])`, INV-013). Importar arquivado impediria para sempre a reativação, que é o objetivo. `CANCELLED → ACTIVE` é transição válida. Esconder ex-aluno de lista operacional é filtro de tela, não status |
| 2 | **Todos apontam para o `Plan` "Programa Adultos e Idosos"** | Os 29 nomes de plano do Pacto são **descartados**. Recriá-los no ArenaHub importaria a bagunça comercial do sistema antigo; o plano original fica como texto em `Subscription.lastReason`, para rastreio |
| 3 | **`Subscription` `CANCELLED`, e nenhum `Entitlement`** | Regra de arquitetura nº 1: entitlement é o que libera catraca. Aluno importado **não entra na academia** |
| 4 | **Nenhum `ConsentRecord`, nenhuma biometria** | Regra nº 7. O consentimento é colhido na recepção quando o aluno voltar |
| 5 | **`membershipNumber = AP-2026-{matrícula do Pacto em 8 dígitos}`** | Dá idempotência (regra nº 4) sem migration: `UNIQUE (tenant_id, membership_number)` já existe. A importação fecha elevando `student_sequences.next_value` para **3000**, acima da maior matrícula do Pacto (2240), para aluno novo não colidir |
| 6 | **Endereço só completo; `state = 'GO'` fixo** | `street`, `city`, `postalCode` e `state` são `NOT NULL`, e o relatório não traz UF. Registro com só o bairro fica **sem** endereço, em vez de entrar pela metade |
| 7 | **Os 20 sem data de nascimento não entram** | `birthDate` é `NOT NULL` e inventar data é dado falso no caminho de produção. Saem em lista de pendência para a recepção |
| 8 | **Menores de idade entram** | Decisão do PI. Ver *Riscos aceitos* |

### O que o PI decidiu e este ADR registra como risco aceito

- **Retenção de ex-aluno.** O contrato acabou; manter o cadastro para reativação não é execução
  de contrato. O PI decidiu manter a base. **Não há LIA registrada nem canal de oposição.**
- **315 menores de 18 anos**, o mais novo com 9. O schema **não tem campo de responsável legal**
  e o relatório não traz um. Entram como cadastro; **não podem receber biometria** enquanto não
  houver consentimento de responsável (regra nº 7, LGPD art. 14). Isso reaparece na fatia de
  biometria e não é resolvido aqui.

### O que fica de fora desta decisão

**A ativação dos alunos correntes.** O `Pessoas1.csv` da catraca traz 347 linhas, e **77 delas
(22%) não casam automaticamente**: a coluna `Matricula` vem vazia em 346/347, e o número
utilizável está em `Cartao` — que **não é** a matrícula. Casar por `Cartao` troca aluno em 50
casos e libera a catraca para a pessoa errada. A ordem de casamento é **CPF → nome completo +
nascimento → cartão**, e as 77 linhas conflitantes vão para conferência humana. Isso é fatia
própria, sequenciada depois da F47.

### Regra que este ADR não afrouxa

O acervo é **dado real de aluno** e o `CLAUDE.md` proíbe dado real no repositório — em fixture,
golden file ou log. A seed vive em `packages/database/prisma/seed.ts` (ADR-020) e **lê o JSON de
caminho externo, fora da árvore versionada**, com o caminho no `.gitignore`. O arquivo nunca é
commitado; a seed sem o arquivo não falha, apenas não importa nada.

## ADR-034 — CPF passa a ser persistido em claro e exibido sem máscara

**Data:** 19/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 19/08/2026**
· **Reverte:** a postura hoje documentada em três lugares do `schema.prisma` (Student, comentários
de `AuditLog`/`BiometricIdentity`) de que "o CPF completo NÃO é persistido" · **Coordena com:**
ADR-033/F47 (#118)

**Contexto.** Desde a F45, o cadastro de aluno guarda só `cpfHash` (SHA-256 com pimenta por
tenant, para detectar duplicata) e `cpfLast3` (três últimos dígitos, para a recepção confirmar
identidade). O comentário do `Student` no schema previa esta decisão: *"se uma fatia futura
precisar exibir o CPF completo, isso vira decisão do PI com cifra reversível, não um `ALTER TABLE`
silencioso."* Esta é essa fatia.

**Motivação declarada pelo PI.** A importação da base legada Pacto (F47/#118) traz **1.618 CPFs
completos e válidos** (100% com dígito verificador correto) para 1.926 alunos. Guardar só o hash
descartaria dado que a academia já possuía no sistema anterior — e a recepção precisa do número
completo tanto para conferência no balcão quanto para casar registro com o CSV da catraca (fatia
de ativação, sequenciada depois da F47).

### Decisões

| # | decisão | por quê |
|---|---|---|
| 1 | **`cpf String?` em claro no `Student`**, com migration | É o pedido central: aluno cadastrado ou importado passa a ter o número completo gravado |
| 2 | **`cpfHash` fica** | Continua sendo o índice de busca de duplicata (`@@index([tenantId, cpfHash])`); trocá-lo por busca em texto claro é varredura de tabela |
| 3 | **`cpfLast3` sai** | Com o número inteiro gravado, `cpfLast3` vira dado derivado que pode divergir do `cpf` — dois campos como fonte da verdade para o mesmo dígito é o tipo de duplicação que gera bug de sincronização |
| 4 | **API devolve `cpf` completo** no DTO da ficha e da lista (`AlunoDto`) | Troca `cpfMasked: mascararCpf(cpfLast3)` por `cpf` direto |
| 5 | **`MaskedCPF` perde a validação que lança erro em runtime** | O componente hoje recusa qualquer valor sem `•` de propósito — vira exibição direta do campo, ou é descontinuado em favor de `<span data-numeric>{cpf}</span>` |
| 6 | **Quem vê: `student.read`, sem permissão nova** | Mesma trilha de acesso que já existe para o resto da ficha (nome, endereço, contatos). Criar `student.cpf.read` seria granularidade não pedida — a recepção que hoje vê a ficha já lida com dado sensível equivalente (endereço, telefone) |
| 7 | **Sem trilha de auditoria dedicada à leitura do CPF** | Mesmo tratamento do resto da ficha — não há log de acesso por campo hoje, e criar um só para CPF seria inconsistente com o resto do cadastro |
| 8 | **CPF nunca em log — regra que já existia, reafirmada** | `CLAUDE.md` já proíbe PII em log de erro; o `logger.ts` do edge-agent já redige `cpf`/`*.cpf`. Esta decisão não relaxa isso: campo de log de requisição da API precisa redigir `cpf` explicitamente onde ainda não redige |
| 9 | **Exportações (`/exports`) e relatórios podem conter CPF completo, sem restrição extra** | Segue a mesma regra de acesso da ficha — quem já podia exportar já tinha o dado disponível na tela |
| 10 | **Base legal para os 1.618 CPFs importados da F47: execução de contrato / legítimo interesse** | O vínculo contratual já existia no Pacto (matrícula ativa ou inativa); o CPF migra junto com o vínculo, para a mesma finalidade (identificação do aluno), sem mudança de finalidade que exigisse novo consentimento |

### Coordenação com a F47 (#118)

A regra 8 do ADR-033 grava `cpfHash` via `calcularHashDeCpf` e não cita `cpfLast3` nem `cpf` em
claro — foi escrita antes desta decisão. **Esta fatia entra primeiro**: a seed da F47 já nasce
gravando `cpf` em claro (regra 1 acima), sem precisar de migration adicional depois.

### O que muda no código

- `packages/database/prisma/schema.prisma` — campo `cpf String?`, remoção de `cpfLast3`, reescrita
  do comentário do `Student` que hoje afirma o oposto.
- `apps/api/src/modules/students/domain/identificacao.ts` — `ultimosTresDigitosDoCpf` e
  `mascararCpf` deixam de ser usadas no caminho de exibição; `calcularHashDeCpf` continua para
  duplicata.
- `apps/api/src/modules/students/student.repository.ts` — `criar`/`atualizar` gravam `cpf` além de
  `cpfHash`; `buscarCandidatosADuplicata` mantém a busca por `cpfHash`.
- `apps/api/src/modules/students/students.controller.ts` — `AlunoDto.cpfMasked` vira `cpf`;
  `paraDto` devolve `aluno.cpf` em vez de `mascararCpf(aluno.cpfLast3)`.
- `packages/ui/src/components/MaskedCPF.tsx` — remove a checagem que lança erro em valor sem `•`.
- `apps/admin-web/app/(protected)/students/page.tsx` e `[id]/page.tsx` — trocam `cpfMasked` por
  `cpf` na interface local.
- `apps/admin-web/app/(protected)/students/novo/formulario-de-cadastro.tsx` — dica do campo CPF
  deixa de afirmar "nunca aparece por inteiro nas telas".
- Testes que hoje afirmam ausência do CPF completo (`students-membership.int-spec.ts`,
  `students-cadastro-completo.int-spec.ts`, `identificacao.spec.ts`, `MaskedCPF.spec.tsx`)
  **invertem** para afirmar presença — cada inversão leva comentário citando este ADR.
- **Não muda:** `apps/edge-agent/src/domain/external-enroll-id.ts` (barreira contra CPF no
  dispositivo biométrico) e `apps/edge-agent/src/observability/logger.ts` (redação de log) — são
  proteções independentes de onde o CPF é persistido no banco da nuvem.

### Risco aceito pelo PI

A tela de listagem é usada no balcão, com o aluno do outro lado e outros na fila (`PRODUCT.md`).
Uma lista de CPFs completos em monitor voltado para a recepção expõe dado pessoal de terceiros —
não do aluno atendido, dos outros da fila. **O PI decidiu com o custo registrado ao lado do
benefício; não bloqueia a fatia.**

---

<a id="adr-035"></a>
## ADR-035 — ECG no MVP 3: o ArenaHub guarda e cita, nunca interpreta

**Data:** 19/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 19/08/2026**
· **Emenda material:** `docs/prd/academia/MVP-03-health-intelligence.md` §6 *(Fora de escopo)* e
§12 *(saída estruturada da IA)* — **a emenda ao PRD é do Code ou do PI; o Cowork não escreve em
`docs/prd/**` (ADR-021)** · **Bloqueia:** nada; **condiciona** F19 e F21

**Contexto.** A bioimpedância da Arena Positiva sai de uma balança bluetooth de consumo
(`CF610_G`, MAC `CF:E8:CC:12:00:11`). Junto dela o PI trouxe um terceiro arquivo que **não é
bioimpedância**: um ECG de 30 s do **OMRON HEM-7530T** via OmronConnect (algoritmo AliveCor),
carregando `Análise instantânea: Possível fibrilação atrial`, 99 bpm e as tags
`Atividade: Alta, Tontura`.

O PI quer o arquivo dentro do produto e **recusou o gate clínico** que o §5 do `MVP-03` previa,
por considerá-lo trava sem propósito. A recusa é aceita, e o gate não volta — mas ela obriga a
escrever a linha que o gate escondia.

**A linha não é "com laudo médico" versus "sem laudo médico". É armazenar versus interpretar.**
A **RDC 657/2022** da ANVISA exclui do regime de dispositivo médico o software que apenas
**armazena, arquiva, transmite ou exibe** dado de saúde. O que enquadra um software como
dispositivo médico é ele próprio **interpretar** — classificar, diagnosticar, apoiar decisão
clínica. O ArenaHub cabe inteiro do lado de fora, desde que não atravesse essa linha.

### Decisões

| # | decisão | por quê |
|---|---|---|
| 1 | **O ECG entra**: arquivo anexado à ficha, no mesmo storage privado dos demais laudos | É o pedido do PI, e guardar documento não é interpretar |
| 2 | **O achado é citação literal, com crédito de origem** — grava-se `Possível fibrilação atrial` exatamente como o aparelho escreveu, com `origem: OMRON HEM-7530T · OmronConnect` e `classificado_por: equipamento` | Repetir o que o fabricante afirmou é exibição. Reescrever com palavra própria é assumir a autoria da classificação |
| 3 | **Proibido reclassificar, normalizar para taxonomia própria ou inventar faixa de referência** para qualquer campo vindo do ECG | Normalizar é interpretar disfarçado de padronização |
| 4 | **O ECG fica fora do snapshot enviado à IA.** Vai apenas o booleano `pendenciaMedicaAberta` e a data `pendenciaDesde` — sem traçado, sem o texto do achado, sem bpm do ECG | Sem o booleano a análise diria *"está tudo ótimo"* com pendência cardíaca aberta, o que é pior que silêncio. Com o texto do achado, a IA vira a intérprete e o produto vira dispositivo médico |
| 5 | **A IA nunca gera pesquisa, estudo ou material explicativo sobre o achado do aluno** | Conteúdo que **muda porque este aluno tem este achado** é personalizado por condição clínica, logo é suporte à decisão clínica — mesmo sem prescrever nada. Somado ao risco concreto de um modelo alucinar referência médica em português |
| 6 | **No lugar da pesquisa: texto fixo**, curto, escrito uma vez, **revisado por profissional de saúde**, idêntico para qualquer achado e para qualquer aluno | Igual para todos = não personalizado = não clínico. E não custa chamada de IA |
| 7 | **Achado aberto vira pendência visível** — badge na lista de alunos, não só na ficha — resolvida por `Registrar encaminhamento` com data e responsável, emitindo `HealthReferralRegistered` no outbox | O que a academia responde num processo não é se o software era regulado; é **o que ela fez depois de saber**. O registro é a prova de que agiu |
| 8 | **O parser do ECG não usa IA.** O PDF do OmronConnect tem camada de texto extraível — `pdftotext` lê `Paciente`, `Gravado`, `Frequência cardíaca`, `Duração`, `Tags` e `Análise instantânea` direto | Custo zero, determinístico e reprodutível. Mandar para OCR seria pagar para introduzir erro |

### O que sustenta a decisão 7, e o que a enfraquece

**A favor do risco baixo:** o `MVP-03` §6 já exclui `prescrição de treino ou dieta`, e o PI
confirmou em 19/08/2026 que **o ArenaHub não emite plano de treino**. Sem prescrição, não há ato
do sistema ligando o achado cardíaco a uma orientação de intensidade — a exposição civil cai
materialmente, e a guarda original ("bloquear publicação de plano") perde o alvo.

**Contra:** o dado continua no banco. `tontura` + `possível fibrilação atrial` +
`Atividade: Alta`, com carimbo de 12/08/2026, é registro de que a academia sabia. A decisão 7 é
o que transforma esse registro de passivo em prova de diligência. Ela é barata; não pular.

### Consequências de implementação

- `HealthAnalysisOutput` (§12 do PRD) ganha `pendingMedicalReferral: boolean` e
  `pendingReferralSince: string | null`. O texto que o aluno lê sobre a pendência é **template
  disparado pelo booleano**, não geração.
- O montador do snapshot precisa de **teste que falha** se qualquer campo de origem `ECG` vazar
  para o payload da IA. É a guarda executável desta decisão — sem ela, a regra é prosa.
- A extração do ECG é parser de texto, não adapter de OCR. Vive no mesmo boundary da Slice 3.3.

---
### Decisões

| # | decisão | por quê |
|---|---|---|
| 1 | **Duas chamadas, dois modelos.** `claude-haiku-4-5` na **extração** dos campos do laudo; `claude-sonnet-4-6` na **análise** | São tarefas diferentes. Extração é mecânica, alto volume, e tem conferência humana campo a campo depois (Slice 3.3) — modelo barato serve. Análise escreve texto que o aluno lê e o avaliador usa; ali trocar 39,8 por 38,9 é o erro que não pode acontecer |
| 2 | **Provedor externo, com pseudonimização na entrada** — snapshot numérico, sem nome, sem CPF, sem imagem, sem identificador direto | §15 do `MVP-03`. É o que torna a transferência internacional defensável em vez de apenas declarada |
| 3 | **Teto de gasto por tenant, com degradação para modo manual** | O `M3-NFR-005` já pede *timeout, orçamento e circuit breaker*. "Orçamento" é literalmente isto: estourou o teto, a análise desliga e a avaliação manual continua funcionando (`M3-NFR-004`), em vez de faturar sem limite |
| 4 | **A troca de modelo é `useClass` no módulo, não reescrita** | Mesmo padrão que a F13 usou com `PaymentProvider`. Se o Sonnet se mostrar caro demais ou fraco demais com dado real, troca-se sem tocar em regra de domínio |

### Custo — a conta que sustentou a escolha

Premissas: 2 imagens por avaliação (os dois PNGs da balança; o ECG é parser de texto, **não passa
por IA** — ADR-035 §8), imagem 1848×2600 redimensionada para 1114×1568 ≈ **2.329 tokens**;
extração ~6.200 in / ~2.000 out; análise ~3.400 in / ~1.500 de texto + ~2.000 de *thinking*
(cobrado como saída). **Sem cache** — com ~10 avaliações/dia espalhadas, o cache de prompt
praticamente não bate.

| arranjo | por avaliação | 300/mês | +20% de reprocessamento |
|---|---|---|---|
| tudo Haiku 4.5 | US$ 0,027 | US$ 8,12 | ~US$ 10 |
| **Haiku + Sonnet 4.6** ← escolhido | US$ 0,079 | US$ 23,66 | **~US$ 28** |
| Haiku + Opus 4.8 | US$ 0,121 | US$ 36,20 | ~US$ 43 |

**O "300/mês" é premissa, não dado.** O número derivável do catálogo da F12 é outro: o plano dá
bioimpedância a cada **30 dias** (adultos) e **60** (clínica), então avaliações/mês tende ao
número de alunos ativos com o benefício. Com a base da F47 (1.926 alunos, ainda `CANCELLED`), o
teto é várias vezes maior. **Puxar o número real antes de fixar o teto da decisão 4.**

### Notas de implementação — erram silenciosamente se ignoradas

- **`claude-haiku-4-5` não aceita `output_config.effort`** e não tem *adaptive thinking*: a
  chamada retorna erro. O adapter precisa ramificar por modelo — a mesma função servindo os dois
  quebra na extração.
- **`claude-sonnet-4-6` usa `thinking: {type: 'adaptive'}`**; `budget_tokens` está depreciado
  nele e não deve entrar em código novo.
- **Tokens de *thinking* são cobrados como saída.** Qualquer estimativa de custo que os ignore
  subestima a análise em ~2×. Foi o erro da primeira estimativa desta conversa, corrigido aqui.
- Contexto do Haiku 4.5 é **200K**, não 1M. Dois laudos cabem com folga; um lote grande, não.

### Retificação de 20/08/2026 — a base legal, e o que de fato exige aceite

Este ADR foi escrito assumindo que **todo** o tratamento de dado de saúde do MVP 3 dependia de
consentimento novo. **Está errado, e o erro é do Cowork:** ele aplicou a este MVP a régua do
ADR-008, que é de biometria.

**Não é o mesmo caso.** Biometria facial a academia **não coletava** antes do ArenaHub — tratamento
novo, do zero, consentimento destacado. **Composição corporal a Arena Positiva já coleta há anos**,
com aparelho próprio, como serviço contratado; o catálogo da F12 **vende** bioimpedância a cada
30 dias (adultos) e 60 (clínica). Registrar isso no ArenaHub em vez de no papel ou no Pacto é
**troca de meio de registro, não início de tratamento** — exatamente o raciocínio da **decisão 10
do ADR-034** para os 1.618 CPFs importados.

**O que sobra, e é só isto:** enviar os números a um **terceiro, fora do Brasil**, é o único ato
que a academia não praticava antes. Ele não muda a natureza do registro; muda para onde o dado
vai. Logo:

- **F17, F18, F19, F20 e F22 não dependem de aceite novo.** A base é o contrato de matrícula, se
  a avaliação física constar como serviço — o que num plano que vende bioimpedância periódica é
  quase certo. **Conferir o contrato substitui redigir documento.**
- **O aceite específico é da F21**, e cobre a saída dos dados, não o registro. Recusá-lo deixa o
  aluno com avaliação, histórico, comparativos e metas — tudo, menos o texto gerado.
- **O ECG não precisa de aceite próprio:** quem anexa é o aluno, ou o avaliador com o arquivo que
  o aluno trouxe. O ato de anexar é o aceite, e o ADR-035 garante que o sistema só guarda e repete.

**Consequência prática:** nenhuma trava de LGPD segura o desenvolvimento nem a operação das
fatias do MVP 3 com aluno real, exceto o aceite da F21.

### O que isto fecha, e o que continua aberto

**Fecha** o item que restava do **ADR-008** — *"transferência internacional de dado sensível, se o
provedor de IA de saúde estiver fora do Brasil"* — pela combinação das decisões 2 e 3:
pseudonimização na entrada mais contrato com não-treinamento. **A F21 deixa de ter ADR
bloqueando.**

**Continua aberto**, e não é ADR: o contrato da decisão 3 e o número real de avaliações
por mês. Nenhum dos dois impede começar F17–F20, que não chamam IA nenhuma.

---

<a id="adr-037"></a>
## ADR-037 — Contexto de saúde do aluno: lista fechada que suprime alerta, não texto que gera texto

**Data:** 19/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 19/08/2026**
· **Emenda:** `MVP-03` §6, §7 (Slices 3.1 e 3.5), §10 e §12 · **Depende de:** ADR-035, ADR-036
· **Condiciona:** F17 e F21

**Contexto.** O PI mantém uma ferramenta pessoal de análise de bioimpedância, e a melhor parte
dela não é o cálculo — é uma lista de **fatores individuais** que mudam como o laudo deve ser
lido: usa creatina, massa muscular atípica, oscilação sazonal. Sem eles, a análise erra de forma
previsível e grosseira.

**O problema é real e mensurável no próprio dado que originou esta decisão.** Com **69,7 kg de
massa livre de gordura** contra a faixa do aparelho de **52,0–64,8 kg**, praticamente todo
compartimento sai "acima": água total, água intracelular, água extracelular, massa proteica,
minerais. São **seis alarmes** num único laudo, e nenhum deles significa o que o aparelho sugere.
No mesmo laudo, o `BMR` de 1.875 kcal é marcado "insuficiente" contra uma faixa calculada por
outra fórmula (ADR-036).

**Um produto que dispara seis alertas falsos por avaliação é abandonado na terceira semana.** O
professor para de ler, e junto param de ser lidos os alertas verdadeiros. Isso não é risco
teórico: é o modo de falha mais comum de ferramenta clínica assistiva.

### Decisões

| # | decisão | por quê |
|---|---|---|
| 1 | **Lista fechada de fatores**, tabela `student_health_context`. **Nenhum campo de texto livre** | Fator individual é dado de saúde (LGPD art. 11). Textarea preenchida pela recepção vira depósito de informação médica não estruturada, com finalidade impossível de enumerar. Lista fechada tem finalidade enumerável e comportamento previsível |
| 2 | **Cada fator SUPRIME alerta específico**; nenhum fator gera texto | Supressão é regra determinística, testável e reversível. Geração é prompt, e prompt não tem teste que falha |
| 3 | **O fator viaja no snapshot**, para a análise saber o que já foi suprimido e por quê | Sem isso a IA reintroduz em prosa o alerta que a regra tirou |
| 4 | **`gestante_ou_pos_parto` e `edema_relatado` bloqueiam ou invalidam a análise**, não apenas suprimem | Bioimpedância não é válida na gestação. Aqui o certo é não analisar, e dizer que não analisou |
| 5 | **"Alerta clínico" não existe no vocabulário do produto.** O que existe é **`valorForaDaFaixaDoEquipamento`** | O nome governa o que o modelo gera. "Alerta clínico" convida a diagnosticar; a formulação neutra descreve o fato e manda a dúvida para `questionsForProfessional` |
| 6 | **Quem preenche é o avaliador**, com `student_health_context.registered_by` e histórico versionado — nunca a recepção | É informação de saúde declarada, com consequência sobre o que o sistema mostra. Precisa de dono identificável |
| 7 | **Exames laboratoriais ficam FORA do MVP 3** — nem anexo, nem extração | Faixa de referência de exame varia por laboratório, método e sexo; interpretá-la é ato clínico muito mais claro que ler composição corporal. Entra como fatia própria se o PI priorizar, com ADR novo |

### Os fatores da lista inicial

| fator | efeito determinístico |
|---|---|
| `suplementacao_creatina` | suprime alerta de **água intracelular** alta; anota o efeito conhecido sobre creatinina sérica caso exame entre no escopo um dia |
| `composicao_atipica` | suprime alertas de **compartimento absoluto** (água total, proteína, minerais, massa livre de gordura). **Mantém** os de razão — ex. água extracelular / água total |
| `gestante_ou_pos_parto` | **bloqueia** a análise; a avaliação é registrada, não interpretada |
| `edema_relatado` | invalida leitura de **água**; os demais campos seguem |
| `uso_de_diuretico` | idem `edema_relatado` |
| `atleta_competitivo` | suprime comparação com **faixa populacional**; mantém comparação com o **próprio histórico** |

A lista cresce por PR do Code, não por campo livre. Fator novo exige o teste que prova o que ele
suprime — sem teste, não entra.

### O que veio da ferramenta pessoal e o que ficou de fora

**Copiado:** o conceito de fator individual; *"tendência é mais informativa que valor isolado"*;
*"priorize o que mudou"*; *"não listar tudo que está normal — economia cognitiva"*; rastrear o
encaminhamento enquanto estiver aberto; e a recusa a tom motivacional sem número atrás.

**Deixado de fora, de propósito:** ajuste de **dieta, treino e suplementação**, recálculo de
macros, e leitura de exame de sangue. Na ferramenta pessoal isso é uma pessoa cuidando de si, com
o próprio médico. No produto seria a academia praticando ato clínico sem competência nem registro.
**A diferença não é de rigor técnico — é de quem é o titular do dado e quem responde pelo
conselho.** O `MVP-03` §6 já exclui prescrição de treino e dieta; esta decisão acrescenta os
exames.

### Risco assumido

Lista fechada erra por omissão: um fator que ninguém previu não tem como ser registrado, e o
alerta falso aparece. **É o erro certo a cometer** — falta um fator, adiciona-se um item com
teste; sobra um campo livre, não há como recolher o dado de saúde que já foi digitado nele.

---

<a id="adr-038"></a>
## ADR-038 — Uma medição, três arquivos: a importação passa a ser N:1 com a avaliação

**Data:** 21/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 21/08/2026**
· **Emenda material:** `MVP-03` §7 (Slice 3.3) e §8 (`M3-FR-009`, `M3-FR-011`)
· **Depende de:** ADR-035 (ECG), ADR-020 (`packages/database`)
· **Condiciona:** a fatia da avaliação multiarquivo; o contrato que F26–F28 consomem

**Contexto.** A Arena Positiva mede o aluno uma vez por mês e sai com **três arquivos da mesma
medição**: o relatório da balança `CF610_G`, o relatório de análise do Unique Health — que lê a
**mesma** balança (`CF:E8:CC:12:00:11`), no **mesmo** instante, com o **mesmo** peso — e um ECG de
30 s do OMRON HEM-7530T.

A F19 entregou o caminho de importação com **um arquivo = uma importação = uma avaliação**:
`AssessmentImport.assessmentId` é `@unique` e `BodyAssessment.import` é singular. Três arquivos
produziriam **três avaliações no mesmo instante** — três pontos no gráfico para uma medição só, e
o comparativo da F18 passaria a mentir sobre a evolução do aluno.

O modelo não está errado: ele resolve o caso que a Slice 3.3 descreve. O que mudou é o fato
operacional — a academia não gera um laudo por medição, gera três.

**Decisão.**

1. **A relação vira N:1.** `@unique` sai de `assessmentId`; `BodyAssessment.import` vira
   `imports AssessmentImport[]`. Cada arquivo permanece sua própria importação, com seu antivírus,
   seu extrator e sua proveniência — o que muda é o destino.

2. **Nasce a sessão de revisão.** Os arquivos sobem, formam um conjunto pendente, e o avaliador
   confirma **uma vez**. A avaliação nasce nesse commit, com as medidas de todos os arquivos. O
   INV-103 é preservado e melhor servido: uma decisão humana em vez de três.

3. **Campo concordante é deduplicado; divergente, nunca.** Quando dois arquivos trazem o mesmo
   tipo com valor equivalente, a revisão mostra uma linha com o selo de duas origens. Quando
   divergem, mostra as duas **sem pré-seleção** — escolher por quem avalia é o erro que este
   processo existe para impedir.

4. **Bioimpedância é obrigatória, ECG é opcional.** Conjunto sem laudo de composição corporal não
   vira avaliação: seria um ponto vazio na série da F18.

5. **O enum de medidas cresce de 15 para 34** — 10 segmentares (que alimentam a visualização
   corporal do aluno), 8 de composição que os laudos já traziam e o modelo não guardava, e
   `HEART_RATE`. O `M3-FR-005` já exigia medidas segmentares; esta é a dívida sendo paga.

6. **Índice, classificação e sugestão do fabricante NÃO viram medida.** Idade corporal, pontuação
   de saúde, tipo de corpo, peso ideal e os "controles" sugeridos pela balança vão para
   `BodyAssessment.deviceReport`, fora do gráfico de evolução. **Critério: vira medida o que é
   medido e comparável; vira atributo o que é índice proprietário.** Comparar mês a mês um número
   cuja fórmula pode mudar num firmware novo produziria tendência falsa — e o aluno leria como
   progresso o que foi só troca de algoritmo.

7. **O ECG segue o ADR-035, sem exceção.** Guarda-se `HEART_RATE` como medida e o achado, as tags
   e as observações como texto atribuído ao aparelho. **Nenhuma linha de código lê o achado para
   decidir coisa alguma** — não alerta, não encaminha, não bloqueia. O PI registrou em 21/08/2026
   que o anexo do arquivo já pressupõe conversa presencial com o aluno, então não há pendência a
   criar. O card de encaminhamento sai da tela.

**Por que não uma entidade agrupadora nova.** Os três arquivos *já são* a mesma avaliação — mesmo
instante, mesma balança. Uma tabela intermediária acrescentaria um nível de indireção para
expressar o que `BodyAssessment` já expressa, e todo consumidor pagaria o join.

**Por que isto é ADR e não decisão de PR.** Migração de schema com `@unique` removido é cara de
desfazer depois que dado histórico existir, e o contrato de evolução corporal será consumido pelo
app e pelo totem (F26–F28) — outro sistema passando a depender da forma.

**Custo de reverter.** Hoje, baixo: nenhuma avaliação de produção tem importação associada (a
migration da F19 é a mais recente). Depois da primeira importação real de três arquivos, voltar
para 1:1 exige escolher qual dos arquivos "é" a avaliação e descartar a proveniência dos outros.

### Risco assumido

**A deduplicação pode esconder divergência real.** Se a tolerância de comparação for larga demais,
dois valores genuinamente diferentes seriam fundidos e o número errado viraria histórico com selo
de "confirmado por dois arquivos". Mitigação: a tolerância deriva da **precisão impressa no
laudo**, não de estimativa, e a assimetria é deliberada — mostrar divergência falsa custa um
clique, escondê-la custa um dado errado no prontuário do aluno.

---

<a id="adr-039"></a>
## ADR-039 — Laudo de bioimpedância publica automaticamente, sem revisão campo a campo

**Data:** 21/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 21/08/2026**
· **Revoga:** a regra de arquitetura nº 8 do `CLAUDE.md` **na parte do OCR** e o `M3-BR-006`
· **Emenda material:** `MVP-03` §7 (Slice 3.3), §8 (`M3-FR-011`) e §14 (`M3-AC-005`)
· **NÃO revoga:** ADR-035 (ECG), `M3-AC-007` e `M3-AC-008` (consentimento e saída de IA)

**Contexto.** O desenho da Slice 3.3 exigia confirmação humana campo a campo antes de qualquer
valor extraído virar histórico. O PI operou o fluxo e concluiu que ele não corresponde ao trabalho
real da academia: **a recepção anexa o arquivo do aluno e pronto** — não há avaliador disponível a
cada medição para conferir sessenta e sete campos contra o papel, e a avaliação precisa estar no
app do aluno quando ele sai da balança, não quando alguém tiver tempo.

Uma tela que ninguém usa não protege ninguém: o resultado previsível da confirmação obrigatória
era o laudo ficar parado em `EXTRACTED`, e a academia voltar ao papel.

**Decisão.**

1. **O valor extraído é publicado automaticamente.** Anexou, extraiu, gravou, o aluno vê. Sem
   revisão campo a campo, sem estado intermediário esperando humano.

2. **Baixa confiança não segura nada** (decisão explícita do PI em 21/08/2026). Campo que o
   extrator leu mal entra igual. A alternativa — segurar o duvidoso — foi apresentada e recusada:
   meia avaliação publicada é pior de explicar ao aluno do que uma avaliação inteira com um número
   a corrigir.

3. **Nasce `health.upload`**, permissão de ANEXAR sem ver nem editar dado de saúde. A recepção
   recebe só ela. A separação do **ADR-037** continua de pé: quem anexa não é quem lê o percentual
   de gordura dos outros alunos.

4. **Publica o ÚLTIMO arquivo da medição, não cada upload.** Quem envia marca o último
   (`ultimoDaSessao`); o servidor não tem como saber se ainda vem arquivo. Sem essa marcação, o
   primeiro laudo confirmava a sessão sozinho e nascia uma avaliação com um arquivo só — os outros
   dois chegavam numa sessão já fechada, que é a avaliação incompleta que esta fatia existe para
   impedir, chegando por outro caminho. **Marcação ausente não publica**: a importação fica em
   `EXTRACTED`, visível na fila da F22 e revisável à mão — preferível a publicar cedo demais.

5. **A correção continua existindo** e não muda: avaliação publicada não sofre `UPDATE`; erro vira
   **correção vinculada** (INV-102, `M3-AC-002`). O que sai é a barreira ANTES da publicação, não a
   trilha depois dela.

**O que esta decisão NÃO alcança.**

- **ECG segue o ADR-035**: guardado e citado, nunca interpretado. Publicar automaticamente o bpm
  medido é uma coisa; classificar um achado cardíaco é outra, e essa continua fora — RDC 657/2022.
- **A análise de IA segue direto para banco, fica dismponivel para o aluno no mobile e totem** e a validação de saída. Publicar valor medido não é o mesmo que rodar IA sobre saúde de quem não
  consentiu; são decisões diferentes, e só a primeira foi tomada aqui.

**Por que ADR e não só um PR.** A regra 8 e o `M3-BR-006` estão escritos em três documentos. Mudar
o código sem registrar deixaria o repositório afirmando o contrário do que o sistema faz — e o
próximo a ler reimplementaria a revisão que esta decisão acabou de remover.

### Risco assumido

**O OCR vai errar, e o erro chega ao aluno antes de qualquer humano.** Vírgula deslocada, campo
borrado, laudo de modelo novo: o número entra no histórico, aparece no app e alimenta o
comparativo até alguém notar.

O PI conhece o risco e o aceita: a proveniência continua gravada (valor extraído, arquivo de
origem, confiança), e a correção vinculada permite consertar sem apagar. **O que se perdeu é a
chance de pegar o erro antes de o aluno vê-lo** — e essa é a troca, explícita, por um fluxo que a
academia consegue operar todo mês.
