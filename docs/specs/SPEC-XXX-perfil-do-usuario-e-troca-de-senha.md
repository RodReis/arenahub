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
| **Plano de apoio** | nenhum — fatia pequena, o desenho é este arquivo |
| **Status** | `rascunho` |
| **Criada em** | 2026-10-04 |
| **Aprovada pelo PI em** | design aprovado em chat em 04/10/2026; spec ainda não revisada |
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
| Fatias anteriores | nenhuma. Reaproveita `PasswordService`, `SessionRepository` e a proteção de força bruta já existentes em `apps/api/src/modules/auth/` |
| Decisões dos PRDs | n/a |

---

## 3. Decisões desta fatia

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | **Avatar é sempre as iniciais do e-mail.** Sem upload e sem foto | foto do leitor facial; upload próprio | dono, funcionário e professor têm foto de cadastro no leitor (`Student.photoObjectKey`, #503), mas **não existe vínculo entre `User` (login) e o registro de pessoa `Student`** — sem ele o painel não sabe de quem é a foto. Decisão do PI em 04/10/2026: sem foto por ora |
| 2 | **Dados só de leitura, sem nome.** E-mail, papéis, academia, MFA, criada em | `User.name` editável | `User` não tem nome; criar o campo exigiria migration e decidir onde ele aparece. O PI escolheu só leitura |
| 3 | **Troca de senha encerra as OUTRAS sessões e mantém esta** | não mexer nas sessões; encerrar todas | senha trocada por suspeita de vazamento precisa derrubar o outro navegador, e derrubar também esta só obrigaria a digitar de novo o que acabou de ser digitado |
| 4 | **Piso de senha = 8**, o mesmo `MINIMO_DE_SENHA` do aceite de convite | piso novo, ou 10 como o aluno | o PI fixou 8 em 05/09/2026 (#281) e a regra tem hoje três cópias que devem ser o mesmo número. Esta rota seria a quarta |
| 5 | **Com MFA ligado, a troca exige o código TOTP** além da senha atual | só a senha atual | quem tem o cookie de sessão mas não tem o segundo fator não pode trocar a credencial que ele protege |
| 6 | **Rota nova no `AuthController`:** `POST /api/v1/auth/password` | rota em `iam` | é troca de credencial da própria sessão, não gestão de usuário. Fica junto de `login`/`refresh`/`me`, onde mora o resto da autenticação |

---

## 4. Escopo negativo

| não faz | vai para |
|---|---|
| Foto de perfil, do leitor ou enviada | fatia futura, depende do vínculo `User`↔`Student` |
| Nome e e-mail editáveis | fora; troca de e-mail depois do aceite é "outro assunto" (SPEC-079 §Fora) |
| Recuperação de senha por e-mail ("esqueci a senha") | fora; a regra do login de não validar tamanho (iam.controller) segue como está |
| Troca de senha do Super Admin da plataforma | fora; o perfil é do painel de tenant |
| Gestão das próprias sessões (listar, encerrar uma) | fora; esta fatia só encerra em massa, como efeito da troca |
| Ligar ou desligar o MFA pelo perfil | fora; MFA tem fluxo próprio no login |

---

## 5. Invariantes que esta fatia precisa preservar

- `INV-002` — o usuário e o tenant vêm da sessão autenticada, nunca do corpo. A rota não aceita
  `userId`.
- **Regra de arquitetura nº 4 (idempotência de efeito externo).** Repetir a mesma requisição de
  troca com a senha antiga já trocada falha com "senha atual incorreta" — nunca grava duas vezes e
  nunca deixa a conta num estado intermediário.
- **Nunca logar PII/credencial** (`CLAUDE.md`, convenções): nem senha atual, nem nova, nem o código
  TOTP aparecem em log, auditoria ou mensagem de erro.

---

## 6. Contrato

**Endpoints**

| método | rota | mudança |
|---|---|---|
| `GET` | `/api/v1/auth/me` | **estendida.** Além de `id`, `email`, `permissions` e o que já devolve, passa a devolver `roles` (nomes), `tenant` (`displayName`), `mfaStatus` e `createdAt`. `select` explícito: nunca `passwordHash` nem os campos de segredo do MFA |
| `POST` | `/api/v1/auth/password` | **nova.** Autenticada (cookie de acesso). Corpo `{ currentPassword, newPassword, confirmation, mfaCode? }`, Zod `.strict()`. `204` em sucesso |

**Regras do `POST /auth/password`**

1. `newPassword` com 8 a 1024 caracteres e igual a `confirmation`. Inválido → `400` com
   `application/problem+json` e código estável.
2. `newPassword` igual a `currentPassword` → `422`, código estável. Trocar por si mesma não troca nada.
3. Confere `currentPassword` com `PasswordService.conferir`. Errada → `401` com código estável e
   mensagem **genérica**.
4. **Força bruta:** a senha atual é um oráculo para quem roubou um cookie, então a conferência passa
   pelo mesmo `ThrottlerStorage` do login e do MFA, com chave por **usuário** (`senha:<userId>`),
   somando toda tentativa. Estourado o limite → `429`, antes de conferir.
5. `mfaStatus` ativo → `mfaCode` obrigatório e conferido por `MfaService.verificar` **antes** de
   gravar. Ausente ou errado → recusa, com a mesma proteção de força bruta do MFA.
6. Em sucesso, **na mesma transação**: grava o novo `passwordHash` e revoga todas as famílias de
   sessão ativas do usuário **exceto a da sessão atual**, com `revokedReason = 'password_changed'`.
7. Auditoria do ato (`AuditLog`) com `userId` e `tenantId` da sessão, **sem** nenhum valor de senha
   ou código.

**Painel (`apps/admin-web`)**

- `app/(protected)/usuario.tsx`: o chip da topbar vira `<Link href="/perfil">`. O cálculo de
  iniciais sai para ser reusado pela página sem duplicar.
- `app/(protected)/perfil/page.tsx`: Server Component, duas seções.
  - **Conta** — avatar (iniciais), e-mail, papéis, academia, MFA ligado ou não, conta criada em.
    Datas pelo componente de data/hora do tenant (regra 5 do lint), nunca `Intl` solto.
  - **Alterar senha** — formulário com `senha atual`, `nova senha`, `confirmar nova senha` e, só
    quando `mfaStatus` ativo, `código do autenticador`.
- `app/actions/perfil.ts`: Server Action que valida em JS (mesmo `MINIMO_DE_SENHA = 8` de
  `actions/usuarios.ts`), chama a rota e devolve estado para `useActionState`.
- Erro e sucesso por **Toast**, nunca `Alert`. Campos **não controlados**; validação em JS, nunca
  `required` nativo (estrutura com passos escondidos morre calada). Os campos de senha são
  limpos depois do sucesso.
- Estilo pelo `docs/design/DS-PAINEL.md`: tokens `--ah-*`, sem hex literal.

**Eventos** — nenhum. **Migrações** — nenhuma: nada novo em `packages/database`.

---

## 7. Critérios de aceite

- [ ] AC-1 — Clicar no chip da topbar abre `/perfil`.
- [ ] AC-2 — `/perfil` mostra e-mail, papéis, academia, MFA e "conta criada em" corretos para o
  usuário logado, e iniciais no avatar.
- [ ] AC-3 — Trocar a senha com a atual certa, nova válida e confirmação igual: Toast de sucesso,
  campos limpos, **esta sessão continua logada**.
- [ ] AC-4 — Depois de AC-3, entrar com a senha **antiga** falha e com a **nova** passa.
- [ ] AC-5 — Depois de AC-3, uma **segunda sessão** do mesmo usuário (outro navegador) perde o
  acesso na próxima requisição.
- [ ] AC-6 — Senha atual errada → Toast de erro genérico, nada muda.
- [ ] AC-7 — Nova senha com menos de 8 caracteres, confirmação diferente ou igual à atual → Toast
  com a frase certa, sem chamar a API quando o erro é detectável na tela.
- [ ] AC-8 — Usuário com MFA ligado: o formulário pede o código; sem ele, ou com código errado, a
  troca é recusada e a senha não muda.
- [ ] AC-9 — Dez tentativas seguidas de senha atual errada recebem `429`.
- [ ] AC-10 — Nem a senha atual, nem a nova, nem o código aparecem em nenhum log nem na auditoria.
- [ ] AC-11 — `GET /auth/me` não devolve `passwordHash` nem campos de segredo do MFA.

---

## 8. Riscos e o que pode dar errado

| risco | sinal de que aconteceu | o que fazer |
|---|---|---|
| Revogar "as outras" derrubar a própria sessão | AC-3 falha: o usuário é deslogado ao trocar | a exclusão usa `familyId` da sessão atual, lido do refresh no cookie; teste de integração prova que a atual segue viva |
| Revogação fora da transação | senha trocada e sessão antiga ainda viva após erro no meio | um único `$transaction`: hash e revogação juntos |
| Rota virar oráculo de senha | muitas tentativas de senha atual sem bloqueio | força bruta por usuário, somando toda tentativa (molde do MFA) |
| Piso de senha desalinhado | tela aceita 8 e API recusa, ou o contrário | uma constante só, citada nos dois lados (a mesma disciplina do convite) |
| `Intl` solto na data de criação | lint da regra 5 falha | usar `TenantDateTime` |
| Verde sem provar a revogação | teste de revogação passa pelo motivo errado | canário por mutação: remover a revogação deve derrubar AC-5 |

---

## 9. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Avatar: upload próprio ou foto do leitor? | Nem um nem outro agora: **só iniciais**; foto depende de vínculo `User`↔`Student` | 04/10/2026 |
| 2 | Dados do perfil: quais e algum editável? | **Só leitura, sem nome** | 04/10/2026 |
| 3 | O que a troca de senha faz com as outras sessões? | **Encerra as outras, mantém esta** | 04/10/2026 |
| 4 | Como achar a foto do leitor do usuário logado? | **Sem foto por ora** | 04/10/2026 |

---

## 10. Fora de dúvida

- **Por que não usar a foto do aluno?** → dono, staff e professor são linhas de `Student` com
  `profile` ADMIN/STAFF/TRAINER e é lá que a foto do leitor mora, mas não há ponte até `User`.
  Casar por e-mail de contato foi descartado pelo PI: e-mail de contato não é verificado.
- **Por que a rota não é do `iam`?** → `iam` gere outras pessoas (convidar, revogar). Trocar a
  própria credencial é autenticação.
- **Por que o piso é 8 e não 10?** → 8 é decisão do PI de 05/09/2026 e já é o piso de quem aceita o
  convite. Uma pessoa que entrou com 8 não pode ser barrada ao trocar por outra de 8.
