# SPEC-079 — Acesso do Admin do tenant: ver, reenviar, corrigir e revogar

| campo | valor |
|---|---|
| **Fatia** | F79 |
| **MVP** | 1 *(posição na fila)* — decisão do PI, não Slice de PRD |
| **Slice do PRD** | não há. Nasce de decisão do PI em 22/09/2026 sobre a fronteira de quem cria usuário |
| **Superfície** | `apps/api` (rotas de plataforma) e `apps/admin-web` (aba nova em `/platform/[tenantId]`) |
| **Card** | #PENDENTE |
| **Status** | `aprovada-pi` — decisões tomadas em 22/09/2026, ver §2 |
| **Depende de** | `CriarTenantUseCase` (F61) e `Invitation` (F6), ambos em produção |

---

## 1. O que esta fatia entrega

O Super Admin passa a **enxergar e consertar** o acesso do Admin de cada academia.

Hoje o convite do Admin nasce junto do tenant (`criar-tenant.use-case.ts`), vale **24 horas** e
não há como reenviá-lo. Cliente que demora dois dias para abrir o e-mail fica trancado fora da
própria academia, e o único conserto é escrever no banco à mão. Erro de digitação no e-mail do
responsável tem o mesmo desfecho: o convite foi para um endereço que não existe e nada na
interface permite corrigir.

A fatia não inventa ator nem fluxo novo: o OWNER já nasce na criação do tenant, com
`PERMISSOES_DO_OWNER`. O que falta é a tela que mostra em que estado esse convite está e os três
atos que o destravam — **reenviar**, **corrigir o e-mail** e **revogar**.

---

## 2. Decisões do PI — 22/09/2026

| # | decisão | consequência nesta fatia |
|---|---|---|
| 1 | O Super Admin cria **um** usuário Admin por tenant, e nada mais | a aba trata de um Admin só; segundo administrador é trabalho do próprio tenant (F80) |
| 2 | O tenant cria os próprios usuários com o perfil que escolher | nenhuma gestão de equipe entra aqui — a tela do tenant é a F80 |
| 3 | F79 antes da F80 | esta fatia destrava o cliente trancado fora; a equipe do tenant vem depois |

---

## 3. Escopo

- **Aba "Acesso"** em `/platform/[tenantId]`, ao lado de Dados do cliente, Layout, Situação e
  Suporte. Quinta aba, mesmo padrão de `abas-do-cliente.tsx`.
- **Estado do Admin** visível sem clicar em nada: quem é, em que situação está e desde quando.
- **Reenviar convite** — emite token novo, revoga o anterior.
- **Corrigir o e-mail** do Admin, enquanto o convite não foi aceito.
- **Revogar convite** pendente.
- **Criar convite** quando não há nenhum (revogado, ou tenant antigo sem convite vivo).

### Não entra

- Gestão de equipe do tenant, perfis prontos e tela de usuários — **F80**.
- Troca de e-mail **depois** do aceite: vira troca de e-mail de usuário, outro assunto.
- Segundo Admin de plataforma no mesmo tenant.

---

## 4. Estados e atos

O estado sai de `Invitation` (mais recente do tenant, papel OWNER) cruzada com `TenantMembership`.

| estado | o que a tela mostra | atos oferecidos |
|---|---|---|
| **Pendente** | e-mail, quando expira | Reenviar · Corrigir e-mail · Revogar |
| **Vencido** | e-mail, que venceu | Reenviar · Corrigir e-mail |
| **Ativo** | e-mail, desde quando entrou | nenhum |
| **Sem convite** (revogado ou inexistente) | que não há acesso | Criar convite |

---

## 5. Regras

| # | regra | motivo |
|---|---|---|
| BR-1 | Reenviar **sempre** emite token novo e revoga o anterior, na mesma transação | estender o prazo do token antigo deixaria dois links vivos, e um deles numa caixa de e-mail que já pode ter vazado |
| BR-2 | Corrigir o e-mail só vale com convite **não aceito**; depois disso, 409 | depois do aceite existe usuário, e trocar o e-mail dele é operação de conta, não de convite |
| BR-3 | O token em claro existe **uma vez**, na resposta da rota | o banco guarda só o SHA-256, como `InvitationService` e `CriarTenantUseCase` já fazem |
| BR-4 | O e-mail sai **fora** da transação e nunca derruba a resposta | provedor que recusa não pode desfazer o convite já gravado; a resposta carrega `emailEnviado` e a tela diz a verdade |
| BR-5 | Todo ato é auditado **dos dois lados**: `platform_audit` e `audit_logs` do tenant | INV-008 — quem opera a academia precisa ver o que a plataforma fez dentro da casa dele, como `ElevarUseCase` já faz |
| BR-6 | As rotas exigem `PlatformGuard`, **sem** elevação de suporte | criar o Admin de um tenant é ato de plataforma, não de operação dentro do tenant |

---

## 6. Rotas

| método | rota | devolve |
|---|---|---|
| `GET` | `/api/v1/platform/tenants/:id/admin` | estado, e-mail, prazo ou data de entrada |
| `POST` | `/api/v1/platform/tenants/:id/admin/convite` | cria ou reenvia; aceita `email` opcional para corrigir. Devolve `token` e `emailEnviado` |
| `POST` | `/api/v1/platform/tenants/:id/admin/convite/revogar` | `{}` |

Uma rota só para criar, reenviar e corrigir: os três atos produzem o mesmo resultado — um convite
pendente válido para um e-mail. Separá-los multiplicaria caminho para o mesmo destino.

---

## 7. Critérios de aceite

| # | critério |
|---|---|
| AC-1 | Convite vencido → reenviar → token antigo recusado, token novo aceito |
| AC-2 | Corrigir e-mail com convite pendente → o anterior fica `REVOKED`, nasce `PENDING` no e-mail novo |
| AC-3 | Corrigir e-mail depois do aceite → 409, convite intocado |
| AC-4 | Reenviar com provedor de e-mail fora → convite criado, resposta com `emailEnviado: false`, tela avisa que a entrega é por conta de quem convidou |
| AC-5 | Revogar pendente → token recusado no aceite, estado vira "sem convite" |
| AC-6 | Todo ato grava linha em `platform_audit` **e** em `audit_logs` do tenant |
| AC-7 | Rotas recusam quem não é Super Admin |
| AC-8 | Tenant com Admin ativo não oferece nenhum ato |

---

## 8. Design

`docs/design/DS-PAINEL.md`. A aba segue `Tabs` como as outras quatro; o ícone acompanha o
vocabulário já usado (`building`, `image`, `power`, `shield`).

Os três atos têm gravidades diferentes e a tela precisa mostrar isso: reenviar é rotina, corrigir
e-mail mexe em para onde o acesso vai, revogar tira o acesso de alguém. **Revogar pede
confirmação**, pelo mesmo motivo que desligar o cliente pede.
