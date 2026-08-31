# SPEC-037 — Regras explicáveis e score

| campo | valor |
|---|---|
| **Fatia** | F37 |
| **MVP** | 6 |
| **Slice do PRD** | **6.2** — `docs/prd/academia/MVP-06-retention-ai.md` §8 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-06-02-baseline-scores.md` *(desatualizado — ver §2)* |
| **Status** | `entregue` — PR [#225](https://github.com/RodReis/arenahub/pull/225), mergeado em 31/08/2026 |
| **ADRs que bloqueiam** | nenhum |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M6-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 6.2. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-06-retention-ai.md` §8, Slice 6.2.

Em uma linha: **o score de churn que a recepção consegue contestar.** Cada ponto do número tem
uma regra com nome, um valor observado e um limite — e quem não pode ser pontuado gera uma linha
de recusa com motivo, nunca um score `0`.

## 2. Decisões específicas desta fatia

*(decisão com efeito além da fatia vira ADR, não fica aqui)*

**1. O gate de ≥6 meses foi liberado pelo PI em 31/08/2026.** O `docs/STATUS.md` §4 dizia
*"F37–F41 continuam atrás dele"*. O PI liberou com o mesmo argumento que soltou a F36: **regra
explicável é código determinístico e não precisa de histórico acumulado para existir** — o gate
guarda o *modelo supervisionado* (Slice 6.5 / F40), que aprende de dado passado. A baseline não
aprende: ela aplica limites que uma pessoa escreveu. Sem histórico, ela simplesmente pontua pouca
gente; com histórico, pontua mais. Nunca fica errada por falta de dado, porque **ausência não
pontua**.

**2. O plano de apoio está desatualizado e não foi seguido ao pé da letra.** Ele descreve
`packages/retention-domain`, `packages/contracts` e `apps/api/src/workers/` — **nenhum dos três
existe** neste repositório. A F36 pôs tudo em `apps/api/src/modules/retention/`, e esta fatia
seguiu a estrutura real. O plano é material de apoio, não contrato (CLAUDE.md).

**3. A F37 abre a primeira rota HTTP de retenção.** A F36 deixou o módulo interno de propósito —
*"expor score antes da baseline seria mostrar um número que ainda não significa nada"*. Agora
significa.

**4. Regra é tupla fechada, nunca expressão.** Feature + operador de uma allowlist de cinco +
limite numérico + peso + direção. Guardar a regra como texto (`"attendance_days_30d <= 4"`) e
interpretar quebraria `M6-AC-002` (expressão arbitrária pode ler relógio e deixar de ser
reprodutível) e transformaria dado de banco em execução remota. A allowlist tem teste que compara
a lista inteira: acrescentar operador é decisão visível no diff.

**5. O score é ordenação, não probabilidade.** Inteiro em `[0, 100]`, com `CHECK` no banco.
`calibratedProbability` é **sempre `null`** nesta fatia — PRD §16 proíbe "probabilidades com falsa
precisão quando não calibradas". A coluna existe nula para a F40 preencher sem migrar de novo, e
para a tela já saber esconder o número quando ele falta.

**6. Faixas e completude mínima são versionadas junto das regras.** Mover o corte de `ALTO` muda
quem entra na fila **sem mudar nenhum peso** — então o corte mora na `RetentionRuleVersion`, e o
score antigo continua explicável pelos cortes que o produziram. Só versão **congelada** pontua:
catálogo em edição faria dois alunos do mesmo dia saírem com regras diferentes.

**7. Inelegível gera linha de recusa, não score zero.** Score `0` põe o suprimido no mesmo balde
do aluno saudável e faz uma decisão de governança parecer medição de risco baixo. Sem a linha,
*"não pontuado"* seria indistinguível de *"o job não rodou"* — e as duas exigem ações opostas da
operação.

## 3. Escopo negativo

- **Não cria tarefa de CRM.** Fila, cooldown, atribuição e SLA são a Slice 6.3 (F38).
- **Não roda sozinho.** Não há job/cron: `pontuarDia` existe e é testado, mas o agendamento
  entra junto do CRM, que é quem consome a fila. Mesma escolha da F36, que também não agendou
  `gravarSnapshot`.
- **Não há tela.** O `admin-web` consome a rota numa fatia posterior; esta entrega a API e o
  contrato OpenAPI.
- **Não há modelo supervisionado.** Slice 6.5 (F40), condicionada a `M6-ML-01`.
- **Não emite evento de domínio.** `RetentionScoreCalculated` e `RetentionRiskIncreased` (PRD
  §14) entram quando houver consumidor — publicar evento que ninguém lê é ADR-005 ao contrário.

## 4. Invariantes que esta fatia precisa preservar

| invariante | onde é provado |
|---|---|
| **INV-006** — isolamento entre tenants | `retencao-score-explicavel.int-spec.ts` → *"score de outro tenant nunca aparece na fila"*. Canário: remover `tenantId` do `where` da fila derruba 2 testes. |
| **Regra de arquitetura nº 2** — `tenant_id` em toda entidade | as cinco tabelas novas têm `tenant_id`; `TenantContext` é o primeiro parâmetro de todo método público. |
| **Regra de arquitetura nº 4** — todo efeito externo é idempotente | `@@unique([snapshotId, provider, ruleVersionId])`. Canário: derrubar o índice faz reexecução **e** concorrência duplicarem (2 testes caem). |
| **`M6-BR-002`** — ausência reduz confiança, não aumenta risco | 3 testes de integração + 5 unitários. Canário: trocar `valor.valor` por `valor.valor ?? 0` derruba *"zero observado pontua, ausente não"*. |
| **`M6-AC-010`** — score nunca altera acesso, cobrança ou desconto | estrutural: o módulo não importa nada de `access`, `billing` nem `membership`. |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | A F37 está atrás do gate de ≥6 meses de histórico. Libero agora? | **Liberar agora.** Regra explicável é código determinístico; o gate existe para o modelo supervisionado (F40). | 31/08/2026 |

## 6. Antes de codificar, confirme

- [x] O gate de entrada do MVP tem decisão registrada — PI, 31/08/2026 (§5, pergunta 1)
- [x] Os ADRs listados acima estão resolvidos — nenhum bloqueia
