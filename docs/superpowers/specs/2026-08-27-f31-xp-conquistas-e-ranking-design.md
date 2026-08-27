# F31 — XP, conquistas e ranking mensal

| campo | valor |
|---|---|
| **Fatia** | F31 (absorve o escopo da F33) |
| **SPEC** | `SPEC-031` — e `SPEC-033`, absorvida |
| **MVP** | 5 |
| **Slices do PRD** | **5.2** e **5.4** — `docs/prd/academia/MVP-05-engagement.md` §7 |
| **ADR desta fatia** | ADR-047 |
| **Data** | 27/08/2026 |

## 1. O que esta fatia entrega

Um aluno treina, a catraca confirma a passagem, e isso vira ponto. O ponto vira
saldo do mês, conquista de marco e posição num placar que a academia inteira vê
na recepção. Nada disso pode ser inventado, duplicado ou reescrito depois.

Três entregas, uma cadeia só:

1. **Ledger de XP append-only** — toda concessão carrega o fato que a originou e
   a versão da regra que a calculou. Correção é movimento novo vinculado, nunca
   `UPDATE`.
2. **Conquistas verificadas** — desbloqueio sai de evidência no ledger, nunca de
   alegação do cliente. Reversão mantém o desbloqueio original e anexa o motivo.
3. **Ranking mensal publicado** — snapshot imutável por unidade e mês, com coorte
   mínima, desempate determinístico e exposição reavaliada em toda leitura.

## 2. Decisões que moldam o desenho

### 2.1 A fatia roda antes do gate do MVP 5 (ADR-047, Decisão 1)

O gate do MVP 5 pede *"eventos confiáveis + app do MVP 4"*. O app não existe
(`apps/mobile/` tem um `.gitkeep`), mas o totem existe e identifica o aluno por
CPF desde a F49. Os eventos de frequência existem e são confiáveis: a F24
entregou `StudentAttendanceSession`, com dia local da unidade, política
versionada e unicidade no banco.

A superfície é o totem, pelo mesmo argumento que o ADR-046 aceitou para a F30.

### 2.2 F31 absorve a F33 (ADR-047, Decisão 2)

Decisão do PI em 27/08/2026: o ranking aparece **junto** com o XP — na área
pública do totem (placar geral da academia) e na conta individual do aluno
(a posição dele). `SPEC-033` é absorvida; a numeração `F33`/`SPEC-033` fica
**queimada**, não reaproveitada.

Motivo do PI: XP privado sem placar não entrega o que a academia quer ver, e
partir em duas fatias adiaria metade do valor sem reduzir risco.

### 2.3 XP existe mesmo para quem saiu do ranking

`M5-BR-002`: recusar o ranking não reduz funcionalidade nem XP. O opt-out da F30
governa **aparecer**, não **pontuar**. Um aluno em opt-out acumula XP, vê o saldo
dele e desbloqueia conquistas — só não entra no placar.

Isto é uma armadilha real: amarrar a concessão de XP a `resolverExposicao()`
pareceria coerente e inverteria a regra em silêncio. Os dois caminhos ficam
separados de propósito, como `participacao.ts` e `consentimento.ts` já ficam.

### 2.4 Sem fila, sem worker — projeção sob demanda

Os planos de apoio de 14/08 presumem BullMQ, workers e um despachante de outbox.
Nenhum existe nesta base em 27/08/2026: `OutboxEvent` é tabela sem consumidor.

O padrão vigente é o da F24 — projetar sob demanda, gravar idempotente. É o que
esta fatia segue. `XPGranted`, `AchievementUnlocked` e `RankingPublished` são
gravados no outbox na mesma transação da mudança de estado (regra de arquitetura
5); o despacho fica para quem construir o despachante.

Consequência aceita: o XP aparece quando o aluno abre a conta, não no instante do
giro da catraca. Aceitável porque não há notificação nesta fatia — e o placar é
recalculado na publicação, não a cada passagem.

### 2.5 Catálogo v1 proposto pelo Code (ADR-047, Decisão 3)

`M5-RULES-01` pede catálogo aprovado por profissional. Decisão do PI em
27/08/2026: não bloqueia, mesmo caminho do `M3-CLINICAL-01` (ADR-035). O Code
propõe o v1; o PI revisa os números depois, e trocar valor é **versão nova de
regra**, não migration.

## 3. Arquitetura

### 3.1 Domínio puro

Em `apps/api/src/modules/engagement/domain/`, sem banco, sem rede, sem relógio —
o "agora" entra por parâmetro:

| arquivo | responsabilidade |
|---|---|
| `regra-de-xp.ts` | interpretador declarativo; resolve a versão vigente em `occurredAt` |
| `movimento-de-xp.ts` | `GRANT`/`ADJUSTMENT`/`REVERSAL`; exige origem e versão de regra |
| `conquista.ts` | critério declarativo contra evidência do ledger |
| `classificacao.ts` | ordenação e desempate determinístico |
| `exposicao.ts` | **já existe (F30)** — reuso direto, não reimplementação |

