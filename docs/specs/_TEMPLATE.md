# SPEC-000 — <título da fatia>

| campo | valor |
|---|---|
| **Fatia** | F0 |
| **Slice do PRD** | 0.0 — `docs/prd/academia/MVP-00-....md` §7 |
| **MVP** | 0 |
| **Plano de apoio** | `docs/superpowers/plans/....md` |
| **Status** | `planejada` \| `rascunho` \| `em-revisao` \| `aprovada-pi` \| `entregue` |
| **Criada em** | AAAA-MM-DD |
| **Aprovada pelo PI em** | — |
| **Card** | — |

---

## 1. Objetivo em uma frase

<O que passa a ser possível depois desta fatia, do ponto de vista de quem usa. Sem jargão
técnico. Se precisar de duas frases, a fatia provavelmente é grande demais.>

---

## 2. Pré-condições

| item | estado |
|---|---|
| Gate de entrada do MVP | <qual, e a evidência> |
| ADRs que bloqueiam | <ADR-nnn — resolvido em DD/MM ou "nenhum"> |
| Fatias anteriores | <F<n> entregues> |
| Decisões dos PRDs | <`Mn-XXXX-01` atendida ou "n/a"> |

> Pré-condição não atendida = a spec **não** vira `aprovada-pi`.

---

## 3. Decisões desta fatia

Só o que **não** estava no PRD, no plano nem no `CONVENTION.md`. Se a lista estiver vazia, diga
"nenhuma decisão nova — a fatia é execução direta do PRD".

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | | | |

Decisão com efeito além desta fatia **vira ADR** em `docs/DECISIONS.md` — e a spec só aponta
para ele.

---

## 4. Escopo negativo

O que esta fatia **não** faz, e para onde foi.

| não faz | vai para |
|---|---|
| | |

---

## 5. Invariantes que esta fatia precisa preservar

Lista de `INV-nnn` do `docs/CONVENTION.md` §4 que o código desta fatia toca. **Cada um precisa
de teste** — é o que o revisor vai cobrar (`docs/REVIEW.md` §3).

- `INV-000` — <o que significa em concreto aqui>

---

## 6. Contrato

Só o que muda. Nada de repetir OpenAPI inteiro.

**Endpoints** — <método, rota, quem chama, o que muda>
**Eventos** — <nome no passado em inglês, `schemaVersion`, quem consome>
**Migrações** — <tabelas/colunas novas, e o rollback>

---

## 7. Critérios de aceite

Como o PI olha e diz "aceito". **Observável**, não interno.

- [ ] AC-1 — <ação> → <resultado visível>
- [ ] AC-2 —

Mapear para os `Mn-AC-nnn` do PRD quando houver correspondência.

---

## 8. Riscos e o que pode dar errado

| risco | sinal de que aconteceu | o que fazer |
|---|---|---|
| | | |

---

## 9. Perguntas ao PI

Todas resolvidas antes de `aprovada-pi`. **Nenhuma linha em branco na coluna "resposta".**

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | | | |

---

## 10. Fora de dúvida

Coisas que alguém vai querer perguntar de novo daqui a três meses, já respondidas aqui —
para não reabrir discussão fechada.

- <ponto> → <o que ficou decidido, e onde está registrado>
