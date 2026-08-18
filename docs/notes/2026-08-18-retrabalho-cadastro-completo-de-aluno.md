# Retrabalho — Cadastro completo de aluno

**Data:** 18/08/2026 · **Autor:** Cowork (planejamento) · **Decisor:** PI (Rodrigo Reis)
**Origem:** Especificação Completa §11 — *Cadastro Completo do Aluno* · §10 *"cadastro completo de alunos"*
**Fatia entregue que este documento revisita:** F7 / SPEC-007 — *Aluno, plano e entitlement manual* (Slice 1.2, MVP 1)

---

## 1. O que aconteceu

A F7 entregou um cadastro com **quatro campos**: nome, data de nascimento, um contato e CPF
opcional. A Especificação §11 lista **dezoito**, mais contato de emergência. A Slice 1.2 do PRD
diz apenas *"cadastro e busca de aluno"* e o `M1-FR-006` diz *"cadastrar aluno com validação e
detecção de possível duplicidade"* — nenhum dos dois enumera campo. O Code implementou o mínimo
que satisfaz o critério de aceite escrito, e o critério de aceite estava incompleto.

**A falha é de especificação, não de implementação.** Registrar isso importa porque a correção
não é "o Code errou" — é *o PRD não repetiu o que a Especificação já dizia, e a Especificação
não é normativa (ADR-018)*. Toda fatia que dependa de uma lista de campos da Especificação corre
o mesmo risco. Ver §8.

## 2. Três lacunas diferentes, frequentemente confundidas

| # | lacuna | tamanho real |
|---|---|---|
| **A** | **Dado que já existe no banco e nenhuma tela expõe** | `student_addresses` (CEP, logradouro, número, complemento, bairro, cidade, estado) está **criada e órfã**: nenhum endpoint da API a escreve, o seed não a popula, nenhuma tela a lê. `student_contacts` aceita telefone, WhatsApp e e-mail, mas o formulário oferece **um** contato só |
| **B** | **Dado que não existe em lugar nenhum** | RG, sexo cadastral, consultor, origem do lead, contato de emergência, foto — todos na Especificação §11, nenhum no schema |
| **C** | **A tela não tem design system** | O `admin-web` inteiro roda HTML sem estilo: só `login.module.css` existe. A **F42** (design system do painel) está `aprovada-pi` e **não foi aplicada em nenhuma tela**. O mockup do PI não é "cadastro com mais campos" — é o painel com o DS aplicado |

**A e B são a mesma fatia. C não é.** Misturar produz uma entrega grande, difícil de revisar e
impossível de aceitar por partes. Recorte em §5.

## 3. Rastreabilidade campo a campo

Lista pedida pelo PI, confrontada com o schema e com a Especificação §11.

### 3.1 Já existe e já aparece — nada a fazer

| campo pedido | onde vive |
|---|---|
| Nome | `students.full_name` |
| Mat. | `students.membership_number` — gerado pelo servidor, imutável (INV-010) |
| Nascimento | `students.birth_date` |
| Situação | `students.status` |
| Telefone / Email | `student_contacts` (`PHONE`, `WHATSAPP`, `EMAIL`) — hoje o formulário aceita **um** |
| Cadastro | `students.created_at` — existe, não é exibido na listagem |

### 3.2 Existe no banco, morto no código — **expor**

| campo pedido | coluna |
|---|---|
| CEP | `student_addresses.postal_code` |
| Logradouro | `street` |
| Número | `number` |
| Complemento | `complement` |
| Bairro | `district` |
| Cidade | `city` |
| *(Estado/UF — não pedido, exigido pela Espec §11)* | `state` |

Nenhuma linha de código escreve ou lê essa tabela. Ela nasceu na F7 e ficou órfã.

### 3.3 Não existe — **criar**

