# SPEC-018 — Histórico e comparativos

| campo | valor |
|---|---|
| **Fatia** | F18 |
| **MVP** | 3 |
| **Slice do PRD** | **3.2** — `docs/prd/academia/MVP-03-health-intelligence.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-03-02-history-comparisons.md` |
| **Status** | ✅ **entregue** em 21/08/2026 |
| **ADRs que bloqueiam** | nenhum |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M3-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 3.2. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> MVP futuro. O PI não pode aprovar hoje o que ainda não foi discutido — e aprovar sem discutir é o que este processo existe para impedir.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-03-health-intelligence.md` §7, Slice 3.2, e o plano de apoio acima.

## 2. Decisões específicas desta fatia

*(preencher quando houver — decisão com efeito além da fatia vira ADR, não fica aqui)*

**21/08/2026 — `health_goals` entrou nesta fatia, decisão do PI.** O `M3-FR-007` manda comparar
"atual, anterior, primeira e **meta**", e a meta era da Slice 3.4. Entregar o comparativo sem ela
deixaria o `M3-AC-003` aberto. O que permanece na F20: progresso calculado e frequência
(`student_attendance_sessions`).

**Rota do PRD, não do plano de apoio.** O PRD §11 define
`GET /api/v1/students/:id/health-progress`; o plano propunha
`/v1/health/students/:id/history`. Onde divergem, o PRD vence (`CLAUDE.md`).

**Decimais como `number` no JSON, não string.** O plano pedia string; o `AssessmentController` já
responde `number` via `toNumber()` na borda. Duas convenções de decimal na mesma API custariam
mais do que a precisão extra renderia — quem exibe arredonda de qualquer forma (INV-106).

**`assessedAtLocal` no DTO do ponto.** A regra 5 de lint do painel reserva formatação de data ao
`TenantDateTime`, com exceção nominal de dois arquivos, e o eixo do gráfico precisa de string
dentro do SVG. Em vez de abrir uma terceira exceção — decisão de design system, não desta fatia —
o servidor entrega o dia já no fuso da unidade.

## 3. Escopo negativo

*(o que esta fatia deliberadamente não faz, e para onde foi)*

- **Timeline combinando avaliação e frequência** — a Slice 3.2 cita, mas depende de
  `student_attendance_sessions`, que é da **Slice 3.4 (F20)**. A tela entrega o histórico
  corporal; a frequência entra quando a tabela existir.
- **Progresso calculado da meta ao longo do tempo** — fica na **F20**. Esta fatia mede a distância
  do valor atual até o alvo, não a curva de aproximação.
- **Upload, OCR e revisão campo a campo** — **F19**.
- **PDF** — a exportação é CSV. Não há PDF em nenhum módulo do repositório, e criar o primeiro
  seria fatia própria.

## 4. Invariantes que esta fatia precisa preservar

*(listar os `INV-nnn` de `docs/CONVENTION.md` §4 que o código desta fatia toca — cada um precisa
de teste, conforme `docs/REVIEW.md` §3)*

| invariante | onde a fatia o preserva | teste |
|---|---|---|
| **INV-102** avaliação publicada é imutável; correção cria versão vinculada | `selecionarFolhas` descarta a original corrigida **na série**, e as duas continuam publicadas no banco. O filtro é do domínio, não do `WHERE` — no SQL, o domínio nunca saberia que houve correção | `comparativo.spec.ts` (cadeia de correções); integração "correção substitui a original na série, e a original continua publicada"; CSV leva `corrects_assessment_id` e `superseded` |
| **INV-104** ausência de dado não é zero | medida ausente **não vira ponto**; variação sem baseline devolve `null` + razão; gráfico com `connectNulls={false}`; painel escreve `—`, nunca `0,0` | `comparativo.spec.ts`; integração "campo ausente não vira ponto nem zero"; `formatar.test.ts` (par "zero medido" × "ausência") |
| **INV-105** unidade original preservada; conversão testada | meta em libras convertida antes de comparar; CSV leva original **e** canônico com as duas unidades | integração "meta em libras é convertida"; "preserva a unidade ORIGINAL junto da canônica"; `csv-de-saude.spec.ts` |
| **INV-106** arredondamento é só de apresentação | domínio devolve a precisão que recebe; `Decimal` vira `number` só na borda; CSV exporta **string** direto do `Decimal` | `comparativo.spec.ts` ("não arredonda"); integração "preserva o decimal exato" |
| **INV-006** não vazar existência entre tenants | `exigirAluno` em toda rota com `studentId`, respondendo **404** (não 403) para aluno de outra academia | integração: leitura, criação de meta e exportação, uma tentativa de vazamento cada |
| **INV-003** `TenantContext` obrigatório no repositório | `listarPublicadasDoAluno`, `GoalRepository` e o serviço recebem contexto como primeiro argumento | compilador + testes de tenant acima |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| — | — | — | — |

## 6. Antes de codificar, confirme

- [ ] Status desta spec é `aprovada-pi`
- [ ] Os ADRs listados acima estão resolvidos
- [ ] O gate de entrada do MVP tem evidência registrada
