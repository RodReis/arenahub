# SPEC-080 — Perfis prontos e gestão de equipe do tenant

| campo | valor |
|---|---|
| **Fatia** | F80 |
| **MVP** | 1 *(posição na fila)* — decisão do PI, não Slice de PRD |
| **Slice do PRD** | não há. Nasce de decisão do PI em 22/09/2026 sobre a fronteira de quem cria usuário |
| **Superfície** | `apps/api` (papéis e revogação), `packages/database` (migration de backfill) e `apps/admin-web` (tela `/users` já existente) |
| **Card** | [#374](https://github.com/RodReis/arenahub/issues/374) |
| **Status** | `aprovada-pi` — decisões tomadas em 22/09/2026, ver §2 |
| **Depende de** | [F79](SPEC-079-acesso-do-admin-do-tenant.md) — o Admin precisa conseguir entrar antes de montar equipe |

---

## 1. O que esta fatia entrega

A academia passa a montar a **própria equipe**, escolhendo entre cinco perfis prontos.

Hoje existe exatamente um papel por tenant: `OWNER`, criado com o tenant e dono de
`PERMISSOES_DO_OWNER` inteiro. A tela `/users` já lista usuários e já convida com escolha de papel
(issue #274) — **só que o combo tem uma opção só**. Na prática, toda pessoa que entra na academia
entra como dono: a recepcionista que cadastra aluno no balcão enxerga faturamento consolidado,
histórico de bioimpedância e o botão de desligar a unidade.

Esta fatia dá conteúdo àquele combo e fecha a porta que a F79 abriu: o Super Admin entrega **um**
Admin, e daí em diante a academia se organiza sozinha.

### O que NÃO é novidade desta fatia

Listagem de usuários, convite por e-mail e seleção de papel **já existem** e não são reescritos.
O que entra é o que falta ao redor deles.

---

## 2. Decisões do PI — 22/09/2026

| # | decisão | consequência nesta fatia |
|---|---|---|
| 1 | O tenant cria os próprios usuários com o perfil que escolher | os perfis nascem no tenant, não na plataforma |
| 2 | **Perfis prontos**, não permissões avulsas *(opção (a), aprovada)* | nenhuma tela de montar papel marcando ~40 caixas |
| 3 | Os cinco recortes de §4, conferidos linha a linha | são contrato desta spec, não sugestão |
| 4 | Vocabulário na tela: "Gerente", "Recepção", "Financeiro", "Professor" | o rótulo é em pt-BR; o `Role.name` no banco segue em inglês |

---

## 3. Escopo

- **Cinco perfis de sistema** por tenant, criados junto do `OWNER` em `CriarTenantUseCase`.
- **Migration de backfill** para os tenants que já existem — idempotente.
- **Revogar acesso** de um usuário do painel: rota nova e ação na tela.
- **Coluna "Perfil"** na tabela de `/users` — hoje a lista não diz o que cada pessoa pode fazer.
- **Rótulo em pt-BR** no combo de convite e na coluna nova.

### Não entra

- Tenant montando papel próprio marcando permissões do catálogo. Vira fatia futura **se** um cliente
  pedir; oferecer ~40 caixas a quem administra academia resolve um problema que ninguém tem.
- Editar as permissões de um perfil pronto.
- Trocar o perfil de alguém que já aceitou (revogar e convidar de novo é o caminho, e é raro).
- Perfil por unidade. `UserRole.gymUnitId` existe e continua `null`, como em `CriarTenantUseCase`.

---

## 4. Os cinco perfis

Os recortes **não são invenção desta spec**: cada separação de permissão já tem justificativa
nominal em `packages/database/src/permissoes.ts`, escrita quando a permissão foi criada.

| perfil | `Role.name` | permissões |
|---|---|---|
| Dono | `OWNER` | `PERMISSOES_DO_OWNER` inteiro *(já existe)* |
| Gerente | `MANAGER` | tudo de `OWNER` **menos** `user.manage`, `role.assign`, `retention.kill_switch` |
| Recepção | `RECEPTION` | `student.*`, `billing.read`, `class.read`, `health.upload`, `consent.manage`, `consent.read`, `biometric.enroll`, `device.read`, `unit.read`, `tenant.read`, `plan.read`, `engagement.read` |
| Financeiro | `FINANCE` | `billing.*` (inclui `billing.dashboard`), `subscription.manage`, `plan.manage`, `plan.read`, `reconciliation.*`, `student.read`, `unit.read`, `tenant.read` |
| Professor | `TRAINER` | `class.manage`, `class.read`, `student.read`, `health.read`, `health.assess`, `engagement.read`, `unit.read`, `tenant.read` |

### As ausências que importam

Cada uma tem a fonte que a justifica:

- **Recepção sem `billing.dashboard`** — o painel consolida faturamento, ticket médio e
  inadimplência do tenant inteiro; quem atende na porta precisa achar a fatura de **um** aluno
  (`permissoes.ts`, F54, decisão do PI em 25/08/2026).
- **Recepção sem `health.read`** — ela **anexa** o laudo (`health.upload`) e nunca vê o percentual
  de gordura de ninguém (ADR-039).
- **Recepção sem `biometric.read`/`revoke`** — cadastrar a face é operação de balcão; ler ou apagar
  template biométrico é ato sobre dado sensível do art. 11.
- **Gerente sem `user.manage`/`role.assign`** — quem gerencia a operação não decide quem entra no
  sistema; isso fica com o dono.
- **Gerente sem `retention.kill_switch`** — desligar o scoring afeta a academia inteira
  (`permissoes.ts`: "decisão de operação, não de consulta").
- **Financeiro sem `student.create`/`update` e sem biometria** — ele lê o aluno para cobrar, não
  para cadastrar.

**Regra:** a fonte da verdade é uma constante por perfil em `packages/database/src/permissoes.ts`,
ao lado de `PERMISSOES_DO_OWNER`. Repetir a lista em qualquer outro lugar **já produziu OWNER real
sem `access.read` em produção** — o comentário que registra isso está no próprio arquivo.

---

## 5. Regras

| # | regra | motivo |
|---|---|---|
| BR-1 | Os cinco perfis são `isSystem: true` | a tela já trata `isSystem` como "não editável nem apagável" (`GET /roles` devolve o campo desde a #274) |
| BR-2 | Backfill idempotente: `upsert` por `(tenantId, name)` | roda em tenant que já tem os perfis sem duplicar; a `@@unique` do schema garante |
| BR-3 | O backfill **não mexe** em `UserRole` existente | ninguém muda de perfil por causa de migration; quem é OWNER continua OWNER |
| BR-4 | Revogar acesso apaga `UserRole` e marca `TenantMembership` como `REVOKED` | o `AuthGuard` lê os dois; deixar um deles vivo é acesso que não morre |
| BR-5 | Ninguém revoga o **próprio** acesso | trancar-se fora exige outro dono para desfazer; 409 com código próprio |
| BR-6 | O **último** `OWNER` do tenant não pode ser revogado | academia sem dono não tem quem convide ninguém — e só o Super Admin resolveria |
| BR-7 | Revogar exige motivo, auditado | mesma disciplina da F79 e do desligamento de cliente |
| BR-8 | Convite pendente para quem foi revogado continua valendo | são coisas diferentes: revogar tira acesso vivo, revogar convite é ato da F79 |

---

## 6. Rotas

| método | rota | permissão | devolve |
|---|---|---|---|
| `POST` | `/api/v1/users/:id/revogar` | `user.manage` | `{ revogado: true }` |

`GET /users` ganha o **perfil** de cada usuário no DTO — hoje devolve só `id`, `email`, `status` e
`mfaStatus`, e a tela não tem como mostrar coluna que a API não manda.

---

## 7. Critérios de aceite

| # | critério |
|---|---|
| AC-1 | Tenant novo nasce com os cinco perfis, cada um com exatamente as permissões de §4 |
| AC-2 | Backfill roda duas vezes seguidas sem duplicar papel nem alterar `UserRole` |
| AC-3 | Convite com perfil Recepção produz usuário que **não** alcança `billing.dashboard` nem `health.read` — provado por requisição real recusada, não por conferência de lista |
| AC-4 | Revogar apaga `UserRole` **e** marca `TenantMembership` como `REVOKED`; o usuário revogado recebe 401/403 na requisição seguinte |
| AC-5 | Revogar a si mesmo → 409, nada muda |
| AC-6 | Revogar o último `OWNER` → 409, nada muda |
| AC-7 | Revogar penúltimo `OWNER` funciona — a guarda é sobre o último, não sobre o papel |
| AC-8 | Revogar sem motivo → 400 |
| AC-9 | Auditoria grava o ato com o motivo, sem PII |
| AC-10 | A lista mostra o perfil de cada usuário, em pt-BR |

---

## 8. Design

`docs/design/DS-PAINEL.md`. A tela `/users` já existe e **não é redesenhada**: entra uma coluna e
uma ação de linha.

**Revogar pede confirmação com motivo** (`ConfirmDialog`), pelo mesmo motivo da F79 — tira o acesso
de alguém e não se desfaz.

O **rótulo em pt-BR** é da camada de apresentação; `Role.name` continua em inglês, como todo
identificador do domínio (`CLAUDE.md`, *Regras de trabalho*). Um mapa em um lugar só — repeti-lo por
tela é como a lista de permissões se desgarra.
