# Evidência — Decisão online e passagem (F9 / SPEC-009)

**Fatia:** F9 · **Slice do PRD:** 1.4 · **Issue:** [#9](https://github.com/RodReis/arenahub/issues/9)
**Última atualização:** 16/08/2026

> **Como ler este documento.** Ele separa o que **já foi medido** do que **ainda não foi**.
> Campo em branco é campo em branco — não se preenche com estimativa. Um relatório que
> mistura número medido com número plausível deixa de servir para autorizar produção, que é a
> única coisa que ele existe para fazer.

---

## 1. Situação em 16/08/2026

| bloco | estado |
|---|---|
| Testes automatizados (unitário, integração, contrato) | ✅ **concluído** |
| Carga contra a API (`M1-NFR-003`) | ✅ **medido** — ver §3 |
| Latência em hardware real (`M1-NFR-002`) | ⬜ **pendente** — bancada indisponível na data |
| Matriz negativa física (`M1-AC-006`) | ⬜ **pendente** — bancada indisponível na data |
| Smoke em hardware antes do release do Edge | ⬜ **pendente** |

**Motivo do pendente:** a bancada (catraca Topdata Inner Fit + leitor facial `192.168.2.188`)
não estava acessível a partir da máquina de desenvolvimento no dia da implementação. Os
scripts de medição estão prontos e testados no que não depende de hardware — falta executá-los
com o equipamento ligado.

---

## 2. Cobertura automatizada

| requisito | onde é provado |
|---|---|
| `M1-FR-019` resolver identidade no tenant/unidade corretos | `apps/api/test/integration/access-event.int-spec.ts` |
| `M1-FR-020` avaliar as cinco dimensões | `packages/access-policy/src/evaluate-access.spec.ts` |
| `M1-FR-021` `ALLOW`/`DENY` com razão estável e versão | idem + `access-reason.spec.ts` |
| `M1-FR-022` correlacionar reconhecimento, decisão, comando e passagem | `apps/edge-agent/src/application/orquestrar-acesso-online.spec.ts` |
| `M1-FR-023` override com permissão, motivo e auditoria | `apps/api/test/integration/manual-override.int-spec.ts` |
| `M1-BR-002` aluno bloqueado/inativo não entra | tabela de decisão + property test |
| `M1-BR-003` acesso depende de entitlement, nunca de assinatura | `access-projection.repository.ts` não consulta `Subscription` |
| `M1-BR-005` revogação bloqueia antes da exclusão física | `access-event.int-spec.ts`, `online-decision.int-spec.ts` |
| `M1-BR-006` política mais restritiva prevalece | property test de precedência |
| `M1-BR-007` override não altera assinatura nem entitlement | `manual-override.int-spec.ts` (fotografa antes/depois) |
| `M1-BR-009` evento imutável, correção vinculada | `access-event.int-spec.ts` |
| `M1-NFR-007` isolamento entre tenants | `access-event.int-spec.ts` |
| `M1-AC-005` aluno autorizado entra e gera evento completo | `online-decision.int-spec.ts` |
| `M1-AC-006` sem entitlement, a catraca não libera | `online-decision.int-spec.ts` + `orquestrar-acesso-online.spec.ts` |
| `M1-AC-008` override exige permissão e motivo, e é auditado | `manual-override.int-spec.ts` |

**Total na entrega:** 403 testes unitários e 215 de integração, verdes.

---

## 3. Carga — `M1-NFR-003` ✅

**Executado em:** 16/08/2026 · **Script:** `apps/api/test/load/online-access.ts`

### Baseline declarada

`M1-NFR-003` pede suportar **10× o pico medido da primeira unidade**. A unidade piloto ainda
não opera, então **não existe pico medido**. Em vez de inventar um, o teste roda contra uma
baseline conservadora declarada:

- catraca em horário de pico: ~1 passagem a cada 3 s ≈ **0,33 req/s por catraca**;
- baseline adotada com folga para várias catracas: **5 req/s**;
- alvo do teste: **50 req/s** (10×).

> ⚠️ **Este número substitui-se sozinho.** Quando a unidade piloto operar, o pico real entra
> em `LOAD_BASELINE_RPS` e o teste roda de novo. O script não muda.

### Resultado

| métrica | valor | critério |
|---|---|---|
| Taxa média sustentada | **50,0 req/s** | ≥ 47,5 (95% do alvo) ✅ |
| Latência p50 | **26 ms** | — |
| Latência p97,5 | **87 ms** | — |
| Latência p99 | **141 ms** | — |
| Latência máxima | **206 ms** | — |
| Respostas não-2xx | **0** | = 0 ✅ |
| Erros / timeouts | **0** | = 0 ✅ |
| Eventos gravados | **1501** | 1 por requisição ✅ |

**Duração:** 30 s · **Conexões:** 20 · **Mistura:** ~70% `ALLOW`, ~30% `DENY`

**Veredito: APROVADO** para a baseline declarada.

**Ambiente:** desenvolvimento local — API em `localhost:3344`, PostgreSQL 17 em contêiner,
mesma máquina. **Isto não é ambiente de produção**, e o número não autoriza produção sozinho:
ele estabelece que a aplicação sustenta 10× a baseline sem erro nem perda de evento.

> **Nota de reprodutibilidade.** O script exige `MFA_ENCRYPTION_KEY` fixa no `.env`. Sem ela,
> a API gera chave nova a cada arranque e não decifra a credencial que o script grava — a
> corrida inteira volta 401. O script falha cedo com essa instrução em vez de produzir um
> relatório de 1500 rejeições com aparência de medição.

---

## 4. Latência em hardware — `M1-NFR-002` ⬜ PENDENTE

**Script pronto:** `apps/edge-agent/test/hardware/online-passage.hardware.ts`

### O que precisa ser executado

```bash
# 1. Modo observação — mede a decisão SEM acionar a catraca.
#    É o passo 3 do rollout (MVP-01 §19): "piloto em modo observação".
pnpm --filter @arenahub/edge-agent test:hardware:access -- --sem-comando

# 2. Janela assistida — com comando físico habilitado.
pnpm --filter @arenahub/edge-agent test:hardware:access
```

**Pré-condições:** leitor facial e catraca na mesma unidade, cadastrados e sincronizados (F8
concluída); `.env` do edge-agent com `USE_SIMULATOR=false`; API alcançável do PC da bancada.

### Resultado — a preencher

| modelo | firmware | modo | n | p50 | p95 | p99 | máx | erros |
|---|---|---|---|---|---|---|---|---|
| Topdata Inner Fit | _(a preencher)_ | observação | | | | | | |
| Topdata Inner Fit | _(a preencher)_ | assistido | | | | | | |

**Limite homologado no MVP 0:** _(a preencher — se existir, ele vence o objetivo de 300 ms,
porque foi medido neste hardware)_

**Objetivo:** p95 < 300 ms (`M1-NFR-002`)

**Veredito:** _(a preencher)_

> **O cálculo do veredito já está testado.** `montarRelatorio` e `resumir` são funções puras
> com 12 testes em `relatorio-de-hardware.spec.ts`, rodando no CI. O que falta é a medição,
> não a conta — inclusive a regra de que o limite do MVP 0 vence o objetivo quando é mais
> restritivo.

---

## 5. Matriz negativa física — `M1-AC-006` ⬜ PENDENTE

Dez casos, cada um uma forma diferente de o sistema errar para o lado perigoso. O caso de
**controle** existe porque uma matriz em que nada pode passar não prova que algo passa quando
deve — um sistema quebrado que nega tudo passaria.

| # | caso | esperado | resultado | evento |
|---|---|---|---|---|
| 1 | `CONTROLE_VALIDO` — aluno ativo, direito vigente | **libera** | ⬜ | |
| 2 | `DIREITO_EXPIRADO` | nega | ⬜ | |
| 3 | `FORA_DO_HORARIO` | nega | ⬜ | |
| 4 | `ALUNO_BLOQUEADO` | nega | ⬜ | |
| 5 | `BLOQUEIO_ADMINISTRATIVO` | nega | ⬜ | |
| 6 | `BIOMETRIA_REVOGADA` — ainda presente no leitor | nega | ⬜ | |
| 7 | `IDENTIDADE_DESCONHECIDA` — cadastro de fábrica | nega | ⬜ | |
| 8 | `UNIDADE_ERRADA` | nega | ⬜ | |
| 9 | `RECONHECIMENTO_DUPLICADO` — sem segundo giro | nega | ⬜ | |
| 10 | `NUVEM_INDISPONIVEL` — até a Slice 1.5, `DENY` explícito | nega | ⬜ | |

**Critério:** todos os dez precisam passar. Não há "aprovado com ressalva" numa matriz cujo
objeto é provar que ninguém entra sem direito.

**Override** tem teste separado (§2, `M1-AC-008`) — ele não entra nesta matriz porque é o
único caminho em que liberar sem direito é o comportamento **correto**.

---

## 6. Gate de saída da fatia

| item | estado |
|---|---|
| Cloud e Edge compartilham a mesma política e versionamento | ✅ `packages/access-policy` |
| Nenhuma falha, timeout ou dado ausente produz `ALLOW` | ✅ property tests + `CLOUD_UNAVAILABLE` |
| `ALLOW` físico ocorre uma vez por evento de acesso | ✅ máquina de estado + teste de sabotagem |
| Passagem e timeout correlacionados; evento original imutável | ✅ `AccessPassage` separado |
| Override explícito, autorizado, auditado, sem alterar entitlement | ✅ `M1-BR-007` verificado |
| Latência e capacidade com relatório real por hardware | 🟡 **carga sim; hardware pendente** |
| `M1-AC-005/006/008` passam | 🟡 **automatizado sim; físico pendente** |

---

## 7. O que falta, explicitamente

1. Rodar §4 e §5 com a bancada ligada e colar os números aqui.
2. Registrar o limite de latência homologado no MVP 0, se houver.
3. Smoke em hardware antes de cada release do Edge (`MVP-01` §17).

**Nada disso bloqueia o merge desta fatia** — a implementação e a cobertura automatizada estão
completas. **Bloqueia sim a entrada em produção**, e é essa a diferença que este documento
registra.
