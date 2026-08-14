# STATUS.md — ArenaHub

> Kanban e roadmap. **Prosa curta mora aqui, sem detalhe** — detalhe vai para
> `docs/STATUS-ARQUIVO.md`.
>
> **Donos deste arquivo:** o **Cowork** escreve **apenas** no *Índice Fatia ↔ SPEC* (uma linha
> por spec aprovada). **Todo o resto é do Code.** Se o Cowork precisar mexer em outra seção,
> para e pergunta ao PI.

**Última atualização:** 14/08/2026 · **Fase:** documentação e planejamento · **Código:** zero linha

**14/08/2026 — oito decisões novas + duas ratificações (ADR-005 e ADR-020).** Restam quatro
pendências: ADR-013 e ADR-007 inteiros, ADR-011 e ADR-008 em parte.

---

## 1. Onde estamos, em três frases

O repositório tem PRDs aprovados para planejamento, planos de implementação por slice e, desde
14/08/2026, o conjunto de documentos de governança. **Não existe `package.json`, `apps/`,
`packages/`, `infra/` nem `.github/`** — o bootstrap do monorepo é a primeira entrega.

Nada pode ser codificado até que: (a) a spec da fatia esteja `aprovada-pi` em `docs/specs/`,
e (b) os ADRs que a bloqueiam estejam resolvidos.

**Próximo movimento:** criar o board e os cards `[INFRA]` de bootstrap; em paralelo, o Cowork
escreve `SPEC-001` (bancada reproduzível). O MVP 0 depende de hardware, SDK e rede de
laboratório — nada disso é decisão, é providência.

---

## 2. Quadro

| coluna | label | o que significa | quantas |
|---|---|---|---|
| Backlog | `proplan:backlog` | spec aprovada, card criado, ninguém pegou | 0 |
| A Fazer | `proplan:todo` | Code pegou | 0 |
| Em Andamento | `proplan:doing` | Code está implementando | 0 |
| Feito | `proplan:done` | PR mergeado com CI verde | 0 |
| Finalizado | `proplan:finalizado` | **PI aceitou e fechou a issue** | 0 |

**Nenhum card existe ainda.** O board do GitHub precisa ser criado com estas cinco colunas e
as cinco labels antes do primeiro card — é trabalho `[INFRA]`.

---

## 3. Decisões abertas que bloqueiam trabalho

Ordenadas por quanto travam. Detalhe e opções em `docs/DECISIONS.md`.

### 3.1 Ainda aguardando o PI

| ADR | o que falta | bloqueia |
|---|---|---|
| **ADR-011** *(parcial)* | **provisionamento de identidade** do Edge na instalação e **credencial** de `/api/v1/edge/*`: certificado ou segredo? Rotação e revogação por quem? | F4 |
| **ADR-008** *(parcial)* | **base legal** (consentimento puro × legítimo interesse com LIA), **RIPD**, e papéis **controlador/operador** entre ArenaHub e academia | F8 |
| **ADR-013** | provedor de pagamento — sai do card `[GATE]` de homologação, com matriz de critérios já definida no ADR | F12–F16 |
| **ADR-007** | semântica entre validade e carência offline; conflito de reconciliação; push ou pull de snapshot. **Sem urgência** — migrou com F10 para o MVP 1.5 | F10 |

### 3.2 Decididos em 14/08/2026

