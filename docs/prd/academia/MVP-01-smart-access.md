# PRD técnico — MVP 1: Smart Access

## 1. Controle

- Status: APROVADO para planejamento em 14/08/2026
- Dependência obrigatória: MVP 0 com decisão `GO` ou `GO_WITH_CONSTRAINTS`
- Resultado: primeira unidade operando acesso físico pelo ArenaHub
- Modelo financeiro deste MVP: assinatura e confirmação manual, sem gateway de pagamento
- Contrato transversal: [estrutura, comandos, testes e limites](../README.md)

## 2. Objetivo

Permitir que uma academia cadastre alunos, atribua plano e assinatura manual, registre consentimento biométrico, sincronize identidade com dispositivos Topdata e libere entrada somente quando existir entitlement válido. A operação deve continuar durante interrupções de internet dentro da política offline configurada.

## 3. Métricas de sucesso

- 100% das decisões físicas possuem `AccessEvent` correlacionável;
- nenhuma liberação sem entitlement ou override auditado;
- p95 da decisão local abaixo de 300 ms no hardware homologado, ou limite aprovado no MVP 0;
- sincronização de identidade com taxa de sucesso diária mínima de 99%, excluindo indisponibilidade física documentada;
- reconciliação de backlog sem perda ou duplicação lógica;
- operador identifica dispositivo offline ou sync falho pelo painel sem consultar banco ou logs brutos.

## 4. Personas e permissões mínimas

| Persona | Capacidades |
|---|---|
| Proprietário | configuração do tenant, usuários, unidades e políticas |
| Gerente | alunos, planos, assinaturas manuais, bloqueios e relatórios operacionais |
| Recepcionista | cadastro, consentimentos, biometria, consulta e override conforme permissão |
| Operador técnico | dispositivos, Edge, sync, diagnósticos e logs técnicos mascarados |
| Super Admin | suporte multi-tenant com elevação auditada |

Permissões iniciais:

```text
tenant.read, tenant.update
unit.create, unit.read, unit.update
user.manage, role.assign
student.create, student.read, student.update, student.archive
plan.manage, subscription.manage
biometric.enroll, biometric.revoke
device.manage, device.diagnose
access.read, access.override
audit.read
```

## 5. Gates de entrada

- [ ] restrições do MVP 0 incorporadas;
- [ ] modelos e firmwares suportados definidos;
- [ ] contrato do Edge Agent aprovado;
- [ ] termos de privacidade e consentimento biométrico versionados;
- [ ] política offline inicial aprovada pela operação;
- [ ] ambientes local, homologação e produção definidos;
- [ ] responsáveis por incidentes físicos identificados.

## 6. Escopo

### Incluído

- tenant, unidade e usuários internos;
- autenticação, refresh token, RBAC e auditoria;
- alunos e matrícula;
- planos sem cobrança automática;
- assinatura manual e entitlement;
- consentimento e identidade biométrica;
- dispositivos e sincronização individual;
- Edge Agent como serviço Windows;
- access decision engine;
- acesso facial, override manual e fallback operacional registrado;
- eventos de acesso;
- cache e fila offline;
- painel operacional;
- exportação básica de eventos e auditoria.

### Fora de escopo

- PIX, cartão, invoice ou webhook financeiro;
- app do aluno e totem;
- bioimpedância;
- ranking ou gamificação;
- churn e IA;
- múltiplos fabricantes além dos homologados no MVP 0;
- billing da própria plataforma SaaS;
- customização profunda de marca.

## 7. Slices verticais

### Slice 1.1 — Core seguro e unidade

- bootstrap do monorepo e ambientes locais;
- tenant, unidade, usuário, sessão, RBAC e MFA administrativo;
- contexto obrigatório de tenant;
- audit log para autenticação e administração;
- painel mínimo de seleção de unidade.

Aceite: proprietário cria a primeira unidade e convida um recepcionista que só acessa o tenant correto.

### Slice 1.2 — Aluno, plano e entitlement manual

