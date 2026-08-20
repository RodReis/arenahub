# Ativação da base corrente do Pacto — design

**Data:** 2026-08-20
**Fatia:** F48 (a fatia que a F47/#118 declarou "fora de escopo, depois")
**MVP:** 1
**Origem:** pedido do PI em 20/08/2026, com o arquivo `Pessoas-ativas.txt`

---

## 1. O problema

A F47 (#118) trouxe **1.926 alunos do Pacto como `CANCELLED`**, de propósito: base
histórica, sem assinatura vigente e sem direito de acesso. É por isso que a coluna
"Plano" da tela de Alunos aparece vazia — não é defeito, é o ADR-033 regra 3.

Falta o outro lado: **quem está ativo hoje na academia**. São ~340 pessoas que
pagam, treinam e passam na catraca todo dia, e que no ArenaHub ainda estão
canceladas ou inexistentes. Enquanto isso não entra, o sistema não pode assumir a
operação da porta.

O arquivo `Pessoas-ativas.txt` é a exportação do Pacto dessas pessoas. Traz, além
do cadastro, **dois identificadores de equipamento por pessoa** (`Cartao` e
`Identificador Facial`) e um **código de perfil** (aluno / funcionário / professor /
administrador) que o ArenaHub ainda não modela.

## 2. O que entra nesta fatia

1. Casar cada registro do JSON com o aluno já existente no banco (de/para)
2. Atualizar endereço e telefone/celular quando houver
3. Gravar as credenciais de equipamento (`Cartao`, `Identificador Facial`)
4. Gravar o perfil da pessoa (aluno/funcionário/professor/administrador)
5. **Vincular o plano** *Programa Adultos e Idosos* via `Subscription`
6. Ativar: `Student.status = ACTIVE` + `Entitlement` correspondente

### Fora de escopo

- **Emissão de `Invoice`.** Vincular plano não é cobrar. Essas pessoas já pagaram
  no Pacto; gerar fatura retroativa criaria dívida fantasma para ~340 pessoas.
- **`BiometricIdentity` / `ConsentRecord`.** Ver §4.2 — o número do leitor entra
  como credencial; o vínculo formal de consentimento continua nascendo no fluxo
  da recepção que já existe (F8/F17).
- **Cadastro de gente nova.** Quem não casar vira pendência, não vira aluno novo
  (evita duplicar os 1.926 da F47 por diferença de grafia).

---

## 3. Schema — o que nasce

### 3.1 `StudentCredential` (tabela nova)

Credencial de equipamento por aluno. É *o número que o leitor usa para identificar
a pessoa* — não é o template biométrico.

| campo | tipo | conteúdo |
|---|---|---|
| `id` | uuid | PK |
| `tenantId` | uuid | escopo (regra de arquitetura nº 2) |
| `studentId` | uuid | dono |
| `kind` | `StudentCredentialKind` | `TURNSTILE_CARD` \| `FACIAL_ENROLL_ID` |
| `externalId` | text | o número (`2061`) |
| `createdAt` / `updatedAt` | timestamp | |

```
@@unique([tenantId, kind, externalId])   // dois alunos não dividem o mesmo número
@@index([tenantId, studentId])
```

**Por que tabela própria, e não coluna em `Student`:** uma pessoa pode ter mais de
uma credencial (cartão trocado, re-enrolamento facial), e a unicidade do número
precisa ser garantida pelo banco — coluna solta em `Student` não dá nenhuma das
duas coisas.

**Por que não em `DeviceUser`:** `DeviceUser.externalUserId` já guarda o `enrollid`,
mas exige `identityId` → `BiometricIdentity` → `consentRecordId` **NOT NULL**
(INV-017). `DeviceUser` é o estado da sincronização *com um dispositivo específico*;
`StudentCredential` é o identificador da pessoa, independente de dispositivo. São
coisas diferentes, e é a segunda que o JSON traz.

### 3.2 `Student.profile` (coluna nova)

Enum `StudentProfile`, default `STUDENT`:

| valor | `Codigo Perfil` do JSON | acesso |
|---|---|---|
| `ADMIN` | 0 | liberado |
| `STUDENT` | 1 | controlado (depende de plano) |
| `STAFF` | 2 | liberado |
| `TRAINER` | 3 | liberado |

**O perfil não decide acesso** — ele *origina um entitlement* (§5.2). Ler o perfil
dentro do Access Decision Engine criaria a segunda fonte de verdade que a regra de
arquitetura nº 1 proíbe.

Os códigos 4/5/6 aparecem no arquivo apenas em registros de teste e são
descartados (§4.4).

---

## 4. Importação

Seed em `packages/database/prisma/seed-ativos.ts` (ADR-020: seed mora em
`packages/database`). Lê o JSON de **caminho externo**, fora do repositório, com o
caminho no `.gitignore` — dado real de aluno não entra no Git (`CLAUDE.md`). Sem o
arquivo, a seed não falha: apenas não importa.

### 4.1 Casamento (de/para)

Em cascata; o primeiro critério que bater vence:

1. **CPF normalizado** (11 dígitos, sem máscara) — match forte
2. **Nome normalizado** (sem acento, caixa única, espaços colapsados) **único** no
   banco — usado só quando o registro não tem CPF
3. **Ambíguo ou nenhum** → pendência

Nunca cria aluno novo, nunca escolhe entre dois candidatos.

### 4.2 Credenciais de equipamento

`Cartao` → `StudentCredential(kind: TURNSTILE_CARD)`
`Identificador Facial` → `StudentCredential(kind: FACIAL_ENROLL_ID)`

Nos dados reais os dois campos trazem **o mesmo número** (`1↔1`, `2061↔2061`) — é o
mesmo `enrollid` espelhado nos dois lugares do Pacto. Ambos são gravados mesmo
assim: são chaves distintas do ponto de vista do equipamento, e nada garante que
continuem iguais.

O template facial em si vive no leitor Topdata, não neste arquivo. Gravar o número
aqui **não** cria `BiometricIdentity` e **não** dispensa consentimento: quando
alguém registrar o rosto pelo fluxo da recepção, o consentimento nasce nesse ato e
a identidade biométrica se amarra ao número que já estará gravado.

### 4.3 Campos cadastrais

| destino | origem | condição |
|---|---|---|
| `StudentAddress` | `Endereco` + `Bairro` + `Cep` + `Municipio` | só com rua, cidade e CEP presentes; `state = 'GO'` fixo quando `Uf` vazio ou inválido |
| `StudentContact(PHONE)` | `Telefone` | normalizado; ignora vazio |
| `StudentContact(WHATSAPP)` | `Celular` | idem |
| `StudentContact(EMAIL)` | `Email` | idem; descarta valor sem `@` |

Campo vazio **não sobrescreve** dado existente no banco — importação não apaga o
que a recepção já corrigiu à mão.

`Data Nascimento` só é aplicada quando plausível (não futura, titular com ≥ 3 anos).
O arquivo traz nascimentos em `2026` e `2022`; esses vão para pendência sem tocar no
registro.

### 4.4 Descartes

Registros de teste, identificados por nome igual a número ou marcador de POC:
`teste-poc-17-08`, `1307`, `824`, `1862`, `8585`. Não entram e são contados no
relatório.

---

## 5. Vínculo de plano e ativação

A cadeia obrigatória (regra de arquitetura nº 1):

```
Student ──→ Subscription ──→ Entitlement ──→ Access Decision Engine
             (vínculo do      (o que a
              plano)           catraca lê)
```

### 5.1 Perfil `STUDENT` — assinante

`Subscription`:

| campo | valor |
|---|---|
| `planId` | *Programa Adultos e Idosos*, **resolvido por nome** |
| `status` | `ACTIVE` |
| `startsAt` | `Data Inicio` do JSON (`AAAAMMDD`) |
| `endsAt` | `Data Fim` do JSON |
| `lastReason` | `"Importação da base ativa do Pacto"` |

`Entitlement`: `source = SUBSCRIPTION`, `subscriptionId` apontando para ela, mesmas
datas, `policySnapshot` copiado do plano no instante da derivação.

**O plano é resolvido por nome, nunca por UUID fixo.** A issue #118 fixava
`ed754805-c70f-4e76-bda4-b8f3a2591a52`; esse id **não existe mais** no banco atual
(hoje é `69838883-19e6-49c1-8ad7-0a9625bbc86e`). `plans.name` é UNIQUE por tenant e
sobrevive à recriação do banco. Plano ausente = falha alta, não importação parcial.

### 5.2 Perfis `ADMIN` / `STAFF` / `TRAINER` — acesso por vínculo

**Não recebem `Subscription`.** Não são assinantes e não pagam mensalidade; criar
assinatura para eles poluiria o financeiro com cobrança inexistente.

Recebem `Entitlement` direto:

| perfil | `source` |
|---|---|
| `TRAINER` | `PERSONAL_TRAINER` |
| `STAFF`, `ADMIN` | `EMPLOYEE` |

Com `subscriptionId = null` — o schema já prevê (*"Nulo quando a origem não é
assinatura"*). Ambos os valores já existem em `EntitlementSource`; nada de enum novo.

**Período do vínculo.** `Entitlement.startsAt` e `endsAt` são **NOT NULL** no
schema, e o JSON não traz período para a maioria desses perfis. O vínculo
empregatício não tem data de fim conhecida, mas **direito de acesso sem prazo não
existe neste sistema** — foi decisão do ADR-019 que expiração é sempre explícita.

Portanto: `startsAt` = data da importação, `endsAt` = `startsAt + 12 meses`, e
`reason` registra `"Vínculo (perfil <X>) — importação da base ativa do Pacto"`.

Doze meses é revalidação anual do vínculo, não expiração de plano: quem continua
trabalhando tem o direito renovado; quem saiu perde o acesso sozinho, sem depender
de alguém lembrar de revogar. É a mesma lógica que a liberação financeira usa
(direito que depende de alguém lembrar de desligar vira permanente por
esquecimento).

**`policySnapshot` sem plano.** O campo é NOT NULL, e
`montarSnapshotDePolitica(planId, planName, gymUnitIds, janelas)` exige plano — que
aqui não existe. O snapshot do vínculo é montado com `planId: null`,
`planName: "Vínculo <perfil>"`, as unidades do tenant e **janela livre** (todos os
dias, `startMinute: 0`, `endMinute: 1440`).

Isso exige alargar `SnapshotDePolitica` para aceitar `planId: string | null`. É
mudança de tipo, não de significado: o snapshot continua sendo a cópia congelada
das regras que valiam quando o direito nasceu — só que a regra, aqui, é "acesso
liberado por vínculo" em vez de "acesso por plano X". Sem isso, funcionário só
entraria com um plano falso, que é pior.

### 5.3 Ativação

`Student.status = ACTIVE` para todo registro casado.

Perfil `STUDENT` **sem data no JSON** (~60 registros): o cadastro é atualizado e
ativado, mas **nenhum entitlement é criado** — sem período não há direito de acesso
a derivar. Vai para pendência com o motivo explícito.

---

## 6. Idempotência e relatório

**Rodar duas vezes produz o mesmo resultado** (regra de arquitetura nº 4). Toda
escrita é `upsert` por chave natural:

| entidade | chave |
|---|---|
| `StudentCredential` | `(tenantId, kind, externalId)` |
| `Subscription` | `(tenantId, studentId, planId, startsAt)` |
| `Entitlement` | `(tenantId, studentId, source, startsAt)` |
| `StudentContact` | `(studentId, type, value)` |

**Relatório obrigatório**, nos moldes que a #118 exigiu — sem ele a entrega não é
pronta:

1. **Preenchimento por campo:** `endereço 210/340`, `telefone 318/340`,
   `credencial 340/340`…
2. **Lista de pendências,** com motivo por registro

Foi um `logradouro 0/1934` que denunciou extrator quebrado na F47. Importação que
só diz "sucesso" é como esses registros viraram lixo no Pacto.

### Pendências previstas

- **Duplicatas:** uma pessoa aparece 2× com dois cartões diferentes e o mesmo CPF;
  outra, 2× com o sobrenome grafado de dois jeitos (uma letra de diferença)
- **CPF trocado entre linhas:** uma pessoa aparece 2× com CPF e celular invertidos
  entre si — o valor do documento numa linha é o do telefone na outra
- **Nascimento impossível:** 5 registros com data em 2026/2022
- **~40 sem CPF:** resolvidos por nome único, ou pendência
- **Perfil STUDENT sem período**

---

## 7. Testes

**Unitário** (funções puras, sem banco):

- normalização de CPF, nome, telefone
- `AAAAMMDD` → `Date`, incluindo entrada vazia e inválida
- plausibilidade de data de nascimento
- mapa `Codigo Perfil` → (`StudentProfile`, `EntitlementSource`)
- decisão de casamento sobre conjunto sintético (match forte / por nome / ambíguo)

**Integração** (Postgres local):

- casamento contra base semeada, incluindo o caso ambíguo
- **idempotência:** rodar 2× e provar contagem e conteúdo idênticos
- campo vazio no JSON não apaga dado existente
- `STUDENT` sem período não ganha entitlement

**Regra de arquitetura:**

- teste provando que aluno importado **sem** entitlement continua **negado** pela
  catraca — a mesma garantia que a F47 exigiu, agora do outro lado

---

## 8. Riscos aceitos

| risco | mitigação |
|---|---|
| Ativação em massa dá acesso a quem não deveria | Período vem do JSON, não é inventado; quem não tem período não ganha entitlement |
| Menores de idade entram sem responsável legal no dado | Herdado do ADR-033 (schema não tem o campo). **Não recebem biometria** enquanto não houver consentimento de responsável (LGPD art. 14) |
| Casamento por nome pode errar em homônimo | Só aceita nome **único**; qualquer ambiguidade vira pendência humana |
