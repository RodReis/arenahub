# Evidência — SPEC-007 / F7 · Aluno, plano e entitlement manual

> **Documento de evidência da fatia**, exigido pela Task 7 do plano de apoio
> (`docs/superpowers/plans/2026-08-14-mvp-01-02-students-entitlements.md`).
>
> Os números abaixo vieram de **execução**, não de prosa (`docs/TESTING.md` §5). Data e SHA
> ficam no log do CI e no histórico do Git — gravá-los aqui tornaria o arquivo impossível de
> manter conferido.

## 1. Ambiente de verificação

| item | valor |
|---|---|
| PostgreSQL | 17.10 (`postgres:17-alpine`, `infra/docker/docker-compose.yml`) |
| Node local | v24.15.0 — **acima do pin do repositório** (`.nvmrc` = 22) |
| Node no CI | 22, via `.nvmrc` |
| Prisma | 7.9.1, driver adapter `@prisma/adapter-pg` |
| NestJS | 11.2.0 · Zod 4.4.3 · Jest 29.7.0 · **fast-check 4.9.0** (novo nesta fatia) |

> ⚠️ A divergência de runtime local × CI continua valendo, com a mesma decisão do PI de
> 15/08/2026: **o CI é o árbitro** antes do merge.

## 2. Suítes e contagem

| suíte | comando | antes de F7 | depois |
|---|---|---|---|
| unitário — API | `pnpm --filter @arenahub/api test` | 42 | **119** |
| unitário — painel | `pnpm --filter @arenahub/admin-web test` | 2 | 2 |
| integração — API | `pnpm --filter @arenahub/api test:integration` | 58 | **87** |
| integração — banco | `pnpm --filter @arenahub/database test:integration` | 11 | 11 |
| E2E — painel | `pnpm --filter @arenahub/admin-web test:e2e` | 10 | 10 |
| | **total** | 123 | **229** |

**106 testes novos:** 77 unitários (dos quais **6 são propriedades** do fast-check, com 2.800
casos gerados) e 29 de integração.

## 3. Gate completo

Os oito comandos raiz, na ordem do `docs/TESTING.md` §6:

| comando | resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ 5 tasks |
| `pnpm typecheck` | ✅ 6 tasks |
| `pnpm test` | ✅ 238 testes (API 119 + edge-agent 119) |
| `pnpm test:integration` | ✅ 87 testes, 7 suítes |
| `pnpm build` | ✅ 4 tasks |
| `pnpm test:e2e` | ✅ 10 testes |
| `pnpm test:report --check` | ✅ relatório confere com a execução |

## 4. Rastreabilidade de requisitos

| requisito | como é verificado |
|---|---|
| `M1-FR-006` cadastrar aluno com validação e detecção de duplicidade | `students-membership.int-spec.ts` → *"aponta duplicata por CPF sem impedir o cadastro"*, *"recusa CPF com digito verificador invalido"* |
| `M1-FR-007` matrícula única e imutável no tenant | `students-membership.int-spec.ts` → *"gera matricula unica e sequencial sob 20 criacoes concorrentes"*, *"mantem contadores independentes por tenant"* |
| `M1-FR-008` arquivar preservando histórico e bloqueando acesso | `students-membership.int-spec.ts` → *"arquiva suspendendo entitlements e preservando a timeline"*, *"recusa nova assinatura para aluno arquivado"* |
| `M1-FR-009` plano com unidades, dias, horários e validade | `plan.spec.ts` (31 testes) + `students-membership.int-spec.ts` → *"recusa janelas sobrepostas"*, *"recusa janela apontando para unidade fora do plano"* |
| `M1-FR-010` criar, pausar, retomar e cancelar com auditoria | `students-membership.int-spec.ts` → *"pausa e retoma propagando ao entitlement"*, *"cancela revogando o entitlement"*, *"exige razao em toda alteracao de assinatura"* |
| `M1-FR-011` derivar entitlement explícito da assinatura e do plano | `students-membership.int-spec.ts` → *"deriva entitlement da assinatura na mesma transacao, com snapshot"* |
| `M1-FR-012` cortesia com razão, responsável e validade | `students-membership.int-spec.ts` → *"concede cortesia com razao e responsavel, sem assinatura"*, *"recusa cortesia sem razao"* |
| `M1-BR-001` CPF não é matrícula nem ID técnico | `identificacao.spec.ts` → *"nao contem nenhum trecho do CPF"* · `students-membership.int-spec.ts` → *"nao usa o CPF na matricula"* |
| `M1-BR-002` aluno `BLOCKED`/`CANCELLED`/`ARCHIVED` sem acesso normal | `entitlement.spec.ts` → *"nega para aluno BLOCKED, CANCELLED ou ARCHIVED..."* · propriedade *"aluno BLOCKED, CANCELLED ou ARCHIVED nunca e efetivo"* |
| `M1-BR-003` acesso depende de entitlement, não de assinatura | **Verificado por ausência de dependência**: `entitlement.ts` não importa `Subscription`. Ver §6 |
| `M1-BR-006` a política mais restritiva prevalece | `plan.spec.ts` → bloco *"interseccaoDeJanelas"* · propriedade *"interseccao de janelas nunca permite o que uma das partes nega"* |
| `M1-BR-010` exclusão administrativa é arquivamento | `student.spec.ts` → *"trata ARCHIVED como terminal"* · integração → *"arquiva suspendendo entitlements e preservando a timeline"* |