- cadastro e busca de aluno;
- matrícula gerada sem depender de CPF;
- plano e regras essenciais;
- assinatura manual;
- geração, suspensão e expiração de entitlement;
- timeline administrativa.

Aceite: recepção cadastra aluno, atribui plano e visualiza exatamente quando e onde o acesso é válido.

### Slice 1.3 — Consentimento, biometria e sync

- consentimento biométrico versionado;
- `BiometricIdentity`, `DeviceUser` e `DeviceSyncJob`;
- cadastro/exclusão individual nos dispositivos;
- fila, retry, dead letter e painel de pendência;
- revogação com exclusão verificável.

Aceite: identidade chega a todos os dispositivos-alvo e sua revogação remove o acesso e o cadastro físico.

### Slice 1.4 — Decisão online e passagem

- access engine puro e versionado;
- canal autenticado API ↔ Edge;
- decisão por aluno, entitlement, unidade, horário e bloqueio;
- comando físico e `AccessEvent`;
- override manual com motivo obrigatório.

Aceite: o aluno entra somente com entitlement válido; negações e overrides têm motivo e auditoria.

### Slice 1.5 — Operação offline

- snapshot assinado/versionado de permissões;
- validade e carência configuradas por unidade;
- decisão local determinística;
- fila persistente de eventos;
- reconciliação e deduplicação;
- modo degradado visível.

Aceite: a unidade mantém operação dentro da política durante queda cloud e reconcilia tudo ao retornar.

### Slice 1.6 — Painel e prontidão operacional

- dashboard de dispositivos, acessos, recusas e backlog;
- busca e exportação de access events;
- alertas de Edge/dispositivo offline e dead letters;
- runbooks de instalação, upgrade, diagnóstico e rollback;
- smoke operacional de abertura da unidade.

Aceite: equipe opera um turno completo sem acesso direto a banco, terminal ou logs brutos.

## 8. Requisitos funcionais

### Core e identidade

- `M1-FR-001`: criar tenant e uma ou mais unidades com timezone e horário de funcionamento.
- `M1-FR-002`: autenticar usuários internos e rotacionar refresh tokens.
- `M1-FR-003`: aplicar permissões por tenant e, quando configurado, por unidade.
- `M1-FR-004`: exigir MFA dos perfis Proprietário, Super Admin e Operador técnico em produção.
- `M1-FR-005`: auditar login, falha de login, troca de função e elevação de suporte.

### Alunos e acesso comercial manual

- `M1-FR-006`: cadastrar aluno com validação e detecção de possível duplicidade dentro do tenant.
- `M1-FR-007`: gerar matrícula única e imutável dentro do tenant.
- `M1-FR-008`: arquivar aluno preservando histórico e bloqueando novos acessos.
- `M1-FR-009`: criar plano com unidades, dias, horários e período de validade.
- `M1-FR-010`: criar, pausar, retomar e cancelar assinatura manualmente com auditoria.
- `M1-FR-011`: derivar entitlement explícito da assinatura e regras do plano.
- `M1-FR-012`: criar entitlement de cortesia com razão, responsável e validade.

