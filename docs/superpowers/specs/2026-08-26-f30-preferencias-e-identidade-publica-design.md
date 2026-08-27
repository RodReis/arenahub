# F30 — Preferências e identidade pública · design

| campo | valor |
|---|---|
| **Fatia** | F30 · `SPEC-030` |
| **MVP** | 5 (Slice 5.1) |
| **Issue** | [#30](https://github.com/RodReis/arenahub/issues/30) |
| **Data** | 26/08/2026 |
| **ADR que esta fatia cria** | **ADR-046** — superfície no totem, gate do MVP 5 não se aplica, consentimento de ranking vira opt-out |

---

## 0. O que muda em relação ao que estava escrito

O plano de apoio de 14/08 (`docs/superpowers/plans/2026-08-14-mvp-05-01-preferences-public-identity.md`)
supunha um app mobile e um `StudentChannelContext`. **Nenhum dos dois existe**: `apps/mobile/`
tem um `.gitkeep` e nada mais, e o canal do aluno hoje é o totem. Quatro decisões do PI, tomadas
em 26/08/2026, redesenham a fatia:

1. **Superfície no totem, não no app.** O `apps/kiosk` já identifica o aluno e já traz
   `modulos.ranking` no contrato de configuração, desligado por padrão — a F50 reservou o lugar.
   Vira **ADR-046**, porque contraria o texto da Slice 5.1 e o gate do MVP 5.
2. **Alias livre com moderação**, com fila própria no `admin-web`.
3. **As quatro finalidades modeladas**, duas dormentes (`CHALLENGE`, `ENGAGEMENT_PUSH`).
4. **O consentimento de ranking caiu** — alunos já aceitos e autorizados. O regime vira
   **opt-out**: participa por padrão, sai quem pedir.

A decisão 4 esvazia o aceite escrito da Slice 5.1 (*"aluno não consentido nunca aparece"*):
não há mais "não consentido". O aceite é **emendado** pelo ADR-046 para *"aluno que pediu para
sair nunca aparece, a partir da próxima projeção"*.

## 1. Abordagem — consentimento estendido, não tabela paralela

`ConsentDocumentType` ganha `RANKING`, `CHALLENGE`, `ENGAGEMENT_PUSH` e
`PHYSICAL_EVOLUTION_RANKING`. A preferência do aluno **é** um `ConsentRecord`.

Motivo: `ConsentRecord` já é append-only, já revoga por linha nova com `supersededAt`, já
guarda ator/IP/user-agent, e já tem repositório e domínio puro testados
(`apps/api/src/modules/privacy/`). Criar `EngagementPreferenceReceipt` ao lado — como o plano
de 14/08 pedia — duplicaria essa invariante e criaria duas verdades sobre o que o aluno
consentiu.

Alternativas descartadas: tabela própria de preferências (duplica o append-only) e híbrida
(dois modelos pagando por um, com o lado do consentimento quase vazio depois da decisão 4).

### 1.1 A inversão de regime — o ponto perigoso desta fatia

Na mesma tabela, duas leituras opostas da ausência de linha:

| regime | ausência de `ConsentRecord` significa |
|---|---|
| biometria, saúde, IA | **não autorizado** |
| engajamento (esta fatia) | **participa** |

Predicado próprio, com o aviso no código:

```ts
// apps/api/src/modules/engagement/domain/participacao.ts
//
// Ausencia de linha significa PARTICIPA -- o oposto de `avaliarConsentimento`
// (biometria), onde ausencia significa NAO AUTORIZADO. Nao unifique as duas:
// a diferenca e de regime, nao de implementacao.
export function participaDoRanking(decisao: DecisaoRegistrada | null): boolean;
```

**Não reusa `avaliarConsentimento()`.** Um predicado servindo aos dois regimes passaria verde
enquanto nenhum teste misturasse os casos — o defeito que
`comentario-avisa-e-codigo-repete` registra. Teste explícito nas duas direções, mais um teste
que falha se o default for invertido.

## 2. Modelo de dados

### 2.1 Aditivo ao enum

`ConsentDocumentType` += quatro valores. Enum do Postgres aceita valor novo sem tocar em linha
existente. As dormentes nascem sem documento publicado e sem consumidor; existem para que
F31–F35 não precisem de migration.

### 2.2 `PublicProfile` (tabela nova)

Uma linha por `(tenantId, studentId)`.

| campo | por quê |
|---|---|
| `alias` | texto livre escolhido pelo aluno |
| `aliasNormalized` | forma canônica: Unicode NFKC, minúsculo, sem espaço invisível |
| `status` | `PENDING` · `APPROVED` · `REJECTED` · `HIDDEN` |
| `rejectionReason` | razão categorizada (enum), nunca texto livre |
| `moderatedBy` / `moderatedAt` | quem decidiu e quando |
| `version` | compare-and-swap contra edição concorrente |

**Unicidade em índice parcial** — `(tenantId, aliasNormalized)` apenas sobre `APPROVED`. Dois
alunos podem ter o mesmo alias pendente; só um chega a aparecer. Índice total recusaria o
segundo pedido legítimo antes de qualquer moderador olhar
(`indice-parcial-erra-a-cardinalidade`).

### 2.3 Como o aluno aparece

Ordem de resolução: `APPROVED` → o alias · qualquer outro estado → primeiro nome · optou por
anônimo → `"Participante"`. **Alias em moderação nunca vaza.**

### 2.4 O que NÃO entra no modelo

Sem tombstone e sem porta de invalidação de cache (o plano de 14/08 pedia ambos): não há cache
de ranking, porque não há ranking — a F30 decide quem pode aparecer, a F33 calcula posição.
Abstração de uso único.

## 3. Política de exposição — o ponto único

```ts
// apps/api/src/modules/engagement/domain/exposicao.ts
export type Exposicao =
  | { exibe: true; nome: string }
  | { exibe: false; motivo: 'OPT_OUT' | 'ALUNO_INATIVO' };

export function resolverExposicao(entrada: {
  decisao: DecisaoRegistrada | null;   // ausencia = participa
  perfil: PerfilPublico | null;
  primeiroNome: string;
  statusDoAluno: StudentStatus;
}): Exposicao;
```

Pura: sem banco, sem relógio. É ela que dá substância ao aceite emendado — quem quiser expor um
aluno sem chamá-la tem de escrever o nome na mão, e isso aparece em revisão.

`StudentStatus` entra porque aluno cancelado no telão do saguão é vazamento com outro nome: a
base legada do Pacto tem 1.926 `CANCELLED` (F47).

## 4. Casos de uso

Em `apps/api/src/modules/engagement/`:

| caso de uso | o quê |
|---|---|
| `ObterPreferencias` | lê as quatro finalidades + perfil público do aluno da sessão |
| `AtualizarPreferencia` | grava `ConsentRecord` (`REFUSED` = sair, `ACCEPTED` = voltar) e põe `supersededAt` na linha anterior, na mesma transação |
| `DefinirAliasPublico` | cria/edita `PublicProfile`, sempre volta a `PENDING`, compare-and-swap por `version` |
| `ModerarAlias` | `APPROVED`/`REJECTED`/`HIDDEN` + razão categorizada; ator é usuário do painel |

**Idempotência:** `AtualizarPreferencia` recebe `Idempotency-Key`; repetir é no-op, não par de
linhas contraditórias. Mesmo padrão de `consent.repository.ts`.

### 4.1 Triagem de alias

Função pura, sem serviço externo: normalização NFKC, corte de espaço invisível e caractere de
controle, rejeição de padrão de PII (e-mail, telefone, CPF), comprimento, lista de bloqueio do
tenant.

**Ela classifica, não pune.** Tudo vira `PENDING`; a triagem anexa códigos de sinal para o
moderador. Alias limpo também espera aprovação — senão o filtro vira a moderação, e filtro se
contorna. Sem screening por IA: não foi pedido, e há humano na fila por decisão do PI.

### 4.2 Sem outbox

O plano de 14/08 publicava `EngagementOptedOut`. Ninguém consome — quem consumiria é a F33, que
não existe. A Regra de arquitetura 5 obriga o evento a ser persistido na mesma transação da
mudança de estado; não obriga a inventar evento sem consumidor. Quando a F33 chegar, ela lê o
estado ou o evento nasce ali.

## 5. Superfícies

### 5.1 Totem (`apps/kiosk`)

Módulo `ranking` — já existe no contrato, desligado por padrão. Duas telas na área do aluno,
atrás de `KioskAreaDoAlunoService.resolver()`: mesmo canal de pagamento e saúde, mesma amarra
(`studentId` da sessão, nunca da URL; módulo desligado responde 404).

- **Minhas preferências** — `RANKING` como interruptor *"aparecer no ranking"*, **ligado por
  padrão** (a inversão, visível ao aluno). `CHALLENGE` e `ENGAGEMENT_PUSH` não aparecem
  enquanto dormentes: interruptor que não faz nada é pior que ausência.
- **Meu nome no ranking** — primeiro nome · apelido · anônimo. Apelido digitado mostra
  *"em análise"*; até aprovar, vale o primeiro nome.

Sessão efêmera, teclado na tela, alvo de toque grande. Tudo lido dos tokens (`DS-TOTEM.md`).

### 5.2 Painel (`apps/admin-web`)

Rota `(protected)/engagement/aliases`: fila de `PENDING`, aprovar/rejeitar com razão
categorizada, busca nos já moderados. O moderador **não edita** o alias — julga o que o aluno
escreveu.

### 5.3 Rotas

```
GET   /api/v1/kiosk/sessoes/:id/engajamento/preferencias
PATCH /api/v1/kiosk/sessoes/:id/engajamento/preferencias
PATCH /api/v1/kiosk/sessoes/:id/engajamento/perfil-publico
GET   /api/v1/engagement/aliases            (painel)
PATCH /api/v1/engagement/aliases/:id        (painel)
```

## 6. Testes

Piso: `dev`, `lint`, `test`, `test:integration`, `build` verdes, mais `pnpm test:report`
(`pnpm test` não roda integração).

Com nome próprio:

- **A inversão** — ausência de linha = participa, e um teste que **falha** se o default for
  invertido. É o defeito mais caro desta fatia.
- **Os dois regimes na mesma tabela** — biometria e engajamento no mesmo caso, provando que não
  se contaminam. Sem isso a suíte passa pelo motivo errado.
- **Índice parcial** — dois `PENDING` com mesmo alias entram; o segundo `APPROVED` é recusado.
- **Alias** — Unicode, homógrafo, espaço invisível, PII; e que pendente nunca vaza na exposição.
- **Isolamento de tenant e de sessão** — sessão de um aluno não lê nem escreve preferência de
  outro.
- **Idempotência** — mesma `Idempotency-Key` não cria segunda linha.

Integração contra o Postgres local, banco próprio da suíte (não Testcontainers).

## 7. Escopo negativo

Deliberadamente fora, e para onde foi:

| fora | onde entra |
|---|---|
| cálculo de ranking, snapshots, desempate | F33 (Slice 5.4) |
| XP, ledger, conquistas | F31/F32 (Slices 5.2/5.3) |
| desafios | F34 (Slice 5.5) |
| push e notificação | não há app; MVP 4 |
| qualquer tela em `apps/mobile` | MVP 4 |
| outbox de engajamento | F33, quando houver consumidor |
| cache de exposição e invalidação | F33, quando houver snapshot |
| screening de alias por IA | não pedido |

## 8. Invariantes tocadas

A preencher na implementação, conforme `docs/REVIEW.md` §3 — cada `INV-nnn` de
`docs/CONVENTION.md` §4 que o código tocar precisa de teste. Candidatas: INV-021
(imutabilidade da decisão de consentimento) e a regra de `tenant_id` em toda entidade de
negócio.

## 9. Documentos a atualizar na entrega

`docs/DECISIONS.md` (ADR-046), `docs/STATUS.md`, `docs/DEVELOPMENT.md`, `docs/TESTING.md`,
`docs/CONVENTION.md` (finalidades de consentimento e `PublicProfile`) e a `SPEC-030` (§2, §3,
§4 e §5).
