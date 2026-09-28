# Redesign do painel financeiro — shadcn/ui

Data: 2026-09-27
Escopo: `apps/admin-web/app/(protected)/billing/page.tsx` (conteúdo, sem sidebar/header), 3 componentes de
gráfico novos e locais a `billing/`, `GymUnit.capacidadeMaxima` (schema + API + form de unidade),
`planoMaisPopular` no resumo financeiro.
Não é fatia de PRD nova — evolução visual sobre a F54 (`SPEC-054`) já entregue. Sem número de fatia/SPEC novo.

## Esta spec substitui `2026-09-27-redesign-painel-financeiro-design.md`

A spec anterior decidiu (decisão #1): "Sem shadcn/ui, sem Tailwind". Essa decisão foi revertida nesta mesma
sessão, por pedido explícito do usuário ("quero que usa-se o component do shadcn/ui para ficar um layout rico e
moderno"), depois de eu descobrir que **a infraestrutura shadcn/ui já está instalada e conectada ao design
system do ArenaHub por decisão do PI** (18/08/2026, ver `apps/admin-web/postcss.config.mjs` e o bloco de
mapeamento de tokens em `apps/admin-web/app/globals.css`):

> "O `shadcn add` grava aqui uma paleta neutra própria [...] Deixá-la como veio faria todo componente shadcn sair
> com o visual default do shadcn, que é exatamente o que o ADR-026 e o ADR-031 mandam não acontecer: o DS próprio
> É o contrato, e o shadcn é o mecanismo (acessibilidade, teclado, foco), não a aparência."

Ou seja: usar shadcn/ui nesta tela não é adotar uma stack nova — é usar o mecanismo que já está plugado aos
tokens `--ah-*`. Os componentes já herdam a paleta do ArenaHub automaticamente via `components.json` (aliases
`@/components/ui`, `baseColor: neutral`, `cssVariables: true`).

Os 3 componentes de gráfico entregues na spec anterior (`GraficoDeRosca`, `BarrasVerticais`,
`SerieFinanceira` evoluído, em `packages/ui/src/components/`) **continuam existindo e não são removidos** —
outras telas do painel podem usá-los. Esta fatia não os usa, constrói 3 componentes novos e locais à pasta
`billing/`, por decisão explícita do usuário: dar liberdade visual total para bater com o mockup sem arriscar
regressão no design system compartilhado.

## Decisões já tomadas (não reabrir)

1. **Escopo isolado**: shadcn/ui só na tela `/billing`. Migração do resto do admin-web fica para depois, decisão
   futura e separada (provavelmente com ADR próprio).
2. **Sem sidebar/header**: o mockup mostra o wrapper completo do protótipo Stitch (menu lateral "FitPulse",
   busca global, avatar). Isso não existe no admin-web hoje e não é desta fatia — o redesign cobre só o
   `<section>` que a página já renderiza dentro do layout `(protected)` existente.
3. **Cor**: componentes shadcn usam a paleta já mapeada em `globals.css` (`--primary` = teal de ação do
   ArenaHub, `--destructive` = `--ah-danger`, etc.) — não a paleta indigo/emerald/rose do `DESIGN.md` colado.
   Layout/composição seguem o mockup; cor final é a do produto.
4. **Gráficos novos, locais à tela**: Recharts + Tailwind, dentro de `apps/admin-web/app/(protected)/billing/`.
   Não reestiliza nem estende os componentes de `@arenahub/ui`.
5. **CSS Modules → Tailwind**: `summary.module.css` é removido; a tela passa a usar classes Tailwind + tokens já
   mapeados, para poder conviver com os componentes shadcn instalados via CLI.
6. **Fatia única**: schema + backend + frontend entram juntos neste plano — não se separa em fatias menores.

## Mudanças de dado (fora do front puro)

### `GymUnit.capacidadeMaxima`

Campo novo, `Int?`, opcional. `null` = "sem limite definido" — o widget de capacidade instalada simplesmente não
aparece no painel financeiro (mesmo padrão do card "Estornado", que só aparece quando `estornadoMinor > 0`).
Unidades existentes nascem com `null`; nenhuma migração de dado retroativo.

- **Migration**: `ALTER TABLE "gym_units" ADD COLUMN "capacidade_maxima" INTEGER;`, gerada via
  `prisma migrate dev` (nunca SQL escrito à mão), nome de pasta
  `<timestamp>_capacidade_maxima_da_unidade`.
- **Backend** (`apps/api/src/modules/tenancy/`):
  - `gym-unit.controller.ts`: `esquemaDeAtualizacao` e `esquemaDeCriacao` ganham
    `capacidadeMaxima: z.number().int().positive().optional()`; `UnidadeDto` e `paraDto()` incluem o campo.
  - `gym-unit.repository.ts`: `atualizar()` e `criar()` aceitam `capacidadeMaxima?: number | undefined` na
    assinatura de `dados` (o filtro de `undefined` já existente cobre o resto, sem mudança de lógica).
- **Frontend** (`apps/admin-web/app/(protected)/units/`):
  - `editar-unidade.tsx`: novo `Field` numérico, mesmo padrão dos campos existentes (`name`, `timezone`).
  - `nova/formulario-de-unidade.tsx`: mesmo campo, opcional, no cadastro.
  - `apps/admin-web/app/actions/units.ts`: `esquemaDeUnidade`/`esquemaDeEdicaoDeUnidade` (Zod, não `.strict()`)
    ganham o campo; `cadastrarUnidade`/`editarUnidade` incluem `capacidadeMaxima` no corpo da chamada quando
    preenchido.

### `ocupacaoPorUnidade` no resumo financeiro

Achado durante o planejamento: `alunosAtivos` no resumo é agregado do **tenant inteiro**
(`consultar-resumo-financeiro.use-case.ts` não filtra por `gymUnitId`), e um tenant pode ter várias unidades
(`Tenant.gymUnits: GymUnit[]`). Comparar `alunosAtivos` (tenant todo) contra `capacidadeMaxima` (de uma
unidade) só faz sentido sem ambiguidade quando há exatamente uma unidade — em multi-unidade seria uma
comparação sem sentido.

Decisão do usuário: o widget mostra **uma barra por unidade do mesmo tenant** (nunca de outro tenant — a
mesma garantia de sempre via `TenantContext`/RLS). `ResumoFinanceiroDto.ocupacaoPorUnidade:
{ nomeDaUnidade: string; alunosAtivos: number; capacidadeMaxima: number | null }[]`, calculado agrupando
assinaturas ativas/inadimplentes por `gymUnitId` dentro do próprio tenant. Unidade sem `capacidadeMaxima`
definida aparece na lista só com a contagem de alunos, sem barra de progresso. Com uma única unidade no
tenant, o widget é visualmente idêntico a uma barra única.

Isso exige uma query nova no use case (contagem de assinaturas agrupada por `gymUnitId`, análoga ao padrão de
`groupBy` já usado para "quebra por método") — diferente de `planoMaisPopular`, que reaproveita dado já
carregado.

### `planoMaisPopular` no resumo financeiro

`ResumoFinanceiroDto.planoMaisPopular: { nome: string; quantidade: number } | null`. Calculado em
`consultar-resumo-financeiro.use-case.ts`, **sem query nova**: agrupamento em memória sobre a query
`assinaturas` já carregada (`status: { in: ['ACTIVE', 'PAST_DUE'] }`, já seleciona `planId`). Empate de contagem
resolve pelo nome do plano em ordem alfabética, para ser determinístico. Função pura nova em
`apps/api/src/modules/billing/domain/resumo-financeiro.ts` (mesmo padrão de `ticketMedio`/`taxaDeChurn`),
testável isolada sem banco. Nome do plano exige um `db.plan.findMany({ where: { id: { in: planIds } } })`
pequeno (só os planos que aparecem no agrupamento, não todos os planos do tenant).

`null` quando não há nenhuma assinatura ativa/inadimplente no período — mesmo critério de "ausência" que o resto
da tela já usa (`<Ausente />`).

### `metaMensalMinor` e `projecaoFechamentoMinor` — sem mudança de backend

Ambos deriváveis só com campos que a API já devolve. Ficam como funções puras dentro de `page.tsx`, ao lado de
`mesSeguinte`/`periodosDisponiveis`:

```ts
// metaMensalMinor = resumo.receitaEsperadaMinor (sem cálculo, é alias semântico)
// projecaoFechamentoMinor = resumo.recebidoMinor + resumo.aReceberMinor
```

Não entram no DTO — evita inflar a API com derivados que o front já pode montar sem chamada extra.

## Layout (de cima para baixo)

1. **Filtro de período** (chips) — mantém como está, reestilizado com classes Tailwind equivalentes.

2. **3 hero cards** (shadcn `Card`):
   - **Recebido**: valor + badge de tendência (mantém as 3 guardas existentes: `suficienteParaLinha`,
     `!periodoParcial`, `competenciasConsecutivas`) + barra de progresso da meta mensal
     (`recebidoMinor / metaMensalMinor`, shadcn `Progress`) + sparkline existente.
   - **Assinaturas vigentes**: valor total do tenant + lista de barras de ocupação, **uma por unidade**
     (`ocupacaoPorUnidade`), cada uma `alunosAtivos / capacidadeMaxima` daquela unidade — unidade sem
     `capacidadeMaxima` aparece só com a contagem, sem barra. Lista vazia (nenhuma unidade com capacidade
     definida) omite a seção inteira.
   - **Ticket médio**: como está hoje + linha de apoio com "Plano mais popular" (texto, não é widget próprio).

3. **Faixa compacta de KPIs** (Esperado, A receber, Vencido, Inadimplência, Estornado condicional) — shadcn
   `Card` menores com `Badge` de tom (`success`/`danger`/`warning`/`neutral` mapeados a `--ah-state-*`).

4. **Linha 1 — dois cards lado a lado**:
   - Evolução de receita: gráfico de área/linha com gradiente sob a curva de recebido (Recharts local).
   - Composição por método de pagamento: donut com legenda lateral rica (ícone, valor formatado, % do total,
     contagem de alunos/pagamentos) — visual mais próximo do mockup do que `GraficoDeRosca` atual permite sem
     mudar sua API pública.

5. **Linha 2 — dois cards lado a lado**:
   - Aging da dívida: barras horizontais (mockup usa horizontal, não vertical), com botão "Acessar fila de
     cobrança" (shadcn `Button`) linkando para `/billing/delinquency` (rota já existente).
   - Saúde do negócio & retenção: badge "Score Saudável" / "Atenção" / neutro, **reusando as mesmas 3 guardas de
     `variacaoRecebido`** que já governam o badge de tendência do card Recebido (dado insuficiente ou período
     parcial ou meses não consecutivos → estado neutro/cinza "Sem dado suficiente"; `variacaoRecebido > 0` →
     "Saudável" verde; `<= 0` → "Atenção" amber). Critério é só receita — `novosAlunos`/`cancelamentos` ficam
     como contexto textual no card, não entram na regra do score. Mais os 4 sub-KPIs já existentes (novos
     alunos, cancelamentos, taxa de churn, LTV).

6. **Base de cálculo** (`<dl>`) — mantém como está.

## Fora de escopo (confirmado com o usuário)

- Sidebar, header, busca global, avatar — não existem no admin-web, não são desta fatia.
- Régua automatizada de WhatsApp (exigiria integração de mensageria).
- "Últimas movimentações de alunos" (exigiria feed de eventos).
- "Configurar Gateways" (link para tela que não existe / não foi confirmada).
- Migração do resto do admin-web para shadcn/ui.

## Acessibilidade (não negociável, mesma régua da spec anterior)

- Cada gráfico novo mantém tabela invisível (`aria-hidden` no wrapper visual, tabela real no DOM) para leitor de
  tela — mesmo padrão que a revisão final da spec anterior corrigiu (achado I3).
- Foco visível herdado de `:focus-visible` já configurado em `globals.css`.
- Contraste de cor: como os tokens shadcn já apontam para `--ah-*` (verificados em contraste na spec anterior),
  não há trabalho novo de contraste — só validar que os componentes shadcn instalados (`Card`, `Badge`,
  `Progress`, `Button`) não introduzem hex literal (lint já proíbe).

## Testes

Mesmo padrão da spec anterior: RTL para os 3 componentes de gráfico novos (estados vazios, cores por token,
edge cases: faixa zerada em aging, competência com 1 ponto na série, `quebraPorMetodo` vazio). Testes de
`page.tsx` cobrindo os novos condicionais (`capacidadeMaxima` null, `planoMaisPopular` null, badge de score nas
mesmas 3 guardas). Testes de backend: função pura de `planoMaisPopular` em `resumo-financeiro.spec.ts` (empate,
lista vazia, um só plano). Sem teste de integração novo para `gym-unit.controller.ts` além do que a suíte atual
já cobre — não há precedente de spec de integração para essa rota no repo hoje (achado da investigação); avaliar
se a fatia precisa criar um se o PR de revisão apontar lacuna.