> **Emenda de 18/09/2026 — [ADR-059](../../DECISIONS.md#adr-059), decidida pelo PI.** Das seis
> regras de plano da Especificação §34 sem campo (`CONVENTION.md` INV-059), **aulas inclusas**
> e **convidados** foram confirmadas no escopo do MVP1. `M1-FR-009` continua cobrindo só
> unidades, dias, horários e validade — o campo em `Plan` e o comportamento de aulas
> inclusas/convidados não foram desenhados por esta emenda. **Desenhados em 18/09/2026**, em
> emenda posterior: convidados pelo [ADR-060](../../DECISIONS.md#adr-060) (F76) e aulas inclusas
> pelo [ADR-061](../../DECISIONS.md#adr-061), que criou a entidade `Class` como módulo próprio
> (F77) e o vínculo com o plano (F78) — lá, "aulas inclusas" é **qualitativo** (quais aulas o
> plano autoriza reservar) e a reserva **não** entra no motor de decisão de acesso. Limite semanal de acessos, pausa com teto de dias,
> fidelidade e multa por quebra de fidelidade **seguem fora de escopo** — a decisão do PI foi
> "não entra agora", não "resolvido".

### Biometria e dispositivos

- `M1-FR-013`: registrar aceite ou recusa de consentimento biométrico versionado.
- `M1-FR-014`: cadastrar identidade biométrica sem armazenar template bruto quando o dispositivo não exigir.
- `M1-FR-015`: criar uma operação de sync por usuário e dispositivo.
- `M1-FR-016`: mostrar estado `PENDING`, `PROCESSING`, `SYNCED`, `FAILED`, `RETRYING` ou `REMOVED`.
- `M1-FR-017`: revogar biometria, bloquear uso e remover de todos os dispositivos-alvo.
- `M1-FR-018`: registrar heartbeat, firmware, status e última sincronização do dispositivo e Edge.

### Decisão e eventos

- `M1-FR-019`: resolver identidade externa para aluno dentro do tenant/unidade corretos.
- `M1-FR-020`: avaliar entitlement, status do aluno, unidade, janela de horário e bloqueio administrativo.
- `M1-FR-021`: devolver `ALLOW` ou `DENY`, razão estável, validade e versão da política.
- `M1-FR-022`: correlacionar reconhecimento, decisão, comando e passagem.
- `M1-FR-023`: permitir override manual somente com permissão, estudante/visitante, dispositivo e motivo.
- `M1-FR-024`: consultar e exportar eventos por período, aluno, unidade, decisão e método.

### Offline e operação

- `M1-FR-025`: distribuir snapshot incremental ou completo de permissões ao Edge.
- `M1-FR-026`: validar integridade, tenant, unidade, versão e expiração do snapshot.
- `M1-FR-027`: decidir offline apenas dentro da validade e carência aprovadas.
- `M1-FR-028`: persistir eventos locais antes de confirmar processamento físico.
- `M1-FR-029`: reconciliar backlog com idempotência e manter horário original.
- `M1-FR-030`: alertar Edge, dispositivo ou sincronização indisponível.

## 9. Regras de negócio

- `M1-BR-001`: CPF pode ajudar a detectar duplicidade, mas não é matrícula nem ID técnico.
- `M1-BR-002`: aluno `BLOCKED`, `CANCELLED` ou `ARCHIVED` não recebe acesso normal.
- `M1-BR-003`: acesso depende de entitlement; assinatura não é consultada diretamente na catraca.
- `M1-BR-004`: ausência de consentimento impede cadastro biométrico, não o cadastro administrativo do aluno.
- `M1-BR-005`: revogação biométrica produz bloqueio lógico imediato, mesmo se a exclusão física estiver pendente.
- `M1-BR-006`: política mais restritiva prevalece quando regras se sobrepõem.
- `M1-BR-007`: override nunca altera silenciosamente assinatura ou entitlement.
- `M1-BR-008`: dados offline vencidos resultam em negação ou fallback operacional explícito conforme política; nunca em allow ilimitado.
- `M1-BR-009`: evento de passagem é imutável; correções são novos registros vinculados.
- `M1-BR-010`: exclusão administrativa é arquivamento quando existe histórico legal ou operacional.

## 10. Estados principais

```text
Student: LEAD | TRIAL | ACTIVE | SUSPENDED | BLOCKED | CANCELLED | ARCHIVED
Subscription: PENDING | ACTIVE | PAUSED | CANCELLED | EXPIRED
Entitlement: SCHEDULED | ACTIVE | SUSPENDED | REVOKED | EXPIRED
BiometricIdentity: PENDING_CONSENT | ACTIVE | REVOKED | DELETION_PENDING | DELETED
DeviceSyncJob: PENDING | PROCESSING | SYNCED | FAILED | RETRYING | REMOVED
Device: PROVISIONING | ONLINE | DEGRADED | OFFLINE | RETIRED
AccessDecision: ALLOW | DENY
Passage: NOT_APPLICABLE | PENDING | CONFIRMED | TIMED_OUT
```

Transições inválidas retornam erro de domínio e não produzem efeito parcial.

## 11. Modelo de dados mínimo

```text
tenants, gym_units
users, roles, permissions, user_roles, sessions
students, student_contacts, student_addresses
plans, subscriptions, entitlements
consents, biometric_identities
edges, devices, device_users, device_sync_jobs
access_policies, access_events, manual_access_overrides
outbox_events, inbox_receipts, audit_logs
```

Restrições essenciais:

- matrícula única por tenant;
- `external_user_id` único por dispositivo;
- `idempotency_key` única por origem de evento;
- apenas um processamento lógico por `event_id` e consumidor;
- índices por `(tenant_id, gym_unit_id, occurred_at)` nos eventos;
- soft delete não pode liberar unicidade sem regra explícita.

## 12. API inicial

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/mfa/verify

POST   /api/v1/units
POST   /api/v1/users/invitations
GET    /api/v1/students
POST   /api/v1/students
GET    /api/v1/students/:id
PATCH  /api/v1/students/:id

POST   /api/v1/plans
POST   /api/v1/subscriptions
POST   /api/v1/subscriptions/:id/pause
POST   /api/v1/subscriptions/:id/cancel

POST   /api/v1/students/:id/biometric-consents
POST   /api/v1/students/:id/biometric-identities
DELETE /api/v1/students/:id/biometric-identities/:identityId

GET    /api/v1/devices
POST   /api/v1/devices
GET    /api/v1/device-sync-jobs
POST   /api/v1/access/manual-overrides
GET    /api/v1/access-events

POST   /api/v1/edge/heartbeat
GET    /api/v1/edge/access-snapshots/latest
POST   /api/v1/edge/access-events/batch
POST   /api/v1/edge/sync-results/batch
```

Endpoints Edge usam identidade de dispositivo, escopo de unidade e proteção contra replay; nunca sessão de usuário comum.

## 13. Eventos

```text
StudentCreated
StudentStatusChanged
SubscriptionActivated
SubscriptionPaused
SubscriptionCancelled
EntitlementActivated
EntitlementRevoked
BiometricConsentRevoked
DeviceSyncRequested
DeviceSyncSucceeded
DeviceSyncFailed
AccessGranted
AccessDenied
PassageConfirmed
EdgeOnline
EdgeOffline
DeviceOnline
DeviceOffline
```

## 14. UX mínima

- busca de aluno por nome, matrícula, telefone ou CPF mascarado;
- status de acesso apresentado como resultado e razão, não inferido por cor isolada;
- tela pública da catraca não exibe dívida, CPF ou informação sensível;
- confirmação explícita para revogação biométrica e override;
- falha de sync mostra dispositivo, código, última tentativa e ação recomendada;
- modo offline e idade do cache ficam visíveis para operação técnica;
- formulários preservam dados digitados em erros recuperáveis.

## 15. Segurança e auditoria específicas

- consentimento biométrico guarda versão, finalidade, aceite/revogação, ator, IP e dispositivo;
- fotos e documentos ficam em storage privado com URL temporária;
- segregação de suporte exige justificativa e expiração da elevação;
- ações auditadas: cadastro/arquivo de aluno, função, assinatura manual, cortesia, bloqueio, biometria, dispositivo e override;
- snapshots Edge são assinados ou autenticados e não aceitos após expiração;
- segredo do Edge é rotacionável e armazenado pelo mecanismo seguro do Windows;
- rate limiting por identidade, tenant, IP e dispositivo conforme endpoint.

## 16. Requisitos não funcionais

- `M1-NFR-001`: API administrativa com p95 menor que 500 ms, excluindo integrações externas.
- `M1-NFR-002`: decisão local conforme limite homologado no MVP 0, objetivo p95 menor que 300 ms.
- `M1-NFR-003`: ingestão de eventos suporta ao menos 10 vezes o pico medido da primeira unidade.
- `M1-NFR-004`: nenhuma perda de evento persistido durante reinício do Edge.
- `M1-NFR-005`: RPO cloud inicial máximo de 24 h e RTO documentado antes da produção.
- `M1-NFR-006`: Edge atualiza com rollback para a versão anterior.
- `M1-NFR-007`: todas as consultas multi-tenant críticas possuem teste de isolamento.
- `M1-NFR-008`: acessibilidade WCAG 2.2 AA nos fluxos administrativos essenciais.
- `M1-NFR-009`: exportações grandes são assíncronas e não bloqueiam a API.
- `M1-NFR-010`: API, web e Edge expõem versão e estado de saúde.

## 17. Testes obrigatórios

- unitários de todas as combinações de política de acesso;
- propriedade: entitlement expirado nunca retorna `ALLOW`;
- integração de transações, outbox, inbox e constraints;
- tenant A não lê, altera ou sincroniza dados do tenant B;
- contrato com simuladores homologados no MVP 0;
- queda cloud, queda local, relógio divergente, duplicação e backlog;
- E2E: cadastrar → assinar manualmente → consentir → sincronizar → reconhecer → entrar;
- E2E negativo: expirado, fora do horário, bloqueado e consentimento revogado;
- E2E de override e auditoria;
- smoke em hardware real antes de cada release do Edge.

## 18. Critérios de aceite

- `M1-AC-001`: proprietário cria unidade, funções e usuários sem cruzamento de tenant.
- `M1-AC-002`: recepção cadastra aluno e o sistema gera matrícula única.
- `M1-AC-003`: assinatura manual ativa entitlement com período e unidade corretos.
- `M1-AC-004`: identidade consentida sincroniza individualmente em todos os dispositivos-alvo.
- `M1-AC-005`: aluno autorizado é reconhecido, recebe `ALLOW`, passa e gera evento completo.
- `M1-AC-006`: aluno sem entitlement recebe `DENY` e a catraca não libera.
- `M1-AC-007`: revogação biométrica impede novo uso imediatamente e agenda exclusão física.
- `M1-AC-008`: override exige permissão e motivo e aparece na auditoria.
- `M1-AC-009`: durante queda cloud, decisões seguem cache válido e eventos são reconciliados uma vez.
- `M1-AC-010`: cache vencido segue a política aprovada e deixa modo degradado visível.
- `M1-AC-011`: painel identifica Edge/dispositivo offline, sync falho e backlog.
- `M1-AC-012`: um turno operacional piloto encerra sem evento perdido ou acesso indevido conhecido.

## 19. Rollout e rollback

1. laboratório com simuladores;
2. homologação com hardware real;
3. unidade piloto em modo observação, sem comandar catraca;
4. janela assistida com fallback manual;
5. operação normal com monitoramento reforçado;
6. expansão por unidade após checklist.

Rollback do Edge restaura versão anterior e mantém SQLite. Rollback cloud nunca remove colunas ou eventos exigidos pelo Edge ainda ativo. Alterações de contrato suportam ao menos a versão atual e a imediatamente anterior durante rollout.

## 20. Gate de saída

- [ ] todas as slices concluídas;
- [ ] piloto operacional aprovado;
- [ ] runbooks testados por pessoa diferente do autor;
- [ ] backup e restauração demonstrados;
- [ ] alertas e contatos de incidente ativos;
- [ ] pendências de segurança críticas zeradas;
- [ ] métricas de acesso e sync dentro dos limites;
- [ ] versão de produção e evidências registradas.

## 21. Checklist de execução

- [ ] Slice 1.1 — Core seguro e unidade
- [ ] Slice 1.2 — Aluno, plano e entitlement manual
- [ ] Slice 1.3 — Consentimento, biometria e sync
- [ ] Slice 1.4 — Decisão online e passagem
- [ ] Slice 1.5 — Operação offline
- [ ] Slice 1.6 — Painel e prontidão operacional