| ADR | decisão |
|---|---|
| **ADR-002** | **Dois níveis** — `Tenant` = academia, `GymUnit` = unidade. Multiunidade em uso desde o dia 1; a Especificação §6 precisa de nota de emenda |
| **ADR-004** | **A nuvem decide sempre.** Reabre automaticamente se a POC medir p95 acima de 300 ms |
| **ADR-005** | `ALLOW`/`DENY`, `occurred_at`, `gym_unit_id`, `access_policies`. Eventos mantêm `AccessGranted`/`AccessDenied`, transportando `outcome` |
| **ADR-008** | Expurgo de biometria em **30 dias** após o fim do vínculo. **Há aluno menor** → consentimento por responsável legal é escopo obrigatório de F8 |
| **ADR-009** | Não opera com convênio hoje. `Entitlement.source` nasce como enum extensível; integração fica fora do roadmap |
| **ADR-011** | `edge-agent` no **PC da recepção**, compartilhado. Mitigação: serviço com início automático, alerta de heartbeat obrigatório em F11, regra escrita de não desligar, liberação manual como fallback |
| **ADR-012** | **Offline sai do MVP 1** e vira MVP 1.5 |
| **ADR-019** | Bloqueio no primeiro instante de `due_date + grace_period` (13/08 no exemplo), **configurável** em `BillingSettings`. Timezone **da unidade**, sem fallback |
| **ADR-020** | Schema Prisma em `packages/database`. **Exige emenda ao `prd/README.md` §5** |

**Também aguardando o PI** (não são ADR; **nascem nos planos**, não nos PRDs — promovê-los ao PRD ou tratá-los como apoio é decisão do PI): `M2-COMPLIANCE-01`,
`M3-CLINICAL-01` (manifest de protocolo de saúde com assinatura profissional),
`M3-STUDENT-AI-01`, `M4-DIST-01` (publicação em lojas), `M5-RULES-01` (catálogo de XP e
streak assinado por profissional) e as **8 decisões abertas de `docs/DESIGN-UI.md` §17** —
entre elas a lista canônica de razões de `DENY`, que F9 precisa.

---

## 4. Roadmap

| MVP | entrega | gate de entrada | fatias | estado |
|---|---|---|---|---|
| **0** | Hardware e protocolo Topdata comprovados em bancada | hardware + SDK + rede de laboratório | F1–F5 | não iniciado |
| **1** | Academia operando acesso online, com assinatura manual | decisão de saída do MVP 0 (`MVP-00` §15) = `GO` ou `GO_WITH_CONSTRAINTS` | F6–F9, F11 | bloqueado por MVP 0 |
| **1.5** | Operação offline: snapshot, fila e reconciliação | MVP 1 em piloto, com incidente de link medido | F10 | adiado por **ADR-012** |
| **2** | Pagamento controla entitlement automaticamente | MVP 1 estável + **provedor homologado** | F12–F16 | bloqueado por ADR-013 |
| **3** | Evolução física rastreável + IA assistiva | identidade e frequência estáveis + protocolo clínico | F17–F22 | bloqueado por MVP 1 |
| **4** | Autosserviço: app do aluno e totem | APIs estáveis dos MVPs 1, 2 e 3 | F23–F29 | bloqueado |
| **5** | Engajamento opt-in mensurável | eventos confiáveis + app do MVP 4 | F30–F35 | bloqueado |
| **6** | Risco de churn explicável → tarefa operacional | ≥ 6 meses de histórico confiável | F36–F41 | bloqueado |

**Observação sobre o MVP 3:** o índice do plano declara que **o MVP 2 não é dependência
funcional** — MVP 3 pode andar em paralelo se o PI priorizar assim.

---

## 5. Índice Fatia ↔ SPEC

> **Fonte única da numeração.** *Nunca o número nu, sempre o par.* Escrito **só pelo Cowork**.
>
> Regra (ADR-015): `Slice N.M` = `F<n>` = `SPEC-<nnn>`, mesmo número, alocado uma vez, nunca
> reaproveitado. Planos de gate não são fatias — viram card `[GATE]`.
>
> `status` da spec: `planejada` (número reservado, arquivo não existe) → `rascunho` →
> `em-revisao` → `aprovada-pi` → `entregue`. Mesmo conjunto em `docs/specs/README.md` §3.

