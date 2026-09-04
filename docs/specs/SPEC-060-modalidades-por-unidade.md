# SPEC-060 — Modalidades por unidade e vínculo do aluno

| campo | valor |
|---|---|
| **Fatia** | F60 |
| **MVP** | 1 *(posição na fila)* — cadastro de aluno e unidade, Slice 1.1/1.2 |
| **Slice do PRD** | não há. Escopo mora nesta spec (regra reaberta em 23/08/2026) |
| **Superfície** | `admin-web` · `api` · `docs/design/DS-PAINEL.md` |
| **Card** | [#270](https://github.com/RodReis/arenahub/issues/270) |
| **Status** | entregue — escopo decidido pelo PI em 04/09/2026 |

---

## 1. O que esta fatia entrega

A Arena Positiva é um **complexo esportivo**, não uma academia: além da musculação existem
quadras de areia, cross fit e box. O ArenaHub só conhecia "aluno da academia", e a recepção
não tinha como dizer, olhando a ficha, **que tipo de aluno** é cada pessoa.

A unidade passa a ter uma **lista de modalidades**, cadastrada pela própria academia, e o aluno
vincula **uma ou mais** no cadastro.

---

## 2. Decisões do PI — 04/09/2026

| # | decisão | consequência |
|---|---|---|
| 1 | **Modalidade é rótulo, não controle de acesso** | não toca em `Plan`, `Entitlement` nem no motor de decisão. A catraca continua decidindo por plano (regra de arquitetura nº 1) — e hoje **só a academia tem catraca** |
| 2 | **Um aluno pode ter várias ao mesmo tempo** | tabela de junção (`student_modalities`), não coluna nem enum. Academia e cross fit juntos é o caso comum |
| 3 | **Modalidade é POR UNIDADE, não por tenant** | cada unidade define a própria lista. O catálogo por tenant com tabela de oferta (o padrão `Plan` + `PlanUnit`) só ganha quando existir relatório cruzando unidades |
| 4 | **Opcional na coluna, obrigatória no painel** | a exigência é de aplicação, no wizard. Um import futuro sem modalidade não pode ser recusado pela API por causa de uma regra de tela |
| 5 | **Migração atribui `Academia - Clínica de Musculação`** | a todos os alunos existentes com `profile = 'STUDENT'`, em local **e em produção** |
| 6 | **Só perfil `STUDENT` recebe** | `ADMIN`, `STAFF` e `TRAINER` ficam sem modalidade — professor e funcionário não são aluno de atividade nenhuma; o acesso deles vem do vínculo |

---

## 3. Dados

Duas tabelas novas. Nenhuma coluna alterada em `Student` ou `GymUnit`.

| tabela | chave | por que assim |
|---|---|---|
| `gym_unit_modalities` | única por `(gym_unit_id, name)` | unicidade **por unidade**: duas unidades do mesmo complexo podem oferecer "Cross Fit" cada uma, e são ofertas distintas |
| `student_modalities` | `(student_id, modality_id)` | junção, porque o aluno tem várias |

**Sem `code`.** Modalidade nasce como nome livre digitado pela recepção; exigir código obrigaria
a inventar uma regra de nomenclatura que ninguém pediu. O nome único por unidade já impede a
duplicata que importa.

**`onDelete: Restrict`** nos dois lados que apontam para modalidade e unidade: apagar levaria
junto o vínculo do aluno. Inativar (`is_active = false`) é o caminho, pelo mesmo motivo que a
própria unidade não tem `DELETE`.

### 3.1 A migração é idempotente

Os dois `INSERT` da carga usam `ON CONFLICT DO NOTHING`. A mesma migração roda em
desenvolvimento e em produção, e rodar duas vezes não duplica modalidade nem vínculo — provado
reexecutando a carga e conferindo as contagens.

Medido no banco local: **1912 vínculos** para 1912 alunos com `profile = 'STUDENT'`, de 1984
alunos no total. Os 72 restantes são funcionário, personal e administrador.

---

## 4. API

Rotas aninhadas em `/units/:unitId`, porque modalidade não existe fora de uma unidade.

| rota | permissão | observação |
|---|---|---|
| `GET /api/v1/units/modalities` | `unit.read` | ativas de **todas** as unidades do tenant, numa chamada. É o que o wizard consome; uma chamada por unidade seria N+1 |
| `GET /api/v1/units/:unitId/modalities` | `unit.read` | `?onlyActive=true` filtra |
| `POST /api/v1/units/:unitId/modalities` | `unit.update` | 409 `MODALITY_ALREADY_EXISTS` quando o nome repete na unidade |
| `PATCH /api/v1/units/:unitId/modalities/:modalityId` | `unit.update` | renomeia e inativa/reativa. **Não há `DELETE`** |

`POST /api/v1/students` ganha `modalityIds` opcional. Toda modalidade pedida tem de ser **da
unidade do aluno** — id de outro tenant, de outra unidade, inexistente ou repetido leva 400
`MODALITY_NOT_IN_UNIT`. A checagem é por **contagem**, numa consulta só já filtrada por tenant
e unidade: pediu três, encontrou duas, recusa. A resposta é a mesma para os quatro casos, porque
distinguir "não existe" de "existe mas não é seu" confirmaria ao atacante que ele acertou o UUID.

A unicidade é do **banco**, não de um `SELECT` antes: duas recepções cadastrando "Cross Fit" no
mesmo instante passariam as duas por uma checagem prévia e a segunda estouraria 500.

---

## 5. Painel

**Unidades** (`/units`) ganha a ação de linha *Modalidades*: modal com a lista, campo para
adicionar e botão de inativar/reativar. O modal **fica aberto** depois de adicionar — quem
cadastra modalidade quase sempre cadastra várias seguidas.

**Cadastro de aluno** (`/students/novo`), passo Administrativo: caixas de seleção com as
modalidades **da unidade escolhida**, obrigatório escolher ao menos uma.

Três armadilhas tratadas:

1. **`required` nativo não funciona** — o passo está dentro de um contêiner `hidden`, e o
   navegador desiste em silêncio ao tentar focar um campo escondido. A validação é em JS e leva
   ao passo onde o campo mora, como os demais obrigatórios.
2. **Trocar a unidade limpa a seleção** — sem isso, marcar em uma unidade e trocar para outra
   enviaria uma modalidade órfã, e a recepção veria `MODALITY_NOT_IN_UNIT` sobre um campo cuja
   tela já mostrava outra lista.
3. **Caixas de seleção, não `<select multiple>`** — com poucas opções o `multiple` esconde que
   dá para marcar mais de uma (exige Ctrl, que ninguém descobre sozinho) e no toque é pior.

---

## 6. Fora de escopo

Preço por modalidade, plano por modalidade, horário por modalidade e modalidade no `kiosk`.
Nada disso foi pedido, e cada um puxa a cadeia de cobrança.

---

## 7. Evidência

| verificação | resultado |
|---|---|
| Integração da fatia (`modalidades-por-unidade.int-spec.ts`) | 7 casos ✅ |
| Integração `apps/api` (57 suítes) | ✅ |
| Integração `packages/database` | 74 ✅ |
| Unitários do wizard | 6 ✅ |
| E2E `admin-web` | 70 ✅ |
| `lint` · `typecheck` · `build` | ✅ (lint com `--force`, sem cache) |

**Canário em dois pontos**, porque teste verde não prova que pega o erro:

- removida a validação de modalidade no controller da API → os dois casos de isolamento
  (outra unidade, outro tenant) falharam;
- removidas a validação e a limpeza no wizard → os dois casos correspondentes falharam.

O contrato OpenAPI foi regenerado: **só inserções**, nenhuma remoção. As rotas novas declaram
schema de resposta em vez de entrar em `OPERACOES_SEM_SCHEMA_DE_RESPOSTA` — aquela lista é
dívida herdada e só pode encolher.