**O interpretador não executa expressão.** Uma regra é dado:
`{ gatilho: 'SESSAO_CONFIRMADA', pontos: 10 }`. Gatilho é enum com allowlist.
Não há `eval`, não há SQL, não há string executável — item 4 do `M5-RULES-01`,
fechado por construção e não por revisão.

### 3.2 Módulo

O módulo `engagement` existente é estendido, não partido em três. XP, conquista e
ranking são o mesmo domínio lendo o mesmo ledger; a regra de arquitetura 9 fala
de **tabela privada de outro módulo**, e não há outro módulo aqui.

Serviços por assunto: `EngagementXpService`, `EngagementRankingService`. O
consumo pelo totem passa por `KioskXpService`, como `KioskEngajamentoService` já
faz — o kiosk nunca lê tabela de engajamento direto.

### 3.3 A fonte do fato

XP de treino nasce de `StudentAttendanceSession`, a projeção da F24. Ela já
resolve, no banco e não num `if`:

- dia local **da unidade**, com política versionada (`dia-civil-local@1`);
- uma sessão por `(tenant, aluno, dia, unidade, política)`;
- só passagem `CONFIRMED` com `outcome = ALLOW` e aluno resolvido.

`M5-BR-003` ("no máximo uma sessão elegível por janela diária") e `M5-BR-004`
("entrada sem passagem confirmada não gera XP") saem de graça: o XP **lê** a
sessão, não recalcula fuso nem reimplementa deduplicação. Duas linhas de defesa
divergem; uma não.

## 4. Modelo de dados

### 4.1 `XpRuleVersion`

Catálogo versionado. `@@unique([tenantId, code, version])`, `effectiveFrom`,
`effectiveTo`, `trigger` (enum), `points` (Int), `status`.

Regra alterada é **linha nova** (`M5-BR-009`). A resolução usa `occurredAt` do
fato, nunca o relógio do processo: um evento atrasado é pontuado pela regra que
valia quando o aluno treinou.

### 4.2 `XpLedgerEntry` — append-only

`type GRANT|ADJUSTMENT|REVERSAL`, `points`, `ruleVersionId`, `sourceKind`,
`sourceId`, `reversesEntryId`, `occurredAt` (data do **fato**), `localMonth`.

```
@@unique([tenantId, studentId, sourceKind, sourceId, ruleVersionId, type])
```

É esta chave que garante `M5-AC-002`. Cem replays colidem na mesma linha; a
violação de unicidade é tratada como **sucesso idempotente**, não como erro que
alimenta retry infinito. Idempotência em índice, não em `if` — guarda que lê
antes de escrever perde a corrida por construção, como F14, F17 e F18 já
custaram nesta base.

`localMonth` (`AAAA-MM` da unidade) é materializado na escrita e indexado. É o
recorte que o placar agrupa sem varrer o ledger nem reconverter fuso na leitura —
o erro clássico que a F24 documenta.

### 4.3 `StudentXpBalance` — projeção

`@@unique([tenantId, studentId, localMonth])`, `points`, `entryCount`,
`rebuiltAt`. Apagar e reconstruir do ledger tem de produzir o mesmo número
(`M5-NFR-002`), e isso é teste, não promessa.

### 4.4 `AchievementDefinitionVersion` e `StudentAchievement`

Definição versionada com critério declarativo
(`{ tipo: 'SESSOES_ACUMULADAS', limiar: 10 }`).

`StudentAchievement` tem `status UNLOCKED|REVERSED`, `unlockedAt`,
`evidenceEntryId` (o movimento do ledger que provou) e `reversedReason`.
Reversão **não apaga**: muda o estado e vincula o motivo, como
`AccessEventCorrection` já faz no MVP 1. `@@unique([tenantId, studentId,
definitionVersionId])`.

### 4.5 `RankingSnapshot` e `RankingEntry`

Snapshot: tenant, unidade, `localMonth`, `minimumCohort`, `eligibleCount`,
`status DRAFT|PUBLISHED|WITHHELD`, `publishedAt`. Publicado é **imutável**
(`M5-AC-007`).

Entry: posição, `studentId`, `points`.

**O ponto onde errar sairia caro.** `RankingEntry` guarda `studentId` para
auditoria, mas o DTO público **nunca** o devolve, e o nome não é gravado na
materialização — ele sai de `resolverExposicao()` **em toda leitura**.

Motivo: o aluno que pede opt-out depois da publicação precisa sumir da próxima
leitura (`M5-FR-003`, `M5-NFR-003` — 15 minutos) sem que ninguém reescreva um
snapshot que é imutável por definição. O snapshot congela **pontuação**; a
exposição é decidida **agora**. Gravar o nome na entrada faria as duas coisas
colidirem, e a que perderia seria a privacidade.

### 4.6 Coorte mínima

`5`, configurável por tenant — não constante espalhada no cálculo.
`eligibleCount < 5` → snapshot `WITHHELD`: o hero não mostra placar, e a conta
individual continua mostrando o XP do aluno (`M5-BR-007`).

