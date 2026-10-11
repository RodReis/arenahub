# Relatórios > Alunos — design

Data: 10/10/2026 · Origem: pedido do PI · Caminho: arquitetural leve · Fatia/SPEC: a alocar no plano (Índice Fatia ↔ SPEC do `STATUS.md`).

## Objetivo

Menu **Relatórios** no painel (`admin-web`), com o primeiro relatório **Alunos**: lista filtrável no padrão da Lista de Alunos, exportável em **PDF** e **CSV** formatados, com logo e dados da academia no cabeçalho.

Sucesso = a recepção/gestão filtra, confere na tela e baixa um arquivo idêntico ao que viu, pronto para imprimir ou abrir no Excel.

## Decisões do PI (10/10/2026)

- **Quem vê:** todo usuário com `student.read` (mesma regra da tela Alunos). O item de menu leva `exigePermissao: 'student.read'` e a API repete a checagem.
- **Financeiro:** um **select único** (`Todos | Inadimplentes | Pagantes`), mutuamente exclusivos, como as abas da tela Cobrança.
- **Abordagem:** módulo `reports` dedicado (não estende `GET /students`, não gera arquivo no navegador).

## Premissas registradas (decisão técnica, reversível)

- Exportação leva **todos os alunos do filtro**, não só a página de 20; teto de 20.000 linhas com erro claro (`REPORT_TOO_LARGE`) acima disso.
- Exportação **síncrona** (sem job). A base de uma academia é de milhares de alunos.
- **Catraca** = números do leitor (`deviceIds`), separados por vírgula. **Contato** = telefone principal. **Plano** = nome do plano vigente, `—` quando não há.
- **Inadimplente** = invoice vencida em aberto, **mesma regra** de `consultar-inadimplencia.use-case.ts`. **Pagante** = pagamento confirmado, **mesma regra** de `consultar-pagos.use-case.ts`. A regra é reusada, não reescrita (ver Riscos).

## Telas

### Menu

Item "Relatórios" em `apps/admin-web/app/(protected)/layout.tsx`, `href: '/reports'`, `exigePermissao: 'student.read'`. `/reports` redireciona para `/reports/students` (hoje só há um relatório).

### `/reports/students`

- Mesmo `PageHeader`, `DataTable`, estados vazio/erro e paginação por cursor (20 por página) de `/students`. Server Component; filtros na URL (link compartilhável, botão voltar funciona).
- Filtros: **Unidade** (`gymUnitId`), **Situação** (`status`), **Perfil** (`profile`: ADMIN, STUDENT, STAFF, TRAINER, PERMUTA_TACIO, PERMUTA_DOUGLAS), **Plano** (`planId`), **Financeiro** (`financeiro`: vazio, `INADIMPLENTES`, `PAGANTES`).
- Colunas: **Catraca, Nome, CPF, Contato, Plano**. CPF e telefone com os formatadores existentes (máscara). Interface em pt-BR.
- Botões **Exportar PDF** e **Exportar CSV**: links `GET` para a rota de exportação com os filtros atuais da URL (download pelo navegador, sem estado de cliente).
- Valor de filtro inválido na URL vira "sem filtro", não 400 (mesma regra de `GET /students`).

## API

Módulo novo `apps/api/src/modules/reports/`.

| Rota | Permissão | Resposta |
|---|---|---|
| `GET /api/v1/reports/students` | `student.read` | JSON paginado por cursor (`limit` ≤ 100, padrão 20) + `X-Total-Count` |
| `GET /api/v1/reports/students/export?format=pdf\|csv` | `student.read` | arquivo (`Content-Disposition: attachment`) |

- **Um** use-case `ConsultarRelatorioDeAlunos` serve as duas rotas: a exportação chama o mesmo filtro sem cursor/limite. Isso garante arquivo = tela.
- Sempre dentro do `TenantContext` (tenant vem da identidade autenticada). Filtros aplicados **na consulta**, nunca em memória.
- Linha do relatório (DTO próprio, não entidade): `{ studentId, deviceIds, fullName, cpf, phone, planName }`.
- Erros seguem `application/problem+json` com `code` estável.

## Arquivos gerados

Cabeçalho comum: logo (lida do object storage via `Tenant.logoObjectKey`), razão social, CNPJ, endereço, telefone; depois filtros aplicados, data/hora de geração no fuso da unidade e total de alunos. Sem logo cadastrada, cabeçalho só com texto.

- **PDF** (`pdfkit`, já dependência da API; padrão de `contrato-pdf.service.ts`): tabela com cabeçalho repetido a cada página e rodapé "Página X de Y".
- **CSV**: UTF-8 com BOM (Excel abre acentos), separador `;`, linhas de cabeçalho da academia no topo, depois a linha de colunas. Células passam por `formatarCelula` de `exports/domain/csv.ts` (escape RFC 4180 + neutralização de CSV injection).
- Nome do arquivo: `relatorio-alunos-AAAA-MM-DD.pdf|csv`.
- Não vão para o arquivo dado de saúde, biometria nem token. Nada de PII em log de erro.

## Testes

- **Unit:** montagem de filtros, formatação do CSV (BOM, separador, escape), montagem do PDF (paginação, cabeçalho).
- **Integração (Postgres local):** isolamento de tenant, cada filtro isolado e combinado, `INADIMPLENTES`/`PAGANTES` batendo com as telas de Cobrança, teto de 20.000, aluno sem plano/sem catraca/sem telefone.
- **Web (Vitest):** filtros escrevem na URL, estado vazio, erro de permissão, botões de exportação carregam os filtros.
- **E2E (Playwright):** menu aparece para quem tem `student.read` e some para quem não tem; filtro altera a lista; download devolve arquivo.
- Canário: plantar divergência entre tela e exportação (ex.: ignorar `financeiro` na exportação) e provar que um teste cai.
- `/code-review` e, no frontend, `/impeccable` + `/frontend-design` antes do commit.

## Riscos

- **Regra de inadimplência/pagante duplicada.** Se a consulta do relatório reimplementar a regra, as telas divergem em silêncio. Mitigação: extrair o critério para função/consulta compartilhada com Cobrança, e teste que compara contagens das duas telas.
- **Memória do PDF** com 20.000 linhas. `pdfkit` escreve em stream; o teto cobre o pior caso. Medir no teste de integração.
- **Logo ausente ou ilegível** no storage não pode derrubar o relatório: cai para cabeçalho de texto.
- **Contrato OpenAPI:** rotas novas entram na lista de rotas declaradas e nos `api-contracts`.

## Fora de escopo

Outros relatórios (financeiro, frequência), agendamento/e-mail do arquivo, exportação assíncrona por job, XLSX, colunas configuráveis, ordenação escolhida pelo usuário.

## Documentação a atualizar na entrega

`docs/STATUS.md` (Índice Fatia ↔ SPEC), `docs/DEVELOPMENT.md`, `docs/specs/SPEC-<nnn>` (ponteiro fino), `docs/TESTING.md` se a guarda de evidência pedir.
