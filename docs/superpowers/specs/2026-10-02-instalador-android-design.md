# Area do instalador Android (QR no painel e no totem)

Issue #534. Pedido do PI em 02/10/2026. Sem `SPEC`/`F` -- nao e Slice de PRD; o Cowork aloca numero se quiser.

## Problema

O app Android sai do EAS como APK, fora da Play Store. A recepcao nao tem onde pegar o link atual nem como entrega-lo ao aluno. O link muda a cada build.

## Decisoes do PI

| # | Pergunta | Decisao |
|---|---|---|
| 1 | Onde fica | Painel (admin-web) **e** totem (kiosk) |
| 2 | Como a area sabe o APK atual | Campo no painel (URL + versao); sem redeploy a cada build |
| 3 | Acesso no totem | Botao "Baixar o app" na tela de espera, abre tela so com o QR |

## Dados

Tabela `tenant_app_distribution`, uma linha por academia:

| coluna | tipo | nota |
|---|---|---|
| `tenant_id` | uuid, PK | regra 2; RLS com a politica da F66 (hoje so `students` e `audit_logs` tem; esta seria a 3a) |
| `android_url` | text | `https`, ate 2048 caracteres |
| `android_version` | text | texto livre curto (ate 40), ex.: `0.1.0 (build 8)` |
| `updated_at` | timestamptz | |
| `updated_by` | uuid, nulo | usuario do painel que salvou |

Migration so aditiva. Sem linha = academia sem link configurado.

## API

- `GET /api/v1/app-distribution` -- `student.read`. Devolve `{ androidUrl, androidVersion, updatedAt } | { androidUrl: null }`.
- `PUT /api/v1/app-distribution` -- `user.manage`. Corpo validado com Zod (`unknown` antes de validar): URL `https` valida, versao opcional. Tenant vem da identidade, nunca do corpo.
- `GET /api/v1/kiosk/config` ganha `appAndroid: { url, version } | null`. O totem ja autentica por dispositivo e academia.
- Erro de dominio com codigo estavel (`APP_DISTRIBUTION_URL_INVALID`) em `application/problem+json`.

## Painel (admin-web)

Pagina `/app`, item "Aplicativo" no menu:

- QR renderizado no servidor (`qrcode` ja e dependencia do admin-web), versao, link e botao "Copiar link".
- Formulario URL + versao, visivel so para quem pode salvar. Toast para sucesso e erro (nunca `Alert`).
- Estado vazio: "Nenhum instalador configurado." e, para quem pode, o formulario.
- Dica fixa: o celular precisa permitir "instalar apps desconhecidos" para abrir o APK.
- Visual segue `docs/design/DS-PAINEL.md`; sem hex literal.

## Totem (kiosk)

- Botao discreto "Baixar o app" na tela de espera. Some quando `appAndroid` e nulo.
- Tela cheia so com o QR, versao e "Voltar". Volta sozinha a espera apos 60 s sem toque.
- Nao pede CPF, nao abre sessao, nao altera o fluxo de identificacao.
- Adiciona `qrcode` ao `apps/kiosk`. Visual segue `docs/design/DS-TOTEM.md`.

## Seguranca

- O QR leva o aluno a baixar um APK: so quem tem `user.manage` troca o destino.
- `https` obrigatorio; esquemas `javascript:`/`http:` recusados no servidor, nao so no formulario.
- O link e dado da academia, nao segredo; nada de PII nem log do valor.

## Testes

- Dominio: validacao da URL (aceita https, recusa http/javascript/vazio/gigante).
- Integracao: repositorio isolado por academia (RLS); `PUT` exige `user.manage`; `GET` exige `student.read`; `kiosk/config` devolve `appAndroid` so da propria academia.
- Painel: com link, sem link, com e sem permissao de salvar.
- Totem: botao some sem link; tela do QR volta sozinha; E2E minimo do botao.

## Fora do escopo

iOS; hospedar o APK no storage privado; atualizar o link sozinho a cada build do EAS; QR do Expo Go de desenvolvimento.

## Pendencia

`docs/STATUS.md` e do Cowork. Esta entrega registra a linha no `docs/DEVELOPMENT.md` e, se aplicavel, na lista de rotas do OpenAPI (`pnpm --filter @arenahub/api test:integration -- openapi.int-spec` com `ATUALIZAR_OPENAPI=1`).
