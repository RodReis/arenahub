# STATUS.md — ArenaHub

> Kanban e roadmap. **Prosa curta mora aqui, sem detalhe** — detalhe vai para
> `docs/STATUS-ARQUIVO.md`.
>
> **Dono deste arquivo: o Cowork, por inteiro** (ADR-021 dissolveu a divisão por seção que valia
> antes). Se o Code encontrar este arquivo divergente da sua branch, **a versão da `main` vence**
> e ele reaplica o próprio progresso por cima — nunca desfaz linha do Cowork.

**Última atualização:** 14/08/2026 *(segunda rodada)* · **Fase:** bootstrap `[INFRA]` **concluído** ·
**Código:** os 6 cards entregues — #42 a #47. **A exceção de arranque morreu.**

**14/08/2026, segunda rodada — ADR-011 e ADR-008 fechados.** F4 e F8 destravadas. Restam **duas**
pendências, nenhuma no caminho crítico de hoje: ADR-013 (sai da homologação do MVP 2, não de
escolha) e ADR-007 (migrou com F10 para o MVP 1.5). Um ponto remanescente do ADR-008 mudou de
dono: bloqueia F21, não F8.

**Correção material registrada:** o ADR-008 oferecia "legítimo interesse com LIA" como base legal
alternativa. **Essa hipótese não existe para dado biométrico** — é dado sensível, e o art. 11 da
LGPD é lista fechada onde legítimo interesse não figura. Corrigido no ADR.

---

## 1. Onde estamos, em três frases