### `M1-AC-002` e `M1-AC-003`

O plano de apoio (Task 7 passo 3) manda mapear `M1-AC-002` e `M1-AC-003`. **Ambos exigem a
interface de recepção**, que é a Task 6 e **não faz parte deste PR** — ver §7. O aceite da
Slice 1.2 (*"recepção cadastra aluno, atribui plano e visualiza exatamente quando e onde o
acesso é válido"*) está coberto **pela API** (a resposta de `POST /api/v1/subscriptions` devolve
o entitlement com unidades e janelas), e **não pela tela**. Declarar o AC fechado hoje seria
fechamento frágil.

## 5. Invariantes tocados

Conforme `docs/REVIEW.md` §3, cada invariante tocado precisa de teste.

| invariante | teste |
|---|---|
| **INV-003** repositório recebe `TenantContext` obrigatório | Estrutural: todo método de `StudentRepository` e `MembershipRepository` tem `TenantContext` como primeiro parâmetro — não compila sem |
| **INV-006** tenant A não lê nem altera dado de B | `students-membership.int-spec.ts` → bloco *"isolamento entre tenants"* (4 testes) |
| **INV-009 / INV-011** matrícula nunca depende do CPF | `identificacao.spec.ts` → *"nao contem nenhum trecho do CPF"* |
| **INV-010** matrícula única e imutável no tenant | `@@unique([tenantId, membershipNumber])` + teste de 20 criações concorrentes |
| **INV-013** arquivar preserva histórico e bloqueia acesso | integração → *"arquiva suspendendo entitlements e preservando a timeline"* |
| **INV-014** cadastro detecta possível duplicidade | integração → *"aponta duplicata por CPF sem impedir o cadastro"* |
| **INV-015** soft delete não libera unicidade | A linha permanece; a constraint continua valendo. Coberto por INV-010 |
| **INV-033** `BLOCKED`/`CANCELLED`/`ARCHIVED` sem acesso normal | `entitlement.spec.ts` + propriedade dedicada |
| **INV-034** regra mais restritiva prevalece | `plan.spec.ts` + propriedade *"interseccao de janelas..."* |
| **INV-035** **entitlement expirado nunca retorna `ALLOW`** | `entitlement.spec.ts` → *"nega direito vencido mesmo com status ACTIVE (job de expiracao atrasado)"* · **propriedade** *"direito vencido nunca e efetivo, seja qual for o status gravado"* (500 casos) |
| **INV-059** regras `[indefinido]` do plano não são inventadas | Estrutural: `Plan` só tem unidades, dias, horários e validade. Sem campo para limite semanal, fidelidade ou multa |
| **INV-060** plano com unidades, dias, horários e validade | `plan.spec.ts` (31 testes) |
| **INV-061** assinatura manual com auditoria | integração → *"exige razao em toda alteracao de assinatura"* + `AuditLog` em cada comando |
| **INV-062** entitlement derivado explicitamente | integração → *"deriva entitlement da assinatura na mesma transacao, com snapshot"* |
| **INV-063** cortesia exige razão, responsável e validade | integração → *"recusa cortesia sem razao"* |
| **INV-064** modelo suporta as nove origens (ADR-009) | `EntitlementSource` no schema, enum extensível |
| **INV-084** evento na mesma transação da mudança de estado | integração → *"recusa transicao invalida sem deixar rastro parcial"*, *"deriva entitlement... na mesma transacao"* |

