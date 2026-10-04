# SPEC-XXX — Perfil do usuário logado e troca de senha

> **Número provisório.** `F<n>` e `SPEC-<nnn>` são alocados pelo Cowork no Índice Fatia ↔ SPEC do
> `docs/STATUS.md` (nunca reaproveitados). O Code não espera a alocação: renomeia este arquivo e
> acerta o título quando o número chegar.

| campo | valor |
|---|---|
| **Fatia** | F? *(a alocar)* |
| **Slice do PRD** | não há. Nasce de pedido do PI em 04/10/2026 |
| **MVP** | — *(a alocar junto com o card)* |
| **Superfície** | `apps/api` (`auth`) e `apps/admin-web` (rota nova `/perfil`, topbar) |
| **Plano de apoio** | [`2026-10-04-perfil-do-usuario-e-troca-de-senha.md`](../superpowers/plans/2026-10-04-perfil-do-usuario-e-troca-de-senha.md) |
| **Status** | `aprovada-pi` |
| **Criada em** | 2026-10-04 |
| **Aprovada pelo PI em** | 04/10/2026 (design em chat e spec revisada); revisão técnica pós-leitura do código em §3 #5–#8 |
| **Card** | — *(Cowork cria)* |

---

## 1. Objetivo em uma frase

Quem está logado no painel abre a própria página de perfil, vê os dados da sua conta e **troca a
própria senha** sem pedir a ninguém — hoje não existe nenhum caminho para isso.

---

## 2. Pré-condições

| item | estado |
|---|---|
| Gate de entrada do MVP | n/a — não pertence a um MVP de PRD |
| ADRs que bloqueiam | nenhum |
| Fatias anteriores | nenhuma. Reaproveita `PasswordService`, a família de sessões e a proteção de força bruta já existentes em `apps/api/src/modules/auth/` |
| Decisões dos PRDs | n/a |

---

