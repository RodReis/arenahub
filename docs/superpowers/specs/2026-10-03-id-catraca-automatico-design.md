# ID da catraca automático e vínculo sem reinício do Edge — design

**Data:** 03/10/2026 · **Aprovado pelo PI em:** 03/10/2026 (brainstorming)
**Fatia/SPEC:** a alocar no Índice Fatia ↔ SPEC do `docs/STATUS.md` (não inventar número).

## Problema

A catraca reconhece o aluno por `DeviceUser.externalUserId` (= `enrollid` do leitor). Esse
vínculo só nasce quando o leitor informa o número à nuvem **e** o número já está gravado em
`StudentCredential` (`FACIAL_ENROLL_ID`). Hoje:

- a recepção digita o número no olho — `GET /students/credentials/next-available` existe mas
  nenhuma tela chama (o runbook `operacao-edge-arena-positiva.md:80-85` diz o contrário);
- face cadastrada no leitor **antes** do número no painel só vincula no próximo reinício do
  Edge (`getuserlist` roda uma vez por registro; pendência só em log `debug`);
- gravar/trocar credencial não cria nem desativa `DeviceUser`;
- há ~63 números no leitor sem aluno (`DeviceReaderNumber`), e o banco guarda só o número —
  a recepção não sabe de quem é cada face.

## Decisões do PI

1. Número nasce **automático ao salvar o aluno** e aparece **em destaque** (grande, cor,
   borda, efeito) para a recepção digitar no leitor.
2. Alunos existentes: **botão de ação na lista de alunos**, sem tela nova.
3. A ação oferece **gerar novo** ou **usar número que já está no leitor**, este com o **nome
   gravado no leitor** para identificar a pessoa.

## Desenho

### API (`apps/api`)

1. **`POST /students/:id/credentials/generate`** — atribui o próximo número livre
   (`proximo-numero-livre.ts`) numa transação. Corrida é barrada pelo
   `@@unique([tenantId, kind, externalId])`; em conflito, recalcula e tenta **uma** vez;
   persistindo, `409 CREDENTIAL_ALREADY_ASSIGNED`. Aluno que já tem credencial
   `FACIAL_ENROLL_ID` recebe o número existente (idempotente — não troca).
2. **`POST /students`** gera a credencial `FACIAL_ENROLL_ID` logo após a criação (transação
   própria — se falhar, o aluno existe sem número e a ação da lista cobre). A ficha exibe o
   número; a resposta do `POST` não muda de contrato.
3. **Vínculo imediato ao gravar credencial** (gerada, escolhida ou digitada via
   `PUT /students/:id/credentials`): se algum leitor do tenant tem o número em
   `DeviceReaderNumber`, cria o `DeviceUser` na hora reaproveitando
   `VincularCadastroLegadoUseCase` — sem esperar reinício do Edge. Troca de número **reaponta**
   o `DeviceUser` existente para o número novo (`@@unique([deviceId, identityId])` impede um
   segundo vínculo do mesmo aluno no leitor) quando o número antigo não é mais credencial do
   aluno; vale tanto no vínculo imediato quanto no que chega pelo Edge.
4. **`GET /device-reader-numbers?unlinked=true`** — números do leitor sem aluno, com
   `readerName` e leitor/unidade. Isolado por tenant (regra 2).

### Edge (`apps/edge-agent`)

- Para cada número sem aluno, `getuserinfo` lê o `name` e o Edge envia `{ número, nome }` no
  `legacy-links`.
- **Não verificado no equipamento:** que o firmware devolve `name` no `getuserinfo`. Ausente
  → envia sem nome; nada quebra. Verificar na bancada (AYTI11108174).

### Banco (`packages/database`)

- `DeviceReaderNumber.readerName String? @map("reader_name")` — migração aditiva.

### admin-web (`apps/admin-web`)

- **Lista de alunos:** ação por linha **"Número da catraca"** → modal com duas abas:
  - **Gerar novo** — um clique, grava, mostra o número em destaque + botão copiar.
  - **Do leitor** — combobox com busca "número — nome do leitor"; confirmar grava e vincula.
- **Ficha do aluno novo:** o número gerado aparece no mesmo destaque.
- Visual segue `docs/design/DS-PAINEL.md` (tokens, sem hex literal). Feedback por Toast.
- Corrigir o runbook para o fluxo novo.

## Fluxo de aluno novo resultante

1. Cadastrar aluno → número da catraca aparece em destaque.
2. Cadastrar a face no leitor com esse número → `senduser` → `DeviceUser` criado.
3. Atribuir plano → entitlement ACTIVE.
4. Abrir cobrança e registrar pagamento.

Ordem inversa (face antes) também fecha: ao gravar o número no painel, o vínculo é imediato.

## Testes

- **Integração (API):** duas gerações paralelas não duplicam número; gravar número presente
  em `DeviceReaderNumber` cria `DeviceUser` e a decisão de acesso devolve ALLOW (com
  entitlement ativo); troca de número desativa o `DeviceUser` antigo; listagem de pendentes
  não vaza tenant.
- **Unit (Edge):** `getuserinfo` sem `name` não quebra o envio.
- **E2E (admin-web):** cadastrar aluno exibe o número; ação da lista gera e exibe.

## Fora do escopo

- Relatórios operacionais/financeiros — fatia própria.
- Plano liberar acesso antes do pagamento (`ativarAssinatura` cria entitlement ACTIVE) —
  decisão de produto do PI, não alterada aqui.
- Envio de face do sistema para o leitor (upload) — backend existe, sem tela; não muda.