## 6. `M1-BR-003` / INV-030 — verificado por ausência

A regra de arquitetura nº 1 diz que **a catraca nunca consulta assinatura**. Isso não se prova
com asserção: prova-se mostrando que o caminho de decisão **não tem como** chegar lá.

- `entitlement.ts` — o módulo que decide efetividade — importa apenas `student.js` (status do
  aluno) e `plan.js` (janelas). **Não importa `Subscription`, `Invoice` nem `Payment`.**
- `direitoEhEfetivo()` recebe `DireitoDeAcesso`, cujos campos são status, validade e janelas do
  **snapshot**. Não há referência a `subscriptionId` na decisão.
- O snapshot é congelado na derivação: a propriedade *"mutar o plano depois da derivacao nao
  altera a decisao"* prova que nem o plano vivo influencia.

**O que isso não prova:** F9 ainda não existe. Quando o motor de decisão nascer, esta ausência
precisa ser reverificada — é fácil um `include: { subscription: true }` entrar sem ninguém notar.

## 7. Escopo negativo — o que esta entrega não faz

| item | onde foi |
|---|---|
| **Interface de recepção** (Task 6 do plano) | **PR seguinte, mesma issue #7.** Decisão do PI em 15/08/2026: backend primeiro |
| `M1-AC-002` e `M1-AC-003` fechados em E2E | Dependem da interface acima |
| Endpoint de merge de duplicatas | Fora do plano de apoio, por decisão dele: *"No merge endpoint is included"* |
| Job de expiração agendada de entitlement | Não há scheduler no repositório. A guarda por data em `direitoEhEfetivo` torna a expiração **correta mesmo sem o job** — o status fica desatualizado, a decisão não |
| Limite de 30 dias para cortesia sem permissão OWNER | O plano de apoio pede; **não há `M1-FR` nem invariante que o sustente**. Escrever a regra sem fonte seria inventar produto — pergunta ao PI |
| `PAST_DUE` de assinatura | Existe no enum, **não é alcançável no MVP 1** (`CONVENTION.md` §3.2). Chega com o MVP 2 |
| Endereço do aluno (`StudentAddress`) | Tabela criada, **sem rota**. Nenhum `M1-FR` a exige nesta fatia |
| **`Idempotency-Key` em `POST /subscriptions`** | **Não implementado.** Ver abaixo — limitação conhecida, não esquecimento |

### Limitação conhecida: ativação de assinatura não é idempotente

`POST /api/v1/subscriptions` chamado duas vezes com a mesma entrada cria **duas assinaturas e
dois entitlements**. Não há chave natural que distinga *"o operador clicou duas vezes"* de
*"o aluno contratou um segundo plano"* — as duas coisas são legítimas.

O INV-087 prevê `Idempotency-Key` para operações assim, mas **nenhuma rota do repositório o
implementa hoje**, nem F6 nem F7. Criá-lo dentro desta fatia seria decidir uma regra de
plataforma dentro de uma feature.

**Consequência aceita:** duplo clique na recepção gera duas assinaturas, ambas visíveis na
timeline do aluno — erro que o operador enxerga e corrige. Não há corrupção silenciosa, e o
entitlement duplicado é aditivo (dois direitos válidos), nunca contraditório.

**Sugestão ao PI:** `Idempotency-Key` transversal merece card `[INFRA]` próprio, antes de F12
(onde o mesmo problema envolve dinheiro e deixa de ser cosmético).

## 8. Decisão de fatia registrada — transições do `Student`

O `docs/CONVENTION.md` §3.1 declara as transições de `Student` como **`[indefinido]`** e manda
defini-las *"na spec de F7"*. **A SPEC-007 §2 saiu vazia** — o Cowork não as definiu.