| F | SPEC | MVP | Slice | título | spec | issue | status |
|---|---|---|---|---|---|---|---|
| F1 | SPEC-001 | 0 | 0.1 | Bancada reproduzível | [`SPEC-001-bancada-reproduzivel.md`](specs/SPEC-001-bancada-reproduzivel.md) | — | aprovada-pi |
| F2 | SPEC-002 | 0 | 0.2 | Ciclo de vida facial | [`SPEC-002-ciclo-de-vida-facial.md`](specs/SPEC-002-ciclo-de-vida-facial.md) | — | aprovada-pi |
| F3 | SPEC-003 | 0 | 0.3 | Catraca e passagem | [`SPEC-003-catraca-e-passagem.md`](specs/SPEC-003-catraca-e-passagem.md) | — | aprovada-pi |
| F4 | SPEC-004 | 0 | 0.4 | Offline e reconciliação | [`SPEC-004-offline-e-reconciliacao.md`](specs/SPEC-004-offline-e-reconciliacao.md) | — | em-revisao |
| F5 | SPEC-005 | 0 | 0.5 | Relatório e decisão | [`SPEC-005-relatorio-e-decisao.md`](specs/SPEC-005-relatorio-e-decisao.md) | — | aprovada-pi |
| F6 | SPEC-006 | 1 | 1.1 | Core seguro e unidade | [`SPEC-006-core-seguro-e-unidade.md`](specs/SPEC-006-core-seguro-e-unidade.md) | — | aprovada-pi |
| F7 | SPEC-007 | 1 | 1.2 | Aluno, plano e entitlement manual | [`SPEC-007-aluno-plano-e-entitlement-manual.md`](specs/SPEC-007-aluno-plano-e-entitlement-manual.md) | — | aprovada-pi |
| F8 | SPEC-008 | 1 | 1.3 | Consentimento, biometria e sync de dispositivo | [`SPEC-008-consentimento-biometria-e-sync-de-dispositivo.md`](specs/SPEC-008-consentimento-biometria-e-sync-de-dispositivo.md) | — | em-revisao |
| F9 | SPEC-009 | 1 | 1.4 | Decisão online e passagem | [`SPEC-009-decisao-online-e-passagem.md`](specs/SPEC-009-decisao-online-e-passagem.md) | — | aprovada-pi |
| F10 | SPEC-010 | 1.5 | 1.5 | Operação offline | [`SPEC-010-operacao-offline.md`](specs/SPEC-010-operacao-offline.md) | — | em-revisao |
| F11 | SPEC-011 | 1 | 1.6 | Painel operacional e prontidão | [`SPEC-011-painel-operacional-e-prontidao.md`](specs/SPEC-011-painel-operacional-e-prontidao.md) | — | aprovada-pi |
| F12 | SPEC-012 | 2 | 2.1 | Ledger operacional e invoice | [`SPEC-012-ledger-operacional-e-invoice.md`](specs/SPEC-012-ledger-operacional-e-invoice.md) | — | em-revisao |
| F13 | SPEC-013 | 2 | 2.2 | PIX e webhook idempotente | [`SPEC-013-pix-e-webhook-idempotente.md`](specs/SPEC-013-pix-e-webhook-idempotente.md) | — | em-revisao |
| F14 | SPEC-014 | 2 | 2.3 | Cartão e recorrência | [`SPEC-014-cartao-e-recorrencia.md`](specs/SPEC-014-cartao-e-recorrencia.md) | — | em-revisao |
| F15 | SPEC-015 | 2 | 2.4 | Inadimplência e acesso | [`SPEC-015-inadimplencia-e-acesso.md`](specs/SPEC-015-inadimplencia-e-acesso.md) | — | em-revisao |
| F16 | SPEC-016 | 2 | 2.5 | Estorno, conciliação e operação | [`SPEC-016-estorno-conciliacao-e-operacao.md`](specs/SPEC-016-estorno-conciliacao-e-operacao.md) | — | em-revisao |
| F17 | SPEC-017 | 3 | 3.1 | Consentimento e avaliação manual | [`SPEC-017-consentimento-e-avaliacao-manual.md`](specs/SPEC-017-consentimento-e-avaliacao-manual.md) | — | planejada |
| F18 | SPEC-018 | 3 | 3.2 | Histórico e comparativos | [`SPEC-018-historico-e-comparativos.md`](specs/SPEC-018-historico-e-comparativos.md) | — | planejada |
| F19 | SPEC-019 | 3 | 3.3 | Upload e revisão | [`SPEC-019-upload-e-revisao.md`](specs/SPEC-019-upload-e-revisao.md) | — | planejada |
| F20 | SPEC-020 | 3 | 3.4 | Metas e frequência | [`SPEC-020-metas-e-frequencia.md`](specs/SPEC-020-metas-e-frequencia.md) | — | planejada |
| F21 | SPEC-021 | 3 | 3.5 | Análise assistiva por IA | [`SPEC-021-analise-assistiva-por-ia.md`](specs/SPEC-021-analise-assistiva-por-ia.md) | — | planejada |
| F22 | SPEC-022 | 3 | 3.6 | Operação e qualidade | [`SPEC-022-operacao-e-qualidade.md`](specs/SPEC-022-operacao-e-qualidade.md) | — | planejada |
| F23 | SPEC-023 | 4 | 4.1 | Identidade e shell mobile | [`SPEC-023-identidade-e-shell-mobile.md`](specs/SPEC-023-identidade-e-shell-mobile.md) | — | planejada |
| F24 | SPEC-024 | 4 | 4.2 | Carteirinha, plano e frequência | [`SPEC-024-carteirinha-plano-e-frequencia.md`](specs/SPEC-024-carteirinha-plano-e-frequencia.md) | — | planejada |
| F25 | SPEC-025 | 4 | 4.3 | Financeiro mobile | [`SPEC-025-financeiro-mobile.md`](specs/SPEC-025-financeiro-mobile.md) | — | planejada |
| F26 | SPEC-026 | 4 | 4.4 | Avaliações e consentimentos | [`SPEC-026-avaliacoes-e-consentimentos.md`](specs/SPEC-026-avaliacoes-e-consentimentos.md) | — | planejada |
| F27 | SPEC-027 | 4 | 4.5 | Kiosk seguro | [`SPEC-027-kiosk-seguro.md`](specs/SPEC-027-kiosk-seguro.md) | — | planejada |
| F28 | SPEC-028 | 4 | 4.6 | Pagamento e desbloqueio no totem | [`SPEC-028-pagamento-e-desbloqueio-no-totem.md`](specs/SPEC-028-pagamento-e-desbloqueio-no-totem.md) | — | planejada |
| F29 | SPEC-029 | 4 | 4.7 | Piloto e distribuição | [`SPEC-029-piloto-e-distribuicao.md`](specs/SPEC-029-piloto-e-distribuicao.md) | — | planejada |
| F30 | SPEC-030 | 5 | 5.1 | Preferências e identidade pública | [`SPEC-030-preferencias-e-identidade-publica.md`](specs/SPEC-030-preferencias-e-identidade-publica.md) | — | planejada |
| F31 | SPEC-031 | 5 | 5.2 | XP e conquistas | [`SPEC-031-xp-e-conquistas.md`](specs/SPEC-031-xp-e-conquistas.md) | — | planejada |
| F32 | SPEC-032 | 5 | 5.3 | Consistência e streak | [`SPEC-032-consistencia-e-streak.md`](specs/SPEC-032-consistencia-e-streak.md) | — | planejada |
| F33 | SPEC-033 | 5 | 5.4 | Rankings privados por padrão | [`SPEC-033-rankings-privados-por-padrao.md`](specs/SPEC-033-rankings-privados-por-padrao.md) | — | planejada |
| F34 | SPEC-034 | 5 | 5.5 | Desafios e notificações | [`SPEC-034-desafios-e-notificacoes.md`](specs/SPEC-034-desafios-e-notificacoes.md) | — | planejada |
| F35 | SPEC-035 | 5 | 5.6 | Operação, moderação e experimento | [`SPEC-035-operacao-moderacao-e-experimento.md`](specs/SPEC-035-operacao-moderacao-e-experimento.md) | — | planejada |
| F36 | SPEC-036 | 6 | 6.1 | Contrato de dados e baseline analítica | [`SPEC-036-contrato-de-dados-e-baseline-analitica.md`](specs/SPEC-036-contrato-de-dados-e-baseline-analitica.md) | — | planejada |
| F37 | SPEC-037 | 6 | 6.2 | Regras explicáveis e score | [`SPEC-037-regras-explicaveis-e-score.md`](specs/SPEC-037-regras-explicaveis-e-score.md) | — | planejada |
| F38 | SPEC-038 | 6 | 6.3 | CRM de retenção | [`SPEC-038-crm-de-retencao.md`](specs/SPEC-038-crm-de-retencao.md) | — | planejada |
| F39 | SPEC-039 | 6 | 6.4 | Experimento operacional | [`SPEC-039-experimento-operacional.md`](specs/SPEC-039-experimento-operacional.md) | — | planejada |
| F40 | SPEC-040 | 6 | 6.5 | Modelo supervisionado (condicionado a M6-ML-01) | [`SPEC-040-modelo-supervisionado-condicionado-a-m6-ml-01.md`](specs/SPEC-040-modelo-supervisionado-condicionado-a-m6-ml-01.md) | — | planejada |
| F41 | SPEC-041 | 6 | 6.6 | Produção controlada e monitoramento | [`SPEC-041-producao-controlada-e-monitoramento.md`](specs/SPEC-041-producao-controlada-e-monitoramento.md) | — | planejada |

