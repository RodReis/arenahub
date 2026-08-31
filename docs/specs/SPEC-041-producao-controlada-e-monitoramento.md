# SPEC-041 — Produção controlada e monitoramento

| campo | valor |
|---|---|
| **Fatia** | F41 |
| **MVP** | 6 |
| **Slice do PRD** | **6.6** — `docs/prd/academia/MVP-06-retention-ai.md` §8 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-06-06-production-monitoring.md` *(pressupõe modelo — ver §2)* |
| **Status** | `entregue` — **escopo reduzido por ausência de modelo**. PR [#229](https://github.com/RodReis/arenahub/pull/229), mergeado em 31/08/2026 |
| **ADRs** | **ADR-050** (F40 não executada) determina o escopo desta fatia |

> **Esta spec é um ponteiro (ADR-022).** Escopo, requisitos e critérios de aceite moram no PRD.

---

## 1. O que esta fatia entrega

**Última fatia do roadmap documentado do MVP 6.**

A Slice 6.6 foi escrita para monitorar um **modelo**. A F40 não foi executada (ADR-050) porque o
gate de dado não fecha — então metade do escopo perdeu o objeto. Entregue o que sobrevive e tem
valor próprio:

| item da Slice 6.6 | entregue? | por quê |
|---|---|---|
| kill switch e rollback | ✅ | desligar o scoring não depende de modelo |
| drift de feature | ✅ | as 13 features da F36 são a entrada de tudo |
| alertas | ✅ | saúde do pipeline + drift crítico |
| expiração de versão | ✅ | já existia — regras versionadas (F37), score com idade |
| relatório de impacto | ✅ | já existia — análise ITT (F39) |
| **champion/challenger** | ❌ | precisa de dois modelos competindo |
| **drift de score / calibração** | ❌ | score de regra não é probabilidade e não calibra |

`Aceite: degradação desativa o modelo com segurança e preserva tarefas já auditadas.`

Sem modelo, o aceite se lê como **desativa o scoring** — e a segunda metade (*preserva tarefas já
auditadas*) é testada literalmente.

## 2. Decisões específicas desta fatia

**1. Escopo reduzido por decisão do PI (31/08/2026), não por conveniência.** Perguntado entre
executar o que faz sentido, não executar como a F40, ou fazer só o kill switch, o PI escolheu o
escopo intermediário. Champion/challenger e calibração ficam documentados como fora de escopo até
haver modelo.

**2. O kill switch desliga SÓ o cálculo novo** — decisão do PI. Para de pontuar e de gerar fila;
scores gravados seguem legíveis com marca de idade (F37) e **tarefas abertas seguem tratáveis até o
fim**. É `M6-NFR-009` literal: *"tarefas e interações permanecem disponíveis se o scoring estiver
indisponível"*. Desligar no meio do dia não pode deixar a recepção com uma fila que ela não
consegue fechar.

**3. Flag é COLUNA de tenant, não serviço de flags.** Mesmo precedente das três flags de
engajamento e do `BillingSettings.blockAnchor`. *"Sem deploy"* é o requisito (`M6-NFR-006`: efeito
em até cinco minutos), e um `UPDATE` numa coluna é o caminho mais curto entre a decisão e o efeito.

**4. Desligado NÃO gera alerta.** `precisaDeAtencao` é sempre `false` com o kill switch acionado,
mesmo com drift crítico visível. Alarme que dispara para uma situação criada de propósito treina a
operação a ignorar o alarme — e alarme ignorado é pior que alarme nenhum, porque dá sensação de
cobertura.

**5. A saúde lê `createdAt`, não `observedAt`.** A pergunta é *"quando o pipeline rodou"*, não *"que
dia ele descreveu"*. Uma reconstrução histórica grava `observedAt` antigo com `createdAt` de hoje —
operação legítima que a F36 desenhou o corte de conhecimento para permitir. Lendo `observedAt`, um
pipeline saudável apareceria como atrasado há meses. **Foi o terceiro canário, e não era pego.**

**6. Dois tipos de drift, e o primeiro é o que machuca.** `AUSENCIA` (a fonte caiu) e `MEDIA` (o
valor típico mudou). Quando a fonte cai, a média dos poucos observados que sobraram também muda —
por isso `AUSENCIA` é reportada primeiro e a `MEDIA` do mesmo período é suprimida: reportar as duas
esconderia a causa no meio do efeito.

**7. Limiares grosseiros de propósito:** 25% para atenção, 50% para crítico. Sem histórico
acumulado não há como calibrar limiar estatístico, e teste de hipótese sobre dias adjacentes
dispararia com qualquer sazonalidade. Pegam o que interessa hoje — fonte que caiu, cálculo que
quebrou — e são substituíveis quando houver série longa.

**8. Janela de 7 dias contra os 7 anteriores.** Curta o bastante para pegar uma fonte que caiu
ontem, longa o bastante para não confundir segunda com domingo. Comparar dia contra dia acusaria
drift toda semana pelo fim de semana.

**9. A média do drift usa só os valores OBSERVADOS.** Somar ausente como zero puxaria a média para
baixo exatamente quando a fonte cai, mascarando o drift de ausência com um drift de média que não
existe. É `M6-BR-002` chegando até o monitoramento.

**10. `retention.kill_switch` é permissão própria**, pelo precedente dos atos excepcionais
(`access.override`, `billing.refund`): ler o painel é acompanhamento; parar o scoring da academia
inteira é decisão de operação.

## 3. Escopo negativo

- **Champion/challenger e calibração** — sem modelo, não há objeto. Voltam com a F40.
- **Kill switch de modelo** (`M6-BR-010`, *"modelo degradado volta à baseline"*) — a baseline **é** o
  que roda; não há de que cair.
- **Não roda sozinho.** O painel é consultado sob demanda; não há job que avalie drift de madrugada
  e mande alerta. Mesma lacuna das F36–F39: **nada agenda o pipeline**.
- **Sem canal de notificação.** `precisaDeAtencao` é um campo da resposta, não um e-mail. Quem
  decide o canal é a operação, e o ArenaHub não envia mensagem (`M6-BR-007`).
- **Sem tela.** A API e o contrato OpenAPI saem aqui.

## 4. Invariantes que esta fatia precisa preservar

| invariante | onde é provado |
|---|---|
| **INV-006** — isolamento entre tenants | kill switch de um tenant não afeta o outro. |
| **`M6-FR-017`** — desativar sem deploy | `UPDATE` de coluna; canário derruba 1 unitário + 3 de integração. |
| **`M6-NFR-009`** — tarefas disponíveis sem scoring | tarefa aberta tratada de ponta a ponta com o kill switch acionado. |
| **`M6-FR-018`** — monitorar drift | drift de ausência detectado sobre dado real. |
| **`M6-BR-009`** — pipeline parado é sinalizado | `ATRASADO` e `NUNCA_RODOU` têm estado próprio. |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | A Slice 6.6 pressupõe modelo e a F40 não foi executada. Qual escopo? | **Só o que faz sentido sem modelo** — kill switch, drift de feature, alerta de pipeline. | 31/08/2026 |
| 2 | O kill switch desliga o quê? | **Só o cálculo de novos scores** — tarefas abertas seguem tratáveis. | 31/08/2026 |

## 6. Antes de codificar, confirme

- [x] Escopo definido pelo PI — §5
- [x] ADR-050 explica por que metade da Slice não tem objeto