| campo pedido | fonte | observação |
|---|---|---|
| Documento (RG) | Espec §11 | texto livre, opcional — RG não tem formato nacional único, validar dígito é inventar regra |
| Sexo | Espec §11 (*"sexo cadastral"*) | enum. Recomendação: `FEMALE \| MALE \| NOT_INFORMED` — "cadastral" espelha documento civil. Identidade de gênero e nome social são **outra** coisa e não foram pedidos (ver §7) |
| Consultor | Espec §11 | FK opcional para `User` do tenant, não texto livre — texto livre não sobrevive à saída do funcionário |
| Estado civil | **nenhuma** — decisão do PI de 18/08 | ver §6.3 (LGPD) |
| Profissão | **nenhuma** — decisão do PI de 18/08 | ver §6.3 (LGPD) |

### 3.4 **Não é campo de cadastro** — é dado derivado

Estes vieram da grade de listagem de um sistema legado, e grade de listagem não é formulário.

| campo pedido | de onde sai |
|---|---|
| Plano | `Plan` via `Subscription` |
| Inc. Plano | `Entitlement.startsAt` |
| Venc. Plano | `Entitlement.expiresAt` |
| Data Mat. | início da primeira `Subscription` — distinto de "Cadastro" (`created_at`) |
| Últ. Acesso | último `AccessEvent` do aluno |

**Digitá-los no cadastro violaria a regra de arquitetura nº 1** (*pagamento não controla acesso;
entitlement controla*). Um campo "Venc. Plano" editável na ficha é uma segunda fonte de verdade
sobre direito de acesso — e a que a catraca **não** consulta. Eles entram como **colunas da
listagem e blocos da ficha**, lidos da cadeia real.

### 3.5 Fora do escopo — decisão do PI de 18/08/2026

| campo pedido | por quê fica fora |
|---|---|
| CNPJ | aluno é pessoa física. CNPJ implica empresa pagadora — entidade própria, não coluna em `students`. `EntitlementSource.CORPORATE` já existe no enum, esperando modelagem. Exige ADR |
| Resp. Contrato | é **relação**, não campo: `FamilyGroup`/`FamilyMember` já existem, e o responsável legal do menor é escopo obrigatório da **F8** (ADR-008). Resolver aqui duplicaria |
| Professores | vínculo N:N aluno↔staff. `PERSONAL_TRAINER` existe como papel; o vínculo não. Pertence ao **MVP 3** |
| Estado civil | **revertido em 18/08:** *"só informação inútil"*. Nenhum caso de uso consome. Coletar dado pessoal que nada usa é o que o princípio da necessidade proíbe (LGPD art. 6º, III) |
| Profissão | idem |

### 3.6 A Especificação §11 pede e o PI não listou

| campo | veredito |
|---|---|
| Contato de emergência (nome, parentesco, telefone) | **entra na F45.** É o único campo do §11 com consequência física: aluno passa mal na academia e não há para quem ligar |
| Origem do lead | **entra na F45** como enum curto. O status `LEAD` existe desde a F7 sem nada que diga de onde o lead veio |
| WhatsApp | já coberto por `StudentContactType.WHATSAPP` |
| Foto | **fica fora — ver §6.2.** Este é o único campo do §11 que toca dado sensível |
| Unidade | **pendência aberta — ver §9.** `Student` não tem `gym_unit_id`, e a regra de arquitetura nº 2 manda tê-lo quando o dado é físico |

## 4. Decisões do PI — 18/08/2026

1. **CPF continua opcional.** INV-009 e INV-011 permanecem: a matrícula nunca depende do CPF.
   O mockup marcava CPF, telefone e e-mail como obrigatórios — **o mockup é corrigido, não o
   domínio**. Quem chega sem documento é cadastrado e recebe matrícula.
2. **Duas fatias separadas:** campos (F45) e design system do painel (F46).
3. **Entram** estado civil e profissão. **Ficam fora** CNPJ, responsável de contrato e
   professores.

## 5. Recorte

### F45 — Cadastro completo de aluno *(MVP 1, retrabalho da Slice 1.2)*
Modelo, API e formulário. Sem design system: a tela continua crua, com mais campos e em passos.

