# STATUS.md — ArenaHub

> Kanban e roadmap. **Prosa curta mora aqui, sem detalhe** — detalhe vai para
> `docs/STATUS-ARQUIVO.md`.
>
> **Donos deste arquivo:** o **Cowork** escreve **apenas** no *Índice Fatia ↔ SPEC* (uma linha
> por spec aprovada). **Todo o resto é do Code.** Se o Cowork precisar mexer em outra seção,
> para e pergunta ao PI.

**Última atualização:** 14/08/2026 · **Fase:** documentação e planejamento · **Código:** zero linha

---

## 1. Onde estamos, em três frases

O repositório tem PRDs aprovados para planejamento, planos de implementação por slice e, desde
14/08/2026, o conjunto de documentos de governança. **Não existe `package.json`, `apps/`,
`packages/`, `infra/` nem `.github/`** — o bootstrap do monorepo é a primeira entrega.

Nada pode ser codificado até que: (a) a spec da fatia esteja `aprovada-pi` em `docs/specs/`,
e (b) os ADRs que a bloqueiam estejam resolvidos.

**Próximo movimento:** o PI decide os ADRs abertos que travam o MVP 0 e o MVP 1; o Cowork
escreve `SPEC-001` (bancada reproduzível) e cria o primeiro card.

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

