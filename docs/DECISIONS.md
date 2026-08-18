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
| [027](#adr-027) | Modelo de `Payment` e `PaymentAttempt` | `proposto` | **F12–F16** |

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
## ADR-008 — Regime de dado biométrico sob LGPD

**Data:** 14/08/2026 · **Status:** `aceito` *(consolidação — `M1-BR-004`, `M1-BR-005`,
`M1-FR-014`, `prd/README.md` §6.4; base legal, papéis e RIPD decididos pelo PI na segunda rodada
de 14/08/2026)* · **Bloqueia:** nada em F8. Resta **um** ponto aberto, e ele bloqueia **F21**

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

**Continua aberto — e bloqueia F21, não F8.**

- **IA de saúde e transferência internacional.** Se o provedor de IA estiver fora do Brasil, há
  transferência internacional de dado **sensível** a tratar (cláusulas-padrão, adequação ou
  consentimento específico para a transferência). Isto é MVP 3 — **F21**, análise assistiva por
  IA. Estava listado como bloqueio de F8 por engano: F8 não chama IA nenhuma.

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

**Data:** 18/08/2026 · **Status:** `proposto` *(recomendação técnica formulada — **aguardando o
PI**)* · **Recorta** o **ADR-013** · **Bloqueia:** F12 a F16

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

### Perguntas ao PI — as quatro que faltam

| # | pergunta | por que é sua, e não minha |
|---|---|---|
| 1 | **Pagamento parcial existe?** A invoice só vira `PAID` quando a soma dos `payments` confirmados iguala o total, ou o recepcionista pode registrar R$ 80 de uma mensalidade de R$ 120 e deixar saldo? | muda a regra de `OPEN → PAID` e cria — ou não — o conceito de saldo devedor |
| 2 | **Qual é o limite da dupla permissão** do pagamento manual (`MVP-02` §7, Slice 2.1), em reais, e **quem é o segundo aprovador**: outro recepcionista serve, ou precisa de gerente? | é política de controle interno, não modelagem |
| 3 | **Pagamento manual pode ser estornado** pelo sistema, ou só anulado por contra-lançamento auditado? | dinheiro recebido na mão não volta pelo caminho por onde o PIX volta |
| 4 | **Sobrepagamento** (entrou mais que o total da invoice): rejeita, aceita e gera crédito para o próximo ciclo, ou aceita e abre refund? | as três são defensáveis; a escolha é de produto |

### Escopo negativo

Este ADR **não** escolhe provedor, **não** define o contrato `PaymentProvider` (isso é ADR-013 +
`MVP-02` §12) e **não** decide as políticas de refund do `M2-COMPLIANCE-01`. Ele também **não
torna a F12 pegável**: a entrada do MVP 2 exige MVP 1 estável, e o MVP 1 depende do gate §15 do
MVP 0, hoje aberto pelo modo `acionamento1: 8` da catraca.
