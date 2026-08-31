# SPEC-038 — CRM de retenção

| campo | valor |
|---|---|
| **Fatia** | F38 |
| **MVP** | 6 |
| **Slice do PRD** | **6.3** — `docs/prd/academia/MVP-06-retention-ai.md` §8 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-06-03-retention-crm.md` *(desatualizado — ver §2)* |
| **Status** | `entregue` |
| **ADRs que bloqueiam** | nenhum |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M6-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 6.3. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-06-retention-ai.md` §8, Slice 6.3.

**É a seta do MVP 6.** A entrega do MVP inteiro é *"risco de churn explicável → tarefa
operacional"*; a F37 entregou o lado esquerdo, e sem esta fatia o score seria relatório, não ação.

`Aceite: cada intervenção liga score, ação, responsável e resultado.`

## 2. Decisões específicas desta fatia

**1. O gate de ≥6 meses foi liberado pelo PI em 31/08/2026** — terceira vez, pelo mesmo argumento
das F36/F37: fila de tarefa é código determinístico sobre o score que já existe, não aprende de
histórico. O gate guarda a Slice 6.5 (F40).

**2. Os quatro parâmetros de operação (`M6-OPS-01`) são decisão do PI, 31/08/2026:**

| parâmetro | valor | razão |
|---|---|---|
| capacidade diária | **20** por unidade | cabe numa manhã de recepção sem atrapalhar o balcão |
| cooldown | **14 dias** | age sem importunar; o score novo continua no histórico |
| SLA | **3 dias úteis** | risco de churn tem janela curta; ligação atrasada não serve |
| canal | **WhatsApp**, único | o que a recepção usa hoje |

São **padrões**, não constantes: cada unidade configura em `retention_capacity_policies`.

**3. Canal único torna `CANAL_INDISPONIVEL` um estado real.** Com só WhatsApp, aluno sem número
cadastrado é caso frequente, e precisa ser distinguível de `SEM_RESPOSTA` — um diz *"tente outro
caminho"*, o outro *"tente de novo mais tarde"*.

**4. Capacidade é por UNIDADE, não por tenant.** A matriz e a do bairro não têm a mesma recepção,
e um número único condenaria uma das duas. Candidato de unidade **sem política é ignorado**, nunca
pontuado com um padrão mudo: o padrão silencioso pareceria funcionar e ninguém descobriria que a
unidade nova nunca foi configurada.

**5. Duas chaves, e elas cobrem coisas diferentes.** `@@unique(score_id)` impede que um score gere
duas tarefas; o **índice parcial** `(tenant, aluno, estratégia) WHERE status ativo` impede que dois
scores de **dias diferentes** — o caso normal, o pipeline roda todo dia — gerem duas tarefas ativas
pelo mesmo motivo. Sem o segundo, o aluno recebe duas ligações.

**6. Registrar contato NÃO conclui a tarefa.** Ligar três vezes até a pessoa atender são três
interações e uma tarefa. Se a primeira tentativa sem resposta fechasse a tarefa, a fila mostraria
*"tratado"* para quem ninguém falou, e o histórico de tentativa — que distingue *"ninguém tentou"*
de *"tentou três vezes"* — sumiria.

**7. `criadaEm` é explícito, não `@default(now())`.** O cooldown compara `agora − criadaEm`; com um
lado no relógio da aplicação e o outro no do Postgres, a conta mistura duas fontes e reprocessar um
dia passado mediria contra o instante da reexecução. **Foi defeito real**, achado por canário — ver
§4.

**8. O plano de apoio está desatualizado.** Ele descreve `packages/retention-domain`,
`RetentionStrategyVersion`, `RetentionActionTemplate` e `RetentionTaskTransition` — nada disso
existe. Segui a estrutura real do módulo, e a estratégia é **derivada do fator dominante** que a
F37 já grava em `position: 1`, em vez de uma tabela de templates que ninguém preencheria.

## 3. Escopo negativo

- **Não envia nada.** `M6-BR-007` e `M6-AC-010`: o `POST .../interactions` **registra** o que a
  pessoa fez pelo WhatsApp dela. É o que separa CRM de retenção de plataforma de marketing, e o
  `docs/prd/README.md` §3 diz que o ArenaHub não é a segunda.
- **Não roda sozinho.** `gerarFila` existe e é testado, mas não há job/cron — mesma escolha da F36
  e da F37.
- **Não há tela.** A API e o contrato OpenAPI saem aqui; o `admin-web` consome depois.
- **Não expira sozinho.** O estado `EXPIRADA` e a transição existem; o processo que a aplica no fim
  do SLA entra junto do agendamento.
- **Não há experimento.** Slice 6.4 (F39).
- **Não emite evento de domínio.** `RetentionTaskCreated` e afins entram quando houver consumidor.

## 4. Invariantes que esta fatia precisa preservar

| invariante | onde é provado |
|---|---|
| **INV-006** — isolamento entre tenants | 2 testes de integração: fila e carregamento por id. |
| **Regra de arquitetura nº 2** — `tenant_id` em toda entidade | as três tabelas novas têm; `TenantContext` é o primeiro parâmetro. |
| **Regra de arquitetura nº 4** — efeito externo idempotente | `@@unique(score_id)` + índice parcial. Canário: derrubar o parcial derruba o teste do score de outro dia. |
| **`M6-BR-004`** — cooldown suprime tarefa, score permanece | canário: desativar o cooldown derruba o teste; e ele só passou a derrubar depois do conserto de §2.7. |
| **`M6-BR-005`** — capacidade limita o top-K | teste com 5 alunos e capacidade 2. |
| **`M6-AC-006`** — interação registra responsável, canal, horário e resultado | teste do aceite, com duas interações numa tarefa. |
| **`M6-AC-010`** — score nunca altera acesso ou cobrança | estrutural: o módulo não importa nada de `access`, `billing` nem `membership`. |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | O gate de ≥6 meses alcança a F38? | **Liberar.** Mesmo argumento das F36/F37. | 31/08/2026 |
| 2 | Capacidade diária por unidade? | **20**, configurável. | 31/08/2026 |
| 3 | Cooldown entre tarefas da mesma estratégia? | **14 dias**. | 31/08/2026 |
| 4 | SLA da tarefa? | **3 dias úteis**. | 31/08/2026 |
| 5 | Canais de contato permitidos? | **WhatsApp**, apenas. | 31/08/2026 |

## 6. Antes de codificar, confirme

- [x] O gate de entrada do MVP tem decisão registrada — PI, 31/08/2026
- [x] `M6-OPS-01` definido pelo PI — §2, decisão 2
- [x] Os ADRs listados acima estão resolvidos — nenhum bloqueia