**Cards `[GATE]` previstos** (não são fatias, não têm SPEC nem F): homologação de provedor de
pagamento (MVP 2), portões clínicos (MVP 3), portões de canal (MVP 4), portões de engajamento
(MVP 5), portões de retenção (MVP 6).

**Exceção registrada (ADR-015):** o índice do plano do MVP 1 divide a Slice 1.3 em duas etapas
com gates distintos. F8 permanece **uma** fatia, com a etapa de sync físico bloqueada por
`HW-GATE-01` (portão de entrada de bancada).

---

## 6. Trabalho `[INFRA]` conhecido, ainda sem card

1. Criar board no GitHub com as 5 colunas e as 5 labels `proplan:*`. **Este item não pode ter card** — ver a *exceção de arranque* em `docs/DEVELOPMENT.md` §2.
2. Bootstrap do monorepo — fazer os 8 comandos obrigatórios existirem antes da primeira feature.
3. `.github/workflows/ci.yml` com build, lint, typecheck, testes e guardas de evidência.
4. `docker-compose` local: Postgres + Redis + MinIO.
5. Colocar sob versionamento os arquivos hoje *untracked* (`CLAUDE.md`, `docs/DESIGN-UI.md`,
   `docs/TESTING.md`, a Especificação Completa e os documentos criados em 14/08/2026).