### F46 — Design system aplicado ao `admin-web` *(MVP 2.5, execução da F42)*
A F42 entregou o contrato (`docs/design/DS-PAINEL.md`); F46 o aplica nas telas existentes.
**Depende da F45** para não estilizar um formulário que vai mudar de forma.

> Os dois números precisam ser alocados no **Índice Fatia ↔ SPEC** do `docs/STATUS.md` antes de
> qualquer código. Nenhuma das duas tem Slice no PRD — mesma situação da F42–F44, resolvida pelo
> ADR-025 (a Slice mora na decisão, não no PRD).

## 6. Escopo da F45

### 6.1 Modelo

```
students            + rg?               String
                    + registered_sex?   enum StudentRegisteredSex
                    + marital_status?   enum MaritalStatus
                    + occupation?       String
                    + advisor_user_id?  FK User (SET NULL)
                    + lead_source?      enum LeadSource

student_contacts    + label?            String   (nome do contato de emergência)
                    + relationship?     String   (parentesco)
                    StudentContactType  + EMERGENCY

student_addresses   (existe — passa a ser escrita)
```

Contato de emergência **reaproveita `student_contacts`** com dois campos opcionais em vez de
tabela nova. É reversível e evita uma quarta tabela para guardar três strings. Se o Code preferir
tabela própria, decide e registra no PR — é escolha barata de desfazer.

Todos os campos novos são **opcionais**. Aluno já cadastrado não pode virar inválido por causa de
uma migration, e a recepção precisa poder cadastrar com o que a pessoa trouxe.

### 6.2 O que a F45 **não** faz: foto

A Especificação §11 pede foto. **Ela fica fora**, e o motivo não é escopo — é lei.

Foto de rosto armazenada ao lado de um sistema de reconhecimento facial é candidata natural a ser
reclassificada como **dado biométrico** pela ANPD, e biometria é art. 11 da LGPD: lista fechada,
**legítimo interesse não existe**. Enquanto não estiver escrito qual é a finalidade da foto
cadastral, quem a vê, por quanto tempo fica e por que ela **não** alimenta o reconhecimento, a
foto não entra. Isso cai no segundo caso da tabela *O que pode bloquear o desenvolvimento* do
`CLAUDE.md`: **para a entrega até estar certo**. Endereço reto para a **F8**, que já trata
consentimento e biometria.

### 6.3 Estado civil e profissão — retirados

Entraram e saíram no mesmo dia. O PI: *"só informação inútil"*. Está certo, e o motivo é o
mesmo que faria a fatia parar: **nenhum caso de uso do produto consome estado civil ou
profissão**. Coletar dado pessoal que nada usa é exatamente o que o princípio da necessidade
proíbe (LGPD art. 6º, III), e o custo aparece depois — no aviso de privacidade, no relatório de
impacto, no titular que pede exclusão de um dado que o sistema nunca precisou.

Se algum dia um caso de uso pedir, volta com a finalidade junto. É uma coluna opcional; adiar não
custa nada, adiantar custa.

### 6.4 API — o buraco que ninguém viu

`POST /api/v1/students` aceita `fullName`, `birthDate`, `cpf` e `contacts`. **Não existe endpoint
que edite dado cadastral de aluno** — `PATCH /students/:id/status` só troca situação.

Um formulário em quatro passos com endereço, emergência e administrativo **precisa** de edição:
sem ela, um CEP digitado errado é permanente. A F45 entrega:

- `POST /students` estendido (todos os blocos opcionais, exceto nome e nascimento);
- `PATCH /students/:id` novo, com `version` (trava otimista, mesmo padrão do status);
- `GET /students/:id` devolvendo endereço e contatos.

O `.strict()` do Zod permanece: `tenantId` e `membershipNumber` continuam recusados no corpo.

### 6.5 UI — quatro passos

Ordem do mockup, com a correção do item 1 do §4:

1. **Dados pessoais** — nome\*, nascimento\*, CPF *(opcional — texto explicativo permanece)*, RG, sexo cadastral, estado civil, profissão, contatos
2. **Endereço e emergência** — CEP, logradouro, número, complemento, bairro, cidade, UF; nome, parentesco e telefone de emergência
3. **Administrativo** — origem do lead, consultor, situação inicial
4. **Plano e consentimentos** — atalho para o que já existe (atribuir plano, F7) e para a F8; **não** duplica nenhum dos dois

Nome e nascimento são os **únicos** obrigatórios. Máscaras de CPF, CEP, telefone e data conforme
`CLAUDE.md`. Toast, nunca `alert`. Rascunho preservado entre passos — quem digita 22 campos e
perde tudo na validação do passo 3 não digita de novo.

### 6.6 Unidade — decidido em 18/08

`Student` **passa a ter `gym_unit_id`**, obrigatório. A Especificação §11 pede "unidade" nas
informações administrativas, a regra de arquitetura nº 2 manda ter `gym_unit_id` quando o dado é
físico, e todas as tabelas vizinhas — `Device`, `AccessEvent`, `PlanUnit` — já têm.

**A premissa, escrita para poder ser contestada em uma palavra:** `gym_unit_id` é a **unidade de
origem** do aluno — onde ele se cadastrou e para onde a recepção o conta. **Não é controle de
acesso.** Quem decide em qual unidade o aluno entra continua sendo o plano, via `PlanUnit` e
`EntitlementUnitWindow`. Ler `students.gym_unit_id` na decisão de acesso criaria uma segunda fonte
de verdade sobre direito de entrar — a mesma regra de arquitetura nº 1 que tira Venc. Plano do
formulário.

Consequências que o Code precisa tratar:

- **Migration com backfill.** Há alunos cadastrados sem unidade. Com uma única unidade ativa
  (`MATRIZ`), o backfill é direto; a coluna nasce `NOT NULL` **depois** do backfill, em dois
  passos, nunca em um.
- **Listagem e busca passam a filtrar por unidade** quando há unidade selecionada no cabeçalho —
  hoje o painel mostra *"Unidade não selecionada"* e lista tudo.
- **Permissão por unidade já existe** (`M1-FR-003`, escopo por unidade quando configurado). O
  filtro do aluno tem que respeitá-la, não reimplementá-la.
- **Transferência entre unidades** é ação auditada, não edição de campo solta. Fica registrada
  como pendência de comportamento — não bloqueia a coluna.

## 7. Fora de escopo, com motivo

- **Nome social** — não pedido e não especificado. Se o cliente inaugural precisar, é campo à
  parte de "sexo cadastral", nunca o mesmo.
- **Identidade de gênero** — `registered_sex` espelha documento civil. Confundir os dois é erro de
  modelagem e de tratamento.
- **Importação em massa do sistema legado** — a grade do print sugere que existe base a migrar.
  É fatia própria, com decisão de deduplicação (INV-014) e de retenção.

## 8. O que evita a próxima F7

A Especificação **não é normativa** (ADR-018), o PRD é. Quando a Especificação enumera algo que o
PRD só menciona — *"cadastro e busca de aluno"* — a lista some do critério de aceite e ninguém
percebe até a tela ficar pronta.

Correção proposta ao PI: **fatia que dependa de lista de campos da Especificação copia a lista
para o corpo da issue**, com o parágrafo de origem. Custa um parágrafo por card e transforma
"cadastro de aluno" em critério checável.

## 9. Pendências que precisam do PI

**Fechadas em 18/08:** finalidade de estado civil e profissão *(resolvida retirando os campos)* e
unidade do aluno *(sim — `gym_unit_id`, §6.6)*.

| # | pergunta | trava o quê |
|---|---|---|
| 1 | **Origem do lead — quais valores?** Indicação, redes, passagem na porta, campanha, outro? | passo 3 do formulário |
| 2 | **Foto entra em qual fatia?** Recomendação: F8, junto do consentimento | §6.2 |

As demais decisões (nome de coluna, tabela vs. campo para emergência, ordem de implementação,
como testar) são do Code, decididas na hora e registradas no PR.