| ADR | pergunta ao PI | bloqueia |
|---|---|---|
| **ADR-010** | *(já aceito)* — mas a POC precisa de hardware, SDK e rede de laboratório para atender `HW-GATE-01` (portão de **entrada** de bancada, definido no plano do MVP 0) | **tudo depois de F5** |
| **ADR-011** | Onde roda o `edge-agent`? Que SO, quem instala, como atualiza, como ganha identidade? | F4, F10 |
| **ADR-002** | Existe rede/franquia no horizonte? (2 ou 3 níveis de hierarquia) | F6 |
| **ADR-009** | O Arena Positiva opera com Wellhub/TotalPass hoje? | F7 |
| **ADR-008** | Retenção de biometria, menor de idade, base legal, RIPD, papéis controlador/operador | F8 |
| **ADR-005** | Ratificar `ALLOW`/`DENY`, `occurred_at`, `gym_unit_id`, `access_policies` | F9 |
| **ADR-004** | Nuvem decide sempre, ou Edge decide com snapshot quente? *(medir na POC antes)* | F9, F10 |
| **ADR-007** | Semântica entre validade e carência; conflito de reconciliação; push ou pull de snapshot | F10 |
| **ADR-012** | Offline fica no MVP 1 ou vira MVP 1.5? | F10 |
| **ADR-013** | Qual provedor de pagamento; políticas de refund e limites | F12–F16 |
| **ADR-019** | Carência de 3 dias sobre 10/08 bloqueia em 13 ou 14? Timezone de unidade ou tenant? | F15 |

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
| **1** | Academia operando acesso, com assinatura manual | decisão de saída do MVP 0 (`MVP-00` §15) = `GO` ou `GO_WITH_CONSTRAINTS` | F6–F11 | bloqueado por MVP 0 |
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
| F1 | SPEC-001 | 0 | 0.1 | Bancada reproduzível | — | — | planejada |
| F2 | SPEC-002 | 0 | 0.2 | Ciclo de vida facial | — | — | planejada |
| F3 | SPEC-003 | 0 | 0.3 | Catraca e passagem | — | — | planejada |
| F4 | SPEC-004 | 0 | 0.4 | Offline e reconciliação | — | — | planejada |
| F5 | SPEC-005 | 0 | 0.5 | Relatório e decisão | — | — | planejada |
| F6 | SPEC-006 | 1 | 1.1 | Core seguro e unidade | — | — | planejada |
| F7 | SPEC-007 | 1 | 1.2 | Aluno, plano e entitlement manual | — | — | planejada |
| F8 | SPEC-008 | 1 | 1.3 | Consentimento, biometria e sync de dispositivo | — | — | planejada |
| F9 | SPEC-009 | 1 | 1.4 | Decisão online e passagem | — | — | planejada |
| F10 | SPEC-010 | 1 | 1.5 | Operação offline | — | — | planejada |
| F11 | SPEC-011 | 1 | 1.6 | Painel operacional e prontidão | — | — | planejada |
| F12 | SPEC-012 | 2 | 2.1 | Ledger operacional e invoice | — | — | planejada |
| F13 | SPEC-013 | 2 | 2.2 | PIX e webhook idempotente | — | — | planejada |
| F14 | SPEC-014 | 2 | 2.3 | Cartão e recorrência | — | — | planejada |
| F15 | SPEC-015 | 2 | 2.4 | Inadimplência e acesso | — | — | planejada |
| F16 | SPEC-016 | 2 | 2.5 | Estorno, conciliação e operação | — | — | planejada |
| F17 | SPEC-017 | 3 | 3.1 | Consentimento e avaliação manual | — | — | planejada |
| F18 | SPEC-018 | 3 | 3.2 | Histórico e comparativos | — | — | planejada |
| F19 | SPEC-019 | 3 | 3.3 | Upload e revisão | — | — | planejada |
| F20 | SPEC-020 | 3 | 3.4 | Metas e frequência | — | — | planejada |
| F21 | SPEC-021 | 3 | 3.5 | Análise assistiva por IA | — | — | planejada |
| F22 | SPEC-022 | 3 | 3.6 | Operação e qualidade | — | — | planejada |
| F23 | SPEC-023 | 4 | 4.1 | Identidade e shell mobile | — | — | planejada |
| F24 | SPEC-024 | 4 | 4.2 | Carteirinha, plano e frequência | — | — | planejada |
| F25 | SPEC-025 | 4 | 4.3 | Financeiro mobile | — | — | planejada |
| F26 | SPEC-026 | 4 | 4.4 | Avaliações e consentimentos no app | — | — | planejada |
| F27 | SPEC-027 | 4 | 4.5 | Kiosk seguro | — | — | planejada |
| F28 | SPEC-028 | 4 | 4.6 | Pagamento e desbloqueio no totem | — | — | planejada |
| F29 | SPEC-029 | 4 | 4.7 | Piloto e distribuição | — | — | planejada |
| F30 | SPEC-030 | 5 | 5.1 | Preferências e identidade pública | — | — | planejada |
| F31 | SPEC-031 | 5 | 5.2 | XP e conquistas | — | — | planejada |
| F32 | SPEC-032 | 5 | 5.3 | Consistência e streak | — | — | planejada |
| F33 | SPEC-033 | 5 | 5.4 | Rankings privados por padrão | — | — | planejada |
| F34 | SPEC-034 | 5 | 5.5 | Desafios e notificações | — | — | planejada |
| F35 | SPEC-035 | 5 | 5.6 | Operação, moderação e experimento | — | — | planejada |
| F36 | SPEC-036 | 6 | 6.1 | Contrato de dados e baseline analítica | — | — | planejada |
| F37 | SPEC-037 | 6 | 6.2 | Regras explicáveis e score | — | — | planejada |
| F38 | SPEC-038 | 6 | 6.3 | CRM de retenção | — | — | planejada |
| F39 | SPEC-039 | 6 | 6.4 | Experimento operacional | — | — | planejada |
| F40 | SPEC-040 | 6 | 6.5 | Modelo supervisionado (condicionado a `M6-ML-01`) | — | — | planejada |
| F41 | SPEC-041 | 6 | 6.6 | Produção controlada e monitoramento | — | — | planejada |

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
| MVP 1 com 16 itens, incluindo offline completo | primeira academia demora | ADR-012 |
| Quatro frontends antes do primeiro cliente | custo de release multiplicado | roadmap já sequencia; não antecipar |
| Concorrência entrega acesso facial de fábrica | diferencial não está no hardware | `docs/LANDSCAPE.md` |
| `edge-agent` roda em máquina que não controlamos | catraca para e não sabemos por quê | ADR-011 |