A tabela implementada em `apps/api/src/modules/students/domain/student.ts`
(`TRANSICOES_DE_ALUNO`) vem do **plano de apoio** (Task 2), que é material de apoio e **não é
contrato**. Adotada nesta fatia por decisão do PI em 15/08/2026:

```text
LEAD      -> TRIAL | ACTIVE | CANCELLED | ARCHIVED
TRIAL     -> ACTIVE | CANCELLED | ARCHIVED
ACTIVE    -> SUSPENDED | BLOCKED | CANCELLED | ARCHIVED
SUSPENDED -> ACTIVE | BLOCKED | CANCELLED | ARCHIVED
BLOCKED   -> ACTIVE | CANCELLED | ARCHIVED
CANCELLED -> ACTIVE | ARCHIVED
ARCHIVED  -> (terminal)
```

> 📌 **Pendência para o Cowork:** o `CONVENTION.md` §3.1 precisa da emenda correspondente. O
> arquivo é dele (ADR-021); corrigi-lo daqui seria a erosão que o próprio ADR nomeia.

**Nota sobre `SUSPENDED`:** o aluno suspenso **continua elegível** a acesso normal. INV-033 e
`M1-BR-002` listam exatamente três estados sem acesso — `BLOCKED`, `CANCELLED`, `ARCHIVED` — e
`SUSPENDED` não está entre eles. Incluí-lo seria inventar regra que nenhum documento pede. Se a
intenção do produto for outra, é decisão do PI e vira emenda.

## 9. Bug encontrado e corrigido na revisão

A revisão de código antes do commit achou uma **condição de corrida real** — não hipotética.

**O bug:** `ativarAssinatura` e `concederCortesia` liam o status do aluno **fora** da transação e
criavam o entitlement **dentro** dela. Entre as duas operações, um arquivamento concorrente
passava despercebido: o `alterarStatus` suspende os entitlements *existentes*, e não via o que
ainda não havia sido criado. Resultado: **aluno `ARCHIVED` com entitlement `ACTIVE`** — violação
direta de INV-033, sem ninguém ter escrito uma linha errada.

**A correção:** `travarAlunoElegivel()` refaz a checagem dentro da transação, com
`SELECT ... FOR UPDATE` na linha do aluno. O arquivamento concorrente espera o commit e então
enxerga o entitlement que precisa suspender.

**A prova de que o teste pega o bug:** removi o lock e rodei a suíte — o teste *"nunca deixa
aluno arquivado com entitlement ativo, mesmo sob corrida"* falhou com `Expected: 0, Received: 1`.
Com o lock de volta, passa. Um teste de concorrência que nunca foi visto falhando não prova nada;
este foi.

## 10. Decisões técnicas que merecem revisão

1. **CPF não é persistido em claro.** Guardamos `cpfHash` (SHA-256 com pimenta por tenant, para
   comparar igualdade) e `cpfLast3` (para a recepção conferir). Uma fatia futura que precise
   exibir o CPF completo exige decisão do PI e cifra reversível — não um `ALTER TABLE`.
2. **Matrícula por contador travado.** `SELECT ... FOR UPDATE` na linha de `StudentSequence`,
   dentro da transação de criação. `COUNT(*)` reusaria número após arquivamento; `SEQUENCE` do
   Postgres é global e vazaria volume entre tenants.
3. **Fim de janela e `endsAt` são exclusivos.** `08:00-12:00` não permite entrar às 12:00. Sem
   isso, duas janelas encostadas fariam o instante pertencer a ambas, e "mais restritiva
   prevalece" perderia resposta única.
4. **Virada de dia entra como duas janelas.** `22:00-02:00` é recusado como intervalo único;
   vira `22:00-24:00` + `00:00-02:00`. Aceitar fim menor que início obrigaria todo consumidor —
   inclusive o motor de F9 — a lembrar do caso especial.
5. **DST registrado em teste.** `America/Sao_Paulo` não tem mais horário de verão (Decreto
   9.772/2019); o teste fixa isso e falha se a base IANA mudar. Um segundo teste usa
   `America/New_York` para provar que a conversão acompanha DST de verdade, e não offset fixo.
