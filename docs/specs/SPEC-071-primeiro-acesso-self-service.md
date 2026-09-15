# SPEC-071 — Primeiro acesso self-service por CPF e data de nascimento

| campo | valor |
|---|---|
| **Fatia** | F71 |
| **Slice do PRD** | — (sem Slice correspondente; escopo mora nesta spec, como nas F49–F70) |
| **MVP** | 4 |
| **Plano de apoio** | — |
| **Status** | `rascunho` |
| **Criada em** | 2026-09-15 |
| **Aprovada pelo PI em** | — |
| **Card** | [#333](https://github.com/RodReis/arenahub/issues/333) |

---

## 0. Fiel ao protótipo

Esta spec segue as 4 telas anexadas pelo PI em 15/09/2026 (`docs/design/` — a incluir como
anexo desta spec quando o PI enviar os arquivos de design; por ora a referência é a própria
conversa). Nenhum campo, rótulo ou texto de apoio abaixo foi inventado — todos vêm das telas.

---

## 1. Objetivo em uma frase

Aluno sem senha ainda cria a própria conta informando **apenas CPF e data de nascimento** — sem
e-mail, sem convite, sem token — e vê os próprios dados de matrícula formatados antes de definir
a senha.

---

## 2. Pré-condições

| item | estado |
|---|---|
| Gate de entrada do MVP | MVP 4 aprovado para planejamento em 14/08/2026 (`MVP-04-app-totem.md` §1) |
| ADRs que bloqueiam | **ADR-057** — decidido pelo PI em 15/09/2026; texto pronto na §11, pendente de commit em `docs/DECISIONS.md` (nota abaixo) |
| Fatias anteriores | F23 (Identidade e shell mobile) — ✅ entregue, aguardando aceite. Login por e-mail/telefone + senha **continua existindo, tela inalterada** — o protótipo confirma isso (tela 2) |
| Decisões dos PRDs | `M4-FR-001`, `M4-FR-002` — atendidas por desenho (ver §3) |

> **Nota de processo:** a ADR-057 e a linha F71 do Índice Fatia↔SPEC (`docs/STATUS.md` §5) têm o
> texto pronto (§11 e nota abaixo) mas não foram commitadas — os dois arquivos passam de 150 KB e
> 260 KB, e reescrevê-los por inteiro nesta sessão arriscava corromper conteúdo histórico sem
> revisão por diff. Linha para `STATUS.md` §5, logo após F70:
> `| F71 | SPEC-071 | 4 | — | Primeiro acesso self-service por CPF e data de nascimento | [SPEC-071-primeiro-acesso-self-service.md] · [ADR-057] | #333 | rascunho |`

---

## 3. Decisões desta fatia

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | Consulta (CPF+data → nome) e criação de senha são dois passos/dois endpoints, não um | um único request fazendo os dois | erro ao criar a senha não deveria obrigar redigitar CPF e data; e é a consulta sozinha que precisa da mensagem neutra do `M4-FR-002` |
| 2 | Campos exibidos (CPF, datas) usam as máscaras já convencionadas no `CLAUDE.md` — aplicação da convenção existente, não decisão nova | máscara própria para esta tela | duas implementações da mesma máscara divergem na primeira mudança |
| 3 | **Login (`POST /api/v1/mobile/auth/login`, da F23) passa a aceitar CPF como identificador alternativo a e-mail/telefone** | manter login só por e-mail/telefone e mudar o texto da tela de confirmação para não prometer CPF | a tela 4 do protótipo diz ao aluno *"você vai usar esta senha junto com seu CPF para entrar"* — se o login não aceitar CPF, a própria ativação ensina algo que não funciona. Extensão de baixo custo (mais um formato de identificador aceito na mesma consulta que já existe), não decisão cara de desfazer — não vira ADR. **Confirmar com o PI (Pergunta 3, §9)** |
| 4 | "Primeiro acesso" não tem nenhum passo de e-mail — nem coleta, nem confirmação, nem convite | manter convite por e-mail como alternativa dentro do mesmo fluxo | o PI foi explícito: "só por CPF + data, sem e-mail". O convite da F23 continua existindo como fluxo **separado**, iniciado por quem envia o convite (recepção), não pelo aluno |

Decisões com efeito além desta fatia estão na **ADR-057** (§11).

---

## 4. Escopo negativo

| não faz | vai para |
|---|---|
| Rebuild da carteirinha completa (QR, frequência) | F24 — Slice 4.2, ainda `planejada` |
| Throttling ou segundo fator na consulta por CPF+data | backlog — reabre se o gatilho de revisão da ADR-057 disparar |
| Remover ou alterar o convite por e-mail da F23 | permanece como está — fluxo separado, disparado pela recepção |
| Coleta ou confirmação de e-mail dentro do "Primeiro acesso" | nunca — decisão explícita do PI (§3, decisão 4) |
| Autenticação recorrente só por CPF sem senha | fora de escopo — CPF é identificador de login (decisão 3), a senha continua obrigatória |
| CPF como autenticador no totem | já resolvido, de forma diferente, pela ADR-045 — superfície distinta, não reaberta aqui |

---

## 5. Invariantes que esta fatia precisa preservar

- **Resposta que não distingue identificador existente de inexistente** (`M4-FR-002`) — a consulta
  por CPF+data devolve a mesma forma de resposta para "não encontrado", "cancelado" e erro interno.
- **Nunca logar CPF, data de nascimento, senha ou hash em claro** — mesma regra da `SPEC-023` §4.
- **`tenant_id` vindo da identidade autenticada** não se aplica à consulta (pré-autenticação) — a
  busca por CPF é escopada pelo `tenantSlug` do build do app, nunca por um tenant no corpo da
  requisição.

---

## 6. Telas e cópia exata (fiel ao protótipo)

### 6.1 Entrada — tela de login (já existente, F23; só ganha o link)

- Campos: **"E-mail ou telefone"** (placeholder `nome@email.com`), **"Senha"**.
- Botão: **"Entrar"**.
- Links: **"Esqueci minha senha"** · **"Entrar com biometria"**.
- Novo, em destaque: **"Primeiro acesso?"** + link **"Criar minha senha"**.

### 6.2 Primeiro acesso — consulta

- Título: **"Primeiro acesso"**.
- Subtítulo: **"Confirme seus dados de matrícula para criar sua senha de acesso."**
- Campos: **CPF** (placeholder `000.000.000-00`), **Data de nascimento** (placeholder `dd/mm/aaaa`).
- Botão: **"Consultar meu cadastro"**.
- Texto de apoio: **"Consultamos o CPF no cadastro da academia. Nada é criado sem confirmação dos seus dados."**

### 6.3 Primeiro acesso — cadastro encontrado

- Título: **"Primeiro acesso"**.
- Subtítulo: **"Encontramos sua matrícula. Agora defina a senha de acesso."**
- Selo: **"✓ Cadastro encontrado"** (verde).
- Nome completo em destaque.
- Lista de dados, rótulo em caixa alta à esquerda, valor formatado à direita:

  | rótulo | formato | exemplo do protótipo |
  |---|---|---|
  | CPF | `000.000.000-00` | `857.906.721-91` |
  | DATA DE NASCIMENTO | `dd/mm/aaaa` | `06/10/1978` |
  | PLANO | texto do plano | `Mensal Fit` |
  | LOCAL | nome da unidade | `Unidade Centro` |
  | DATA DE INÍCIO | `dd/mm/aaaa` | `05/01/2026` |

- Seção **"Crie sua senha"**: campos **"Nova senha"**, **"Confirmar senha"**.
- Texto de apoio: **"Use ao menos 6 caracteres. Você vai usar esta senha junto com seu CPF para entrar."**
- Botão: **"Criar senha e entrar"**.

### 6.4 Falha na consulta (não coberta por print, mas exigida por `M4-FR-002`)

Mensagem única, genérica, sem distinguir motivo: recomendação de texto —
**"Não encontramos seu cadastro. Procure a administração da academia."** — mesma disciplina de
`ADR-024`/`ADR-045`.

---

## 7. Contrato

**Endpoints** (novos, prefixo `/api/v1/mobile/activation`):

- `POST .../lookup` — body `{ cpf, dataNascimento }`; sucesso devolve
  `{ nomeCompleto, cpfFormatado, dataNascimento, plano, local, dataInicio, activationRef }`
  (referência opaca de curta duração, nunca o `studentId`); falha devolve o mesmo
  formato/status para não encontrado, cancelado ou erro, com a mensagem genérica da §6.4.
- `POST .../self-service` — body `{ activationRef, senha, confirmacaoSenha }`; cria a senha e
  ativa a conta; mesmas regras de força de senha já usadas na `SPEC-023`.

**Endpoint alterado:**

- `POST /api/v1/mobile/auth/login` (F23) — body ganha aceitar `cpf` como alternativa a
  `emailOuTelefone`; validação e resposta seguem `M4-FR-002` (mesma forma para credencial errada e
  identificador inexistente).

**Eventos** — reaproveita o evento de ativação de conta já emitido pela F23, com um campo indicando
o canal (`INVITE` | `SELF_SERVICE`) para permitir auditoria de qual caminho cada aluno usou.

**Migrações** — nenhuma tabela nova; reaproveita `student_accounts`. `activationRef`, se precisar
de persistência com expiração, cabe em `account_activation_tokens` (já existe — `SPEC-023` / PRD
§11), com um tipo `SELF_SERVICE_LOOKUP`.

---

## 8. Critérios de aceite

- [ ] AC-1 — aluno com CPF e data de nascimento cadastrados, sem senha ainda, informa os dois e
      vê o próprio nome completo e os 5 campos formatados (§6.3), sem mais nenhum dado sensível.
- [ ] AC-2 — aluno informa CPF ou data que não localizam ninguém e vê a mesma mensagem genérica —
      indistinguível de "encontrado e cancelado".
- [ ] AC-3 — aluno cria senha após localizado e consegue entrar no app com **CPF + senha** (não só
      e-mail — decisão 3, §3).
- [ ] AC-4 — nenhuma etapa do "Primeiro acesso" pede, mostra ou confirma e-mail.
- [ ] AC-5 — login por e-mail/telefone (F23) continua funcionando sem alteração de comportamento
      para quem já usa esse caminho.
- [ ] AC-6 — CPF exibido é mascarado (`000.000.000-00`); datas em `dd/mm/aaaa`.

Mapeia para `M4-AC-001` (aluno ativa conta sem intervenção administrativa sobre senha).

---

## 9. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | ~~"Primeiro acesso" e o convite por e-mail coexistem?~~ | **Resolvido**: coexistem — "Primeiro acesso" é caminho adicional, exclusivo de CPF+data; convite da F23 segue existindo, disparado pela recepção | 15/09/2026 |
| 2 | ~~Os campos Plano/Local/Data de Início já existem na Home da F23?~~ | **Resolvido pelo protótipo**: é tela nova (§6.3), não a Home | 15/09/2026 |
| 3 | O login deve passar a aceitar CPF (decisão 3, §3), ou o texto da tela 4 ("...junto com seu CPF para entrar") deve mudar para "e-mail/telefone"? Assumi a primeira opção como default. | — | — |

---

## 10. Fora de dúvida

- **CPF no totem continua CPF puro (ADR-045)** — esta spec não reabre aquela decisão; são
  superfícies e mecanismos diferentes (login recorrente no totem vs. ativação única no app).
- **O risco de account takeover por antecipação foi apresentado e aceito pelo PI** (ADR-057,
  Decisão 2) — não é omissão, é decisão registrada.
- **Os campos da tela de confirmação (§6.3) são de uma tela nova desta fatia**, não da Home
  entregue pela F23 — confirmado pelo protótipo.

---

## 11. ADR-057 (texto pronto — pendente de commit em `docs/DECISIONS.md`)

## ADR-057 — Primeiro acesso self-service por CPF + data de nascimento (F71)

**Data:** 15/09/2026
**Status:** aceito *(decisão nova — decidida pelo PI em 15/09/2026)*
**Decisor:** Rodrigo Reis (PI)
**Contexto:** a F23 (SPEC-023, Slice 4.1) entregou ativação de conta por convite/token de uso
único enviado por e-mail (`M4-FR-001`) — é o único caminho de ativação em produção hoje. O PI
pediu, em 15/09/2026, um segundo caminho na tela de login do app, fiel a um protótipo de 4 telas:
o aluno sem senha ainda informa CPF e data de nascimento, o sistema localiza o cadastro e devolve
nome, CPF, data de nascimento, plano, unidade e data de início formatados; encontrado, libera dois
campos para criar a senha; não encontrado, mostra mensagem única pedindo para procurar a
administração da academia. **Sem nenhuma etapa de e-mail** — confirmado explicitamente pelo PI.

**Por que é ADR:** introduz um segundo mecanismo de prova de identidade para criar credencial de
aluno, ao lado do que a F23 já entregou e já está em produção — não é ajuste de tela, é um caminho
novo de acesso que, uma vez comunicado a alunos, é caro de desfazer. E fixa um precedente de
segurança da mesma família do ADR-045 (CPF como parte de um mecanismo de autenticação/ativação,
com risco de enumeração aceito conscientemente) — precedente que outra fatia vai citar.

### Decisões

1. **CPF + data de nascimento autenticam a CONSULTA, não abrem sessão.** Localizam o cadastro e
   liberam a tela de criação de senha; só a senha, uma vez criada, autentica dali em diante.
2. **Risco aceito, sem throttling nem segundo fator nesta fatia.** CPF e data de nascimento não
   são segredo — circulam em contratos, grupos de turma, redes sociais — e quem souber os dois de
   outro aluno consegue chegar primeiro à tela de criar senha daquela conta. **O PI foi confrontado
   com o risco de antecipação de conta e decidiu aceitar como está** — sem limite de tentativas,
   sem confirmação por segundo canal nesta fatia.
3. **Mensagem única e neutra para qualquer falha de localização**, disciplina já usada nas
   ADR-024 e ADR-045.
4. **O convite por e-mail da F23 não é revogado; os dois caminhos coexistem, e "Primeiro acesso"
   não tem nenhuma etapa de e-mail** — confirmado pelo PI em 15/09/2026: quem recebeu convite ativa
   por ele; quem não recebeu usa "Primeiro acesso", que é exclusivamente CPF+data do início ao fim.
5. **Se a mesma conta for ativada pelos dois caminhos em corrida**, o primeiro a definir a senha
   vence — o token de convite, se ainda não consumido, passa a apontar para uma conta já ativada e
   falha como "já ativada" ao ser usado depois.
6. **Login recorrente passa a aceitar CPF como identificador alternativo** (`SPEC-071` §3, decisão
   3) — consequência direta de a tela de confirmação prometer login "com seu CPF". Pendente de
   confirmação final do PI (`SPEC-071` §9, pergunta 3).

### Consequências

| # | consequência | onde |
|---|---|---|
| 1 | Novo endpoint de consulta por CPF+data e endpoint de definição de senha, além do já existente `POST /api/v1/mobile/activation/confirm` (token) | `MVP-04-app-totem.md` §10, `SPEC-071` |
| 2 | `M4-FR-001` ganha um segundo modo de ativação; `M4-FR-002` se aplica também a este caminho | `MVP-04-app-totem.md` §8 |
| 3 | Enumeração de CPF+data de nascimento é risco vivo e aceito nesta fatia | `SPEC-071` §8 |
| 4 | Convite por e-mail (F23) permanece ativo, sem nenhuma etapa de e-mail no caminho novo | `SPEC-023` |
| 5 | Login (`mobile/auth/login`) ganha CPF como identificador aceito, além de e-mail/telefone | `SPEC-023`, `SPEC-071` §7 |

### Gatilho de revisão

Qualquer indício de uso do "Primeiro acesso" para ativar conta de aluno diferente do que a
solicitou reabre a Decisão 2 — throttling e/ou segundo fator deixam de ser opcionais.
