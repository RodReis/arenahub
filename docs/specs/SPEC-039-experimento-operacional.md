# SPEC-039 — Experimento operacional

| campo | valor |
|---|---|
| **Fatia** | F39 |
| **MVP** | 6 |
| **Slice do PRD** | **6.4** — `docs/prd/academia/MVP-06-retention-ai.md` §8 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-06-04-operational-experiment.md` *(desatualizado — ver §2)* |
| **Status** | `entregue` |
| **ADRs que bloqueiam** | nenhum |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M6-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 6.4. Este arquivo não os copia.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-06-retention-ai.md` §8, Slice 6.4.

**A fatia que separa retenção medida de retenção alegada.** Sem braço de controle não há como
distinguir *"a ligação segurou o aluno"* de *"o aluno ia ficar de qualquer jeito"* — e toda métrica
de retenção vira anedota.

`Aceite: resultado permite decidir continuar, ajustar ou interromper sem cherry-picking.`

## 2. Decisões específicas desta fatia

**1. Gate liberado pelo PI (31/08/2026)** — quarta vez, mesmo argumento: randomização e ITT são
código determinístico sobre a fila que já existe. O gate de ≥6 meses guarda a Slice 6.5 (F40).

**2. Os parâmetros de `M6-EXPERIMENT-01` são decisão do PI:**

| parâmetro | valor | razão |
|---|---|---|
| alocação | **20% controle / 80% tratamento** | 1 em 5 sem ligação; custo baixo, amostra suficiente |
| métrica primária | **permanência em 30 dias** | casa com `predictionDays` do alvo |
| efeitos adversos | **opt-out, cancelamento, recusa, supressão** | `M6-AC-011` pede medir dano, não só ganho |
| canal | herdado da F38 (WhatsApp) | — |

**3. Randomização por HASH, não por sorteio guardado.** O grupo é `sha256(semente ␟ studentId)`
normalizado em `[0,1)`. A alternativa — `Math.random()` + gravar — funciona até a primeira pergunta
séria: *"como sabemos que ninguém mexeu na alocação depois de ver o resultado?"*, cuja resposta
seria *"confie na tabela"*. Com hash, qualquer pessoa recalcula e confere. **Há teste de integração
que faz exatamente isso.**

**4. A semente é POR EXPERIMENTO.** Semente fixa deixaria o mesmo aluno no controle para sempre, e
o custo de nunca receber intervenção se acumularia nas mesmas pessoas. Teste de integração compara
duas sementes sobre os mesmos 40 alunos e exige divisões diferentes.

**5. Aloca com hash, LÊ do banco.** A assimetria é deliberada: recalcular também na leitura faria
uma correção de semente mover alunos **retroativamente**, e tarefas já criadas passariam a pertencer
a um braço em que a pessoa nunca esteve. A gravação prova *quando* entrou; o hash prova que o grupo
não foi escolhido a dedo.

**6. O CONTROLE sai ANTES do corte de capacidade.** Ordem fácil de errar e com consequência real:
filtrar depois faria o controle consumir vaga, a recepção trataria 16 numa capacidade de 20, e o
experimento mediria uma intervenção mais fraca do que a real. **Canário dedicado.**

**7. Imutabilidade mora em TRIGGER, não no serviço.** Guarda em serviço é uma porta; correção
manual, script de migração ou um `update` esquecido passam por fora. Dois triggers: um recusa mudar
`seed`/`control_fraction`/`window_days` depois de `DRAFT`, outro recusa mudar o grupo de uma
alocação. Rodar → ver o resultado → mexer na semente → rodar de novo é o cherry-picking que o aceite
proíbe, e agora o banco recusa.

**8. Janela por ALUNO, contada da alocação dele.** Contar do início do experimento mediria 30 dias
para quem entrou no primeiro dia e 10 para quem entrou no vigésimo — e a diferença apareceria como
efeito. Quem ainda está dentro da janela **não entra na análise**: incluí-lo infla a permanência dos
dois braços (ninguém teve tempo de sair).

**9. ITT conta todo alocado, inclusive quem nunca foi contatado.** Analisar só os contatados é o
viés clássico do campo — quem atende o telefone é sistematicamente mais engajado. A taxa de contato
é **reportada ao lado**, não usada para filtrar: efeito nulo com 10% de contato e com 90% são
conclusões opostas.

**10. Resultado com amostra pequena sai marcado `conclusivo: false`.** Piso de 50 por braço. Não é
teste de significância — é o que impede a leitura ingênua de *"3 de 4 permaneceram, logo 75%"*.

**11. Um experimento ativo por vez.** Dois simultâneos cruzariam os braços: um aluno no controle de
A e no tratamento de B recebe ligação, e o controle de A deixa de ser controle. Desenho fatorial
não está nesta fatia.

**12. O plano de apoio está desatualizado.** Descreve `packages/retention-domain`,
`RetentionExperimentVersion`, `RetentionExperimentExposure` e `RetentionExperimentReport` — nada
disso existe. Segui a estrutura real; exposição é derivada das interações da F38, e o relatório é
calculado sob demanda em vez de materializado.

## 3. Escopo negativo

- **Não estratifica.** Randomização simples, não por faixa de risco. Com um piloto pequeno, blocos
  por estrato dariam braços pequenos demais para medir.
- **Não faz teste de significância.** `conclusivo` é piso de amostra, não p-valor. Estatística
  formal entra quando houver dado real que a justifique.
- **Não roda sozinho.** Sem job/cron — mesma escolha das F36–F38.
- **Não há tela** nem rota HTTP: a análise sai pelo serviço, e a superfície entra junto do painel de
  retenção.
- **Não registra efeito adverso automaticamente.** A tabela existe e a análise lê; o gatilho que
  detecta cancelamento/opt-out na janela entra com o monitoramento (Slice 6.6).

## 4. Invariantes que esta fatia precisa preservar

| invariante | onde é provado |
|---|---|
| **INV-006** — isolamento entre tenants | teste de integração: alocação de outro tenant nunca aparece. |
| **`M6-FR-011`** — randomização por unidade estável | grupo gravado bate com o recalculo; duas sementes re-embaralham. |
| **`M6-FR-012`** — grupo não muda após início | dois triggers no banco + chave única. Canário: 3 testes. |
| **`M6-AC-007`** — preserva atribuição, análise por ITT | conta todo alocado, inclusive não contatado. |
| **`M6-AC-011`** — mede efeitos adversos | agregados nos dois braços, um por aluno. |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | O gate `M6-EXPERIMENT-01` alcança a F39? | **Liberar.** | 31/08/2026 |
| 2 | Proporção controle/tratamento? | **20% / 80%**. | 31/08/2026 |
| 3 | Métrica primária? | **Permanência em 30 dias**. | 31/08/2026 |
| 4 | Efeitos adversos a monitorar? | **Os quatro**: opt-out, cancelamento, recusa, supressão. | 31/08/2026 |

## 6. Antes de codificar, confirme

- [x] `M6-EXPERIMENT-01` definido pelo PI — §2, decisão 2
- [x] Os ADRs listados acima estão resolvidos — nenhum bloqueia