## 5. Fluxo de concessão

```
aluno abre a conta no totem
  → lê StudentAttendanceSession do mês (política vigente)
  → para cada sessão sem movimento: resolve XpRuleVersion em sessionDate
  → grava GRANT + OutboxEvent(XPGranted) numa transação
  → recalcula StudentXpBalance do mês
  → avalia conquistas contra o ledger
```

Colisão de unicidade encerra o passo com sucesso. Duas abas, dois totens, replay
de rede: uma linha.

## 6. Catálogo v1

| regra | gatilho | pontos |
|---|---|---|
| `treino-diario@1` | `SESSAO_CONFIRMADA` | 10 |

| conquista | critério |
|---|---|
| `primeiro-treino@1` | 1 sessão acumulada |
| `dez-treinos@1` | 10 sessões acumuladas |
| `cinquenta-treinos@1` | 50 sessões acumuladas |
| `cem-treinos@1` | 100 sessões acumuladas |

Nenhuma regra premia passagem repetida no mesmo dia — item 3 do `M5-RULES-01`,
garantido pela tabela de sessão e não por contagem no código.

## 7. Ranking mensal

Ordena `StudentXpBalance` do `localMonth` corrente, por unidade.

**Desempate determinístico e publicado** (`M5-BR-008` — nunca sorteio):

1. mais XP;
2. quem atingiu primeiro (`occurredAt` do último movimento, ascendente);
3. `studentId`, como último critério estável.

Executar duas vezes sobre o mesmo conjunto produz a mesma ordem, inclusive com a
entrada embaralhada. É teste.

## 8. Superfícies

### 8.1 Hero público do totem

Bloco novo `RANKING` no rodízio de `blocos-publicos.tsx`.

**A trava estrutural da F51 continua de pé.** Aquele arquivo declara que nenhum
dado de aluno chega até ele e que a tela pública não fala com a rede. O placar
respeita as duas: chega **pelo heartbeat**, com os nomes **já resolvidos por
`resolverExposicao()` no servidor**. A tela não ganha `fetch`, não importa
`SessaoDoAluno`, e não recebe `studentId`.

`WITHHELD` ou módulo desligado → o bloco sai do rodízio. Não aparece cinza, não
aparece vazio.

### 8.2 Conta do aluno

Card novo na grade de `modulos.ts`, tela `components/xp.tsx`:

- saldo do mês;
- **de onde veio cada ponto** — regra e data, em português (`M5-FR-004` e §13 do
  PRD: "sempre mostrar por que o aluno recebeu XP");
- conquistas, incluindo as revertidas com o motivo;
- a posição dele no placar.

Sem linguagem financeira (`M5-BR-010`: XP não tem valor e não se transfere), sem
culpa, sem exibir medida de terceiro.

### 8.3 Painel

Publicar e reter snapshot; ver o que mudou. **Sem edição de entrada** — correção
é movimento compensatório com motivo e permissão (`M5-FR-007`, `M5-AC-010`).

## 9. Testes que provam o aceite

| teste | prova |
|---|---|
| 100 concessões concorrentes reais no Postgres → 1 linha | `M5-AC-002` |
| duas passagens no mesmo dia → 1 sessão → 1 `GRANT` | `M5-AC-003` |
| regra nova não altera snapshot publicado | `M5-AC-007` |
| categoria com 4 participantes não publica | `M5-AC-006` |
| aluno em opt-out **ganha XP e vê o dele**, mas não entra no placar | `M5-BR-002` |
| opt-out após publicação → some da leitura seguinte, snapshot intacto | `M5-AC-009` |
| apaga a projeção, reconstrói do ledger, mesmo saldo | `M5-NFR-002` |
| ordem repetida com entrada embaralhada → mesma classificação | `M5-BR-008` |
| DTO público não contém `studentId` nem nome civil | `M5-AC-001` |

A concorrência vai a teste de integração contra o Postgres, não a unitário com
dublê: a memória `revisao-adversarial-acha-corrida` registra três versões erradas
do mesmo teste na F17, e `duble-esconde-ato-errado` registra o dublê que devolvia
o id certo pelo motivo errado.

## 10. Escopo negativo

| fora | para onde foi |
|---|---|
| desafios e notificações | F34 |
| disputa, moderação de XP e recurso | F35 |
| ranking de evolução física relativa | F35 — exige `PHYSICAL_EVOLUTION_RANKING`, dormente desde a F30 |
| tela em `apps/mobile` | não existe; entra quando o MVP 4 existir |
| BullMQ, worker, despachante de outbox | primeiro consumidor que precisar |
| streak semanal | F32 |

## 11. Invariantes tocadas

`INV-003` (contexto de tenant obrigatório no repositório), `INV-153` a `INV-155`
(exposição pública — F30). Os novos, numerados na implementação, cobrem
append-only do ledger, imutabilidade do snapshot publicado e determinismo do
desempate.