O repositório tem PRDs aprovados para planejamento, planos de implementação por slice e, desde
14/08/2026, o conjunto de documentos de governança. **O bootstrap `[INFRA]` fechou em 14/08/2026** —
os seis cards (#42 a #47): monorepo, `packages/config` com TypeScript estrito e ESLint, ambiente
Docker com Postgres/Redis/MinIO, os oito comandos que **falham com mensagem em vez de mentir**,
`packages/database` com Prisma 7 e migration inicial vazia, e o **CI com a guarda de evidência**.
As pastas de `apps/` continuam vazias — bootstrap é encanamento, não feature.

🏁 **A *exceção de arranque* morreu** com o #47. O ciclo normal do `DEVELOPMENT.md` §2 vale
inteiro: o CI decide o merge, e a guarda de evidência barra relatório que não bate com a execução.

**O gargalo agora é decisão de produto, não encanamento.** Não há mais card `[INFRA]` no caminho;
o que trava é o que sempre travou — ADR aberto e hardware do MVP 0.

Nada pode ser codificado até que: (a) a spec da fatia esteja `aprovada-pi` em `docs/specs/`,
e (b) os ADRs que a bloqueiam estejam resolvidos.

**Próximo movimento: o gargalo não é mais documento.** As 41 specs existem, e as cinco do MVP 0
estão sem ADR bloqueando. O que falta é execução em duas frentes que não dependem uma da outra:

1. **Code:** ✅ bootstrap entregue. **Resta o board no GitHub** — Projects com 5 colunas, cores e
   descrições das labels. É ação no GitHub, fora do repositório, e não bloqueia código.
2. **PI:** providência física do MVP 0 — hardware Topdata, SDK e rede de laboratório. **Não é
   decisão, é compra e agendamento**, e é o único caminho para responder se o SDK é Windows-only
   — pergunta que muda a stack inteira do `edge-agent` e que nenhum documento responde. **Agora é
   o único item no caminho crítico**: com o encanamento pronto, F1 depende de bancada, não de nós.

---

## 2. Quadro

| coluna | label | o que significa | quantas |
|---|---|---|---|
| Backlog | `proplan:backlog` | card criado; **estacionamento visível** — nem tudo aqui é pegável | **41** |
| A Fazer | `proplan:todo` | Code pegou | 0 |
| Em Andamento | `proplan:doing` | Code está implementando | 0 |
| Feito | `proplan:done` | PR mergeado com CI verde | **6** — os seis do bootstrap: [#42](https://github.com/RodReis/arenahub/issues/42), [#43](https://github.com/RodReis/arenahub/issues/43), [#44](https://github.com/RodReis/arenahub/issues/44), [#45](https://github.com/RodReis/arenahub/issues/45), [#46](https://github.com/RodReis/arenahub/issues/46), [#47](https://github.com/RodReis/arenahub/issues/47) |
| Finalizado | `proplan:finalizado` | **PI aceitou e fechou a issue** | 0 |

**Definição de Backlog corrigida em 14/08/2026.** Dizia *"spec aprovada, card criado"*, o que
contradizia o **ADR-022**: *"o card de fatia passa a ser criado para **todas** as fatias, em
Backlog... o portão não se moveu, só ficou mais cedo."* O portão é a **saída** para `todo`, não a
entrada. Decisão do PI em 14/08/2026: vale o ADR-022.

**As 41 issues existem** em [`RodReis/arenahub`](https://github.com/RodReis/arenahub/issues), com
`#N` = `F<n>` — issue #8 é a fatia F8. Coincidência de numeração, não garantia: **a fonte única
continua sendo o Índice da §5**, não o número do GitHub.

**Do Backlog, 10 são pegáveis hoje** — F1–F9 e F11, todas `aprovada-pi` e sem ADR bloqueando.
As outras 31 estão estacionadas: F10 por ADR-007, F12–F16 por ADR-013, e F17–F41 porque o MVP
ainda não foi discutido com o PI.

> ⚠️ **O board (Projects) ainda não existe** — só as labels, criadas automaticamente pela API ao
> aplicar `proplan:backlog`. Elas nasceram **sem cor e sem descrição**, e as outras quatro
> (`todo`, `doing`, `done`, `finalizado`) **só existirão quando forem usadas pela primeira vez**.
> Criar o Projects com as cinco colunas e dar cor/descrição às labels continua sendo `[INFRA]`.

> ⚠️ **Pendência do padrão de título:** o `CLAUDE.md` define `[MVP0]`…`[MVP6]` e **não tem token
> para MVP 1.5**, criado pelo ADR-012. A issue #10 (F10) ficou **sem token de MVP** — inventar
> `[MVP1.5]` violaria a regra de ouro *"só entra token que é verdade"*. **Decisão do PI:** criar o
> token ou aceitar a ausência.

---

## 3. Decisões abertas que bloqueiam trabalho

Ordenadas por quanto travam. Detalhe e opções em `docs/DECISIONS.md`.

### 3.1 Ainda aguardando o PI

| ADR | o que falta | bloqueia |
|---|---|---|
| **ADR-008** *(ponto remanescente)* | **transferência internacional** de dado sensível, se o provedor de IA de saúde estiver fora do Brasil. **Reapontado:** bloqueava F8 por engano — F8 não chama IA nenhuma | F21 |
| **ADR-013** | provedor de pagamento — **não é decisão sua hoje**: sai do card `[GATE]` de homologação, com a matriz de critérios já definida no ADR. O que dá para fechar antes do gate são as duas políticas do `M2-COMPLIANCE-01` e o **modelo de `Payment`, que não tem campos definidos em documento nenhum** — invoice paga em duas tentativas (PIX falho + cartão) não cabe no modelo atual | F12–F16 |
| **ADR-007** | semântica entre validade e carência offline; conflito de reconciliação; push ou pull de snapshot. **Sem urgência** — migrou com F10 para o MVP 1.5 | F10 |

### 3.2 Decididos em 14/08/2026 — segunda rodada

| ADR | decisão |
|---|---|
| **ADR-011** *(fecha o ADR)* | **Provisionamento por código de pareamento de uso único**, com TTL curto e vinculado a `tenant_id` + `gym_unit_id`; o agente troca por **segredo próprio por dispositivo**, guardado no DPAPI/Credential Manager. Nenhum segredo dentro do instalador. **mTLS recusado por custo de operar PKI** para uma unidade — decisão datada, reabre em escala ou por exigência enterprise |
| **ADR-011** *(fecha o ADR)* | **Rotação automática** pelo próprio agente, com credencial de uso de vida curta; **revogação imediata pelo admin do tenant no painel**, sem chamado. **Consequência que vira escopo de F11:** o alerta de heartbeat passa a ter duas causas distintas — Edge ausente e falha de renovação de credencial |
| **ADR-008** | **Base legal: consentimento específico e destacado (art. 11, I).** A alínea "g" (prevenção à fraude) foi **recusada** — hipótese estreita, com ressalva de direitos fundamentais no próprio texto, e base legal ausente foi o fundamento nº 1 da suspensão no caso PR |
| **ADR-008** | **Academia é controladora, ArenaHub é operador**, com contrato de tratamento do art. 39 como entregável de F8. **Fragilidade registrada:** definimos retenção, motor de decisão e política de log — quem define meios é controlador, e a ANPD pode reclassificar. Mitigação: virar essas decisões em parâmetro do cliente, com padrão seguro |
| **ADR-008** | **RIPD: template produzido pelo ArenaHub, adotado e assinado pela academia.** Passa por revisão jurídica antes do primeiro cliente — template errado escala o erro |

### 3.3 Decididos em 14/08/2026 — primeira rodada

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
> `status` da spec: `planejada` → `rascunho` → `em-revisao` → `aprovada-pi` → `entregue`.
> Mesmo conjunto em `docs/specs/README.md` §3.
>
> **Correção de 14/08/2026:** `planejada` era definido como *"número reservado, arquivo não
> existe"*. Depois do ADR-022 os 41 arquivos-ponteiro passaram a ser criados de uma vez, e 25
> deles existem com esse status — a definição descrevia um mundo que acabou. `planejada` agora
> significa: **ponteiro criado, MVP ainda não discutido com o PI.** Não há pergunta apresentada,
> logo não há o que aprovar.

| F | SPEC | MVP | Slice | título | spec | issue | status |
|---|---|---|---|---|---|---|---|
| F1 | SPEC-001 | 0 | 0.1 | Bancada reproduzível | [`SPEC-001-bancada-reproduzivel.md`](specs/SPEC-001-bancada-reproduzivel.md) | [#1](https://github.com/RodReis/arenahub/issues/1) | aprovada-pi |
| F2 | SPEC-002 | 0 | 0.2 | Ciclo de vida facial | [`SPEC-002-ciclo-de-vida-facial.md`](specs/SPEC-002-ciclo-de-vida-facial.md) | [#2](https://github.com/RodReis/arenahub/issues/2) | aprovada-pi |
| F3 | SPEC-003 | 0 | 0.3 | Catraca e passagem | [`SPEC-003-catraca-e-passagem.md`](specs/SPEC-003-catraca-e-passagem.md) | [#3](https://github.com/RodReis/arenahub/issues/3) | aprovada-pi |
| F4 | SPEC-004 | 0 | 0.4 | Offline e reconciliação | [`SPEC-004-offline-e-reconciliacao.md`](specs/SPEC-004-offline-e-reconciliacao.md) | [#4](https://github.com/RodReis/arenahub/issues/4) | aprovada-pi |
| F5 | SPEC-005 | 0 | 0.5 | Relatório e decisão | [`SPEC-005-relatorio-e-decisao.md`](specs/SPEC-005-relatorio-e-decisao.md) | [#5](https://github.com/RodReis/arenahub/issues/5) | aprovada-pi |
| F6 | SPEC-006 | 1 | 1.1 | Core seguro e unidade | [`SPEC-006-core-seguro-e-unidade.md`](specs/SPEC-006-core-seguro-e-unidade.md) | [#6](https://github.com/RodReis/arenahub/issues/6) | aprovada-pi |
| F7 | SPEC-007 | 1 | 1.2 | Aluno, plano e entitlement manual | [`SPEC-007-aluno-plano-e-entitlement-manual.md`](specs/SPEC-007-aluno-plano-e-entitlement-manual.md) | [#7](https://github.com/RodReis/arenahub/issues/7) | aprovada-pi |
| F8 | SPEC-008 | 1 | 1.3 | Consentimento, biometria e sync de dispositivo | [`SPEC-008-consentimento-biometria-e-sync-de-dispositivo.md`](specs/SPEC-008-consentimento-biometria-e-sync-de-dispositivo.md) | [#8](https://github.com/RodReis/arenahub/issues/8) | aprovada-pi |
| F9 | SPEC-009 | 1 | 1.4 | Decisão online e passagem | [`SPEC-009-decisao-online-e-passagem.md`](specs/SPEC-009-decisao-online-e-passagem.md) | [#9](https://github.com/RodReis/arenahub/issues/9) | aprovada-pi |
| F10 | SPEC-010 | 1.5 | 1.5 | Operação offline | [`SPEC-010-operacao-offline.md`](specs/SPEC-010-operacao-offline.md) | [#10](https://github.com/RodReis/arenahub/issues/10) | em-revisao |
| F11 | SPEC-011 | 1 | 1.6 | Painel operacional e prontidão | [`SPEC-011-painel-operacional-e-prontidao.md`](specs/SPEC-011-painel-operacional-e-prontidao.md) | [#11](https://github.com/RodReis/arenahub/issues/11) | aprovada-pi |
| F12 | SPEC-012 | 2 | 2.1 | Ledger operacional e invoice | [`SPEC-012-ledger-operacional-e-invoice.md`](specs/SPEC-012-ledger-operacional-e-invoice.md) | [#12](https://github.com/RodReis/arenahub/issues/12) | em-revisao |
| F13 | SPEC-013 | 2 | 2.2 | PIX e webhook idempotente | [`SPEC-013-pix-e-webhook-idempotente.md`](specs/SPEC-013-pix-e-webhook-idempotente.md) | [#13](https://github.com/RodReis/arenahub/issues/13) | em-revisao |
| F14 | SPEC-014 | 2 | 2.3 | Cartão e recorrência | [`SPEC-014-cartao-e-recorrencia.md`](specs/SPEC-014-cartao-e-recorrencia.md) | [#14](https://github.com/RodReis/arenahub/issues/14) | em-revisao |
| F15 | SPEC-015 | 2 | 2.4 | Inadimplência e acesso | [`SPEC-015-inadimplencia-e-acesso.md`](specs/SPEC-015-inadimplencia-e-acesso.md) | [#15](https://github.com/RodReis/arenahub/issues/15) | em-revisao |
| F16 | SPEC-016 | 2 | 2.5 | Estorno, conciliação e operação | [`SPEC-016-estorno-conciliacao-e-operacao.md`](specs/SPEC-016-estorno-conciliacao-e-operacao.md) | [#16](https://github.com/RodReis/arenahub/issues/16) | em-revisao |
| F17 | SPEC-017 | 3 | 3.1 | Consentimento e avaliação manual | [`SPEC-017-consentimento-e-avaliacao-manual.md`](specs/SPEC-017-consentimento-e-avaliacao-manual.md) | [#17](https://github.com/RodReis/arenahub/issues/17) | planejada |
| F18 | SPEC-018 | 3 | 3.2 | Histórico e comparativos | [`SPEC-018-historico-e-comparativos.md`](specs/SPEC-018-historico-e-comparativos.md) | [#18](https://github.com/RodReis/arenahub/issues/18) | planejada |
| F19 | SPEC-019 | 3 | 3.3 | Upload e revisão | [`SPEC-019-upload-e-revisao.md`](specs/SPEC-019-upload-e-revisao.md) | [#19](https://github.com/RodReis/arenahub/issues/19) | planejada |
| F20 | SPEC-020 | 3 | 3.4 | Metas e frequência | [`SPEC-020-metas-e-frequencia.md`](specs/SPEC-020-metas-e-frequencia.md) | [#20](https://github.com/RodReis/arenahub/issues/20) | planejada |
| F21 | SPEC-021 | 3 | 3.5 | Análise assistiva por IA | [`SPEC-021-analise-assistiva-por-ia.md`](specs/SPEC-021-analise-assistiva-por-ia.md) | [#21](https://github.com/RodReis/arenahub/issues/21) | planejada |
| F22 | SPEC-022 | 3 | 3.6 | Operação e qualidade | [`SPEC-022-operacao-e-qualidade.md`](specs/SPEC-022-operacao-e-qualidade.md) | [#22](https://github.com/RodReis/arenahub/issues/22) | planejada |
| F23 | SPEC-023 | 4 | 4.1 | Identidade e shell mobile | [`SPEC-023-identidade-e-shell-mobile.md`](specs/SPEC-023-identidade-e-shell-mobile.md) | [#23](https://github.com/RodReis/arenahub/issues/23) | planejada |
| F24 | SPEC-024 | 4 | 4.2 | Carteirinha, plano e frequência | [`SPEC-024-carteirinha-plano-e-frequencia.md`](specs/SPEC-024-carteirinha-plano-e-frequencia.md) | [#24](https://github.com/RodReis/arenahub/issues/24) | planejada |
| F25 | SPEC-025 | 4 | 4.3 | Financeiro mobile | [`SPEC-025-financeiro-mobile.md`](specs/SPEC-025-financeiro-mobile.md) | [#25](https://github.com/RodReis/arenahub/issues/25) | planejada |
| F26 | SPEC-026 | 4 | 4.4 | Avaliações e consentimentos | [`SPEC-026-avaliacoes-e-consentimentos.md`](specs/SPEC-026-avaliacoes-e-consentimentos.md) | [#26](https://github.com/RodReis/arenahub/issues/26) | planejada |
| F27 | SPEC-027 | 4 | 4.5 | Kiosk seguro | [`SPEC-027-kiosk-seguro.md`](specs/SPEC-027-kiosk-seguro.md) | [#27](https://github.com/RodReis/arenahub/issues/27) | planejada |
| F28 | SPEC-028 | 4 | 4.6 | Pagamento e desbloqueio no totem | [`SPEC-028-pagamento-e-desbloqueio-no-totem.md`](specs/SPEC-028-pagamento-e-desbloqueio-no-totem.md) | [#28](https://github.com/RodReis/arenahub/issues/28) | planejada |
| F29 | SPEC-029 | 4 | 4.7 | Piloto e distribuição | [`SPEC-029-piloto-e-distribuicao.md`](specs/SPEC-029-piloto-e-distribuicao.md) | [#29](https://github.com/RodReis/arenahub/issues/29) | planejada |
| F30 | SPEC-030 | 5 | 5.1 | Preferências e identidade pública | [`SPEC-030-preferencias-e-identidade-publica.md`](specs/SPEC-030-preferencias-e-identidade-publica.md) | [#30](https://github.com/RodReis/arenahub/issues/30) | planejada |
| F31 | SPEC-031 | 5 | 5.2 | XP e conquistas | [`SPEC-031-xp-e-conquistas.md`](specs/SPEC-031-xp-e-conquistas.md) | [#31](https://github.com/RodReis/arenahub/issues/31) | planejada |
| F32 | SPEC-032 | 5 | 5.3 | Consistência e streak | [`SPEC-032-consistencia-e-streak.md`](specs/SPEC-032-consistencia-e-streak.md) | [#32](https://github.com/RodReis/arenahub/issues/32) | planejada |
| F33 | SPEC-033 | 5 | 5.4 | Rankings privados por padrão | [`SPEC-033-rankings-privados-por-padrao.md`](specs/SPEC-033-rankings-privados-por-padrao.md) | [#33](https://github.com/RodReis/arenahub/issues/33) | planejada |
| F34 | SPEC-034 | 5 | 5.5 | Desafios e notificações | [`SPEC-034-desafios-e-notificacoes.md`](specs/SPEC-034-desafios-e-notificacoes.md) | [#34](https://github.com/RodReis/arenahub/issues/34) | planejada |
| F35 | SPEC-035 | 5 | 5.6 | Operação, moderação e experimento | [`SPEC-035-operacao-moderacao-e-experimento.md`](specs/SPEC-035-operacao-moderacao-e-experimento.md) | [#35](https://github.com/RodReis/arenahub/issues/35) | planejada |
| F36 | SPEC-036 | 6 | 6.1 | Contrato de dados e baseline analítica | [`SPEC-036-contrato-de-dados-e-baseline-analitica.md`](specs/SPEC-036-contrato-de-dados-e-baseline-analitica.md) | [#36](https://github.com/RodReis/arenahub/issues/36) | planejada |
| F37 | SPEC-037 | 6 | 6.2 | Regras explicáveis e score | [`SPEC-037-regras-explicaveis-e-score.md`](specs/SPEC-037-regras-explicaveis-e-score.md) | [#37](https://github.com/RodReis/arenahub/issues/37) | planejada |
| F38 | SPEC-038 | 6 | 6.3 | CRM de retenção | [`SPEC-038-crm-de-retencao.md`](specs/SPEC-038-crm-de-retencao.md) | [#38](https://github.com/RodReis/arenahub/issues/38) | planejada |
| F39 | SPEC-039 | 6 | 6.4 | Experimento operacional | [`SPEC-039-experimento-operacional.md`](specs/SPEC-039-experimento-operacional.md) | [#39](https://github.com/RodReis/arenahub/issues/39) | planejada |
| F40 | SPEC-040 | 6 | 6.5 | Modelo supervisionado (condicionado a M6-ML-01) | [`SPEC-040-modelo-supervisionado-condicionado-a-m6-ml-01.md`](specs/SPEC-040-modelo-supervisionado-condicionado-a-m6-ml-01.md) | [#40](https://github.com/RodReis/arenahub/issues/40) | planejada |
| F41 | SPEC-041 | 6 | 6.6 | Produção controlada e monitoramento | [`SPEC-041-producao-controlada-e-monitoramento.md`](specs/SPEC-041-producao-controlada-e-monitoramento.md) | [#41](https://github.com/RodReis/arenahub/issues/41) | planejada |

**Cards `[GATE]` previstos** (não são fatias, não têm SPEC nem F): homologação de provedor de
pagamento (MVP 2), portões clínicos (MVP 3), portões de canal (MVP 4), portões de engajamento
(MVP 5), portões de retenção (MVP 6).

**Exceção registrada (ADR-015):** o índice do plano do MVP 1 divide a Slice 1.3 em duas etapas
com gates distintos. F8 permanece **uma** fatia, com a etapa de sync físico bloqueada por
`HW-GATE-01` (portão de entrada de bancada).

---

## 6. Trabalho `[INFRA]` de bootstrap

**Os seis cards foram criados em 14/08/2026** pelo Cowork, autorizado pelo **ADR-023**. Todos em
Backlog, assignee PI. Correspondem aos itens 1–6 de `docs/DEVELOPMENT.md` §4.

| card | item §4 | evidência de pronto | depende de |
|---|---|---|---|
| ✅ [#42](https://github.com/RodReis/arenahub/issues/42) Monorepo pnpm + Turborepo | 1 | `pnpm install --frozen-lockfile` passa | — |
| ✅ [#43](https://github.com/RodReis/arenahub/issues/43) TS estrito, ESLint, Prettier | 2 | `pnpm lint` e `pnpm typecheck` verdes | #42 |
| ✅ [#44](https://github.com/RodReis/arenahub/issues/44) Os 8 comandos obrigatórios | 3 | os 8 rodam e **falham com mensagem clara** | #42, #43 |
| ✅ [#45](https://github.com/RodReis/arenahub/issues/45) docker-compose local | 4 | `docker compose up` sobe Postgres, Redis e MinIO | #42 |
| ✅ [#46](https://github.com/RodReis/arenahub/issues/46) `packages/database` | 5 | `pnpm --filter database migrate dev` | #42, #45 |
| ✅ [#47](https://github.com/RodReis/arenahub/issues/47) CI | 6 | **CI verde no próprio PR** | #42, #43, #44, #46 |

**Os outros dois itens da §4 não viraram card, por motivos diferentes:**

- **Item 7 — board no GitHub.** *Não pode* ter card: não há como criar um card para criar o
  board (*exceção de arranque*, `docs/DEVELOPMENT.md` §2). Continua pendente: falta o Projects
  com as 5 colunas, as cores e descrições das labels, e as 4 labels que ainda não existem.
- **Item 8 — versionar arquivos *untracked*.** ***Já está feito.***
  `git status --untracked-files=all` retorna vazio, com 113 arquivos rastreados —
  `CLAUDE.md`, `docs/DESIGN-UI.md` e `docs/TESTING.md` incluídos. Marcar como cumprido na §4.

> ⚠️ **A ordem da §4 está errada e isso não é cosmético.** O `DEVELOPMENT.md` §2 diz que a
> exceção de arranque *"morre no item 7"* — o board — mas o board é o **penúltimo**. Na ordem
> escrita, os itens 1–6 rodam sob regime reduzido e o item 8 cai depois da exceção já morta.
> **O board deveria ser o item 1:** é ele que faz o resto virar processo normal. Reordenar é do
> Code, dono do arquivo.

**Sequência real de execução, então:** board → ✅ #42 → ✅ #43 → ✅ #45 → ✅ #44 → ✅ #46 → ✅ **#47**. O #47 (CI)
é o marco: quando ele fecha, a exceção de arranque morre e o ciclo normal vale inteiro.

> A ordem acima foi para o `DEVELOPMENT.md` §4 no PR
> [#48](https://github.com/RodReis/arenahub/pull/48), como coluna `ordem` **ao lado** do `#`
> original. Os números dos itens **não foram renumerados de propósito** — o ADR-023 e as §1/§6
> deste arquivo citam "item 7", "itens 1–6" e "itens 1–8"; renumerar tornaria um ADR aprovado
> falso, em arquivo que não é do Code.

**#42 entregue em 14/08/2026** — PR [#49](https://github.com/RodReis/arenahub/pull/49). Com ele,
**três números que não existiam em documento nenhum ficaram fixados** por decisão do PI:
**Node 22 LTS, pnpm 10, Turborepo 2**. Registro em `DEVELOPMENT.md` §4. Major não muda sem ADR.

**#43 entregue em 14/08/2026** — PR [#50](https://github.com/RodReis/arenahub/pull/50). Fixou mais
quatro versões: **TypeScript 5.9, ESLint 9, typescript-eslint 8, Prettier 3**. TS 7 e ESLint 10 já
tinham saído e foram recusados pelo mesmo critério do Node 22 — compatibilidade comprovada com
NestJS 11, Next.js 16, Prisma e Expo vale mais que velocidade de compilador.

**#45 entregue em 14/08/2026** — PR [#51](https://github.com/RodReis/arenahub/pull/51). Postgres 17,
Redis 8 e MinIO sobem com healthcheck, todas as imagens com **tag fixa** — `latest` quebraria o
`M0-NFR-006` (qualquer pessoa reproduz a bancada) em silêncio, na máquina de outra pessoa.

> ⚠️ **`docker compose` sem `--env-file .env` ignora o `.env` da raiz.** O Compose procura o
> arquivo ao lado do YAML, e o nosso vive em `infra/docker/`. Sem a flag, todas as portas caem no
> padrão sem aviso nenhum. Por isso os scripts **`pnpm docker:up | down | reset | logs`** existem
> — use-os em vez do comando cru. Descoberto ao subir de verdade, não na leitura.

> ℹ️ **Provisionar não é adotar.** O Redis está no compose para o ambiente local ficar completo.
> Isso **não** autoriza BullMQ na primeira fatia que parecer conveniente — fila entra só com
> métrica que a justifique (`CLAUDE.md` → Stack). Registrado também no `infra/docker/README.md`.

**#44 entregue em 14/08/2026** — PR [#52](https://github.com/RodReis/arenahub/pull/52). **A ressalva
que vinha desde o #42 morreu aqui.**

> ✅ **Verde agora quer dizer verificado.** `turbo run test` num repositório onde ninguém declara
> `test` imprimia `WARNING No tasks were executed` e **saía com código 0**. O aviso passa
> despercebido; o código de saída não — e quem o lê é o CI, que substitui o aceite humano no merge.
> O guarda `scripts/run-task.mjs` faz o comando **falhar com mensagem** em vez de mentir.
>
> Estado dos oito hoje: `install`, `lint` e `typecheck` **passam** porque têm o que rodar; `test`,
> `test:integration`, `test:e2e`, `build` e `dev` **falham com mensagem** — correto, nenhum
> workspace os declara ainda. Cada um passa a valer quando o workspace que o usa nascer.

> ℹ️ **A porta 3344 tem guarda** (`scripts/check-port.mjs`), mesmo sem API ainda. Se estiver
> ocupada, falha — nunca troca. Framework que cai sozinho na porta seguinte deixa dois processos
> servindo, com o operador falando com um e lendo o log do outro.

### Pendência entregue ao Code — arquivo que não é do Cowork

O `docs/DEVELOPMENT.md` ficou com **três referências obsoletas** depois da segunda rodada de
14/08/2026, e o ADR-021 **não** dá esse arquivo ao Cowork. Correção é do Code:

| linha | o que diz hoje | o que passou a valer |
|---|---|---|
| 128 (F4) | bloqueio "hardware, **ADR-011**" | só hardware — ADR-011 fechou |
| 147 (F8) | bloqueio "**ADR-008** (base legal, RIPD, papéis)" | só a etapa física por hardware — ADR-008 fechou nesses três pontos |
| 168 (F10) | "**ADR-011** (partes abertas)" | só ADR-007 |

Anotado em vez de corrigido de propósito: consertar arquivo de outro dono sem pedir é a erosão
que o ADR-021 nomeia — três exceções viram a regra real.

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