---

## 7. Riscos vivos

| risco | impacto | mitigação |
|---|---|---|
| SDK Topdata pode ser Windows-only / DLL nativa | muda stack e deploy do `edge-agent` | é o objeto do MVP 0; `NO_GO` é resultado válido |
| ANPD atuando sobre biometria **antes** da norma sair (caso PR, 04/08/2026) | suspensão do produto no cliente | ADR-008: base legal, comprovação de segurança, log de acesso a template, caminho alternativo |
| **Catraca depende do uptime do PC da recepção** — sem offline no MVP 1, PC desligado = catraca parada | incidente na frente do cliente | ADR-011: serviço automático, alerta de heartbeat em F11, regra escrita, liberação manual |
| Link ruim no piloto sem offline | fila na recepção em horário de pico | primeiro incidente é gatilho para priorizar o MVP 1.5 |
| **Aluno menor de idade + biometria** | agravante em fiscalização da ANPD | ADR-008: consentimento por responsável legal é escopo obrigatório de F8 |
| Quatro frontends antes do primeiro cliente | custo de release multiplicado | roadmap já sequencia; não antecipar |
| Concorrência entrega acesso facial de fábrica | diferencial não está no hardware | `docs/LANDSCAPE.md` |
| `edge-agent` roda em máquina que não controlamos | catraca para e não sabemos por quê | ADR-011 |
