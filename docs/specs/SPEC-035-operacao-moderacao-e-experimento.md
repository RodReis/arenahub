# SPEC-035 — Operação, moderação e experimento

| campo | valor |
|---|---|
| **Fatia** | F35 |
| **MVP** | 5 |
| **Slice do PRD** | **5.6** — `docs/prd/academia/MVP-05-engagement.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-05-06-operations-experiment.md` |
| **Status** | ✅ **entregue** em 28/08/2026 |
| **ADRs que bloqueiam** | nenhum — **ADR-049** autoriza a fatia antes do gate do MVP 5 |

> **Esta spec é um ponteiro (ADR-022).** O escopo e os requisitos (`M5-FR/BR/NFR/AC`) moram no
> PRD, na Slice 5.6. O que este arquivo acrescenta é o que **divergiu** do PRD e do plano, com o
> ADR que autorizou cada divergência.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-05-engagement.md` §7, Slice 5.6.

**Superfícies:** painel (`admin-web`, a secretaria opera) e totem (`kiosk`, o aluno contesta).

**É a última fatia do MVP 5** — depois dela o gate original não guarda mais nenhuma fatia.

A fatia **não cria mecanismo de engajamento novo**: dá à secretaria o poder de **corrigir** os que
já existem sem abrir o banco. O aceite da Slice é literal — *"equipe corrige pontuação e remove
exposição sem editar banco diretamente"*.

---

## 2. Decisões específicas desta fatia

Todas em **ADR-049**, decididas pelo PI em 28/08/2026.

| # | decisão | por quê |
|---|---|---|
| 1 | A fatia **roda antes do gate** do MVP 5 | o app do MVP 4 não existe; os eventos confiáveis já foram consumidos por quatro fatias |
| 2 | Correção **RECUSA por teto**, sem segundo ator | precedente escrito em `BillingSettings.refundLimitMinor`; a academia inaugural tem **uma** secretaria, e fila que exige dois operadores nunca anda |
| 3 | Flag é **coluna no tenant**; experimento fica fora | precedente de `BillingSettings.blockAnchor`; experimento sem hipótese nem leitor nasceria código morto |
| 4 | Ranking ganha **três categorias**; evolução relativa fica fora | XP, frequência e consistência têm dado confiável hoje; `M5-BR-006` exige baseline corporal que o MVP 3 não entregou |
| 5 | Quem **oculta** é a secretaria, não o aluno | botão de denúncia numa tela de academia é ferramenta de briga entre alunos antes de ser de segurança |

### O que substituiu a segregação de função

O plano pedia `SEGREGATION_OF_DUTIES_REQUIRED` em três pontos. O repositório já decidira o
contrário, e a decisão estava escrita no schema. O que entrou no lugar:

| mecanismo | como aparece |
|---|---|
| permissão própria | `engagement.correct`, separada de `engagement.moderate` |
| teto por operação | `Tenant.engagementCorrectionLimitPoints`; acima dele, **recusa** |
| motivo obrigatório | já era invariante do ledger (`XP_MOTIVO_OBRIGATORIO`) |
| trilha | ator e instante em toda decisão; ledger append-only por trigger |

### O teto vale sobre o VALOR ABSOLUTO

O ponto perigoso da fatia. Comparar `pontos > teto` cru deixaria **toda correção negativa passar
por qualquer teto** — `-5000 > 100` é falso — e zerar o saldo de um aluno seria a operação menos
controlada do sistema. Há canário: removendo o `Math.abs`, três testes caem, e a verificação na
API real confirmou (`-500` recusado, `-50` aceito, com teto 100).

### Três estados do teto, que a tela poderia colapsar

| valor | significa |
|---|---|
| ausente | o operador não mexeu neste campo |
| `null` (vazio) | **sem teto** — o estado de todo tenant hoje, porque a coluna nasce nula |
| `0` | ninguém corrige nesta academia |

Tratar vazio como zero desligaria a correção de quem só queria tirar o limite. Canário no dublê:
trocar `!== undefined` por `??` derruba o teste.

---

## 3. Escopo negativo

Herda o do **ADR-048, Decisão 3** (quiet hours, orçamento de contato, canal externo) e acrescenta:

| fora | por quê | para onde foi |
|---|---|---|
| Experimento com grupo controle | sem hipótese, sem métrica de decisão, sem quem leia o resultado | fatia própria, quando houver a primeira pergunta que só um experimento responde |
| Atribuição estável por hash | idem | idem |
| Worker de guardrail / parada automática | idem | idem |
| Segregação de função (dois atores) | não existe papel de aprovador nesta base | substituída por permissão + teto (§2) |
| **Ranking de evolução relativa** | `M5-BR-006` exige baseline corporal comparável, que é entrega do MVP 3 e não existe | **ponta aberta** — entra com a fatia que trouxer o baseline |
| Despachante de outbox | continua sem consumidor | segue como estava desde a F31 |
| Canal de denúncia do aluno | decisão do PI (ADR-049 §5) | a secretaria oculta pela fila |

---

## 4. Invariantes que esta fatia precisa preservar

Nenhum `INV-nnn` novo. A fatia **preserva** os existentes, e há teste para cada um que ela toca:

| invariante | onde a fatia o toca |
|---|---|
| **INV-153** apelido não aprovado nunca é exibido | `HIDDEN` ganhou caminho de escrita; `resolverExposicao()` não mudou, e o teste trava o contrato para o estado agora alcançável |
| **INV-154** ausência de `ConsentRecord` = participa | os indicadores derivam `participandoDoRanking` por **subtração**; contar linhas `ACCEPTED` derruba 2 testes |
| **INV-155** aluno inativo nunca aparece | fica fora de todas as contagens do painel |
| **INV-156** ledger append-only | o teto é checado **antes** da escrita; a trigger barrou até um `DELETE` manual de bancada |
| **INV-160** snapshot publicado nunca é reescrito | a categoria entrou na chave única; regerar mês publicado devolve 409, não 500 |
| **INV-161** quem aparece é decidido na leitura | inalterado — a categoria muda a fonte dos pontos, não a exposição |

---

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Destravar a F35 do gate do MVP 5? | Sim, com ADR-049 | 28/08/2026 |
| 2 | Segregação de função (dois atores)? | Não — teto + permissão, seguindo o precedente | 28/08/2026 |
| 3 | Experimento com grupo controle? | Fora; só as flags por tenant | 28/08/2026 |
| 4 | Quais categorias de ranking? | XP, frequência e consistência; evolução relativa fica | 28/08/2026 |
| 5 | Quem denuncia um apelido? | A secretaria oculta; sem canal para o aluno | 28/08/2026 |

---

## 6. O que a execução revelou

Três achados que o CI não pegaria:

1. **Regerar placar de mês publicado devolvia 500 genérico.** Achado abrindo a tela. O banco de
   integração não tinha snapshot `PUBLISHED`; o de dev tinha. Corrigido para 409
   `RANKING_SNAPSHOT_IMUTAVEL`, com teste que monta a condição exata.
2. **`engagement.correct` não existe em banco já semeado.** O seed a cria, mas quem já tem o
   sistema rodando não ganha a permissão — deu 403 na verificação. Vale para produção: rodar o
   seed (idempotente) faz parte de subir esta fatia.
3. **A allowlist da ponte do totem** (`rotas-da-ponte.ts`) recusaria a rota nova antes de assinar,
   com 404 genérico — a mesma armadilha que quebrou a tela de desafios na F34. A linha foi
   adicionada e há canário.

Um defeito de UI que **não** era meu: o círculo preto sobre o menu no screenshot é o badge do
Next.js dev, não a tela.