## 3. Decisões desta fatia

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | **Avatar é sempre as iniciais do e-mail.** Sem upload e sem foto | foto do leitor facial; upload próprio | dono, funcionário e professor têm foto de cadastro no leitor (`Student.photoObjectKey`, #503), mas **não existe vínculo entre `User` (login) e o registro de pessoa `Student`** — sem ele o painel não sabe de quem é a foto. Decisão do PI em 04/10/2026: sem foto por ora |
| 2 | **Dados só de leitura, sem nome.** E-mail, perfis, academia, conta criada em | `User.name` editável | `User` não tem nome; criar o campo exigiria migration e decidir onde ele aparece. O PI escolheu só leitura |
| 3 | **Troca de senha encerra as OUTRAS sessões e mantém esta** | não mexer nas sessões; encerrar todas | senha trocada por suspeita de vazamento precisa derrubar o outro navegador, e derrubar também esta só obrigaria a digitar de novo o que acabou de ser digitado. Decisão do PI |
| 4 | **Piso de senha = 8**, o mesmo `MINIMO_DE_SENHA` do aceite de convite | piso novo, ou 10 como o aluno | o PI fixou 8 em 05/09/2026 (#281) e a regra tem hoje três cópias que devem ser o mesmo número. Esta rota é a quarta |
| 5 | **Sem código TOTP na troca, e sem "MFA" na página** *(revisto na leitura do código)* | exigir TOTP quando `mfaStatus = ENABLED` | sessão de tenant **nunca** é de usuário com MFA: quem tem MFA é o Super Admin, e o login dele abre sessão de **plataforma** (INV-007, `auth.service.ts` `login`). O campo nunca apareceria e a regra seria código morto; a linha "MFA: desligado" seria igual para todo mundo |
| 6 | **Sessão de suporte não troca senha** (403) | deixar trocar | na elevação de suporte o usuário da sessão é o Super Admin, não alguém da academia. Trocar a senha de plataforma pelo painel do cliente, sem o segundo fator, contorna o INV-007 |
| 7 | **Leitura em rota própria `GET /auth/profile`**, `/auth/me` intocado *(revisto)* | estender `/auth/me` | o layout chama `/auth/me` em **toda** navegação e ele já consulta cobrança; papéis e academia só interessam a uma página |
| 8 | **Senha atual errada é `422`, não `401`** *(revisto)* | `401` | `401` significa "sem sessão" no resto da API; a pessoa está logada, o que falhou foi a conferência de um campo |
| 9 | **Rotas no `AuthController`** | rotas em `iam` | `iam` gere outras pessoas (convidar, revogar). Trocar a própria credencial é autenticação, junto de `login`/`refresh`/`me` |

---

## 4. Escopo negativo

| não faz | vai para |
|---|---|
| Foto de perfil, do leitor ou enviada | fatia futura, depende do vínculo `User`↔`Student` |
| Nome e e-mail editáveis | fora; troca de e-mail depois do aceite é "outro assunto" (SPEC-079 §Fora) |
| Recuperação de senha por e-mail ("esqueci a senha") | fora; a regra do login de não validar tamanho (`iam.controller.ts`) segue como está |
| Troca de senha do Super Admin | fora; o perfil é do painel de tenant, e em suporte a rota recusa (§3 #6) |
| Gestão das próprias sessões (listar, encerrar uma) | fora; esta fatia só encerra em massa, como efeito da troca |
| Derrubar o access token já emitido das outras sessões na hora | fora; o `AuthGuard` não consulta a sessão no banco, o logout de hoje tem o mesmo limite (§8) |

---

## 5. Invariantes que esta fatia precisa preservar

- `INV-002` — o usuário e o tenant vêm da sessão autenticada, nunca do corpo. A rota não aceita
  `userId`, e o `.strict()` recusa campo desconhecido.
- `INV-007` — a troca não vira atalho para a credencial do Super Admin (§3 #6).
- **Exclusão mútua da troca.** Duas trocas simultâneas com a mesma senha atual: só uma grava. A
  escrita é condicionada ao hash lido (`updateMany ... where passwordHash = <lido>`), e a segunda
  recebe "senha atual incorreta".
- **Nunca logar credencial** (`CLAUDE.md`, convenções): nem senha atual nem nova aparecem em log,
  auditoria ou mensagem de erro.

---

## 6. Contrato

**Endpoints**

| método | rota | o quê |
|---|---|---|
| `GET` | `/api/v1/auth/profile` | **nova.** Sessão de tenant. Devolve `{ email, createdAt, roles: string[], tenant: { displayName, timezone } }`. `roles` são os nomes de papel distintos do usuário neste tenant; `timezone` segue o fallback Tenant → primeira unidade de `cobranca()`, e pode ser `null` |
| `POST` | `/api/v1/auth/password` | **nova.** Sessão de tenant. Corpo `{ currentPassword, newPassword }`, Zod `.strict()`. `204` em sucesso |

**Regras do `POST /auth/password`**, nesta ordem:

1. Sessão de suporte → `403 AUTH_PASSWORD_CHANGE_IN_SUPPORT`.
2. Corpo inválido (`newPassword` fora de 8–1024) → `400` do `ZodError`.
3. **Força bruta:** chave `senha:<userId>`, soma **toda** tentativa (molde do MFA: um contador que só
   soma em erro nunca travaria o acerto depois do limite), 10 por minuto, bloqueio de 60 s → `429
   AUTH_PASSWORD_CHANGE_RATE_LIMITED`, antes de conferir.
4. `currentPassword` errada → `422 AUTH_CURRENT_PASSWORD_INVALID`, mensagem genérica.
5. `newPassword` igual à atual → `422 AUTH_PASSWORD_UNCHANGED`.
6. Em sucesso, **numa transação**: grava o novo hash condicionado ao hash lido; revoga toda sessão
   `ACTIVE`/`ROTATED` do usuário fora da família da sessão atual, com `revokedReason =
   'password_changed'`; grava `AuditLog` `user.password_changed` sem valor de senha.

A **confirmação** da senha é só da tela, como no aceite de convite: a API não a recebe.

**Painel (`apps/admin-web`)**

- `app/(protected)/usuario.tsx`: o chip da topbar vira `<Link href="/perfil">`; `iniciais()` passa a
  ser exportada para a página reusar.
- `app/(protected)/perfil/page.tsx`: Server Component com duas seções — **Conta** (avatar com
  iniciais, e-mail, perfis com `rotuloDePerfil`, academia, conta criada em via `TenantDateTime`) e
  **Alterar senha** (`formulario-de-senha.tsx`, client).
- `app/actions/perfil.ts`: Server Action `alterarSenha` com o mesmo `MINIMO_DE_SENHA = 8`; confere
  confirmação e "igual à atual" antes de chamar a API.
- Erro por Toast (`useToastDeErro`), sucesso por Toast; campos limpos depois do sucesso.

**Eventos** — nenhum. **Migrações** — nenhuma.

---

## 7. Critérios de aceite

- [ ] AC-1 — Clicar no chip da topbar abre `/perfil`.
- [ ] AC-2 — `/perfil` mostra e-mail, perfis, academia e "conta criada em" do usuário logado, com
  iniciais no avatar.
- [ ] AC-3 — Trocar a senha com a atual certa e nova válida confirmada: Toast de sucesso, campos
  limpos, **esta sessão continua logada**.
- [ ] AC-4 — Depois de AC-3, entrar com a senha **antiga** falha e com a **nova** passa.
- [ ] AC-5 — Depois de AC-3, outra sessão do mesmo usuário **não renova mais** (refresh recusado) e
  perde o acesso **em até 10 minutos**, quando o access token dela vence.
- [ ] AC-6 — Senha atual errada → Toast de erro, nada muda.
- [ ] AC-7 — Nova senha com menos de 8 caracteres, confirmação diferente ou igual à atual → Toast
  com a frase certa, sem chamar a API.
- [ ] AC-8 — Sessão de suporte (Super Admin elevado) → troca recusada.
- [ ] AC-9 — Dez tentativas no mesmo minuto recebem `429`.
- [ ] AC-10 — Nenhuma senha aparece na auditoria nem em resposta.

---

## 8. Riscos e o que pode dar errado

| risco | sinal de que aconteceu | o que fazer |
|---|---|---|
| Revogar "as outras" derrubar a própria sessão | AC-3 falha: deslogado ao trocar | a família mantida vem da sessão do `sessionId` do token; teste prova que o refresh atual segue rotacionando |
| Outra sessão segue viva até 10 min | AC-5 lido como "na hora" | limite conhecido do `AuthGuard` (só assinatura); é o mesmo do logout. Corrigir é fatia própria: consultar a sessão a cada requisição |
| Revogação fora da transação | senha trocada e sessão antiga viva após erro no meio | uma `$transaction` interativa: hash, revogação e auditoria juntos |
| Rota virar oráculo de senha | muitas tentativas sem bloqueio | força bruta por usuário, somando toda tentativa |
| Piso desalinhado entre tela e API | tela aceita e API recusa | o mesmo número nos quatro lugares, com comentário cruzado |
| Verde sem provar a revogação | teste passa pelo motivo errado | canário: comentar a revogação tem de derrubar o teste de AC-5 |

---

## 9. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Avatar: upload próprio ou foto do leitor? | **Só iniciais**; foto depende de vínculo `User`↔`Student` | 04/10/2026 |
| 2 | Dados do perfil: quais e algum editável? | **Só leitura, sem nome** | 04/10/2026 |
| 3 | O que a troca de senha faz com as outras sessões? | **Encerra as outras, mantém esta** | 04/10/2026 |
| 4 | Como achar a foto do leitor do usuário logado? | **Sem foto por ora** | 04/10/2026 |

---

## 10. Fora de dúvida

- **Por que não usar a foto do aluno?** → dono, staff e professor são linhas de `Student` com
  `profile` ADMIN/STAFF/TRAINER e é lá que a foto do leitor mora, mas não há ponte até `User`.
- **Por que não pede código do autenticador?** → §3 #5: nenhuma sessão de tenant é de usuário com MFA.
- **Por que o piso é 8 e não 10?** → 8 é decisão do PI de 05/09/2026 e já é o piso de quem aceita o
  convite. Uma pessoa que entrou com 8 não pode ser barrada ao trocar por outra de 8.
