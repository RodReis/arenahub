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
| [033](#adr-033) | Importação da base legada do Pacto: 1.926 alunos entram como `CANCELLED` | `aceito` | — |
| [034](#adr-034) | CPF passa a ser persistido em claro e exibido sem máscara | `aceito` | — |
| [035](#adr-035) | ECG no MVP 3: o ArenaHub guarda e cita, nunca interpreta | `aceito` | — |
| [036](#adr-036) | Modelos de IA do MVP 3 e teto de gasto como parâmetro do cliente | `aceito` | — **fecha o ADR-008 e destrava F21** |
| [037](#adr-037) | Contexto de saúde do aluno: lista fechada que suprime alerta | `aceito` | — |
| [038](#adr-038) | Uma medição, três arquivos: a importação passa a ser N:1 | `aceito` | — |
| [039](#adr-039) | Laudo de bioimpedância publica automaticamente | `aceito` | — |
| [040](#adr-040) | Sai o endosso do profissional; fica o consentimento do titular | `aceito` | — |
| [041](#adr-041) | Divergência entre laudos: a balança vence, o ECG vence o bpm | `aceito` | — |
| [042](#adr-042) | **MVP 3.5: o totem antecipado, e a tela pública como produto** | `aceito` | — **cria F49–F52** |
| [043](#adr-043) | Pagamento: PIX segue no Sicoob, CPF vira obrigatório, o totem ganha dois QRs e a assinatura vira modalidade de plano | `aceito` | — **cria F56** |
| [044](#adr-044) | Getnet: a integração é pela Global API, não pela API Brasil legada | `aceito` | — |
| [045](#adr-045) | Regime de identificação do totem: CPF sozinho, sem segundo fator | `aceito` | — *(condicionado à ponte em loopback)* |
| [046](#adr-046) | Engajamento no totem, não no app; o gate do MVP 5 não alcança a F30; ranking vira opt-out | `aceito` | — |
| [047](#adr-047) | F31 roda antes do gate do MVP 5, absorve a F33 e nasce com catálogo de XP | `aceito` | — |
| [048](#adr-048) | F34 roda antes do gate do MVP 5; desafio e aviso vivem no totem | `aceito` | — |
| [049](#adr-049) | F35 roda antes do gate do MVP 5; correção recusa por teto; flag é coluna de tenant | `aceito` | — |
| [050](#adr-050) | A F40 não é executada: o gate `M6-ML-01` não é atingível | `aceito` | — |
| [051](#adr-051) | **Topologia de implantação: nuvem na Railway, totem e edge-agent na academia** | `aceito` | — **cria F58–F59** |
| [052](#adr-052) | **Módulo `platform`: Super Admin, plano SaaS, contrato e identidade visual do tenant** | `aceito` | — **cria F61–F67** |
| [053](#adr-053) | Tenant suspenso fecha a catraca depois de carência configurável | `aceito` | — |
| [054](#adr-054) | Row-Level Security no Postgres como segunda camada de isolamento | `aceito` | — |
| [055](#adr-055) | O contrato do tenant é licença de uso, com termos versionados e assinatura fora do sistema | `aceito` | — |
| [056](#adr-056) | Consentimento self-service no app e exportação de saúde assíncrona | `aceito` | — |
| [057](#adr-057) | Primeiro acesso self-service por CPF + data de nascimento | `aceito` | — |
| [058](#adr-058) | Despachante de outbox como fatia própria; os nove eventos da §70 entram todos na v1 | `aceito` | — **cria F73** |
| [059](#adr-059) | Plano §34: aulas inclusas e convidados entram no MVP1; as outras quatro seguem `[indefinido]` | `aceito` | — |
| [060](#adr-060) | Desenho de convidados (detalha o ADR-059): passe mensal com nome/CPF, acesso via `visitante` | `aceito` | — **cria F76** |

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
## ADR-036 — Modelos de IA do MVP 3 e teto de gasto como parâmetro do cliente

**Data:** 19/08/2026 · **Status:** `aceito` *(**consolidação** — a decisão é do PI em 19/08/2026 e
já estava registrada no `docs/STATUS.md`; este ADR só a traz para o lugar citável)*
· **Fecha:** o ponto remanescente do **ADR-008** · **Destrava:** F21
· **Sustenta:** `MVP-03` §16 (`M3-NFR-005` e `M3-NFR-009`)

**Contexto.** Três documentos citam o ADR-036 desde 19/08/2026 — `MVP-03` §16, o `docs/STATUS.md`
e o `CLAUDE.md`. **Ele nunca foi escrito.** A decisão existia como parágrafo do `STATUS.md` e como
linha da tabela §3.1, e duas NFRs apoiavam-se num ponteiro para lugar nenhum. A dívida foi
apontada pelo ADR-042 em 22/08/2026 e ficou aberta.

Isto é **consolidação, não decisão nova**: cada item abaixo estava registrado no `STATUS.md` antes
desta escrita, e nada foi acrescentado.

**Decisão (PI, 19/08/2026).**

1. **Extração: `claude-haiku-4-5`. Análise: `claude-sonnet-4-6`.** Os dois passos usam modelos
   diferentes de propósito — extrair campo de laudo é leitura, analisar evolução é julgamento;
   pagar o modelo caro na extração seria gastar no passo que menos precisa.
2. **O teto de gasto é parâmetro do cliente, não constante do código** (`M3-NFR-005`). Estourado o
   teto, a análise **degrada para modo manual** e a avaliação continua funcionando
   (`M3-NFR-004`) — o produto não fatura sem limite nem para de medir.
3. **O snapshot enviado ao provedor é pseudonimizado**, e **nenhum campo de origem `ECG` o
   integra** (`M3-NFR-009`). É a aplicação do ADR-035 ao payload da IA.
4. **Custo estimado em ~US$ 28/mês para 300 avaliações.** O "300" é **premissa, não dado**: o
   número real tende ao total de alunos com o benefício, e o catálogo de planos dá bioimpedância a
   cada 30/60 dias.

**Consequências.**

- A **F21** deixou de ter ADR bloqueando em 19/08/2026 — o que restava era firmar contrato com o
  provedor, que é ato de terceiro.
- O ponto remanescente do **ADR-008** (modelo e regime da análise) fecha aqui.
- Modelo é decisão registrada: trocar `claude-haiku-4-5` ou `claude-sonnet-4-6` exige ADR novo.

**O que este ADR não decide.** Nada sobre consentimento, sobre interpretação de ECG (ADR-035) ou
sobre publicação automática de laudo (ADR-039). O que não estava no `STATUS.md` não foi
acrescentado aqui.

> **Nota de origem.** Escrito em 15/09/2026 pelo Cowork, a partir do `docs/STATUS.md` (registro de
> 19/08/2026 e tabela §3.1), na auditoria de cobertura Especificação × MVPs. O conteúdo é o que já
> estava decidido; só o lugar mudou.

---

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

---

<a id="adr-040"></a>
## ADR-040 — Sai o endosso do profissional; fica o consentimento do titular

**Data:** 21/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 21/08/2026**
· **Emenda material:** `MVP-03` §12 e §14 (`M3-AC-007`)
· **NÃO alcança:** LGPD art. 11, ADR-035, `M3-BR-010`

**Contexto.** O aceite da análise por IA era **duplo**: o aluno consentia e o profissional
endossava, nessa ordem. Junto com a publicação automática do ADR-039, o endosso virou o último
ponto onde o laudo esperava por alguém — a análise ficava pronta e parada até um profissional
assinar.

O PI removeu o endosso: **a análise entra direto e fica disponível para o aluno.**

**Decisão.**

1. **O endosso do profissional deixa de ser exigido.** Somem quatro ramos de `avaliarAceite`:
   `AI_CONSENT_MISSING_PROFESSIONAL`, `AI_CONSENT_REFUSED_PROFESSIONAL`, a checagem de documento
   aposentado do profissional e `AI_CONSENT_OUT_OF_ORDER` — este último só existia para comparar o
   instante do endosso com o do consentimento, e sem endosso não há o que ordenar.

2. **Os quatro motivos órfãos saem do enum.** Motivo que nenhum caminho emite é código morto que o
   próximo leitor tenta implementar de novo.

3. **O ECG passa a exibir tudo o que o aparelho reportou** — achado, frequência, duração, instante
   e marcações — cada campo ausente virando traço (INV-104). **Exibir é o limite**: nada lê o texto
   para decidir cor, ordem ou rótulo de gravidade.

**O que esta decisão NÃO alcança — e por quê.**

**O consentimento do ALUNO permanece obrigatório.** Não é escolha de produto: dado de saúde é
sensível (LGPD art. 5, II) e o art. 11 é **lista fechada** — legítimo interesse não existe para
ele. Enviar a saúde de quem não consentiu a um provedor externo não fica legal porque o processo
ficou mais rápido, e o `CLAUDE.md` lista LGPD entre as duas únicas coisas que param a entrega.
Continuam bloqueando: ausência de consentimento, recusa, documento aposentado e a virada dos 18
(INV-143).

**Quem pode DISPARAR a análise não mudou.** `health.assess` segue exigida na rota: produzir a
análise envia dado de saúde para fora, e isso a recepção não faz. Sair do *aceite* e sair do
*controle de acesso* são coisas diferentes; confundi-las daria a quem atende o balcão o poder de
mandar saúde de aluno para um provedor externo.

**O ADR-035 continua inteiro.** O ECG é exibido, nunca interpretado.

### Risco assumido

**A análise chega ao aluno sem um profissional ter lido antes.** O texto sai validado contra
invenção de número e linguagem de diagnóstico (`M3-BR-010`), mas ninguém confere o tom nem o
contexto antes de o aluno ver.

O PI aceita: a análise já carrega o aviso de não-diagnóstico, e a alternativa — esperar endosso —
era o gargalo que fazia o resultado não chegar.

---

<a id="adr-041"></a>
## ADR-041 — Divergência entre laudos: a balança vence, o ECG vence o bpm

**Data:** 21/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 21/08/2026**
· **Emenda:** ADR-039 (acrescenta a decisão 6) · **Depende de:** ADR-039, ADR-038
· **NÃO alcança:** LGPD art. 11, ADR-035, INV-102, INV-104

**Contexto.** O ADR-039 tirou a confirmação campo a campo, mas deixou um caso sem regra: **o que
acontece quando dois laudos da mesma medição discordam.** Enquanto havia revisão humana, a
resposta era óbvia — o avaliador escolhia. Sem ela, `desempatarPorOrigem` só tinha regra para
`HEART_RATE`, e todo o resto caía em `MedidaDuplicadaNaSessaoError`: a publicação automática
**falhava em silêncio** e a sessão voltava para a revisão manual que o ADR-039 tinha acabado de
remover.

Foi o que aconteceu na primeira execução ao vivo. Três arquivos da mesma medição de 04/08 — a
balança `CF610_G`, o app `Unique Health` e um ECG — divergiram na massa de gordura: **22,5 kg
contra 20,0 kg**. Nenhuma avaliação foi publicada, e a tela pediu 31 conferências.

### Decisões

| # | decisão | por quê |
|---|---|---|
| 1 | **Fora do bpm, vence a BALANÇA de bioimpedância** | Ela **mediu** o corpo; o app de análise **derivou** números a partir da medição dela. Entre o medido e o calculado em cima, publica-se o medido |
| 2 | **No `HEART_RATE`, vence o ECG** (já valia, agora está escrito) | A balança reporta repouso, o ECG mede o coração por trinta segundos. É o aparelho feito para isso |
| 3 | **A precedência é por TIPO DE LAUDO, nunca por nome de arquivo** | O rótulo é escolhido por quem anexa. Um arquivo chamado `ecg-agosto.pdf` pode ser a exportação da balança, e a versão anterior — que casava prefixo de `sourceLabel` — daria a vitória a ele |
| 4 | **Dois laudos do MESMO tipo discordando NÃO se resolvem** | É sinal de defeito no aparelho, e escolher um lado esconderia o defeito. O campo fica de fora da avaliação e a tela **diz quais campos ficaram** |
| 5 | **O valor perdedor continua gravado** como campo extraído | Proveniência não se apaga. Ele só não vira a medida da avaliação |
| 6 | **A tela LÊ a decisão do servidor** (`campoPublicadoId`), nunca a recalcula | Duas implementações da mesma regra divergem na primeira mudança — com a tela mostrando um valor e o histórico do aluno guardando outro |

### O caso que fica sem resposta, de propósito

Quando a balança e o app discordam, a decisão 1 escolhe **sempre** a balança — inclusive quando é
a balança que está errada. Não há como distinguir os dois casos sem alguém olhar, e olhar é
exatamente o que o ADR-039 removeu.

**Isso não é mitigado, é aceito**: a correção vinculada (INV-102) continua sendo o caminho, como
já era para todo erro de OCR sob o ADR-039. O que esta decisão acrescenta é que o erro passa a ter
uma direção previsível, em vez de a avaliação inteira não ser publicada.

### Risco assumido

O risco do ADR-039 não mudou de tamanho, mudou de forma. Antes, divergência = nenhuma avaliação
publicada (falha visível, fluxo travado). Agora, divergência = avaliação publicada com o valor da
balança (falha silenciosa, fluxo funcionando).

**A troca é deliberada:** um sistema que não publica é abandonado na terceira semana; um que
publica com um número a corrigir é usado e corrigido. Mas o número errado chega ao aluno antes de
qualquer humano — e a decisão 4 existe para que ao menos a divergência **entre aparelhos do mesmo
tipo** nunca seja resolvida por chute.

### Emenda de 21/08/2026 — o tipo do laudo é DECLARADO, não classificado

A primeira execução com os três laudos reais do PI reprovou o mecanismo da decisão 3. O extrator
de imagem (`anthropic-ocr@1`) devolve **`tipoDeLaudo: 'BIOIMPEDANCE'` fixo para toda foto**:
balança e app de análise chegavam à API indistinguíveis, e a precedência não tinha em que se
apoiar. Resultado: `mais de um valor aceito para o tipo BODY_FAT_MASS` e **nenhuma avaliação
publicada**.

**Decisão do PI:** a tela pede cada laudo no **seu campo** — Relatório de medição (balança),
Análise de composição (app), Eletrocardiograma — cada um com a **miniatura do laudo esperado** ao
lado. O campo declara o tipo; o OCR não classifica mais nada.

| # | decisão | por quê |
|---|---|---|
| 7 | **Três campos de upload rotulados**, e o tipo viaja declarado (`tipoDeLaudo` no envio) | Quem anexa sabe qual arquivo é qual. Classificar por imagem falhou no primeiro teste real |
| 8 | **Miniatura de exemplo ao lado de cada campo** | "Relatório de medição" e "Análise de composição" são dois títulos parecidos para dois papéis coloridos parecidos. A imagem é o rótulo que a recepção lê de relance |
| 9 | **`BIOIMPEDANCE_ANALYSIS` nasce como tipo próprio** | Sem separá-lo de `BIOIMPEDANCE`, a regra "o medido vence o derivado" não tem dois lados para comparar |
| 10 | **Só a balança é obrigatória** | O app deriva números da medição dela; sozinho, não há medição para publicar |

### Três defeitos que a mesma execução revelou

Nenhum deles é da precedência — todos são casos que o ADR-039 não previu, e que só apareceram com
arquivo de verdade:

1. **O último arquivo da sessão falhando levava a medição junto.** O ECG é PDF de traçado, sem
   texto extraível (`EXTRACTOR_NO_CONTENT`); como era o último, o `catch` de `enviar` retornava
   sem publicar, e a balança + análise ficavam paradas em `EXTRACTED` para sempre. **Corrigido:**
   o arquivo ilegível é o caso comum, não a exceção, e não pode segurar os outros.

2. **Import `FAILED` na lista de confirmação estourava erro que mentia.** A constraint
   `assessment_imports_avaliacao_so_em_confirmada` recusa ligar avaliação a import que falhou; a
   contagem não batia e virava `SESSION_ALREADY_CONFIRMED` — que não resolve em nenhuma tentativa
   futura. **Corrigido:** só os imports `EXTRACTED` entram na confirmação.

3. **Um valor implausível derrubava a avaliação inteira.** O OCR leu o **peso** (92,3 kg, impresso
   em destaque no meio da rosca do `CF610_G`) como **percentual de gordura**, e
   `converterParaCanonica` recusou — corretamente. Mas trinta campos corretos ficavam reféns de
   um. **Corrigido:** o campo implausível é descartado com registro em log, a avaliação publica o
   resto, e o valor certo veio do outro laudo (24,4%) exatamente como a decisão 1 manda.

**O que os três têm em comum:** a publicação automática removeu o humano do caminho, e cada
caminho de erro que antes terminava em "o avaliador resolve na tela" passou a terminar em nada
publicado e ninguém avisado. O ADR-039 assumiu o risco do valor errado publicado; não tinha como
prever o risco simétrico — **o valor certo não publicado, em silêncio**.

### Correção de 22/08/2026 — o defeito 1 descrevia mal a causa; o ADR-035 §8 estava certo

O item 1 acima afirma que "o ECG é PDF de traçado, **sem texto extraível**". **É falso, e o
ADR-035 decisão 8 já dizia o contrário desde 20/08:** o PDF do OmronConnect *tem* camada de
texto, e `pdftotext` lê `Paciente`, `Gravado`, `Frequência cardíaca`, `Duração`, `Tags` e
`Análise instantânea` direto de lá.

O que faltava era a **implementação** dessa leitura. `extrairEcg` recebia os bytes do PDF e fazia
`TextDecoder('utf-8').decode(...)` neles; num PDF real o texto vive comprimido em streams
`FlateDecode`, e decodificar os bytes crus devolve lixo binário. Nenhum regex casava, e o arquivo
terminava em `EXTRACTOR_NO_CONTENT` — sintoma que este ADR leu como "o PDF não tem texto", quando
a causa era "ninguém extraiu o texto".

**O contorno do defeito 1 continua correto e necessário** — arquivo ilegível não pode segurar a
medição, e traçado sem camada de texto continua existindo. O que muda é que o ECG do OmronConnect
**deixou de ser esse caso**.

Corrigido em 22/08/2026 com `unpdf` (Node puro, sem dependência externa) no lugar do `pdftotext`
que o ADR-035 §8 nomeia: aquele exigiria o poppler instalado no host e no container de CI. A
decisão de §8 — parser determinístico, nunca OCR — permanece intacta; só a ferramenta mudou.

Duas coisas que o laudo real ensinou e o fixture escondia:

- **O laudo é pt-BR com acento** ("Frequência cardíaca"), e os padrões do extrator são escritos
  sem. O texto passa por `NFD` antes de casar — sem isso, o PDF seria lido corretamente e ainda
  assim nenhum campo entraria.
- **O fixture era um `.txt`** com o texto já extraído: ele *era* o resultado do passo que não
  existia. A suíte provava a metade que existia. Substituído por um PDF de verdade.

---

<a id="adr-042"></a>
## ADR-042 — MVP 3.5: o totem antecipado, e a tela pública como produto

**Data:** 22/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 22/08/2026**
· **Specs F49–F52 aprovadas pelo PI em 22/08/2026**
· **Emenda** o **ADR-015** (numeração) e o **ADR-025** (precedente de MVP com meio)
· **Emenda** `docs/prd/academia/MVP-04-app-totem.md` §5 e §7 — antecipação das Slices 4.5 e 4.6
· **Alcança** `docs/design/DS-TOTEM.md` §11 regra 9 e §12 pendências 1 e 4
· **NÃO alcança:** Regra de arquitetura 1 (entitlement), ADR-024 (razões de acesso),
  `M4-BR-007` (tela pública sem valor), DS-TOTEM §8, §9 e §11 regras 1–8 e 10–12

**Contexto.** Em 22/08/2026 o PI trouxe cinco telas de protótipo de uma superfície que **não
existe em PRD nenhum**: *Personalização do totem*, no `admin-web`, com cinco abas — Marca,
Aparência, Blocos públicos, Módulos e Sessão — e pré-visualização das sete telas do totem.

Três fatos que o protótipo tornou visíveis, e que o roadmap não previa:

1. **A tela pública é o produto, não a moldura.** Palavras do PI: *"a hero do totem é a área
   pública, área que fica visível para o público que está passando na frente dele, onde vai
   mostrar patrocinadores, eventos, informações e outras coisas importantes."* O roadmap tratava
   o totem como terminal de autosserviço — uma fila de alunos resolvendo pendência. É o
   contrário: o totem passa a maior parte do dia **sem ninguém na frente dele**, e é nesse tempo
   que ele trabalha. A jornada do aluno (identificar, pagar, ver evolução) é o **segundo** papel,
   atrás de uma ação deliberada.

2. **A personalização cruza três MVPs.** A aba Módulos liga *Bioimpedância* e *Evolução*
   (MVP 3, F17–F19) e *Ranking e gamificação* (MVP 5, Slice 5.4). A aba Blocos públicos e a de
   Marca não têm origem em MVP nenhum. Alocar isso "no MVP 3", como o pedido original dizia,
   colocaria uma superfície `kiosk` inteira dentro do PRD de *Health Intelligence*.

3. **O protótipo fecha duas pendências abertas do `DS-TOTEM.md` §12.** A aba Sessão define o
   timeout de inatividade (pendência 1 — 60 s por padrão, com aviso a um terço do tempo) e o
   aviso sonoro na recusa (pendência 4 — ligado por padrão, configurável). Ambas estavam com
   proposta escrita e sem decisão. **Este ADR as fecha exatamente como o DS propunha.**

E um fato que ele tornou visível **contra** o desenho existente: a publicação por heartbeat
contradiz a regra não negociável 9 do `DS-TOTEM.md` — *"accent resolvido em provisionamento,
nunca em runtime"*. A Decisão 3 resolve.

---

### Decisão 0 — este ADR antecipa a **decisão**, não a execução

**Palavras do PI, em 22/08/2026:** *"estou antecipando ele, pois quando começar a desenvolver o
totem ele já sabe que ele é configurável."*

Isto é o ponto inteiro, e vale mais que a criação do MVP. **O que chega cedo é o registro, não o
código.** O PI pode manter a execução onde estiver na fila; o que ele não aceita é o totem nascer
com valores fixos em tela e a configurabilidade chegar depois como retrabalho.

**O precedente que justifica.** Foi exatamente isso que aconteceu com o `admin-web`: F6, F7 e F11
entraram na `main` **sem uma linha de CSS**, e o design system chegou depois — F42 contratou, F46
reaplicou, e as duas viraram retrabalho registrado no `STATUS.md`. A decisão existia; ela só não
tinha chegado antes de o código existir.

**A consequência operacional, que é o que este ADR compra:**

> **Nenhuma tela do `kiosk` nasce com valor fixo naquilo que a Decisão 6 não trava.** Marca,
> cor de destaque, tempo de sessão, ordem e tempo dos blocos, módulos habilitados e textos de
> chamada são **lidos da configuração desde o primeiro commit da superfície** — mesmo que, na
> primeira entrega, o único valor que exista seja o padrão do seed.

Ler de um objeto de configuração com um valor padrão custa quase nada quando a tela está sendo
escrita. Custa uma fatia inteira quando ela já existe.

**A fatia que carrega o peso disto é a F49**, não a F50: quem constrói o kiosk seguro já
constrói lendo `KioskConfig`. A F50 acrescenta o painel que escreve nele e a publicação
versionada — não o conceito de haver configuração.

---

### Decisão 1 — cria-se o MVP 3.5, Totem

Mesmo mecanismo do MVP 1.5 (ADR-012) e do MVP 2.5 (ADR-025): **numeração com meio, para não
renumerar o que já está escrito em PRD.** O MVP 3.5 antecipa o totem para antes do app mobile.

| | |
|---|---|
| **entrega** | O totem existindo como mídia da academia e como autosserviço do aluno |
| **gate de entrada** | MVP 1 estável (identidade e decisão de acesso) + MVP 2 com PIX operando (F13 entregue) |
| **fatias** | F49–F52 |
| **token de título** | `[MVP3.5]` — quinto token de meio, ao lado de `[MVP1.5]` e `[MVP2.5]` |

**Por que antes do MVP 4 e não dentro dele.** O MVP 4 entrega app mobile *e* totem, com gate de
"APIs estáveis dos MVPs 1, 2 e 3". O totem não precisa do app: precisa de identidade, de
entitlement e de PIX — que existem. Manter os dois amarrados adia a superfície que a academia
usa o dia inteiro por causa de uma que o aluno usa no celular.


**Decisão do PI em 22/08/2026, explícita: o totem é desenvolvido ANTES do mobile.** A ordem
canônica passa a ser:

```
MVP 1 → MVP 2 → MVP 3 → MVP 3.5 (totem, F49–F52) → MVP 4 (app mobile, F23–F29) → MVP 5 → MVP 6
```

Isto não é só posição na tabela do roadmap: **é a ordem em que o `docs/DEVELOPMENT.md` deve
listar os itens**, e o `DEVELOPMENT.md` é do Code (o ADR-021 não o dá ao Cowork). Fica como
tarefa da F49: reordenar a fila de execução para que o totem apareça antes do app, citando este
ADR.

**Por que a ordem é essa, e não a inversa.** O totem não depende do app: depende de identidade,
entitlement e PIX — que já existem. O app do aluno depende de mais coisas e chega a uma pessoa
por vez, no celular dela. O totem chega a **todo mundo que passa pela recepção**, inclusive quem
nunca vai instalar aplicativo nenhum — e, pela Decisão 4 e pela hero da Decisão 2, ele trabalha
também quando não há ninguém na frente dele.

Consequência para as Slices 4.1–4.4 e 4.7 (o app): **não mudam de conteúdo, mudam de vez na
fila.** Nenhuma renumeração — é para isso que o MVP com meio existe.

**O que este ADR NÃO faz:** não move as Slices 4.5 e 4.6 do PRD do MVP 4. O texto e o aceite
delas continuam onde estão, e a emenda ao `MVP-04` §5/§7 apenas registra que **são executadas no
MVP 3.5**. Duas verdades sobre a mesma Slice é o defeito que o ADR-021 e a emenda de 19/08
existem para impedir.

---

### Decisão 2 — quatro Slices, definidas aqui

Definidas **neste ADR**, não no PRD — pelo mesmo motivo do ADR-025: a Slice 3.5.2 e a 3.5.3 são
trabalho que nenhum PRD descreve. As 3.5.1 e 3.5.4 **citam** o PRD do MVP 4 em vez de reescrevê-lo.

| Slice | fatia | spec | escopo | fonte de verdade |
|---|---|---|---|---|
| **3.5.1** | F49 | SPEC-049 | Kiosk seguro, provisionamento e sessão efêmera | `MVP-04` §7 Slice 4.5 · `M4-FR-015` a `019`, `M4-BR-004` a `006` |
| **3.5.2** | F50 | SPEC-050 | Contrato de configuração, painel e publicação | **este ADR**, Decisões 3, 5, 6 e 8 |
| **3.5.3** | F51 | SPEC-051 | **Tela pública (hero):** blocos, mídia, patrocínio | **este ADR**, Decisões 4 e 7 |
| **3.5.4** | F52 | SPEC-052 | Área do aluno: identificação, pagamento e evolução | `MVP-04` §7 Slice 4.6 · `M4-FR-016`, `020`, `021`, `M4-BR-001`, `007` |

**Sobre a numeração — `SPEC-045` a `SPEC-048` ficam queimados.** O ADR-015 exige `F<n>` e
`SPEC-<nnn>` **iguais**. As fatias F45–F48 nasceram sem spec (o gate de spec morreu em 18/08), e
o `STATUS.md` chegou a citar `SPEC-045` como exemplo de artefato que não deveria existir. Reusar
esses quatro números aqui criaria justamente o par torto que a regra proíbe — **F49 é `SPEC-049`,
e 045 a 048 não são alocados a ninguém, nunca.**

**Ordem obrigatória:** F49 → F50 → F51 e F52 em paralelo. Sem F49 não há totem provisionado em
que publicar; sem F50 não há contrato de configuração para F51 e F52 lerem.

**E a F49 já nasce lendo a configuração** — Decisão 0. Ela não espera a F50 para saber que
existe `KioskConfig`; espera a F50 apenas para que alguém possa escrever nele pelo painel.

**Aceite de cada uma:**

- **F49** — bateria automatizada e manual comprova que dado do aluno A não aparece para o aluno B,
  e que o encerramento limpa memória, storage, cache visual, clipboard, autofill e fila de
  impressão. *(idêntico ao aceite da Slice 4.5 — não foi reescrito.)*
- **F50** — o gerente altera marca, cor, sessão e módulos no painel, publica, e o totem passa a
  refletir a mudança sem interromper aluno em sessão. Descartar restaura o publicado.
- **F51** — o totem roda os blocos habilitados na ordem definida, com o tempo configurado, sem
  rede disponível, servindo mídia do cache local; a faixa de patrocinadores permanece fixa.
- **F52** — aluno com pendência identifica-se, paga por PIX e tem o entitlement restaurado pelo
  fluxo do MVP 2, sem bypass local. *(idêntico ao aceite da Slice 4.6.)*

---

### Decisão 3 — publicar **reinicia a superfície**; o accent continua resolvido no boot

**O conflito.** `DS-TOTEM.md` §11 regra 9: *"accent resolvido em provisionamento, nunca em
runtime"*. A tela de personalização diz: *"Publicar envia a configuração ao TOTEM 01 no próximo
heartbeat"*. Trocar cor por heartbeat é runtime — contraria uma regra marcada como não negociável.

**Decisão do PI:** vence a regra do DS. **Publicar não repinta a tela — ele reinicia a
aplicação do kiosk, fora de sessão.**

| passo | comportamento |
|---|---|
| 1 | `POST .../config/publish` cria uma **versão nova e imutável** da configuração |
| 2 | O `POST /api/v1/kiosk/heartbeat` devolve `configVersion` no corpo da resposta |
| 3 | O kiosk compara com a versão que carregou no boot. Igual: nada acontece |
| 4 | Diferente **e sem sessão de aluno aberta**: baixa a configuração, valida, e **reinicia a aplicação** |
| 5 | Diferente **e com sessão aberta**: **espera o encerramento** e reinicia no atrator |

**Consequências que isto compra:**

- O accent, o alto contraste e a moldura continuam resolvidos **uma vez, no boot** — a regra 9
  sobrevive intacta e sem emenda.
- Nenhuma sessão de aluno é interrompida por publicação — o que a própria tela já promete
  (*"A sessão em andamento não é interrompida"*).
- A reinicialização é o mesmo caminho já exercitado pela atualização controlada (`M4-FR-022`),
  em vez de um segundo mecanismo de aplicação de tema.

**Consequência que isto custa, e é aceita:** a mudança não é instantânea. Com heartbeat de 30 s e
um totem em uso, o gerente pode esperar minutos para ver a cor nova. **A tela precisa dizer
isso** — "aguardando o totem ficar livre" é um estado de publicação, não um erro.

**`docs/design/DS-TOTEM.md` não é escrito pelo Cowork** (ADR-021 — a lista não inclui
`docs/design/**`). Fica para o Code, na F50: acrescentar à regra 9 a frase *"— publicar cria
versão nova e reinicia a superfície fora de sessão"*, citando este ADR. **A regra não muda de
sentido; ganha o mecanismo que a mantém verdadeira.**

---

### Decisão 4 — patrocínio é vitrine, não mídia

A faixa de patrocinadores é o único item do protótipo que não é configuração de produto: é
**receita**. Publicidade paga no totem não existe em PRD nenhum e seria o sexto vetor de negócio
do ArenaHub.

**Decisão do PI: entra, mas só como vitrine estática.**

| entra | não entra |
|---|---|
| Nome do patrocinador em texto | Contagem de impressão ou de exibição |
| Logotipo enviado à plataforma, até 6 por unidade (ver emenda de 28/08/2026) | Clique, QR ou qualquer chamada para ação |
| Rótulo configurável da faixa (padrão: *"Espaço patrocinado"*) | Período de veiculação, campanha, agendamento |
| Posição fixa no rodapé, sempre visível, fora do rodízio | Relatório de veiculação para a academia |

**Por que o corte é exatamente aqui.** No momento em que o ArenaHub **conta** exibições, ele
produz o número em que um contrato de patrocínio se apoia — e passa a responder pela exatidão
dele. Isso é produto de mídia: exige modelo de campanha, período, e relatório auditável. A
vitrine estática não promete número nenhum: a academia vende o espaço por conta própria e o
ArenaHub só desenha.

**O rótulo é obrigatório e não pode ser esvaziado.** Publicidade identificada como tal é
exigência do CDC art. 36, e a faixa fica ao lado de conteúdo informativo da própria academia —
sem rótulo, os dois se confundem. Se o campo vier vazio, vale o padrão.

**Gatilho de revisão:** o primeiro pedido de "quantas vezes meu logo apareceu" abre fatia
própria e ADR próprio. Não se resolve com um contador acrescentado em silêncio.

#### Emenda de 28/08/2026 — o logotipo é upload nosso, em raster, não SVG por URL

A tabela acima dizia *"Logotipo em SVG"*, e o contrato implementava
`logotipoUrl: z.string().url()` — endereço de imagem hospedada por terceiro. **Decisão do PI:
os dois pontos mudam.**

**A URL externa foi aposentada.** A faixa dependia de um host que a academia não controla: link
que morre é logo que some da parede, e ninguém percebe até alguém olhar o totem. Além disso, só
entrava marca que já estivesse na web — um patrocinador de bairro com a arte num arquivo ficava
de fora. O campo virou `logotipoKey`: a chave do objeto no **nosso** storage, gravada pelo
servidor no upload e resolvida em URL assinada no boot do totem, exatamente como `midiaKey` →
`midiaUrl` do bloco de vídeo já fazia (mesma checagem de prefixo de tenant antes de assinar).

Não se manteve URL e chave em paralelo: dois campos com a mesma função viram a pergunta "qual
vence?" em toda leitura.

**SVG saiu; entram PNG, JPEG e WebP, até 2 MB.** SVG é o formato natural de logotipo e por isso
estava na tabela — mas é XML, e carrega `<script>`, `<foreignObject>` e handlers `on*`. Aceitá-lo
exigiria sanitizar XML **além** do antivírus, que não detecta script em SVG, numa tela que fica
ligada o dia inteiro na recepção. Os três formatos raster não têm superfície de script, e PNG com
fundo transparente cobre o caso da faixa.

O upload reusa o pipeline da Decisão 7 sem exceção: formato → antivírus → storage, com a chave
gerada pelo servidor. A regra de formato é própria (`domain/logotipo-do-patrocinador.ts`), e não
uma extensão da de vídeo — juntá-las produziria uma lista onde logotipo aceitaria MP4 de 40 MB.

**Nada do que a Decisão 4 recusa voltou:** segue sem contador, sem clique, sem período, sem
relatório. O que mudou é de onde vem a imagem, não o que a faixa faz.

---

### Decisão 5 — módulo desligado remove a etapa; o que ele nunca remove

A aba Módulos avisa: *"Desligar um módulo remove a ação da tela interna e a etapa correspondente
do fluxo — não apenas esconde o botão."* Está certo, e precisa de duas travas.

**Trava 1 — desligar é no servidor, nunca no cliente.** O `GET /api/v1/kiosk/config` devolve os
módulos habilitados, e os endpoints de módulo desligado **respondem 404 para aquele dispositivo**.
Um kiosk com devtools aberto não reabilita nada. Isso é a mesma disciplina do `M4-FR-018`
(*"expor apenas endpoints e campos necessários à jornada kiosk"*).

**Trava 2 — cada módulo carrega o gate da fatia que o alimenta.** Módulo cuja fatia de origem não
foi entregue **não aparece no painel** — não aparece desligado, não aparece cinza: não existe.

| módulo | fatia de origem | estado em 22/08/2026 |
|---|---|---|
| Pagamento por PIX e cartão | F13 ✅ / F14 ✅ (MVP 2) | disponível |
| Bioimpedância na balança | F17 ✅ / F18 ✅ (MVP 3) | disponível — resumo apenas, conforme `DS-TOTEM.md` §9.2 |
| Acompanhamento da evolução | F18 ✅ (MVP 3) | disponível |
| Ranking e gamificação | **F33 (MVP 5) — planejada** | **não aparece no painel até a F33 entregar** |

O protótipo mostra os quatro ligados. **Ranking sai da entrega desta fatia** e volta com o MVP 5.

**O que módulo nenhum remove, em nenhuma configuração:**

- A tela de resultado de acesso e a frase pública única em `DENY` (ADR-024, `DS-TOTEM.md` §8).
- O caminho alternativo à biometria (Regra de arquitetura 7).
- *"Preciso de mais tempo"* durante a contagem (`DS-TOTEM.md` §11 regra 5, WCAG 2.2 AA).
- A limpeza de sessão no encerramento (`M4-FR-020`).
- A assinatura discreta do ArenaHub no rodapé (`DS-TOTEM.md` §11 regra 10).

---

### Decisão 6 — a lista fechada do que **não** é configurável

O protótipo já declara parte disso em tela. Fica normativo:

| não configurável | onde está fixado |
|---|---|
| Tipografia, escala e alvo de toque (display 64 px, corpo 24 px, ação 88 px) | `DS-TOTEM.md` §3, §4, §11.2 |
| Contraste mínimo de 7:1 | `DS-TOTEM.md` §11.3 |
| Light mode e alternância de tema | `DS-TOTEM.md` §11.8 — só alto contraste sob demanda |
| Comportamento de encerramento: corte em 0 ms + limpeza completa | `M4-FR-020`, `DS-TOTEM.md` §11.6 |
| A frase pública de `DENY` | ADR-024, `DS-TOTEM.md` §8 |
| Exibir valor ou motivo de pendência na tela pública | `M4-BR-007`, `DS-TOTEM.md` §9.1 |
| A assinatura do ArenaHub no rodapé | `DS-TOTEM.md` §11.10 |
| Efeito visual atrás de texto, valor, QR ou botão | `DS-TOTEM.md` §11.7 — o atrator é o único lugar com efeito |

**A cor de destaque é escolha entre quatro, não campo livre de hex.** O tom aplicado é **derivado
por contraste sobre carbono**, nunca o hex bruto — o protótipo já diz isso e está correto
(`DS-TOTEM.md` §2.1).

**Precedência do alto contraste:** o interruptor da aba Aparência define o **padrão de boot** da
unidade. O botão *"Alto contraste"* na tela do totem é do **aluno**, vale só para a sessão dele, e
**sempre vence** o padrão enquanto a sessão durar. Gerente não pode desligar a acessibilidade de
quem está usando; encerrada a sessão, volta o padrão da unidade.

---

### Decisão 7 — MP4 e link do Instagram, com o risco escrito

**Decisão do PI: as duas origens entram.** Upload de MP4 até 40 MB **e** link de reel do
Instagram, baixado uma vez e servido do cache local do totem.

**O risco, registrado porque foi assumido e não mitigado:** o Instagram não expõe URL estável de
mídia. Buscar um reel exige extração não oficial (`yt-dlp` ou equivalente), que quebra sem aviso a
cada mudança da Meta. Isso não é defeito do ArenaHub e não terá correção nossa — é dependência de
um contrato que não existe.

**As três travas que tornam o risco tolerável:**

1. **O download acontece uma vez, no ato de salvar o bloco** — nunca em runtime, nunca no totem.
   Falhou? O painel diz que falhou, **no momento em que o gerente está olhando**, e oferece o
   upload de MP4 como caminho.
2. **O totem nunca fala com o Instagram.** Ele serve do object storage e do cache local. Extração
   quebrada não derruba tela pública nenhuma que já esteja publicada.
3. **Mídia já baixada continua funcionando** mesmo depois de a extração quebrar. O que se perde é
   a capacidade de adicionar *nova* mídia por link — degradação, não queda.

**A tela precisa dizer isso.** O campo de link não pode prometer o que a Meta não garante:
o texto abaixo dele diz que a mídia é copiada no momento do salvamento e que mudanças posteriores
no Instagram não se refletem no totem.

**Toda mídia enviada passa pelo antivírus do boundary** antes de ir para o object storage —
o mesmo dublê e a mesma fronteira de `docs/TESTING.md`, já exigidos pelo MVP 3.

---

### Decisão 8 — escopo da configuração: tenant → unidade → dispositivo

A configuração resolve em **três camadas, com a mais específica vencendo**:

```
tenant (marca, patrocinadores padrão)
  └── gym_unit (aparência, blocos, módulos, sessão)
        └── kiosk_device (sobrescreve o que a unidade define)
```

**Por quê três e não uma.** A academia tem uma marca; a unidade tem uma recepção com luz própria
(o alto contraste da aba Aparência é recomendado *"em recepção com luz direta"*); e um totem na
porta da musculação não mostra o mesmo que um na entrada. O protótipo já opera no nível do
dispositivo — *"Configure o TOTEM 01 · Recepção"*.

**`tenant_id` obrigatório em toda linha; `gym_unit_id` obrigatório quando o dado é físico**
(Regra de arquitetura 2). O tenant vem da identidade autenticada do gerente no painel e da
identidade do dispositivo no kiosk — **nunca do corpo da requisição**.

---

### Modelo de dados

```text
kiosk_configurations      versão imutável publicada; rascunho é a versão sem published_at
kiosk_config_blocks       bloco público: tipo, posição, habilitado, payload
kiosk_sponsors            nome, logo opcional, posição — máximo 6 por configuração
kiosk_media_assets        MP4/SVG no object storage: checksum, origem, duração, bytes
```

**Publicar cria versão nova; nunca altera a publicada.** É o que permite *Descartar* restaurar o
publicado, o que dá ao heartbeat um número para comparar, e o que torna reversível uma
configuração que ficou ilegível na recepção — sem isso, "voltar" seria refazer de memória.

### API

```text
GET    /api/v1/admin/kiosk-devices/:id/config            rascunho + publicado
PUT    /api/v1/admin/kiosk-devices/:id/config            salva rascunho
POST   /api/v1/admin/kiosk-devices/:id/config/publish    cria versão
DELETE /api/v1/admin/kiosk-devices/:id/config/draft      descartar
POST   /api/v1/admin/kiosk-media                         upload MP4/SVG + antivírus
GET    /api/v1/kiosk/config                              versão publicada, do lado do totem
POST   /api/v1/kiosk/heartbeat                           passa a devolver configVersion
```

O `heartbeat` já existe no `MVP-04` §10. **Ganha um campo, não um endpoint.**

### Requisitos funcionais e regras de negócio desta fatia

- `M3.5-FR-001`: configurar marca, aparência, blocos, módulos e sessão por dispositivo, herdando de unidade e tenant.
- `M3.5-FR-002`: publicar cria versão imutável e o heartbeat passa a anunciá-la.
- `M3.5-FR-003`: o kiosk aplica versão nova reiniciando fora de sessão de aluno.
- `M3.5-FR-004`: rodar blocos públicos habilitados na ordem definida, com tempo por bloco de 8, 12, 20 ou 30 s.
- `M3.5-FR-005`: servir toda mídia do cache local, sem rede e sem script de terceiro na tela pública.
- `M3.5-FR-006`: exibir faixa de patrocinadores fixa, rotulada, fora do rodízio.
- `M3.5-FR-007`: desligar módulo remove a etapa do fluxo e o endpoint correspondente para aquele dispositivo.
- `M3.5-BR-001`: nenhuma configuração pode expor valor, motivo de pendência ou nome completo na tela pública.
- `M3.5-BR-002`: nenhuma configuração pode reduzir contraste, tipografia, alvo de toque ou remover *"Preciso de mais tempo"*.
- `M3.5-BR-003`: alto contraste escolhido pelo aluno vence o padrão da unidade enquanto durar a sessão.
- `M3.5-BR-004`: módulo cuja fatia de origem não foi entregue não aparece no painel.
- `M3.5-BR-005`: publicação nunca interrompe sessão de aluno em andamento.
- `M3.5-BR-006`: a faixa de patrocinadores não conta exibição, não aceita clique e não agenda veiculação.

---

### Riscos assumidos

| risco | por que se aceita |
|---|---|
| Extração de reel do Instagram quebra sem aviso | Decisão do PI, com as três travas da Decisão 7. Degrada, não derruba |
| Publicação lenta em totem ocupado | Preço de não interromper aluno em sessão. A tela mostra o estado de espera |
| Vitrine de patrocínio vira pedido de métrica | Gatilho explícito na Decisão 4: abre fatia e ADR próprios |
| Totem antecipado sem app mobile no ar | O totem não depende do app; o `M4-BR-007` e o `DS-TOTEM.md` §9 já assumem aluno sem celular na mão |

### O que este ADR não decide

1. **O que o totem imprime** — pendência 2 do `DS-TOTEM.md` §12, continua aberta, sem impacto nesta fatia.
2. **Layout da tela pública da catraca** — pendência 3 do §12. A tela de *resultado de acesso* é
   outra superfície que não a hero do totem; este ADR não a toca.
3. **Áudio na tela pública.** O protótipo diz *"reproduz sem som, com legenda"* e está certo —
   recepção não tem áudio confiável. Se o PI quiser som, é decisão nova.
4. **Conteúdo dos blocos Eventos, Material informativo, Instagram e Informação da academia.**
   Esta fatia entrega o **mecanismo**; o payload de cada tipo de bloco é definido na F51.

### Dívida de índice, apontada e não corrigida

O índice no topo deste arquivo **para no ADR-032**: os ADRs 033 a 041 não foram indexados, e o
**ADR-036 é citado no `CLAUDE.md` e no `STATUS.md` sem existir neste arquivo**. Ambos são
anteriores a este ADR e não são escopo dele — ficam apontados, não apagados, conforme a diretriz
de alterações cirúrgicas do `CLAUDE.md`.

---

## ADR-043 — Pagamento: PIX segue no Sicoob, CPF vira obrigatório, o totem ganha dois QRs e a assinatura vira modalidade de plano

**Data:** 23/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 23/08/2026**
· **Confirma** o **ADR-032** (PIX no Sicoob) e o mantém, com contingência documentada
· **Reverte** a decisão do PI de 18/08/2026 registrada no `STATUS.md` e em
  [`notes/2026-08-18-retrabalho-cadastro-completo-de-aluno.md`](notes/2026-08-18-retrabalho-cadastro-completo-de-aluno.md) §1 (*"CPF continua opcional"*)
· **Emenda** `docs/prd/academia/MVP-04-app-totem.md` §7 Slice 4.6 — o totem deixa de ser só PIX
· **Alcança** `SPEC-053`, `SPEC-055`, `SPEC-052` e cria a **F56**
· **NÃO alcança:** INV-009, INV-011 e INV-012 (matrícula não depende do CPF, CPF não é
  identificador de dispositivo) — continuam valendo palavra por palavra; regra de arquitetura 1
  (entitlement); ADR-027 (modelo de `Payment`); ADR-034 (CPF em claro)

**Contexto.** Em 23/08/2026 o PI trouxe quatro documentos de integração Getnet
(`docs/integracao/`), analisados em
[`notes/2026-08-23-analise-integracao-getnet.md`](notes/2026-08-23-analise-integracao-getnet.md).
Eles são bons sobre a Getnet e foram escritos como se o backend não existisse — o MVP 2 está
entregue desde 19/08. Da análise saíram quatro perguntas que só o PI podia responder, e uma quinta
coisa que ninguém tinha visto. Este ADR registra as cinco.

---

### Decisão 1 — PIX continua no Sicoob; a Getnet é plano B, escrito

O **ADR-032 fica de pé**: PIX pelo Sicoob, porque o dinheiro cai direto na conta da academia. Os
documentos assumiam PIX na Getnet, e isso **não** se torna decisão.

**O plano B é registrado agora, e não é hipótese vaga.** Se a fase 0 mostrar que o PIX do Sicoob
custa caro em integração — ele exige **mTLS com certificado**, e nada disso está estudado no
repositório —, a troca para a Getnet é **uma linha de `provider_accounts`**, porque a tabela guarda
*o que a conta sabe fazer, não quem ela é*, e o roteamento pergunta pela **capacidade**. O que a
troca custa não é código: é o dinheiro passar a cair no adquirente, com prazo e taxa dele.

**Gatilho para reabrir:** esforço de mTLS/certificado do Sicoob medido na fase 0 acima do custo de
um segundo adapter. Quem constata é quem executa a F55; a decisão continua sendo do PI.

---

### Decisão 2 — A recorrência continua no ArenaHub, e "assinatura" vira **modalidade de plano**

Os documentos propunham entregar a mensalidade ao **Subscriptions Engine da Getnet**. Recusado —
e o motivo é que o custo aparece em regra comercial, não em código: o engine torna **o valor do
plano imutável** (mudar preço = plano novo + migrar assinaturas), substitui o retry `[0,3,7]` que
o PI escolheu em 19/08 pelo dele, e cria uma segunda fonte de verdade de assinatura ao lado da
nossa. O ciclo do ArenaHub — invoice por período, `blockAnchor`, carência, `PlanPrice.validFrom` —
**fica.**

**O que o PI acrescentou, e é escopo novo:** *"quero ter a possibilidade de criar um plano com
assinatura mensal"*. Isto é uma **modalidade de plano**, não uma troca de motor:

| modalidade | quem cobra | como o aluno paga |
|---|---|---|
| **avulsa** (hoje) | o ArenaHub gera a invoice do período; alguém cobra | espécie, PIX ou cartão, a cada mês |
| **assinatura** (nova) | o ArenaHub gera a invoice do período **e cobra sozinho** no cartão tokenizado do aluno, com o retry do tenant | o aluno adere uma vez, com cartão salvo |

**A assinatura não terceiriza o ciclo.** O calendário, o valor, a carência e o bloqueio continuam
nossos; o que muda é que existe um método salvo e uma autorização do aluno para cobrar sem ele
agir. Vira a fatia **F56**.

---

### Decisão 3 — CPF passa a ser **obrigatório** no cadastro de aluno

O antifraude da Getnet **bloqueia cartão** sem `customer` completo — nome, e-mail, telefone,
**CPF** e endereço de cobrança. O PI decidiu tornar o CPF obrigatório em vez de pedi-lo dentro do
fluxo de pagamento.

**Isto reverte a decisão de 18/08** (*"CPF continua opcional — o mockup que o marcava obrigatório
é que está errado"*). A reversão é explícita e datada; quem ler o documento de retrabalho da F45
precisa chegar aqui.

**O que NÃO muda, e é o que evita o erro previsível:** **INV-009 e INV-011 continuam inteiras** —
*todo aluno tem matrícula, e a matrícula nunca depende do CPF*; *CPF ajuda a detectar duplicidade,
mas não é matrícula*. Campo obrigatório no cadastro **não** é chave de identificação. Quem
implementar não pode usar o CPF como matrícula, nem como identificador de dispositivo (INV-012).

**Como a obrigatoriedade entra — e por que não é `NOT NULL`:**

1. **Validação de aplicação**, na API e na tela, para **cadastro novo e edição**. A coluna
   `students.cpf` **continua anulável**.
2. **A base legada não pode ser reescrita:** a importação do Pacto trouxe **1.618 CPFs para 1.926
   alunos** (ADR-034) — há pelo menos **308 alunos sem CPF**, e não existe de onde inventá-lo. Uma
   migration `NOT NULL` **falharia**, e preencher com valor sintético produziria CPF inválido em
   registro de gente real.
3. Aluno sem CPF vira **pendência de cadastro visível**: a recepção completa quando ele aparecer.
   Ele continua entrando na catraca — pendência cadastral **não** é razão de negativa de acesso
   (ADR-024 é lista fechada, e nada aqui a altera).
4. **`NOT NULL` só quando a pendência zerar**, e isso é decisão futura, não desta.

---

### Decisão 4 — O totem exibe **dois QRs**: PIX e checkout de cartão

O `MVP-04` §7 Slice 4.6 previa apenas PIX, e o documento do totem concordava. O PI decidiu que o
aluno escolhe **PIX ou cartão** no totem — e a forma escolhida mantém tudo o que a Slice protegia:

> **O totem exibe um QR e não tem teclado de cartão.** No PIX, o QR é a cobrança; no cartão, o QR
> é o **checkout hospedado**, que o aluno abre no **próprio celular**. Em nenhum dos dois o totem
> vê PAN, CVV ou token — ele continua **fora do escopo PCI**, como o documento do totem exige.

Continuam valendo, sem exceção: `M4-BR-007` e `DS-TOTEM` §11 — **a tela pública não mostra
pendência nem valor**, e valor só aparece depois de ação deliberada do aluno; identificação **não**
é por CPF (`M4-FR-016`); e a sessão encerra limpando tudo.

**Este ADR emenda o `MVP-04` §7 Slice 4.6** — é o mecanismo do ADR-021: com a decisão registrada
em ADR aceito, o Cowork materializa a emenda no PRD citando este número.

---

### Decisão 5 — Achado: `createTokenizedSubscription` está sendo usado para cobrar invoice avulsa

**Não é decisão do PI; é defeito latente encontrado ao cruzar os documentos com o código, e ele
precisa ser corrigido antes do adapter real.**

A F14 cobra a invoice no cartão chamando `this.provedor.createTokenizedSubscription({...})` uma
vez **por cobrança**, guardando o `externalSubscriptionId` como `externalPaymentId` da tentativa
(`cobrar-assinatura-no-cartao.use-case.ts`). Contra o `FakePaymentProvider` isso passa: o dublê
devolve um id e ninguém cobra nada.

**Contra a Getnet real, isso cria uma assinatura mensal de verdade a cada invoice.** O
`POST /rpy/be-subscription/v1/subscriptions` instala uma recorrência que **cobra sozinha todo
ciclo**. Doze meses de mensalidade produziriam **doze assinaturas vivas** no provedor, cobrando o
mesmo aluno em paralelo — e o ArenaHub não tem onde vê-las, porque não persiste
`externalSubscriptionId` em `Subscription`.

**Consequência normativa:** a porta `PaymentProvider` passa a distinguir os dois atos, e a F55 não
entrega adapter real sem isso:

- **`chargeTokenizedPayment`** — cobrança **pontual** com token salvo. É o que a F14 sempre quis
  dizer, e é o que a cobrança de invoice deve chamar.
- **`createTokenizedSubscription`** — recorrência de verdade, instalada **uma vez por assinatura
  do aluno**, e usada só pela modalidade da Decisão 2 (**F56**).

**Corrigido em 25/08/2026** (PR referenciando a issue #158): `chargeTokenizedPayment` nasceu na
porta, a F14 passou a chamá-lo, e o campo de retorno virou `externalPaymentId` — o nome descrevia
o defeito, não o dado. O teste que fecha a porta afirma o **estado no provedor** (nenhuma
recorrência instalada depois de três invoices cobradas), e não o id devolvido: o id diz o que
voltou daquela chamada, e o que cobra o aluno no mês seguinte é o que ficou de pé.

**Achado durante a correção — o cancelamento dependia do defeito.**
`CancelarRecorrenciaUseCase` varria `payment_attempts` e passava `externalPaymentId` para
`cancelSubscription()`. Aquilo só funcionava porque a coluna guardava, por acidente, um id de
assinatura. Corrigida a cobrança, a coluna guarda o que o nome sempre disse, e mandá-la para
`cancelSubscription` cancelaria pelo identificador errado. **Decisão do PI em 25/08/2026:** o
estado verdadeiro do sistema é **zero recorrências a cancelar** — cobrar invoice não instala
calendário nenhum, e o contrato do caso de uso já dizia que zero não é erro. A fonte correta
(`Subscription.externalSubscriptionId`) nasce na **F56**, e é lá que esse número volta a ser
maior que zero. Não se antecipou a coluna para não invadir escopo de outra fatia.

---

### Consequências

| # | consequência | onde |
|---|---|---|
| 1 | `SPEC-053` troca "pedir CPF no pagamento" por "CPF obrigatório no cadastro" | `SPEC-053` §9 |
| 2 | `SPEC-055` fixa PIX no Sicoob, com o gatilho da Decisão 1 escrito | `SPEC-055` §9.3 |
| 3 | `SPEC-055` ganha a separação `chargeTokenizedPayment` × `createTokenizedSubscription` | `SPEC-055` §3.1 |
| 4 | Nasce a **F56** — plano com assinatura mensal | Índice do `STATUS.md` |
| 5 | `MVP-04` §7 Slice 4.6 emendado — dois QRs no totem | PRD |
| 6 | F45/F48 herdam a pendência de CPF da base legada | cadastro e ativação |
| 7 | A F14 tem correção pendente que **só aparece com provedor real** | Decisão 5 |

---

## ADR-044 — Getnet: a integração é pela Global API, não pela API Brasil legada

**Data:** 25/08/2026 · **Decisão do PI** · **Status:** aceito

### Contexto

A `SPEC-055` §9.1 listava cinco perguntas para a Fase 0 com a Getnet, e a primeira decidia os
*paths* de toda a integração: **Global API** (`docs.globalgetnet.com`, sandbox
`api-sbx.globalgetnet.com`) ou **API Brasil legada** (`api.getnet.com.br`)? Os conceitos são os
mesmos; os caminhos, não. Enquanto a resposta não existisse, escrever adapter era apostar — e
apostar errado significa reescrever o transporte inteiro.

### Decisão

**Global API.**

Razão registrada pelo PI: é a interface moderna e unificada (*single entry point*) para pagamento
digital e presencial; permite operar Brasil, Argentina, Chile e México por **uma única integração
técnica**; e é o caminho indicado para projeto novo e para integração entre e-commerce e Smart
POS.

**Multi-país não é requisito do MVP 2** — o ArenaHub atende uma academia em Curitiba. O que pesa
aqui é outra coisa: **escolher a interface que não está em fim de vida é barato agora e caro
depois.** Migrar transporte de pagamento com dinheiro real correndo é exatamente a classe de
mudança que este arquivo existe para evitar.

### Por que é ADR e não nota de PR

Contrato com terceiro, no critério do `CLAUDE.md`: outro sistema (o da Getnet) já consome a
escolha, e desfazê-la depois de credencial emitida e tráfego rodando custa reemissão contratual,
não refactor.

### O que a documentação pública confirmou — 25/08/2026

OAuth2 `client_credentials`; header **`x-seller-id`** (confirma que a conta vai por
`ProviderAccount`, nunca em variável de ambiente — INV-078); *Single-Step Payments* (autoriza e
captura numa chamada); tokenização para cobrança recorrente; assinatura como produto — **que a
Decisão 2 do ADR-043 recusou usar**; webhook em tempo real; e **Web Checkout** em três formas
(iFrame, lightbox, página hospedada).

### O que continua em aberto, e o que ainda bloqueia

A decisão **não desbloqueia a F55**. Seguem sendo insumo do PI: `client_id`, `client_secret` e
`seller_id` (maquininha ativa não dá credencial de e-commerce — `SPEC-055` §9.1), e o certificado
mTLS do Sicoob.

E a documentação pública **não respondeu** hosts base, paths exatos, validade do `access_token`,
formato da idempotência, nem — o mais caro — **como se verifica a autenticidade do webhook**. Essa
última é o achado aberto desde 19/08 (`SPEC-055` §3.3) e continua sendo o que **impede tráfego de
produção**: sem ela, `M2-FR-007` não é cumprido e o endpoint aceita evento forjado.

### Consequências

| # | consequência | onde |
|---|---|---|
| 1 | `SPEC-055` §9.1 pergunta 1 respondida; as outras quatro seguem abertas | `SPEC-055` §9.1, §10 |
| 2 | Hosts entram em configuração por `ProviderAccount` (sandbox/produção), não em constante | `SPEC-055` §3.2 |
| 3 | A suposição de `access_token` ~3600 s sem refresh continua **suposição**, não fato | `SPEC-055` §9.2, §10.2 |
| 4 | Nenhum código muda hoje — sem credencial não há o que chamar | — |

---

## ADR-045 — Regime de identificação do totem: CPF sozinho, sem segundo fator

**Data:** 25/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 25/08/2026**
· **Emenda** `docs/prd/academia/MVP-04-app-totem.md` — `M4-BR-004`
· **Restringe** `docs/design/DS-TOTEM.md` §5.1 (três caminhos de identificação viram um)
· **Alcança** a `SPEC-049` §0, §3.2, §3.3 e §9 — a fatia F49
· **NÃO alcança:** a autenticação do **dispositivo** (HMAC, §3.1 da spec — outro mecanismo,
  intocado); `M4-BR-002` e `M4-BR-003` (QR da carteirinha do app, MVP 4); `M4-BR-005` e
  `M4-BR-006` (duração e não persistência da sessão, que continuam valendo inteiros);
  ADR-042 Decisões 5 e 6; a Regra de arquitetura 1 (entitlement)

### Contexto

O `DS-TOTEM.md` §5.1 desenha **três caminhos** para o aluno se identificar no totem:
reconhecimento facial, QR Code da carteirinha do app e digitação de CPF *"com confirmação por
data de nascimento"*. A F49 é a fatia que constrói o totem seguro, e precisava saber quais
desses três nascem com ela.

Em 25/08/2026, durante o brainstorming da fatia, o PI decidiu **quatro** coisas. Elas restringem
o desenho do DS, e uma delas **contraria um `BR` do PRD**. Ficam aqui, não no corpo de um PR,
porque duas delas são risco aceito conscientemente — e risco aceito que mora em mensagem de
commit some.

### Decisão 1 — reconhecimento facial vai para o backlog

Dos três caminhos do DS §5.1, **facial não entra na F49 nem tem fatia alocada**. Vai para o
backlog, sem MVP de destino.

O totem já convive com biometria facial na catraca (MVP 1); o que não existe é a jornada de
*identificação por rosto no totem*, que é uma superfície diferente, com iluminação, distância e
consentimento diferentes.

### Decisão 2 — QR Code nesta superfície é PIX, não carteirinha

O totem tem QR Code, mas ele é **de pagamento** (PIX, ADR-043), não de identificação. O QR da
carteirinha do app que o DS §5.1 desenha **é MVP 4** — depende do app mobile existir, e o app
mobile vem depois do totem (ADR-042, Decisão 1).

Consequência prática: quem lê "QR no totem" em documento antigo não deve concluir que existe
identificação por QR na F49. Não existe.

### Decisão 3 — login é CPF sozinho, sem segundo fator

O DS §5.1 pede *"digitar CPF com confirmação por data de nascimento"*. **O PI decidiu CPF puro.**

Isto **contraria `M4-BR-004`** — *"CPF no totem é localizador, não autenticador suficiente"*. A
regra dizia exatamente que o CPF sozinho não basta para abrir sessão; a decisão do PI diz que
basta.

**A consequência foi apresentada ao PI e reafirmada por ele:** quem sabe o CPF de um aluno vê,
naquele totem, o **nome** dele, o **estado do plano** e o **valor da fatura em aberto**. Não é
uma exposição hipotética — é a carga útil que `POST /api/v1/kiosk/sessions` devolve por desenho
(`SPEC-049` §4). **Risco aceito.**

O que **não** muda: a superfície continua mínima (`M4-FR-018`). CPF sozinho abre a sessão, mas a
sessão não passa a expor endereço, contato, documento, avaliação nem biometria. O relaxamento é
no *portão*, não no *conteúdo*.

### Decisão 4 — mensagem única e neutra, sem limite de tentativas

Toda falha de identificação — CPF inexistente, aluno cancelado, erro interno — devolve a **mesma
frase**: *"Não foi possível entrar. Procure a recepção."* Mesma disciplina da frase pública única
de `DENY` (ADR-024).

E **sem limite de tentativas**: o totem não bloqueia, não conta, não impõe espera.

**Consequência, apresentada e aceita pelo PI:** enumeração de CPF é barata. Um número por vez, o
totem confirma quem é aluno daquela unidade — e, para quem é, quanto deve. A mensagem neutra não
distingue *"não existe"* de *"existe e está cancelado"*, mas **distingue sucesso de falha**, e é
isso que a enumeração precisa. **Risco aceito.**

### O achado da implementação que agrava a Decisão 4

A Decisão 4 foi aceita sobre uma premissa implícita: **enumerar exige estar fisicamente na frente
do aparelho**, um CPF por vez, digitando num teclado de tela, à vista da recepção. Isso é o que
torna o risco tolerável.

A implementação da F49 quase quebrou essa premissa. A superfície `apps/kiosk` roda um servidor
Node que assina as chamadas à API (o segredo HMAC do dispositivo **não pode** ir para o
navegador). Na primeira versão esse servidor escutava em `0.0.0.0` — o padrão do Next. Como a
rede da academia **não é isolada** (registro do MVP 0), qualquer host da LAN podia chamar
`POST /api/kiosk/sessions` em laço, com CPF de terceiros, e receber nome, plano, pendência e um
token de sessão válido — **sem tocar no totem**, e sem a mensagem neutra proteger nada, porque o
status HTTP cru distingue 404 de 201. Isso é a base inteira do tenant, na velocidade de um
script.

**Foi corrigido:** a ponte liga apenas em loopback (`--hostname 127.0.0.1`, em `dev` e em
`start`), e o motivo está escrito ao lado do script para que ninguém o "conserte".

**O que fica registrado, e é o ponto deste bloco:** a Decisão 4 é aceitável **enquanto e somente
enquanto** a ponte ficar em loopback. Expor a ponte à rede — por conveniência de diagnóstico, por
container mal configurado, por *reverse proxy* — não é ajuste de infraestrutura: **é mudança do
risco que o PI aceitou**, e reabre esta decisão.

### Consequência para a F49 — a área interna nasce vazia, e isso é correto

O PI havia decidido, na mesma conversa, restringir **dado de saúde** (avaliação, evolução 3D,
histórico de avaliações) e o **ranking** a autenticação forte, deixando pagamento e histórico de
pagamentos no nível fraco.

**Com a Decisão 1, não existe autenticação forte nesta fatia.** Facial era o caminho forte; ele
saiu. Logo, os quatro módulos ficam **inalcançáveis por qualquer caminho** até a F52 / MVP 4 —
não porque foram desligados, mas porque a porta que os abriria não foi construída.

Somando a isso a decisão de deixar **pagamento e histórico de pagamentos para a F52**, a área
interna da F49 entrega **zero dos seis módulos** do `DS-TOTEM.md` §5.2.

**Isso é correto e intencional.** O aceite da F49 é *isolamento de tenant e limpeza de sessão* —
que dado do aluno A não chega ao aluno B, e que nada dele sobrevive ao encerramento. Uma fatia
com módulos ligados provaria menos, não mais: entregaria funcionalidade antes de provar a
fundação que a sustenta.

Módulo sem fatia entregue **não aparece** — não aparece cinza, não aparece desabilitado
(ADR-042, Decisão 5, trava 2).

### Gatilho de revisão

**A primeira fatia que trouxer reconhecimento facial ou QR Code da carteirinha do app ao totem
reabre a questão do segundo fator** — e, com ela, as Decisões 3 e 4 inteiras.

O motivo: hoje o CPF é o único portão, e um segundo fator custaria uma tela a mais numa jornada
que não tem alternativa. Quando existir caminho forte, o CPF passa a ser o caminho *degradado*, e
aí a pergunta muda de *"vale a pena o atrito?"* para *"o que o caminho fraco pode ver?"* — que é
outra decisão, com outro custo.

Reabre também, **antes disso**, qualquer proposta de tirar a ponte do loopback (bloco acima).

### Consequências

| # | consequência | onde |
|---|---|---|
| 1 | `M4-BR-004` fica **emendado**: CPF é autenticador suficiente no totem até nova decisão | `MVP-04` §9 |
| 2 | O DS-TOTEM §5.1 fica restrito a um caminho na F49; os outros dois seguem desenhados, não implementados | `DS-TOTEM.md` §5.1 |
| 3 | Enumeração de CPF é risco vivo e aceito, condicionado ao loopback da ponte | `SPEC-049` §9 |
| 4 | A área interna da F49 entrega zero dos seis módulos do DS §5.2 — aceite é isolamento e limpeza | `SPEC-049` §0 |
| 5 | Facial no totem sai do roadmap: backlog, sem MVP de destino | `docs/STATUS.md` |

---

## ADR-046 — Engajamento no totem, não no app; o gate do MVP 5 não alcança a F30; ranking vira opt-out

**Data:** 26/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 26/08/2026**
· **Emenda** `docs/prd/academia/MVP-05-engagement.md` §1 (gate de entrada) e §7 Slice 5.1
  (superfície e critério de aceite)
· **Alcança** a `SPEC-030` e a fatia F30
· **NÃO alcança:** F31–F35, que seguem atrás do gate do MVP 5 tal como estava; a Regra de
  arquitetura 9 (módulo não lê tabela privada de outro módulo); INV-021 (consentimento
  versionado e revogável)

### Contexto

A Slice 5.1 do `MVP-05` foi escrita presumindo o **app** do MVP 4 como canal do aluno e um gate
de entrada que exige *"eventos confiáveis + app do MVP 4"*. Nenhuma das duas premissas resistiu
ao estado real do repositório em 26/08/2026: `apps/mobile/` tem só um `.gitkeep`, e o canal do
aluno que existe de fato é o `apps/kiosk` — que desde a F49/F50 (ADR-042, ADR-045) já identifica
o aluno por CPF e já trazia `modulos.ranking` no contrato de `KioskConfiguration`, desligado por
padrão desde a F50. O lugar estava reservado; a Slice 5.1 não sabia disso.

Durante o brainstorming da F30, em 26/08/2026, o PI tomou três decisões que redesenham a fatia. A
terceira é a mais delicada: ela esvazia um critério de aceite já escrito no PRD.

### Decisão 1 — a superfície é o totem, não o app

**"App" na Slice 5.1 vira "totem".** O `apps/kiosk` ganha duas telas na área do aluno (atrás de
`KioskAreaDoAlunoService.resolver()`, mesma amarra de sessão que paga e evolução física já usam):
*Minhas preferências* (interruptor de participação no ranking) e *Meu nome no ranking* (primeiro
nome · apelido · anônimo).

Motivo: o totem alcança **todo aluno que passa pela recepção**, hoje, sem depender de o aluno ter
instalado um aplicativo que ainda não existe. Esperar o MVP 4 para começar o MVP 5 empurraria
engajamento para depois de uma dependência que a F30 não precisa.

### Decisão 2 — o gate do MVP 5 não se aplica a esta fatia

O gate dizia *"eventos confiáveis + app do MVP 4"*. Os dois requisitos descrevem o que **F31 em
diante** vai precisar — XP e streak leem evento de frequência/pagamento; desafio e push mobile
leem o app. A F30 não lê nenhum evento e não abre tela em `apps/mobile`: ela é o alicerce de
privacidade e identidade pública sobre o qual as fatias seguintes vão se apoiar, não o primeiro
consumidor delas.

**Isso libera só a F30.** F31–F35 continuam atrás do gate original — a Decisão 1 não antecipa o
MVP 4 nem promete eventos que não existem. Se uma fatia futura quiser rodar antes do gate, precisa
do próprio ADR, com o próprio argumento.

### Decisão 3 — consentimento de ranking vira opt-out

A Slice 5.1 previa, como critério de aceite, *"aluno não consentido nunca aparece em API, cache,
exportação ou tela pública"* — um regime **opt-in**. Palavras do PI: os alunos **já estão
aceitos e autorizados**; não faz sentido pedir consentimento explícito para um ranking interno de
academia com o mesmo rigor que se pede para biometria ou dado de saúde.

O critério de aceite muda para: **"aluno que pediu para sair nunca aparece, a partir da próxima
projeção"**. Não existe mais "aluno não consentido" — existe aluno que participa (o padrão) e
aluno que registrou saída.

### A consequência que precisa ficar escrita — dois regimes na mesma tabela

`ConsentRecord` continua sendo a fonte única de consentimento (mesmo modelo append-only, mesma
revogação por linha nova com `supersededAt`, mesmo ator/IP/dispositivo). `ConsentDocumentType`
ganha quatro finalidades novas: `RANKING`, `CHALLENGE`, `ENGAGEMENT_PUSH` e
`PHYSICAL_EVOLUTION_RANKING` — as três últimas **dormentes**, sem documento publicado e sem
consumidor nesta fatia, modeladas só para que F31–F35 não precisem de migration.

O ponto perigoso: a mesma tabela passa a sustentar **dois regimes opostos**.

| regime | finalidades | ausência de `ConsentRecord` significa |
|---|---|---|
| biometria, saúde, IA | `BIOMETRIC`, `HEALTH`, `AI_ANALYSIS` | **NÃO autorizado** |
| engajamento (esta fatia) | `RANKING`, `CHALLENGE`, `ENGAGEMENT_PUSH`, `PHYSICAL_EVOLUTION_RANKING` | **participa** |

Os predicados que leem essa tabela vivem **separados de propósito**:
`avaliarConsentimento()` em `apps/api/src/modules/privacy/domain/consentimento.ts` para o
primeiro regime, `participaDoRanking()` em
`apps/api/src/modules/engagement/domain/participacao.ts` para o segundo. Um predicado servindo
aos dois regimes passaria verde enquanto nenhum teste misturasse os dois casos na mesma linha — o
defeito que a memória `comentario-avisa-e-codigo-repete` já registrou uma vez nesta base. Unificar
os dois inverteria um dos dois regimes em silêncio, e é exatamente por isso que
`participacao.ts` carrega o aviso no próprio código, não só neste ADR.

### Consequências

| # | consequência | onde |
|---|---|---|
| 1 | `MVP-05` §7 Slice 5.1 fica **emendada**: superfície é o totem; critério de aceite passa a opt-out | `MVP-05` §7 |
| 2 | `MVP-05` §1 fica **emendado**: gate não alcança a F30, continua valendo para F31–F35 | `MVP-05` §1 |
| 3 | `ConsentDocumentType` ganha quatro finalidades, três dormentes | `packages/database/prisma/schema.prisma` |
| 4 | `ConsentRecord` guarda dois regimes opostos de ausência de linha, com predicados separados | `SPEC-030` §2, §4 |
| 5 | `PublicProfile` (tabela nova) guarda o apelido público e sua moderação, com unicidade em índice parcial sobre `APPROVED` | `SPEC-030` §2 |
| 6 | `HIDDEN` nasce sem caminho de escrita nesta fatia — é para denúncia, e não há canal de denúncia até a F35 | `SPEC-030` §3 |

---

## ADR-047 — F31 roda antes do gate do MVP 5, absorve a F33 e nasce com catálogo de XP proposto pelo Code

**Data:** 27/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 27/08/2026**
· **Emenda** `docs/prd/academia/MVP-05-engagement.md` §1 (gate de entrada) e §7 Slice 5.2
  (superfície)
· **Alcança** a `SPEC-031` e a fatia F31; **absorve** a `SPEC-033` e a fatia F33
· **NÃO alcança:** F32, F34 e F35, que seguem atrás do gate do MVP 5 tal como estava; a Regra de
  arquitetura 9; a Regra de arquitetura 5 (evento na mesma transação da mudança de estado);
  o regime opt-out do ADR-046

### Contexto

O ADR-046 liberou a F30 e escreveu, com todas as letras, que **F31–F35 continuam atrás do gate
original** e que *"se uma fatia futura quiser rodar antes do gate, precisa do próprio ADR, com o
próprio argumento"*. Este é esse ADR, e este é o argumento.

O gate do MVP 5 pede duas coisas: *"eventos confiáveis + app do MVP 4"*. Em 27/08/2026 elas estão
em estados opostos, e é isso que muda a conta desde 26/08.

**O app não existe e não vai existir tão cedo.** `apps/mobile/` tem um `.gitkeep`; F23–F29 estão
todas `planejada`; a ordem de execução do ADR-042 coloca o MVP 4 depois do MVP 3.5.

**Os eventos confiáveis existem.** A F24 entregou `StudentAttendanceSession`: dia local **da
unidade**, política versionada (`dia-civil-local@1`), e uma sessão por
`(tenant, aluno, dia, unidade, política)` garantida por chave única no banco. A F49–F52 entregou
o totem com área do aluno identificada por CPF. Nenhuma das duas existia quando o gate foi
escrito.

### Decisão 1 — a fatia roda, com o totem como superfície

Mesmo movimento do ADR-046, Decisão 1: onde a Slice diz "app", leia-se **totem**. O `apps/kiosk`
ganha a tela *Meu XP* na área do aluno e um bloco de ranking no rodízio da tela pública.

**Isso libera só a F31 (com o escopo da F33 dentro).** F32, F34 e F35 continuam atrás do gate —
streak, desafios, notificações e moderação não ganham argumento por tabela.

### Decisão 2 — F31 absorve a F33; a numeração F33/SPEC-033 fica queimada

Palavras do PI: *"o ranking vai aparecer na área pública do totem (ranking da academia — geral) e
na conta individual do aluno, mostrando onde ele está"*.

XP privado sem placar não entrega o que a academia quer ver. Partir em duas fatias adiaria metade
do valor sem reduzir risco: o placar ordena exatamente o saldo que a F31 já produz, e o portão de
exposição já existe desde a F30 (`resolverExposicao()`).

`F33` e `SPEC-033` **não são reaproveitadas** — número alocado não volta à fila (regra do
`STATUS.md`). O arquivo `docs/specs/SPEC-033-rankings-privados-por-padrao.md` fica como histórico
e aponta para cá.

**Três parâmetros do ranking, decididos pelo PI nesta data:**

| parâmetro | decisão | consequência |
|---|---|---|
| identidade no placar público | **conforme a F30** — `resolverExposicao()` decide | apelido aprovado, ou primeiro nome, ou "Participante"; nome civil completo nunca vai ao hero |
| coorte mínima (`M5-BR-007`) | **5 participantes** | abaixo disso o snapshot é `WITHHELD` e o hero não mostra placar; a conta individual continua mostrando o XP |
| período | **mês corrente** | zera no dia 1º; o ledger guarda tudo, o mês é só o recorte |

### Decisão 3 — `M5-RULES-01` não bloqueia; o Code propõe o catálogo v1

`M5-RULES-01` pede *"catálogo de XP e streak assinado por profissional"*. Ele **nasceu no plano de
apoio, não no PRD**, e o precedente é o `M3-CLINICAL-01` — mesmo formato, mesma exigência de
assinatura profissional, derrubado como gate em 19/08 pelo ADR-035, decisão do PI.

Dos quatro itens do `M5-RULES-01`, dois são **código e são entregues de qualquer forma**:

- *"nenhuma regra premia passagens repetidas no mesmo dia local"* — garantido por
  `StudentAttendanceSession`, no banco, não por contagem no código;
- *"interpretador declarativo não aceita JavaScript, SQL ou expressão arbitrária"* — a regra é
  dado (`{ gatilho, pontos }`) com allowlist de gatilhos; não há caminho para expressão.

Os outros dois são **conteúdo**: quanto vale um treino, quais conquistas existem. O Code propõe o
v1 (10 XP por sessão confirmada; conquistas em 1, 10, 50 e 100 sessões) e o PI revisa os números
quando quiser. **Trocar valor é versão nova de regra, não migration** — é para isso que
`XpRuleVersion` é versionada.

### A consequência que precisa ficar escrita — snapshot congela pontuação, não exposição

`RankingSnapshot` publicado é **imutável** (`M5-AC-007`): regra alterada depois não reescreve
placar passado. Mas `M5-FR-003` e `M5-NFR-003` exigem que o aluno que pede opt-out suma da
próxima leitura em até 15 minutos.

As duas exigências colidiriam se o nome fosse gravado na entrada do snapshot. Por isso
**`RankingEntry` guarda `studentId` para auditoria e o nome sai de `resolverExposicao()` em toda
leitura** — o snapshot congela **pontuação e posição**; quem aparece é decidido **agora**.

Gravar o nome público na materialização pareceria uma otimização óbvia e seria o defeito: um
aluno que pediu para sair continuaria estampado num artefato imutável, e a única saída seria
mutar o que o `M5-AC-007` proíbe mutar.

### A trava da F51 que esta fatia não pode quebrar

`apps/kiosk/components/blocos-publicos.tsx` declara, no próprio código, que **nenhum dado de aluno
chega até ele** (`M3.5-BR-001`) e que **a tela pública não fala com a rede**. Um bloco de ranking
com nomes é, por definição, dado de aluno na tela pública.

A trava fica de pé assim: o placar chega **pelo heartbeat**, com os nomes **já resolvidos no
servidor**. A tela não ganha `fetch`, não importa `SessaoDoAluno`, e nunca recebe `studentId`.

### Decisões e onde elas aterrissam

| # | decisão | aterrissa em |
|---|---|---|
| 1 | F31 roda antes do gate do MVP 5, com o totem como superfície | `MVP-05` §1, §7 Slice 5.2 |
| 2 | F31 absorve a F33; `F33`/`SPEC-033` ficam queimadas | `STATUS.md` Índice Fatia ↔ SPEC, `SPEC-033` |
| 3 | Identidade no placar segue `resolverExposicao()` (F30) | `SPEC-031` §8 |
| 4 | Coorte mínima do ranking: **5**, configurável por tenant | `SPEC-031` §4.6 |
| 5 | Período do placar público: **mês corrente** | `SPEC-031` §7 |
| 6 | `M5-RULES-01` não bloqueia; catálogo v1 proposto pelo Code | `SPEC-031` §6 |
| 7 | Snapshot congela pontuação; exposição é reavaliada em toda leitura | `SPEC-031` §4.5 |
| 8 | Sem BullMQ, worker ou despachante de outbox — projeção sob demanda, como a F24 | `SPEC-031` §2.4 |

### Emenda de 27/08/2026 — o placar público é lido ao vivo; o snapshot guarda o mês fechado

Decidido pelo PI em 27/08/2026, durante a execução da fatia. **Emenda as Decisões 2 e 3 acima**
e o desenho da `SPEC-031` §7 e §8.1.

**O que motivou:** o PI perguntou se gerar e publicar o placar não deveria ser automático. O
levantamento mostrou que `@nestjs/schedule` **já existe e já está ligado** (`ScheduleModule.forRoot()`
no `app.module.ts`), com precedente maduro em `operations/alert-scheduler.service.ts` (F11) —
`@Interval`, trava de reentrada, `agora` injetado para teste, falha de um tenant não derrubando os
outros, idempotência no banco em vez de fila. O plano da fatia afirmava que não havia infra de
agendamento; **estava errado**.

**Decisão 1 — o hero mostra o parcial do mês corrente.** É o que engaja: o aluno vê que pode subir
treinando hoje. Placar só do mês fechado não reflete o esforço em curso.

**Decisão 2 — o hero lê ao vivo, sem snapshot e sem publicação.**

Publicar o parcial todo dia colidiria de frente com o `M5-AC-007` (*"snapshot publicado é
imutável"*): o placar do mês corrente muda a cada treino, e republicá-lo exigiria reescrever o que
o critério de aceite proíbe reescrever.

A saída não foi afrouxar a imutabilidade — foi ver o que ela protege. O `M5-AC-007` existe para que
**regra alterada não mude placar histórico**. O placar de agosto *depois* que agosto acabou é
histórico; *enquanto* agosto corre, é estado corrente. Ler ao vivo elimina a colisão em vez de
contorná-la.

**Decisão 3 — o snapshot fica, para o mês fechado.** Um job mensal, no dia 1º, gera e publica o
snapshot do mês que acabou — o registro imutável e auditável que o `M5-FR-010` pede. O painel
continua podendo gerar e publicar manualmente.

| superfície | fonte | quando |
|---|---|---|
| hero público | leitura ao vivo, com cache curto | mês corrente, sempre atualizado |
| snapshot | job mensal no dia 1º | mês fechado, imutável |
| painel | geração e publicação manuais | a qualquer momento |

**A consequência técnica registrada:** o heartbeat do totem bate a cada 30 s (2.880 vezes por dia,
por totem). Calcular o placar em cada batida varreria `StudentXpBalance` da unidade e resolveria
exposição de todos os alunos, toda vez. O placar ao vivo é servido de **cache em memória por
`(tenant, unidade, mês)`, com TTL curto** — o placar não muda em um minuto de forma que alguém
perceba, e o `M5-NFR-004` (p95 < 500 ms, sem cálculo síncrono pesado) continua atendido.

A coorte mínima de 5 e `resolverExposicao()` valem igual na leitura ao vivo: abaixo do mínimo, o
placar vem vazio e o bloco sai do rodízio do hero.

### Emenda de 27/08/2026 (2) — a tela pública passa para a grade densa do DS v2.1

Decidido pelo PI em 27/08/2026, depois de uma auditoria de design que comparou o código do totem
com o `docs/design/DS-TOTEM.md` v2.1.

**O que a auditoria encontrou.** `apps/kiosk/components/blocos-publicos.tsx` implementa um
**rodízio** — um bloco de mídia por vez, girando — e justifica assim, no próprio código:

> *"O §4 exige 'no máximo um bloco de mídia visível por vez', e o rodízio garante isso por
> construção."*

**Essa frase não existe na v2.1.** Ela vem da versão anterior do documento; a v2.1 a substituiu
pela **grade densa** ("home pública em grade densa", no cabeçalho de versão): reel à esquerda em
altura total, carrossel e ranking empilhados à direita.

O código está correto para o DS de ontem e divergente do DS de hoje. Como o documento de design é
**contrato de implementação** (ADR-026), quem se ajusta é o código — a F51 ficou defasada em
relação ao documento, e a F31 herdou a defasagem ao acrescentar o bloco de ranking ao rodízio.

**A consequência que motivou a decisão:** o §4 define três regras de recomposição — *"se um bloco
da coluna direita for desligado, o outro ocupa a coluna inteira; se a coluna toda for desligada, o
reel ocupa a largura total"*. Num rodízio elas não existem, porque nunca há dois blocos na tela ao
mesmo tempo. Essa é a responsividade real desta superfície: o totem é 1080×1920 fixo, mas **a
composição muda por configuração**, e todo bloco pode ser desligado no painel.

**Decisão:** a tela pública é reescrita na grade v2.1, com as quatro composições possíveis
cobertas por teste. O escopo alcança código da F51 — registrado aqui para que a mudança não pareça
refactor oportunista dentro de uma fatia de engajamento.

**Também alinhado ao §3.4c nesta emenda:** o bloco de ranking ganha medalhão por posição (1º em
`brand/500`, 2º–3º em `brand/tint`, demais em `border/hairline`), chip de período
("AGOSTO · TREINOS"), rodapé "Participação opcional · nomes abreviados" e classes próprias — hoje
ele reusa as do bloco de eventos.

**E o nome abreviado.** O §3.4c exige *"nomes sempre abreviados em tela pública"* — `"Ana S."`, não
`"Ana"`. `resolverExposicao()` (F30) devolvia o primeiro nome inteiro. A abreviação passa a viver
no domínio, com as partículas de ligação tratadas (`"Ana de Souza"` → `"Ana S."`, nunca `"Ana d."`),
e incide sobre o caminho do primeiro nome — **apelido aprovado continua inteiro** (o aluno o
escolheu para aparecer assim, e ele passou por moderação) e **`ANONIMO` continua "Participante"**.

---

## ADR-048 — F34 roda antes do gate do MVP 5; desafio é opt-in e o aviso vive no totem, sem canal externo

**Data:** 28/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 28/08/2026**
· **Emenda** `docs/prd/academia/MVP-05-engagement.md` §1 (gate de entrada) e §7 Slice 5.5
  (superfície e canal de notificação)
· **Alcança** a `SPEC-034` e a fatia F34
· **NÃO alcança:** a F35, que segue atrás do gate do MVP 5 tal como estava; o regime opt-out do
  ADR-046 (ver Decisão 2, que **não o revoga** — convive com ele); a Regra de arquitetura 9

### Contexto

O ADR-046 escreveu que **F31–F35 continuam atrás do gate original** e que *"se uma fatia futura
quiser rodar antes do gate, precisa do próprio ADR, com o próprio argumento"*. O ADR-047 fez isso
pela F31 e o PI liberou a F32 por decisão direta em 28/08/2026. Este é o ADR da F34.

O gate pede *"eventos confiáveis + app do MVP 4"*. O argumento é o mesmo do ADR-047, e ficou mais
forte: **o app continua não existindo** (`apps/mobile/` tem um `.gitkeep`), e os **eventos
confiáveis existem** — `StudentAttendanceSession` (F24), o ledger de XP (F31) e o streak derivado
(F32), todos com política versionada.

A F30 já deixou a fatia preparada: `CHALLENGE` e `ENGAGEMENT_PUSH` **já existem** em
`ConsentDocumentType`, marcadas dormentes, e o comentário do schema diz textualmente *"DORMENTE
ate a F34"*. Acordar `CHALLENGE` não exige migration.

### Decisão 1 — a fatia roda, com o totem como superfície

Mesmo movimento do ADR-046 e do ADR-047: onde a Slice 5.5 diz "app", leia-se **totem**. A área do
aluno do `apps/kiosk` ganha os desafios; a tela pública não muda.

**Isso libera só a F34.** A F35 (operação, moderação e experimento) continua atrás do gate.

### Decisão 2 — desafio é OPT-IN, e isso não contradiz o ADR-046

A Slice 5.5 diz *"inscrição opt-in"* e o `M5-BR-001` diz *"nenhuma participação é habilitada por
padrão"*. O ADR-046 tornou o **ranking** opt-out. As duas coisas convivem, e a diferença não é
inconsistência:

| | ranking (ADR-046) | desafio (esta fatia) |
|---|---|---|
| o que é | **exposição** de algo que já acontece | **compromisso** que o aluno assume |
| padrão | participa (opt-out) | não participa (opt-in) |
| por quê | o aluno já treina; o placar só mostra | inscrever alguém sem pedir cria meta que ele não escolheu |

⚠️ **Não unifique os dois predicados.** `participaDoRanking()` trata ausência de decisão como
*participa*; a inscrição em desafio é uma **linha que existe ou não existe** — sem linha, não está
inscrito. Um predicado servindo aos dois regimes passa verde enquanto nenhum teste misturar os
casos, e aí ou o aluno vira participante de um desafio que nunca aceitou, ou some do ranking.

A finalidade `CHALLENGE` do `ConsentDocumentType` **continua dormente**: ela é um regime de
consentimento opt-out, e a inscrição em desafio não é consentimento — é adesão, e mora na própria
tabela de participação.

### Decisão 3 — a notificação é aviso no totem; não há canal externo, e `ENGAGEMENT_PUSH` segue dormente

O `M5-FR-015` pede *"notificação somente por canal consentido e dentro de quiet hours"*. O plano
de apoio (`2026-08-14-mvp-05-05-challenges-notifications.md`) desenha um módulo
`student-notifications` dono de inbox e entrega, BullMQ e um push processor.

**Nada disso existe, e dois deles não têm para onde ir.** Em 28/08/2026 o repositório não tem
tabela de notificação, não tem módulo de notificação e **não tem nenhuma dependência de e-mail,
push, SMS ou WhatsApp**. Push exigiria o app, que é justamente o que o gate não tem.

O `CLAUDE.md` resolve o conflito: plano é material de apoio e, onde divergir do PRD, o PRD vence;
e Redis/BullMQ entra *"só quando comprovadamente necessário, não por padrão"*.

**Decisão do PI:** a notificação desta fatia é o **aviso exibido na área do aluno quando ele se
identifica no totem**. Não há envio, logo:

- **não há quiet hours** — não existe "hora errada" quando é o aluno que chega;
- **não há orçamento de contato** — o aviso não persegue ninguém;
- **não há distinção transacional × marketing** — nada sai da academia, e a pergunta que a issue
  #34 levantava (*"a distinção entre as duas é decisão de produto"*) **não se coloca** enquanto
  não houver canal;
- **`ENGAGEMENT_PUSH` continua dormente**, e acorda na fatia que trouxer um canal de verdade.

**Escopo negativo explícito, para a F35 e para quem vier depois:** quiet hours, orçamento de
contato, a fronteira transacional × marketing e qualquer canal externo **não foram implementados
nem decididos** — não foram esquecidos, foram adiados até existir um canal que os torne uma
pergunta real.

### Decisão 4 — templates seguros são limite de frequência, não catálogo de conteúdo

O `M5-BR-011` diz que *"desafio não pode exigir frequência acima do limite profissional aprovado"*
e o aceite da Slice 5.5 diz que *"desafio não permite regra fora dos limites de segurança"*.

O limite mora no **template**, versionado, e o desafio **copia a versão** ao nascer — editar o
template depois não altera desafio em curso. Mesmo princípio do `policySnapshot` do entitlement
(Regra de arquitetura 1) e do snapshot de ranking (`M5-BR-009`): regra que muda não reescreve o
passado.

### Consequências

- A F34 entrega desafios ponta a ponta no totem, com aviso na própria tela.
- A F35 continua atrás do gate e **herda** o escopo negativo da Decisão 3.
- `ENGAGEMENT_PUSH` segue dormente; a primeira fatia com canal externo precisa decidir a fronteira
  transacional × marketing, e não pode presumir que esta fatia a decidiu.

### Emenda de 28/08/2026 — inscrição automática substitui o opt-in da Decisão 2

**Decidida pelo PI em 28/08/2026**, ao ver a tela com `0 inscrito(s)` num desafio recém-aberto.

**Emenda** `docs/prd/academia/MVP-05-engagement.md` §7 Slice 5.5 (*"inscrição opt-in"*) e
`M5-BR-001` (*"nenhuma participação é habilitada por padrão"*), **para desafio**. As demais
finalidades de engajamento não mudam: `RANKING` segue o regime opt-out do ADR-046, e
`CHALLENGE`/`ENGAGEMENT_PUSH` seguem dormentes.

#### O que muda

A Decisão 2 deste ADR fixou desafio como **opt-in**, com o argumento de que inscrever alguém sem
pedir cria meta que ele não escolheu. O PI decidiu o contrário, e o motivo é de produto: um
desafio que ninguém vê nascer vazio não engaja ninguém — a academia abre a campanha para os
alunos que ela já tem, não para os que forem ao totem descobrir que ela existe.

**Regra nova:** ao abrir a inscrição, todo aluno **`ACTIVE` com entitlement `ACTIVE`** na
unidade do desafio (ou no tenant inteiro, quando `gymUnitId` é nulo) é inscrito automaticamente.

#### Três decisões do PI que fecham as pontas

| pergunta | decisão | consequência |
|---|---|---|
| quem entra | aluno `ACTIVE` **e** entitlement `ACTIVE` | é a mesma cadeia que a catraca usa (Regra de arquitetura 1) — não se inventa um segundo conceito de "aluno em dia" |
| e se ficar inadimplente no meio | **continua no desafio** | desafio é engajamento, não cobrança; tirar quem atrasou uma fatura puniria duas vezes, e a apuração não precisa recalcular elegibilidade a cada passada |
| pode sair | **sim, pelo totem** | `M5-FR-014` continua valendo: entra sozinho, mas ninguém é obrigado a participar. Quem sai **não é reinscrito** por uma reabertura |

#### O que NÃO muda

- **A adesão continua sendo uma linha em `ChallengeParticipant`** — não há "participante
  implícito". Sem linha, não está no desafio. Isso é o que permite sair, e o que faz a contagem
  de inscritos ser um `count` e não uma regra espalhada.
- **`podeInscrever` continua existindo** e continua recusando inscrição repetida: a inscrição
  automática usa o mesmo caminho, e a unique `(challenge, student)` continua sendo quem garante
  uma adesão por aluno.
- **Quem saiu não volta.** A inscrição automática pula quem já tem linha — inclusive `LEFT`.
  Reinscrever quem pediu para sair seria ignorar o pedido dele.

### Emenda de 28/08/2026 (2) — o desafio na tela pública é um bloco do carrossel, não um slot novo

**Decidida pelo PI em 28/08/2026**, ao relatar que *"o desafio não está mostrando na área pública
do totem"*.

#### O que se descobriu antes de decidir

Duas coisas, e só uma era defeito:

- **O ranking JÁ estava no hero** desde a F31 — `blocos-publicos.tsx` tem `temRanking`, a grade tem
  composição própria, e o heartbeat já devolve `placar` com o nome de exibição resolvido no
  servidor. Ele não aparecia porque o módulo `xp` estava **desligado**, e `xp` não estava na lista
  de módulos configuráveis do painel (falta da própria F31). Corrigido como `[FIX]`, não como
  fatia.
- **O desafio nunca existiu na tela pública.** Os cinco tipos de bloco são `VIDEO`, `EVENTOS`,
  `MATERIAL`, `INSTAGRAM` e `INFORMACOES`.

#### Decisão — sexto tipo de bloco, não sétimo slot

O desafio entra como **`DESAFIO`, um tipo de bloco do carrossel**, e não como uma área própria na
grade do hero.

O motivo é estrutural: a grade tem hoje `reel` à esquerda em altura total, com `carrossel` e
`ranking` empilhados à direita — **seis composições fechadas** enumeradas em `classeDaComposicao` e
espelhadas em CSS. Um sétimo slot dobraria a tabela para doze, numa tela de **1080×1920 fixos que
não rola** (`M3.5-NFR`: `scrollHeight === clientHeight`). O carrossel já é o lugar onde blocos
rodiziam entre si; o desafio é conteúdo de campanha, exatamente como eventos e material.

#### O que o bloco mostra, e o que ele NÃO mostra

**Mostra:** título do desafio, a meta e quantos dias faltam. É chamada, não placar.

**Não mostra nome de aluno nenhum** — nem quem está participando, nem quem está na frente.
`M3.5-BR-001` proíbe dado de aluno na tela pública, e o ranking só passa porque
`resolverExposicao()` já resolveu o nome de exibição no servidor (F30). Um "ranking do desafio" no
hero exigiria o mesmo tratamento e **não está nesta emenda**.

**Sem contagem de inscritos.** Com a inscrição automática (emenda anterior), o número é a base
inteira da academia — dizer "293 participando" na parede não informa nada e, pior, sugere um
engajamento que ninguém escolheu.

#### Qual desafio aparece

O **que termina primeiro** entre os abertos hoje, um só. Rodiziar entre desafios dentro de um slot
que já rodizia seria rodízio dentro de rodízio, e ninguém acompanha. Sem desafio aberto, o bloco
**sai do carrossel** — mesmo comportamento do ranking abaixo da coorte mínima, e a razão é a mesma:
bloco vazio na parede é pior que bloco ausente.

---

## ADR-049 — F35 roda antes do gate do MVP 5; correção recusa por teto, não por segundo ator; flag é coluna de tenant, sem experimento

**Data:** 28/08/2026 · **Status:** `aceito` · **Decidido pelo PI em 28/08/2026**
· **Emenda** `docs/prd/academia/MVP-05-engagement.md` §1 (gate de entrada) e §7 Slice 5.6
  (superfície, segregação de função e escopo de experimento)
· **Alcança** a `SPEC-035` e a fatia F35; a ponta aberta da F33 (rankings por categoria)
· **NÃO alcança:** o regime opt-out do ADR-046; a inscrição automática do ADR-048; a Regra de
  arquitetura 9; o `M5-BR-006` (evolução relativa continua fora — ver Decisão 4)

### Contexto

O ADR-046 escreveu que **F31–F35 continuam atrás do gate original** e que *"se uma fatia futura
quiser rodar antes do gate, precisa do próprio ADR, com o próprio argumento"*. O ADR-047 fez isso
pela F31, o PI liberou a F32 por decisão direta e o ADR-048 fez pela F34. **Este é o ADR da F35, a
última fatia do MVP 5** — depois dele o gate original não guarda mais nenhuma fatia.

O gate pede *"eventos confiáveis + app do MVP 4"*. O argumento é o mesmo das três vezes anteriores,
e nesta é o mais forte de todos: **o app continua não existindo** (`apps/mobile/` tem um
`.gitkeep`), e os eventos confiáveis não só existem como já foram consumidos por quatro fatias —
`StudentAttendanceSession` (F24), o ledger de XP (F31), o streak derivado (F32) e o progresso de
desafio (F34).

Esta fatia é diferente das anteriores num ponto: ela **não cria** um mecanismo de engajamento novo,
ela dá à secretaria o poder de **corrigir** os que já existem sem abrir o banco. O aceite da Slice
5.6 é literal: *"equipe corrige pontuação e remove exposição sem editar banco diretamente"*.

### Decisão 1 — a fatia roda, com painel e totem como superfícies

Mesmo movimento do ADR-046, do ADR-047 e do ADR-048: onde a Slice 5.6 diz "app", leia-se **painel**
para o que a secretaria opera, e **totem** para o que o aluno faz.

A divisão não é arbitrária: contestar é ato do aluno (totem, área interna autenticada); resolver,
corrigir, ocultar, recalcular e medir são atos da operação (painel).

**Isso encerra o gate do MVP 5.** Nenhuma fatia do MVP 5 continua atrás dele.

### Decisão 2 — correção RECUSA por teto; não existe segundo ator

O plano de apoio (`2026-08-14-mvp-05-06-operations-experiment.md`, Task 1 Step 1 e Task 3 Step 3)
pedia segregação de função em três pontos: `SEGREGATION_OF_DUTIES_REQUIRED` ao autorizar correção,
e *"aprovação requer ator diferente"* ao publicar recálculo.

**O repositório já decidiu o contrário, e a decisão está escrita no schema** —
`packages/database/prisma/schema.prisma`, campo `BillingSettings.refundLimitMinor`:

> *"RECUSA, NÃO APROVA: acima do teto a operação é barrada com erro de domínio. **Não existe papel
> de aprovador no MVP 2**, e inventar uma fila de aprovação que ninguém opera produziria estorno
> travado para sempre."*

O argumento vale inteiro aqui, e o contexto o reforça: **o cliente inaugural tem uma secretaria**.
Uma fila que exige dois operadores distintos, numa academia com um, é uma fila que nunca anda — e o
efeito prático de uma correção travada para sempre é pior que o de uma correção errada, porque a
errada é visível no extrato e reversível pelo próprio mecanismo desta fatia.

O que o produto usa no lugar do segundo ator, seguindo o precedente do MVP 2:

| mecanismo | como aparece na F35 |
|---|---|
| **permissão própria** | `engagement.correct`, separada de `engagement.moderate` — como `reconciliation.resolve` é separada de `reconciliation.read`, pela mesma razão: *"quem confere nem sempre é quem decide"* |
| **teto por operação** | correção acima do teto do tenant é **recusada** com erro de domínio, nunca enfileirada |
| **motivo obrigatório** | já é invariante do ledger (`XP_MOTIVO_OBRIGATORIO`), a fatia não afrouxa |
| **trilha** | ator e instante em toda decisão; o ledger é append-only por trigger |

### Decisão 3 — flag é coluna de settings do tenant; experimento fica fora

A Slice 5.6 pede *"feature flags e experimento com grupo controle"*. São duas coisas, e o PI separou.

**Flags entram**, porque o aceite depende delas: desligar uma capacidade é o rollback que a operação
precisa ter. Entram no formato que o repositório já usa — **coluna em tabela de settings do tenant**,
pela razão registrada em `BillingSettings.blockAnchor`: *"não é constante, é CONFIGURAÇÃO… regra
comercial que vive dentro de um `if` é regra que ninguém encontra depois"*. Não entra serviço de
flags, nem arquivo de toggle, nem variável de ambiente.

**Experimento com grupo controle fica fora.** Não há experimento pedido: nem hipótese, nem métrica
de decisão, nem quem leia o resultado. Atribuição estável por hash, eventos de exposição e worker de
guardrail nasceriam sem consumidor — e código sem consumidor não é preparação, é dívida que ninguém
sabe se funciona porque nada exerce. Quando houver a primeira pergunta que só um experimento
responde, ela traz o próprio ADR e a própria fatia.

**Escopo negativo explícito, herdado e ampliado:** a F35 herda o escopo negativo do ADR-048 Decisão 3
(quiet hours, orçamento de contato, canal externo) e acrescenta: sem atribuição de grupo, sem
guardrail automático de parada, sem despachante de outbox.

### Decisão 4 — ranking ganha categoria; evolução relativa continua fora

Fecha a ponta que o PI deixou aberta em 28/08/2026 ao fechar a #33: *"rankings por categoria
(frequência, consistência, evolução relativa — PRD §7) ficam para F34/F35"*. A F34 não pegou; é aqui.

Entram **três** categorias, e o critério é ter dado confiável hoje:

| categoria | fonte | existe? |
|---|---|---|
| XP do mês | `XpLedgerEntry` (F31) | sim — é o ranking atual |
| Frequência | `StudentAttendanceSession` (F24) | sim — mesma projeção que o XP lê |
| Consistência | semanas elegíveis (F32) | sim — `avaliarSemanas`/`resumirStreak` |

**Evolução relativa fica fora.** O `M5-BR-006` exige *"variação relativa e baseline comparável"*, e
baseline corporal comparável é entrega do MVP 3 que não existe. Publicar ranking de evolução sem
baseline comparável é publicar número que não significa o que diz — e o `M5-FR-012` ainda proíbe
expor valor absoluto quando oculto, o que exige desenho próprio. Vira ponta registrada, não código
apressado.

**Consequência estrutural:** a chave única `[tenantId, gymUnitId, localMonth]` de `RankingSnapshot`
**impede** dois snapshots do mesmo mês e unidade. A categoria entra na chave. Migration obrigatória.

### Decisão 5 — quem oculta é a secretaria; não há canal de denúncia do aluno

A F30 deixou `PublicProfileStatus.HIDDEN` **sem nenhum caminho de escrita** — estado alcançável por
nada, esperando *"o canal de denúncia da F35"* (ADR-046, Decisão 6).

O PI decidiu que o canal **não é do aluno**: a fila de moderação ganha a ação **Ocultar**, e a
secretaria a usa quando alguém reclama na recepção. Razão: um botão de denúncia numa tela de
academia é ferramenta de briga entre alunos antes de ser ferramenta de segurança, e a reclamação
real chega na recepção, que é onde a pessoa que pode agir já está.

`HIDDEN` deixa de ser órfão. `resolverExposicao()` não muda — ela já trata qualquer status
diferente de `APPROVED` caindo no primeiro nome, e há teste da F30 provando (`exposicao.spec.ts`).

### Consequências

| # | consequência | onde |
|---|---|---|
| 1 | `MVP-05` §1 fica **emendado**: o gate não alcança a F35 — e não guarda mais nenhuma fatia | `MVP-05` §1 |
| 2 | Slice 5.6 fica **emendada**: sem segregação de função, sem experimento com grupo controle | `MVP-05` §7 |
| 3 | Correção acima do teto **recusa**; não existe fila de aprovação | `SPEC-035` §2 |
| 4 | Permissão nova `engagement.correct` entra no catálogo | `seed.ts` |
| 5 | `RankingSnapshot` ganha categoria na chave única — **migration** | `schema.prisma` |
| 6 | Evolução relativa continua fora, com razão registrada — ponta aberta | `SPEC-035` §3 |
| 7 | `HIDDEN` ganha caminho de escrita pela fila de moderação | `SPEC-035` §1 |
| 8 | Flag de engajamento é coluna de settings do tenant, nunca `if` no código | `schema.prisma` |

---

## ADR-050 — A F40 não é executada: o gate `M6-ML-01` não é atingível, e a medição diz por quê

**Data:** 31/08/2026
**Status:** aceito
**Decisor:** Rodrigo Reis (PI)
**Contexto:** Slice 6.5 do MVP 6 (`docs/prd/academia/MVP-06-retention-ai.md` §8), issue
[#40](https://github.com/RodReis/arenahub/issues/40)

### O problema

A Slice 6.5 entrega um **modelo supervisionado de churn**, e o próprio título a condiciona ao gate
`M6-ML-01`. A issue #40 é explícita sobre o que isso significa:

> ⚠️ **Fatia condicional — pode não acontecer, e isso é resultado válido.** Se as regras
> explicáveis de F37 já resolverem o problema com dado suficiente, **modelo supervisionado é custo
> sem ganho**. A condicionalidade está no próprio título da Slice; não a trate como formalidade.

O gate tem números verificáveis, e a pergunta certa não era *"queremos ML?"* — era **"o dado
existe?"**. Isso se mede.

### A medição, em 31/08/2026

Contra o banco de desenvolvimento (`arenahub`, tenant `arena-positiva`, o único que existe):

| exigência do `M6-ML-01` | mínimo | medido | razão |
|---|---|---|---|
| snapshots elegíveis por tenant | 1.000 | **0** | o pipeline da F36 **nunca rodou** — nenhuma fatia do MVP 6 tem job |
| churns positivos por tenant | 200 | **1** | `student_timeline_events` tem **um** `SUBSCRIPTION_CANCELLED` |
| histórico confiável | ≥ 6 meses | **3 dias** | sessões de treino existem só em 27/08; invoices, de 25 a 27/08 |

**Os 1.907 `Subscription.status = CANCELLED` não são 1.907 churns.** São o *status atual* de linhas
importadas em bloco entre 19 e 26/08/2026 — todos os 1.967 alunos entraram numa carga única. Status
corrente não tem data de transição, e a F36 documentou exatamente essa armadilha: *"a invoice estava
vencida em D" é aritmética sobre datas imutáveis, não consulta de status*. Sem a data em que o
aluno saiu, não há label temporal — e sem label temporal não há treino supervisionado, só
memorização do presente.

### A decisão

**A F40 não é executada.** Nenhum código de ML entra no repositório: sem pipeline de treino, sem
runner Python, sem shadow mode, sem `model_versions`.

Não é adiamento por falta de tempo. É o **resultado que o PRD prevê** para o caso em que o gate não
fecha, e a última linha do `M6-ML-01` já dizia o que fazer: *"ausência do gate mantém baseline
funcional e ML fechado"*. A baseline da F37 está entregue, funcional e explicável; ela é o produto
enquanto não houver dado que justifique outra coisa.

### Por que não construir "já que é barato"

Três razões, em ordem de peso:

**1. O modelo não poderia ser promovido.** O aceite da Slice 6.5 exige superar a baseline num teste
temporal congelado. Com 1 churn datado não há conjunto de teste — o pipeline nasceria com o kill
switch permanentemente acionado, e código que nunca executa em produção apodrece sem ninguém notar.

**2. Custo de manutenção real, benefício zero.** Cada fatia seguinte carregaria a compatibilidade de
um trilho de ML que ninguém usa: migrations, `providers` no módulo, testes que rodam no CI a cada
push, dependências Python. A F37 já deixou a porta aberta com `RetentionScoreProvider` e a coluna
`calibratedProbability` nula — a F40 encaixa quando fizer sentido, **sem refazer nada**.

**3. Modelo ruim é pior que regra clara.** Treinado em 3 dias de dado, ele aprenderia a data de
importação, não o comportamento do aluno. E o resultado seria pior do que inútil: um número sem
explicação que a recepção não pode contestar, substituindo regras que ela entende. O MVP inteiro foi
desenhado na ordem oposta — *"explicável vem antes de modelo, e a ordem é deliberada"* (issue #37).

### O que precisa acontecer para reavaliar

Em ordem de dependência. Nenhum destes é trabalho da F40:

1. **O pipeline precisa rodar diariamente.** Snapshot → score → fila → alocação existem e são
   testados, mas **nenhuma das quatro fatias tem job**. Sem execução recorrente, `student_feature_
   snapshots` continua vazia e os seis meses nunca começam a contar. É a única dependência dura, e
   hoje ela não tem card.
2. **Churn precisa virar evento datado.** `SUBSCRIPTION_CANCELLED` em `StudentTimelineEvent` já é
   append-only e tem `occurredAt` — o caminho existe, falta o cancelamento real passar por ele em
   volume.
3. **Seis meses de operação real.** Com o pipeline rodando desde D, o gate é reavaliável em D+180.
4. **Só então:** medir de novo o `M6-ML-01` e, se fechar, reabrir a decisão.

**Critério de reabertura:** ≥ 1.000 snapshots e ≥ 200 churns datados no mesmo tenant. Enquanto não
houver, esta decisão não precisa ser revisitada — e a medição pode ser refeita a qualquer momento
com as consultas registradas em `SPEC-040`.

### Consequências

| # | consequência | onde |
|---|---|---|
| 1 | A F40 é fechada como **não executada**, não como pendente | `docs/STATUS.md`, `SPEC-040` |
| 2 | Nenhum código, migration ou dependência de ML entra no repositório | — |
| 3 | A baseline de regras (F37) **é** o produto de scoring, não um degrau provisório | `SPEC-037` |
| 4 | `calibratedProbability` segue nula e `RetentionScoreProvider` segue com um provider | `schema.prisma` |
| 5 | **Fica exposta uma lacuna que não tem card: nada agenda o pipeline diário** | ver §4 acima |
| 6 | A F41 (Slice 6.6) perde o objeto principal — drift e kill switch **de modelo** | reavaliar escopo |
| 7 | A medição é reproduzível e datada; refazê-la é o gatilho de reabertura | `SPEC-040` §2 |

---

<a id="adr-051"></a>
## ADR-051 — Topologia de implantação: nuvem na Railway, totem e edge-agent na academia

**Data:** 02/09/2026
**Status:** aceito *(decisão nova — **decidida pelo PI em 02/09/2026**)*
**Decisor:** Rodrigo Reis (PI)
**Contexto:** todas as issues de `admin-web` e `kiosk` fechadas; o PI pediu a spec de implantação
(`SPEC-058`) e, na mesma conversa, criou na Railway quatro serviços — `api`, `admin-web`, `kiosk`
e `edge-agent`. Dois deles não podiam existir ali, e a conversa que explicou por quê é este ADR.

**Por que é ADR e não decisão de spec:** contrato com terceiro (Railway) e escolha cara de desfazer
(onde mora o segredo do totem; onde ficam os arquivos) — o critério do `CLAUDE.md`.

### Decisão

| # | componente | onde roda | por quê |
|---|---|---|---|
| 1 | `apps/api` | **Railway**, serviço público (HTTPS), porta interna **3344** fixa | única superfície que totem e Edge alcançam de fora |
| 2 | `apps/admin-web` | **Railway**, mesmo projeto, fala com a API pela **rede privada** (`API_INTERNAL_URL`) | uma conta, uma fatura; o PI citou Vercel e decidiu Railway ao ver o projeto criado |
| 3 | Postgres, Redis | **Railway**, mesmo projeto | já eram a stack (`prd/README.md` §5) |
| 4 | Object storage | **Railway Bucket** (S3-compatível) | mesmo projeto; MinIO só em dev. R2 e S3 descartados por exigirem conta nova. Trocar é variável, não código |
| 5 | `apps/kiosk` | **PC do totem, na academia** — `next start --hostname 127.0.0.1 -p 3210` | ver *A decisão que importa* |
| 6 | `apps/edge-agent` + `EasyInnerBridge.exe` | **PC da recepção, Windows**, serviço | `EasyInner.dll` é Windows x86 (ADR-010); a catraca está na LAN. Composição é a **F59** |

### A decisão que importa: o totem NÃO vai para a nuvem

O ADR-045 aceitou a enumeração de CPF no totem **sob uma condição escrita**: a ponte HMAC
(`/api/kiosk/*`) fica em loopback, então enumerar exige estar fisicamente na frente do aparelho.
O próprio ADR diz que expor a ponte *"por reverse proxy... não é ajuste de infraestrutura: é
mudança do risco que o PI aceitou"*.

Publicar `apps/kiosk` na Railway ou na Vercel é exatamente isso: `POST /api/kiosk/sessions` na
internet, sem rate limit, devolvendo nome, plano e valor em aberto para qualquer CPF. O PI viu a
consequência e decidiu **local**. Esta decisão **preserva** o ADR-045 sem emendá-lo.

**Como o painel na nuvem controla um totem local:** não controla diretamente — controla a API. O
totem **puxa** `GET /api/v1/kiosk/config` e envia `POST .../heartbeat` pela ponte local; publicar
uma versão no painel muda a tela no próximo heartbeat (F50). Nada da nuvem entra na LAN. É o mesmo
sentido de tráfego do Edge.

### Consequências normativas

1. **O serviço `kiosk` e o serviço `edge-agent` criados na Railway em 02/09/2026 foram apagados**
   pelo PI na mesma conversa. Recriá-los reabre o ADR-045 (kiosk) ou contraria o ADR-010 (edge).
2. **A API continua em 3344.** A Railway injeta `PORT`; a solução é o *target port* do serviço,
   não a API ler `PORT`. Trocar a regra de porta é decisão registrada (`CLAUDE.md`), não ajuste.
3. **Esta implantação é PRÉ-PRODUÇÃO.** A restrição 1 do ADR-029 (*nenhuma unidade entra em
   operação real com a catraca em modo livre*) segue em vigor até o ADR-028 fechar e a F59 entrar.
   `SPEC-058` §7.3 exige que o aceite diga isso em texto.
4. **Antivírus: o dublê sobe** (`FakeMalwareScannerAdapter` é o único provider). Nenhum upload é
   escaneado em pré-produção. Risco aceito pelo PI em 02/09/2026; scanner real é card futuro, sem
   prazo fixado — **quem fixar o prazo é o PI**.
5. **Pagamento real desligado** até a F55; `FakePaymentProvider` nunca recebe CPF de aluno real.
6. **Banco de produção nasce com a base do Pacto** (F47 `CANCELLED` + F48 ativação), dentro de um
   tenant criado por bootstrap real — o seed de bancada não roda em produção.
7. **Perder `MFA_ENCRYPTION_KEY` invalida TOTP, credencial de totem e de Edge de uma vez.** Cópia
   fora da Railway, no cofre do PI, é critério de aceite da F58.

### O que este ADR não decide

- Como empacotar (Dockerfile vs. config Railway), como migrar (pre-deploy vs. job), números de
  rate limit, mecanismo de serviço Windows — **do Code**, registrado no PR.
- Domínios e DNS.
- Quando o scanner real entra — PI.

### Fatias

| fatia | spec | issue |
|---|---|---|
| F58 — Implantação: nuvem + totem local | [`SPEC-058`](specs/SPEC-058-implantacao-nuvem-e-totem-local.md) | [#253](https://github.com/RodReis/arenahub/issues/253) |
| F59 — Composição de produção do edge-agent | [`SPEC-059`](specs/SPEC-059-composicao-de-producao-do-edge-agent.md) | [#254](https://github.com/RodReis/arenahub/issues/254) |

---

## ADR-052 — Módulo `platform`: Super Admin, plano SaaS, contrato e identidade visual do tenant

**Data:** 08/09/2026
**Status:** aceito *(decisão nova — **decidida pelo PI em 08/09/2026**)*
**Decisor:** Rodrigo Reis (PI)
**Contexto:** o ArenaHub tem um tenant (`arena-positiva`), criado por script (`bootstrap-tenant.ts`)
com acesso ao banco. Não existe ator de plataforma, não existe plano SaaS tipado, não existe
contrato e a cobrança do ArenaHub sobre o tenant estava **fora de escopo** dos MVPs 1 e 2
(`CONVENTION.md` §5). O PI pediu a análise da super administração de tenants e decidiu o recorte
na mesma conversa.

**Por que é ADR:** contrato com o cliente (valores, índice, carência), modelo de cobrança da
plataforma e forma do ator de plataforma são caros de desfazer — e o módulo inteiro nasce aqui.

### Decisões

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | **Módulo `platform`**, numerado como **MVP 7 — Plataforma**, fora de `docs/prd/academia/` | fatia solta dentro do MVP 1 | é um produto para outro cliente (o dono do ArenaHub), com ator, dados e cobrança próprios |
| 2 | **Super Admin é modo do `admin-web`**, rota `/platform` | app separado (caixa "Super Admin" do `ARCHITECTURE.md`) | `User` é global (e-mail único, sem `tenant_id`), então um papel de plataforma sem `tenant_id` basta; um app a mais é um deploy a mais |
| 3 | **Entrada em tenant só por sessão elevada** — justificativa, expiração, `AuditLog` com `actorType = SUPPORT` (INV-005, INV-008); **MFA obrigatório** (INV-007, `mfa.service.ts` já existe) | impersonation por troca de sessão | é o invariante já escrito; impersonation **é** a elevação, não outra coisa |
| 4 | **CRUD de tenant e unidades pelo Super Admin** substitui o script de bootstrap. `TenantStatus` passa a `ACTIVE` \| `INACTIVE` \| `SUSPENDED` | manter script | segundo cliente não pode depender de acesso ao banco |
| 5 | **Plano SaaS em dois modelos**, escolhido no contrato: **(a) por aluno** — preço por aluno **ativo** e por aluno **inativo**, distintos e configuráveis (padrão **R$ 5,00** e **R$ 2,50**); **(b) fixo mensal** corrigido anualmente por índice | preço único por aluno; pacotes por faixa | decisão comercial do PI |
| 6 | **Aluno ativo = `Student.status = ACTIVE`; inativo = todo o resto** — `LEAD`, `TRIAL`, `SUSPENDED`, `BLOCKED`, `CANCELLED`, `ARCHIVED` *(fechado pelo PI em 08/09/2026, segunda rodada)*. Na base real de 08/09: 409 ativos, ~1.580 inativos | Entitlement ativo no dia de corte (proposta do Cowork); `LEAD`/`TRIAL` fora da conta | o PI escolheu o status do aluno, que é o que a academia vê na tela. **Consequência registrada:** lead cobrado desestimula cadastrar lead — o preço do inativo é **negociado por contrato** e pode ser zero |
| 7 | **Índice de correção padrão: IPCA (IBGE)**; o contrato guarda `index_code`, data-base e aniversário; o **valor do índice entra por configuração manual com histórico** | IGP-M; automação pela API SGS do Banco Central (série 433) | IGP-M é de aluguel e oscila demais para serviço; API pública no caminho de faturamento é risco desnecessário no primeiro ano — a automação fica para depois |
| 8 | **Contrato é registro imutável** — tenant, plano, modelo, valores acordados em **minor units**, índice, aniversário, carência — mais **PDF gerado**. Mudar preço do plano **não** altera contrato vigente; novo valor = novo contrato ou aditivo | contrato = `Subscription`; assinatura eletrônica | fecha o buraco `Contract` do §5 sem amarra externa. Assinatura eletrônica **não entra** |
| 9 | **Identidade visual configurável no cadastro do tenant:** logo (upload), **ícone SVG** (favicon), **nome exibido** na tela inicial, **texto de missão** e **texto de diferenciais** | domínio próprio / CNAME | é o que o PI marcou na tela de login; CNAME é caro na Railway e ninguém pediu |
| 10 | **Tela de login identifica o tenant pelo `slug` na URL** (`/{slug}/login`); sem slug, marca ArenaHub | detectar pelo domínio do e-mail | antes de autenticar não há `TenantContext`, e o `slug` já é "identificador público usado em URL" no schema |

### Fatura da plataforma

Existe, e é do ArenaHub sobre o tenant — **não** reaproveita o módulo `billing` (aquele é do tenant
cobrando aluno: outro pagador, outro ciclo, outra consequência). Emitida no **dia configurado no
contrato**, conta os alunos por status **naquele dia** (modelo a) ou aplica o valor fixo corrigido
(modelo b). Pagamento **registrado manualmente pelo Super Admin** nesta primeira versão — gateway
para a plataforma é ADR futuro. Vencimento → carência → gate da catraca: ADR-053.

### Riscos que o PI aceitou de olhos abertos

- **Inativo custa mais que ativo na base real.** Arena Positiva hoje: 409 × 5,00 = R$ 2.045 e
  1.582 × 2,50 = R$ 3.955 — **66% da fatura vem de quem não treina**. O incentivo é o tenant
  apagar histórico para pagar menos, e `ARCHIVED` é terminal. Mitigação mínima: o tenant vê a
  **prévia da fatura** no painel antes da emissão, e a exclusão física de aluno continua não
  existindo.
- **Assinatura eletrônica fora.** O contrato vale pelo que o PI decidir fora do sistema.

### Pendências do PI — **fechadas em 08/09/2026**

1. ~~Os quatro status que não são nem ativo nem inativo~~ — **decidido:** todos contam como **inativo** (decisão 6). A proposta do Cowork (não contar `LEAD`/`TRIAL`) foi recusada.
2. ~~Dia de emissão padrão~~ — **dia 1, configurável no contrato.** O PI aprovou as specs F61–F67 com essa proposta dentro; vale até ele dizer diferente.
3. **Preço do inativo é negociado por contrato** — o padrão R$ 2,50 é ponto de partida, não regra; o PI viu a inversão da fatura (66% de inativos) e decidiu que isso se resolve na negociação, não no modelo.

### Consequências normativas

- `CONVENTION.md` §5: `SaasPlan` e `Contract` deixam de ser buraco; `FeatureFlag` continua coluna
  (ADR-049), sem serviço — plano SaaS **não** habilita módulo por flag nesta versão.
- `ARCHITECTURE.md`: a caixa "Super Admin" passa a ser rota do `admin-web`. Emenda a fazer.
- Fatias: **F61** Super Admin e ciclo de vida do tenant · **F62** identidade visual e login por
  slug · **F63** plano SaaS e contrato · **F64** fatura da plataforma · **F65** gate de tenant
  (ADR-053) · **F66/F67** RLS (ADR-054).

---

## ADR-053 — Tenant suspenso fecha a catraca depois de carência configurável

**Data:** 08/09/2026
**Status:** aceito *(decisão nova — **decidida pelo PI em 08/09/2026**)*
**Decisor:** Rodrigo Reis (PI)
**Contexto:** hoje **nada** em `access`, `device-sync` ou `edge-agent` lê `Tenant.status` — suspender
um tenant trava o painel e mais nada. O PI decidiu que a inadimplência do tenant com o ArenaHub
chega à catraca, com carência.

**Por que é ADR:** mexe no motor de decisão (ADR-003) e no snapshot do Edge — a mecânica mais cara
de desfazer do sistema.

### Decisão

1. **Carência: 15 dias após o vencimento da fatura da plataforma**, padrão global, **configurável
   por tenant** no contrato. Vencida a carência, o tenant vai para `SUSPENDED` e a catraca **nega
   todo mundo** — aluno, funcionário, personal. Enquanto não houver fatura automática, a suspensão
   é **manual** pelo Super Admin e a carência conta da data que ele informar.
2. **É um gate de tenant no motor de decisão, não revogação de Entitlement.** O motor ganha uma
   verificação antes das regras de aluno: `tenant.gate_active` → `DENY` com razão
   **`TENANT_SUSPENDED`**. Entitlements ficam intactos; regularizou, o gate cai e ninguém precisa
   ser recadastrado. Revogar em massa seria destrutivo e irreversível na prática.
3. **A regra 1 continua de pé.** "Pagamento não controla acesso" fala do pagamento **do aluno**.
   O gate é do **contratante**, outro ator, outra cadeia — não passa por `Invoice` nem
   `Subscription` do aluno.
4. **Edge:** o snapshot assinado carrega **`tenantGateAt`** (instante em que o gate ativa, ou nulo).
   Edge online fecha no próximo sync; edge **offline antes da suspensão** só fecha quando o snapshot
   **expirar** — comportamento aceito; a alternativa (snapshot sem TTL curto) reabriria o `[FIX]`
   "snapshot expirado permite allow offline".
5. **Aviso antes de fechar:** desde o vencimento, o `OWNER` vê no painel a contagem regressiva e o
   valor em aberto. Fechar sem avisar é incidente, não cobrança.
6. **Reversão imediata:** pagamento registrado → gate cai na hora na nuvem, no próximo sync no Edge.

### Escopo negativo

Não bloqueia login do painel na carência (o dono precisa ver a fatura para pagar); não apaga nada;
não toca em `Entitlement`, `Subscription` nem `Invoice` do aluno.

### Emenda — três decisões do PI na F65 (09/09/2026), o ADR não fechava

1. **O aviso vai nos três lugares**, não só "no painel" (§5): grid do Super Admin, faixa
   não-dispensável no painel do dono, e a linha da fatura vencida no tenant. A terceira ficou
   **fora do escopo da F65** — nenhuma tela em `admin-web` consumia o endpoint de faturas do
   tenant, e construí-la era task própria, não acréscimo; fica registrada como pendência, não
   como decisão revertida.
2. **A chave automático/manual (`Tenant.autoSuspend`) mora no TENANT, não no contrato.**
   `TenantContract` é imutável depois de ativo (F63) — pôr a chave lá exigiria contrato novo com
   PDF novo para virar uma preferência operacional. Nasce **desligada**: coluna ligada por padrão
   fecharia catraca de inadimplente no primeiro deploy sem ninguém ter decidido isso por aquele
   cliente.
3. **A suspensão automática só efetiva às 6h locais do dia seguinte** ao esgotamento da carência,
   no fuso da própria academia — não no instante exato em que a carência acaba. Sem regra de
   feriado, mas ninguém fecha a catraca às 3h de um domingo com a recepção fechada.

**O `tenantGateAt` do §4 segue sem produtor** — a F10 (`SPEC-010`, operação offline) continua no
backlog do MVP 1.5. A F65 entregou o campo que o motor puro vai consumir
(`AccessPolicyInput.tenant.gateActive`); a serialização para o Edge fica para quando a F10
existir.

---

## ADR-054 — Row-Level Security no Postgres como segunda camada de isolamento

**Data:** 08/09/2026
**Status:** aceito *(decisão nova — **decidida pelo PI em 08/09/2026**)*
**Decisor:** Rodrigo Reis (PI)
**Contexto:** o isolamento de tenant é 100% aplicação — `TenantContext` obrigatório no repositório
(INV-003) e teste que tenta cruzar e falha (INV-006). Um `where` esquecido vaza. O PI decidiu
ligar RLS agora, antes do segundo tenant.

**Por que é ADR:** exige um segundo role de banco em produção, mudança no client factory e
migration de dado em **doze tabelas** — caro de desfazer.

### Decisão

1. **RLS é segunda camada.** `TenantContext` continua obrigatório; RLS pega o `where` que faltou.
   Nenhum repositório passa a "confiar no banco" para filtrar.
2. **Role de runtime separado do dono das tabelas** — `arenahub_app`, sem ownership, sem
   `BYPASSRLS`. Migrations continuam com o dono. Toda tabela com política leva
   `FORCE ROW LEVEL SECURITY`. Na Railway isso significa **criar o segundo usuário** e duas
   `DATABASE_URL` (migração × runtime).
3. **Contexto por transação:** `SET LOCAL app.tenant_id = '<uuid>'` no início de cada transação,
   via **extensão do Prisma Client** no `packages/database` — nunca `SET` de sessão (pool
   compartilhado). Query fora de transação com tenant **falha**, não devolve vazio.
4. **Contextos sem request** — worker, outbox, edge-sync, seed, Super Admin elevado — setam
   `app.actor = 'system' | 'platform'` explicitamente; a política aceita `app.actor = 'platform'`
   **só** no caminho da sessão elevada (ADR-052 §3). Nada implícito.
5. **As tabelas sem `tenant_id` que têm dono de tenant ganham a coluna** — `AccessPassage`,
   `PlanUnit`, `PlanAccessWindow`, `EntitlementUnitWindow`, `RankingEntry`, `ReplayNonce`.
   Política por `JOIN` é lenta e frágil. `Tenant`, `User`, `Permission` e `RolePermission` são
   globais e ficam fora.

   > **Emenda em 10/09/2026, decidida pelo PI ao executar a F67.** Este parágrafo dizia "doze
   > tabelas" e nomeava mais três, escritas antes de conferir o schema. Ao implementar, três não
   > têm dono de tenant e a coluna as quebraria ou mentiria: **`AiPromptVersion`** — o próprio
   > schema registra que "prompt é do produto, não do tenant", e `name` é único **globalmente**,
   > então `tenant_id` exigiria trocar a unicidade por `(tenant_id, name)` e mudaria a semântica;
   > **`KioskReplayNonce`** — anti-replay por `key_id`, sem nenhum laço com tenant; e
   > **`InboxReceipt`** — sem pai de onde herdar e **sem escritor nem leitor** em todo o
   > repositório, de modo que qualquer valor seria dado inventado; ela ganha a coluna na fatia que
   > lhe der o primeiro uso. Ficam com as globais também `IndexValue` (IPCA), `PlatformAdmin` e
   > `SaasPlan`, que são da plataforma e nunca de uma academia. **A F67 entregou seis colunas e
   > política em 109 tabelas**, com guarda de integração que recusa tabela nova com `tenant_id` e
   > sem política.
6. **Duas fases:** **F66** — role, extensão, política em `students` e `audit_logs`, teste de
   integração sob o role restrito tentando cruzar tenant (INV-006 no banco). **F67** — coluna nas
   tabelas do §5 + política em todas as tabelas com `tenant_id`.

### Riscos

Timeout de **5 s** de transação interativa do Prisma já apareceu no import do Pacto pelo proxy
público; toda query passar a ser transação aumenta a exposição. Testcontainers precisa do role
restrito ou o teste mente. Performance: as políticas usam o índice em `tenant_id` que já existe.

---

## ADR-055 — O contrato do tenant é licença de uso em regime de assinatura, com termos versionados e assinatura fora do sistema

**Data:** 11/09/2026
**Status:** aceito *(decisão nova — **decidida pelo PI em 11/09/2026**)*
**Decisor:** Rodrigo Reis (PI)
**Contexto:** a F63 entregou o contrato como **ficha de dados** — contratante, plano, superfícies,
reajuste, vigência. Ao ver o PDF gerado em produção, o PI pediu cláusulas (objeto, escopo, preço,
propriedade intelectual, sigilo, LGPD), a qualificação da empresa fornecedora e um lugar para o
cliente assinar, e perguntou se existe integração de assinatura gratuita.

**Por que é ADR:** regime jurídico do contrato com o cliente e eventual contrato com terceiro
(plataforma de assinatura) — os dois critérios de "caro de desfazer" do `CLAUDE.md`. E porque a
decisão 2 abaixo muda a forma de um dado já em produção.

### Decisões

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | **O documento é "Contrato de licença de uso de software em regime de assinatura e prestação de serviços de suporte"** | "Contrato de prestação de serviço", como está hoje | prestação de serviço é o rótulo de desenvolvimento sob encomenda, onde a titularidade do que se produz é discutível. O ArenaHub é produto da CONTRATADA vendido a vários clientes; o documento diz isso na primeira linha e a Cláusula 1.2 fecha a porta |
| 2 | **Os termos são versionados (`terms_version`) e o contrato grava a versão fechada** | texto único, sempre o atual | regerar em 2029 o PDF de um contrato de 2026 tem que reproduzir os termos de 2026. É a regra dos valores copiados (ADR-052 §8) aplicada ao texto. Sem isso, editar uma cláusula reescreveria retroativamente todo contrato assinado — inclusive os já usados em cobrança |
| 3 | **Cláusula de suspensão por inadimplência entra no contrato** (Cláusula 5) | manter a regra só no ADR-053 | o ADR-053 manda a catraca fechar 15 dias após o vencimento. Fechar a catraca de uma academia sem que o contrato preveja é a decisão técnica sem respaldo no documento que a autoriza. A cláusula existe para sustentar o que o sistema já faz |
| 4 | **Na LGPD, a academia é controladora e a RRB TRADING é operadora** | silêncio sobre o tema | é a repartição correta e a que protege a CONTRATADA: quem decide coletar biometria é a academia. A Cláusula 7.3 põe a coleta do consentimento no colo de quem decide, e a 9.3 registra que o sistema guarda versão e data do consentimento e mantém caminho alternativo — o que o ADR-008 e a regra de arquitetura nº 7 já fazem |
| 5 | **Entra limitação de responsabilidade** (Cláusula 11) | sem limitação | a catraca depende de energia, internet e equipamento de terceiro na academia. Sem a cláusula, "a catraca parou e eu perdi o dia" é problema da CONTRATADA |
| 6 | **Dados da CONTRATADA vêm de configuração**, não de literal no `contrato-pdf.service.ts` | constante no código | endereço e representante mudam por ato societário; trocar endereço não pode exigir deploy |
| 7 | **Sem integração com plataforma de assinatura eletrônica** — o fluxo é: gerar PDF → assinar fora → **subir o PDF assinado** de volta | ZapSign, Autentique, Clicksign, D4Sign por API | ver a seção abaixo |

### Assinatura: por que não integrar agora

A pergunta do PI foi se existe integração gratuita. A resposta honesta tem duas partes.

**Existe plano gratuito, e ele caberia.** ZapSign e Autentique oferecem faixa gratuita de cerca de
**5 documentos por mês**. O ArenaHub assina contrato com **tenant**, não com aluno: hoje é um
cliente, e a projeção realista é de poucos contratos por mês. O volume cabe na faixa gratuita — o
problema não é o preço.

**O problema é o custo de engenharia contra o benefício.** Integrar significa: contrato com terceiro
(este ADR), segredo de API em produção, webhook de retorno com idempotência por
`external_event_id` (regra de arquitetura nº 4), tratamento de recusa e expiração, e um fornecedor a
mais no caminho de um documento que o PI assina **um por mês**. Subir o PDF assinado é um campo,
um upload e um status — entrega o mesmo resultado (o documento assinado guardado junto do contrato)
por uma fração do custo, e não amarra o produto a ninguém.

**A API gov.br foi verificada e não serve:** a integração de assinatura avançada gov.br é destinada a
serviços públicos e exige integração prévia ao Login Único; não é caminho para um SaaS privado.

**Quando reabrir:** volume acima de ~5 contratos/mês, ou exigência de cliente por assinatura com
carimbo de tempo. Aí a decisão é comparar ZapSign e Autentique pelo que a faixa paga entrega, e
vira ADR novo. Enquanto isso, assinar pela interface gratuita do fornecedor e subir o PDF é o
caminho — e não é integração, é operação.

### Limite do que isto é

O texto das cláusulas foi **redigido pelo Cowork**, não por advogado, e o PI foi avisado disso. Ele
cobre o que um contrato de SaaS costuma cobrir e protege a CONTRATADA nos pontos que o produto
expõe — biometria, disponibilidade dependente de terceiro, titularidade do código. **Revisão
jurídica antes do primeiro uso real é lacuna registrada** (SPEC-070 §7, item 8), não é escopo
dispensado.

### O risco que o PI aceitou

A Cláusula 9 promete o que o produto **ainda não faz por inteiro**: o isolamento por RLS é F66/F67,
ainda em backlog, e não existe ferramenta de exportação de dados do tenant (Cláusula 8.4) nem de
eliminação. Assinar contrato com essas cláusulas antes de F66, F67 e da exportação existirem é
assumir obrigação a descoberto. **Não bloqueia a F70** — bloqueia prometer no papel o que não está
no ar, e a saída é a ordem: assinar contrato real depois da exportação existir, ou aceitar o risco
por escrito.

### Consequências normativas

- `CONVENTION.md` §5, linha `Contract`: o contrato do tenant ganha termos versionados; o contrato do
  **aluno** continua sendo a `Subscription`.
- **A F70 acrescenta colunas ao `Tenant`** (endereço, telefone, CPF do responsável) — a Especificação
  §9 já previa endereço e telefone; é dívida sendo paga, não campo novo de produto.
- ADR-053 §1 ganha respaldo contratual (Cláusula 5.2).
- Fatia: **F70** — contrato com cláusulas, qualificação das partes e assinatura (`SPEC-070`).

## ADR-056 — Consentimento self-service no app e exportação de saúde assíncrona (F26)

**Data:** 12/09/2026
**Status:** aceito *(decisão nova — **decidida pelo PI em 12/09/2026**)*
**Decisor:** Rodrigo Reis (PI)
**Contexto:** a issue #26 (F26, SPEC-026, Slice 4.4) citava tipos de consentimento (`TERMS`,
`PRIVACY`, `MARKETING`) que não existiam no enum `ConsentDocumentType` — só `BIOMETRIC`, `HEALTH`,
`AI_ANALYSIS`, `RANKING`, `CHALLENGE`, `ENGAGEMENT_PUSH`, `PHYSICAL_EVOLUTION_RANKING`. E o PRD
(§7, Slice 4.4) pede exportação do histórico de saúde "solicitada de forma assíncrona", enquanto o
`HealthExportService` (F18) era síncrono por decisão registrada no próprio cabeçalho do arquivo.

**Por que é ADR:** as duas mudanças são caras de desfazer. Expandir um enum de consentimento é
schema em produção que outros módulos já leem; reverter a exportação de assíncrono para síncrono
desfaria um contrato de API (`POST /health-exports` deixa de devolver o arquivo na resposta) que o
painel e o app passam a depender.

### Decisões

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | **`ConsentDocumentType` ganha `TERMS`, `PRIVACY`, `MARKETING`** | manter só os tipos que já existiam e a issue estava desatualizada | o PI confirmou que a issue é que estava certa — os tipos são novos, não erro de nomenclatura |
| 2 | **`HealthExportService` deixa de ser síncrono**: `solicitar` grava `DataExportJob` `PENDING` e devolve na hora; `processar` roda em background; o cliente consulta até `COMPLETED` e só então pede o link (`POST .../download`) | manter síncrono só para o painel e criar caminho assíncrono separado para o app | duas políticas de exportação para o mesmo dado dariam dois lugares para o expurgo e a auditoria divergirem. O PI escolheu unificar: painel e app entram pelo mesmo `HealthExportService`, mesma tabela `data_export_jobs`, mesmo padrão da F11 (`ExportsService`, disparo sem `await`) |
| 3 | **Consentimento self-service do app cobre `TERMS, PRIVACY, HEALTH, AI_ANALYSIS, MARKETING, RANKING` — não `BIOMETRIC`** | incluir biometria também | cadastro biométrico é presencial (F19), e revogar implica marcar exclusão física nos leitores (INV-018/INV-019) — fora do escopo desta fatia. Confirmado com o PI durante a implementação |

### Consequências

- `apps/api/src/modules/privacy/consent.repository.ts`: os métodos que só aceitavam o literal
  `'BIOMETRIC'` passam a aceitar qualquer `ConsentDocumentType`. O evento de timeline grava
  `BIOMETRIC_CONSENT_*` quando chamado sem `documentType` (compatibilidade com a F19) e
  `CONSENT_ACCEPTED`/`CONSENT_REVOKED` (novos, com o tipo no `payload`) quando chamado com um tipo
  explícito.
- `apps/api/src/modules/health/health-progress.controller.ts`: `POST /students/:id/health-exports`
  muda de contrato — não devolve mais `downloadUrl` na resposta. Ganha `GET /health-exports/:id` e
  `POST /health-exports/:id/download`. Snapshot OpenAPI regenerado
  (`packages/api-contracts/openapi/arenahub-v1.json`).
- Migração `20260912120000_f26_consentimentos_do_aluno`: `ALTER TYPE ... ADD VALUE` em statements
  separados (exigência do Postgres fora de transação) para os dois enums (`consent_document_type` e
  `student_timeline_event_type`).
- Fatia: **F26** (`SPEC-026`).

---

## ADR-057 — Primeiro acesso self-service por CPF + data de nascimento (F71)

**Data:** 15/09/2026
**Status:** aceito *(decisão nova — decidida e aprovada pelo PI em 15/09/2026)*
**Decisor:** Rodrigo Reis (PI)
**Fatia:** F71 (`SPEC-071`), issue [#333](https://github.com/RodReis/arenahub/issues/333)

**Contexto:** a F23 (`SPEC-023`, Slice 4.1) entregou ativação de conta por convite/token de uso
único enviado por e-mail (`M4-FR-001`) — é o único caminho de ativação em produção hoje, com login
por e-mail/telefone + senha. O PI pediu, em 15/09/2026, um segundo caminho de ativação, fiel a um
protótipo de telas: o aluno sem senha ainda informa CPF e data de nascimento, o sistema localiza o
cadastro e devolve nome, CPF, data de nascimento, plano, unidade e data de início formatados;
encontrado, libera dois campos para criar a senha; não encontrado, mostra mensagem única pedindo
para procurar a administração da academia. **Sem nenhuma etapa de e-mail** — confirmado
explicitamente pelo PI. Na mesma conversa, o PI corrigiu também a tela de login: o campo visível
deixa de ser "e-mail ou telefone" e passa a ser **CPF**.

**Por que é ADR:** introduz um segundo mecanismo de prova de identidade para criar credencial de
aluno, ao lado do que a F23 já entregou e já está em produção — não é ajuste de tela, é um caminho
novo de acesso que, uma vez comunicado a alunos, é caro de desfazer. E muda o identificador
principal do login recorrente (e-mail/telefone → CPF na UI), decisão que outra fatia e o suporte ao
aluno vão herdar. Fixa também um precedente de segurança da mesma família do ADR-045 (CPF como
parte de um mecanismo de autenticação/ativação, com risco de enumeração aceito conscientemente).

### Decisões

| # | decisão | por quê |
|---|---|---|
| 1 | **CPF + data de nascimento autenticam a CONSULTA, não abrem sessão.** Localizam o cadastro e liberam a tela de criação de senha; só a senha, uma vez criada, autentica dali em diante | separa prova de identidade (fraca, CPF+data) de credencial de longo prazo (senha) |
| 2 | **Risco aceito, sem throttling nem segundo fator nesta fatia.** CPF e data de nascimento não são segredo, e quem souber os dois de outro aluno consegue chegar primeiro à tela de criar senha daquela conta | PI confrontado com o risco de antecipação de conta e decidiu aceitar como está |
| 3 | **Mensagem única e neutra para qualquer falha de localização**, disciplina já usada nas ADR-024 e ADR-045 | antienumeração (`M4-FR-002`) |
| 4 | **O convite por e-mail da F23 não é revogado; os dois caminhos coexistem, e "Primeiro acesso" não tem nenhuma etapa de e-mail** | quem recebeu convite ativa por ele; quem não recebeu usa "Primeiro acesso" |
| 5 | **Se a mesma conta for ativada pelos dois caminhos em corrida**, o primeiro a definir a senha vence — o token de convite, se ainda não consumido, passa a apontar para uma conta já ativada e falha como "já ativada" ao ser usado depois | exclusão mútua na escrita, não numa leitura seguida de decisão (mesma disciplina de `consumirTokenEDefinirSenha`) |
| 6 | **A tela de login mostra só CPF; o backend continua aceitando e-mail/telefone por baixo** — retrocompatibilidade evita quebrar quem já ativou pela F23 antes desta fatia | protótipo corrigido pelo PI em 15/09/2026 |

### Gatilho de revisão

Qualquer indício de uso do "Primeiro acesso" para ativar conta de aluno diferente do que a
solicitou reabre a Decisão 2 — throttling e/ou segundo fator deixam de ser opcionais.

### Consequências

- `apps/api/src/modules/student-identity/dto/mobile-auth.dto.ts`: `loginDto` aceita `cpf` OU
  `identificador`, nunca os dois; novos `ativacaoConsultaDto`/`ativacaoSelfServiceDto`.
- `StudentAccountRepository.encontrarCandidatoParaAtivacao`: busca `Student` por `cpfHash` (nunca
  `cpf` em claro) + `birthDate`, escopada por tenant via `comContexto` (a rota é `@Public()`, sem
  `TenantRlsInterceptor` — o método abre o próprio escopo de RLS pelo tenant já resolvido do
  `tenantSlug`). `criarOuAtivarConta`: cria a conta (sem convite prévio) ou ativa uma `PENDING`
  por cima — exclusão mútua via `updateMany` condicionado + índice único de `studentId`.
  `encontrarPorIdentificador` (F23) fica como estava — CPF entra pelo mesmo campo `identifier`
  quando um self-service o grava ali.
- `StudentIdentityService.consultarAtivacao`/`confirmarAtivacao`: a consulta emite um
  `activationRef` — um token pré-auth de curta duração (`TokenService.emitirPreAuth`, mesmo
  mecanismo do desafio de MFA, novo `purpose: 'STUDENT_SELF_SERVICE_ACTIVATION'`) — em vez de uma
  linha nova em `student_account_tokens`: evita migração, e a mesma disciplina de expiração do MFA
  já resolve "curta duração, uso único de fato" (o `criarOuAtivarConta` fecha a corrida do lado do
  banco, não do token).
- Endpoints NOVOS, prefixo próprio `/api/v1/mobile/activation` (não `/auth`):
  `POST .../lookup` (consulta) e `POST .../self-service` (confirmação) — `StudentActivationController`.
- `POST /api/v1/mobile/auth/login` (F23): body aceita `cpf` como alternativa a `identificador`; a
  UI manda só `cpf`, o campo antigo continua funcionando por baixo.
- `docs/design/DS-APP.md` §3.1/§4.2/§5.5: campo de login muda de "e-mail/telefone" para "CPF";
  novo fluxo de dois passos na Folha para o primeiro acesso.
- `docs/CONVENTION.md` INV-012 ganha nota de exceção apontando para este ADR, igual ao padrão já
  usado para ADR-045/`M4-BR-004`.
- Fatia: **F71** (`SPEC-071`), issue #333 — ver `docs/STATUS.md` §5 (Índice Fatia ↔ SPEC).

---

## ADR-058 — Despachante de outbox como fatia própria; os nove eventos de notificação da §70 entram todos na primeira versão

**Data:** 16/09/2026
**Status:** aceito *(decisão nova — decidida e aprovada pelo PI em 16/09/2026)*
**Decisor:** Rodrigo Reis (PI)
**Fatia:** F73 (`SPEC-073`), issue [#343](https://github.com/RodReis/arenahub/issues/343)

**Contexto:** a auditoria de cobertura de 15/09/2026 achou que os nove eventos de notificação da
Especificação §70 (pagamento próximo, pagamento vencido, pagamento aprovado, plano renovado, plano
vencendo, meta atingida, nova avaliação, ranking atualizado, aluno ausente) não têm produtor —
busca literal por três termos diferentes, zero ocorrências fora da Especificação. A inbox do app
(`GET /mobile/avisos`, F29) nasce vazia por construção: nada escreve nela. O mesmo buraco atinge
duas coisas já entregues: `AssessmentPublished` e `HealthGoalReached` são declaradas **consumidas**
pelo `MVP-05` §12 (XP de avaliação +20, XP de meta +100) e **nunca produzidas** — o XP dessas duas
fontes nunca é creditado. E "notificações internas de eventos financeiros" está no **Incluído** do
`MVP-02` §6, dado por entregue sem nota sobre a lacuna. A peça que destravaria os três casos é o
despachante de outbox, cortado no ADR-047 decisão 8 sem destino.

**Por que é ADR:** cria infraestrutura compartilhada nova (despachante de outbox) que três
consumidores diferentes (XP, inbox de avisos, analytics §119) vão depender — decisão cara de
desfazer se cada produtor tivesse publicado direto e precisasse ser desmontado depois. E fecha uma
decisão de escopo de produto (quais dos nove eventos entram na v1) que o card `[INFRA]` #343
marcou explicitamente como bloqueante.

### Decisões

| # | decisão | por quê |
|---|---|---|
| 1 | **Os nove eventos da §70 entram todos na primeira versão**, não só os três de pagamento | decisão do PI — escopo completo de uma vez, em vez de fatiar por evento |
| 2 | **Despachante de outbox é fatia própria** (F73), não publicação direta por cada produtor | é pré-requisito de três consumidores (XP do MVP-05 §12, inbox §70, analytics §119); construir uma vez e os produtores plugam depois evita retrabalho quando os três casos vierem em sequência |
| 3 | **Canal é só in-app (inbox `GET /mobile/avisos` da F29) nesta fatia** — sem WhatsApp/e-mail | preenche a inbox que já existe e nasce vazia; canal externo fica para card separado, não bloqueia esta entrega |

### Consequências

- Nova fatia **F73** (`SPEC-073`) para o despachante de outbox: lê a tabela de outbox (transactional
  outbox já é regra de arquitetura, item 5 do `CLAUDE.md`) e publica nos três consumidores.
- `AssessmentPublished` e `HealthGoalReached` (já existentes) passam a ter produtor real assim que
  a F73 estiver de pé — o XP do MVP-05 §12 deixa de estar quebrado.
- Os nove eventos da §70 precisam de produtor cada um; a ordem de implementação entre eles fica a
  critério do Code (não é decisão de produto).
- Canal externo (WhatsApp/e-mail) fica fora de escopo — abre card `[INFRA]` ou spec própria quando
  o PI pedir.
- Fatia: **F73** (`SPEC-073`), issue #343 — ver `docs/STATUS.md` §5 (Índice Fatia ↔ SPEC).

---

## ADR-059 — Plano §34: aulas inclusas e convidados entram no MVP1; limite semanal, pausa com teto, fidelidade e multa seguem `[indefinido]`

**Data:** 18/09/2026
**Status:** aceito *(decisão nova — decidida pelo PI em 18/09/2026)*
**Decisor:** Rodrigo Reis (PI)
**Issue:** [#339](https://github.com/RodReis/arenahub/issues/339) — card de decisão, não de fatia

**Contexto:** a auditoria de cobertura de 15/09/2026 achou que seis das onze regras de plano da
Especificação §34 nunca ganharam campo, ADR ou nota de "fora de escopo": limite semanal de
acessos, aulas inclusas, convidados, pausa permitida + número de dias de pausa, fidelidade e multa
por quebra de fidelidade. `CONVENTION.md` (INV-059) já registrava isso com todas as letras: hoje
todo plano do ArenaHub é ilimitado, sem prazo mínimo e pausável à vontade por qualquer
recepcionista, e o contrato do aluno — de onde fidelidade e multa dependeriam — também não existe
como entidade. A pausa em particular está meio construída: `SUBSCRIPTION_PAUSED`/`RESUMED` já são
gravados pelo repositório e `POST /subscriptions/:id/pause` (`MVP-01` §12) já existe, mas sem tela
e sem teto de dias — a recepção segue cancelando em vez de pausar, o que já produz churn falso no
MVP 6.

**Por que é ADR:** mexe no schema de `Plan`, entidade central do MVP 1 já em produção com dado real
de tenant — campo novo aqui é migração, e desfazer depois de aluno ativo ter "aulas inclusas" ou
"convidados" preenchidos é caro. Fecha também a decisão de escopo de produto que o card `[INFRA]`
#339 marcou como bloqueante.

### Decisões

| # | regra da §34 | decisão | por quê |
|---|---|---|---|
| 1 | Limite semanal de acessos | **não entra** — segue `[indefinido]` | decisão do PI |
| 2 | Aulas inclusas | **entra no MVP1** | decisão do PI |
| 3 | Convidados | **entra no MVP1** | decisão do PI |
| 4 | Pausa permitida + número de dias de pausa | **não entra** — segue `[indefinido]`; mantém o estado atual (rota de pause/resume sem tela, sem teto de dias, recepção cancela em vez de pausar) | decisão do PI — as duas andam juntas |
| 5 | Fidelidade | **não entra agora** | depende do contrato do aluno, que também fica fora de escopo por ora |
| 6 | Multa por quebra de fidelidade | **não entra agora** | mesma dependência da decisão 5 |

**O que esta decisão não decide.** O PI decidiu **se** aulas inclusas e convidados entram, não
**como**. Cardinalidade, unidade de medida, se "convidado" é um número de passes ou um vínculo
nomeado, e a dependência ou não da entidade `Class` — que **não existe** (`CONVENTION.md` §5:
"sem entidade, agenda, professor ou reserva") — não foram decididos aqui e não são inventados por
este ADR. O **nome e o tipo do campo** em `Plan` são decisão de implementação do Code (`CLAUDE.md`,
*O que pode bloquear o desenvolvimento*), mas o **comportamento** que "aulas inclusas" e
"convidados" impõem é escopo de produto: se não estiver óbvio a partir desta decisão, volta a ser
pergunta ao PI antes da fatia que precisar dele.

### Consequências

- `CONVENTION.md` INV-059 e a linha "Aulas / `Class`" do §5 passam a citar este ADR: os dois itens
  saem de "sem campo, sem registro" para "confirmados no escopo do MVP1; campo e comportamento
  ainda não desenhados".
- `MVP-01-smart-access.md` ganha nota junto de `M1-FR-009` apontando para este ADR.
- Este ADR **não abre fatia**. `F<n>`/`SPEC-<nnn>` nascem quando o desenho do campo e do
  comportamento existir — até lá, #339 pode ser fechada pelo PI como decisão registrada, sem virar
  fatia.
- Limite semanal, pausa com teto de dias, fidelidade e multa continuam `[indefinido]` em
  `CONVENTION.md`, agora com a referência a este ADR — a decisão para elas foi "não entra agora",
  não "resolvido".

---

## ADR-060 — Desenho de convidados no plano (detalha o ADR-059): passe mensal com nome/CPF, acesso via `Entitlement.source=visitante`; aulas inclusas segue sem fatia

**Data:** 18/09/2026
**Status:** aceito *(decisão nova — decidida pelo PI em 18/09/2026)*
**Decisor:** Rodrigo Reis (PI)
**Issue:** [#339](https://github.com/RodReis/arenahub/issues/339)

**Contexto:** o [ADR-059](#adr-059) confirmou que aulas inclusas e convidados entram no MVP1, mas
deixou em aberto **como** — cardinalidade, unidade de medida, e se convidados depende de alguma
entidade nova. O Cowork levou três perguntas dirigidas ao PI para fechar esse "como".

### Decisões

| # | pergunta | decisão |
|---|---|---|
| 1 | Formato de "aulas inclusas" | **Vínculo com agenda/aula específica** — a opção que exige criar a entidade `Class` (agenda, professor, reserva), que hoje **não existe** (`CONVENTION.md` §5) |
| 2 | Formato de "convidados" | **Nº de passes por mês, com nome e CPF do convidado registrados** a cada uso — não é só um contador |
| 3 | Acesso do convidado na catraca | Reaproveita `Entitlement.source = visitante`, que **já existe** (INV-064) — nenhuma tabela de decisão de acesso nova |

### O que isto muda de tamanho — registrado, não só aceito

**Convidados** ficou com desenho suficiente para virar fatia agora: reaproveita infraestrutura que
já existe (`Entitlement.source=visitante`) e não depende de entidade nova — só de `Plan` ganhar o
limite mensal e de um registro de uso (nome, CPF, data, a assinatura a que se refere).

**Aulas inclusas** não. A opção escolhida — vínculo com agenda/aula específica — implica construir
do zero a entidade `Class`: agenda recorrente, atribuição de professor, capacidade/vagas, reserva
do aluno, política de cancelamento/no-show. Nenhum desses cinco pontos foi decidido, e não são
inventados por este ADR — abrir fatia hoje para "aulas inclusas" seria estimar sobre um desenho que
não existe. **Este ADR não aloca fatia para aulas inclusas.** Ela nasce depois de uma rodada de
decisão específica sobre o desenho de `Class` — recomendo isso como próximo card `[INFRA]`, decisão
do PI, não deste ADR.

### Consequências

- Fatia nova **F76** (`SPEC-076`) para convidados — sem Slice de PRD (nasce do ADR-059/060, mesmo
  regime de F49–F75 sem Slice). Ver `docs/STATUS.md` §5.
- `docs/specs/SPEC-076-convidados-no-plano.md` carrega o escopo completo (não há Slice para
  apontar), incluindo o registro explícito de que o critério de reset mensal (mês-calendário ou
  ciclo de cobrança da assinatura) **não foi decidido** e volta a ser pergunta ao PI antes da
  implementação — não é suposição do Code.
- Consentimento/base legal para o CPF do convidado **não é escopo desta fatia nem deste ADR** —
  `CLAUDE.md` já veda o Cowork de inventar exigência de LGPD, consentimento ou aceite duplo sem
  decisão explícita do PI, e nenhuma foi pedida aqui.
- `CONVENTION.md` §5 (linha "Aulas / `Class`") permanece como estava depois do ADR-059: escopo
  confirmado, entidade e comportamento ainda `[indefinido]` — este ADR não altera essa linha porque
  não resolveu o desenho de `Class`, só registrou que ele é necessário.
