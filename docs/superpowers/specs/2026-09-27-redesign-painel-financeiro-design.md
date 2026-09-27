# Redesign do painel financeiro — gráficos ricos

Data: 2026-09-27
Escopo: `apps/admin-web/app/(protected)/billing/page.tsx` + `summary.module.css` + 3 componentes em `packages/ui`.
Não é fatia de PRD nova — evolução visual sobre a F54 (`SPEC-054`) já entregue. Sem número de fatia/SPEC novo.

## Contexto

Pedido do usuário trazia um mockup de referência (Stitch, `stitch_modern_gym_financial_dashboard`) com layout
em shadcn/ui + Recharts + Material Symbols + cards com sombra. O admin-web já roda um design system próprio
(`@arenahub/ui`, tokens `--ah-*`), com contrato registrado em `docs/design/DS-PAINEL.md`: card **sem sombra,
nunca**, ícones em traço, cor semântica só por tom com badge+ícone+texto, sem shadcn.

Decisão (confirmada com o PI): **layout/estrutura segue o mockup, stack continua `@arenahub/ui`**. O mockup vira
referência de composição — quais blocos existem, hierarquia, quais gráficos — não de biblioteca.

A tela atual (`page.tsx`) já resolve boa parte do que o mockup pede: faixa única de KPI (decisão do PI de
25/08/2026, documentada no CSS, para caber em ~1 tela a 1280px), cor por severidade não decorativa, duas colunas
irmãs para "onde parou" / "por onde entrou", tabela recolhida em `<details>`. O que falta, por pedido explícito
do usuário ("gráficos ricos e modernos"): os dois blocos de barra horizontal (dívida, método de pagamento) e o
gráfico de série ficam mais expressivos, e os 3 KPIs mais importantes ganham destaque hero acima da faixa
compacta.

## Decisões já tomadas (não reabrir)

1. Stack: `@arenahub/ui`, tokens `--ah-*`. Sem shadcn/ui, sem Tailwind, sem Material Symbols, sem sombra em card.
2. Método de pagamento vira `GraficoDeRosca` (donut) novo — não reaproveita `BarrasDeFaixa`.
3. Aging da dívida vira `BarrasVerticais` novo (colunas com eixo) — não reaproveita `BarrasDeFaixa`.
4. `SerieFinanceira` evolui in-place (gradiente, pontos, grid) — não é substituído.
5. 3 KPIs (Recebido, Assinaturas vigentes, Ticket médio) promovidos a hero cards acima da faixa compacta dos
   demais.
6. Componentes novos e dados seguem `--ah-*` em claro e escuro — nunca hex fixo no SVG.
7. Zero mudança de backend/endpoint. `Resumo` (interface em `page.tsx`) já carrega todo dado necessário.

## Correção sobre a stack de gráficos (achado durante o plano)

Ao ler o código-fonte de `BarrasDeFaixa`, `SerieFinanceira` e `Sparkline`, os três **já usam Recharts**
(`recharts` já é dependência do design system) — não SVG puro à mão, como este spec assumia antes de ler o
código. Mantém-se a decisão de não usar shadcn/ui/Tailwind (isso é sobre estilo de componente e tokens, não sobre
a lib de gráfico), mas os componentes novos seguem o padrão real do repo: Recharts + `getComputedStyle` para
resolver token `--ah-*` em cor (hook `useCoresDosTokens`/`useCorDoToken`, já implementado três vezes de forma
quase idêntica — candidato a extrair para um hook compartilhado, mas fora de escopo aqui: YAGNI, só extrair
quando um quarto uso pedir).

Achado adicional: **`SerieFinanceira` já tem boa parte do que o spec original pedia como "evolução"** — grid
pontilhado (`CartesianGrid strokeDasharray`), linha tracejada para o faturado/esperado, ponto (`dot`) na linha de
recebido, área de contexto entre as duas curvas. Falta só: destacar o último ponto (mais recente) com raio maior,
e avaliar se um gradiente de preenchimento sob a curva de recebido (do zero até a linha, não só entre as duas
linhas) agrega ou compete visualmente com a área "não entrou" que já existe — decisão de implementação, ver Task
correspondente no plano.

## Componentes novos

### `GraficoDeRosca` (`packages/ui/src/components/GraficoDeRosca.tsx`)

Recharts `PieChart`/`Pie` com `innerRadius` (rosca, não pizza cheia), seguindo o padrão de
`BarrasDeFaixa`/`SerieFinanceira`: `ResponsiveContainer` + `accessibilityLayer={false}` + wrapper `aria-hidden`
+ tabela invisível antes do SVG para leitor de tela. Cor de cada fatia resolvida via `getComputedStyle` do token
(mesmo hook `useCoresDosTokens` que `BarrasDeFaixa` já implementa — copiar a implementação, já que extrair um
hook compartilhado é decisão de escopo maior, fora deste redesign).

Props (mesma forma de dado que `BarrasDeFaixa` já usa, para reduzir atrito de adaptação na page):

```ts
interface SegmentoDeRosca {
  rotulo: string;
  valor: number; // minor units
  tokenDeCor: string; // ex. '--ah-state-success'
  valorLegivel: string; // já formatado, ex. "R$ 11.723,20 · 68% (152 alunos)"
}

interface GraficoDeRoscaProps {
  testId: string;
  descricao: string; // acessibilidade, mesmo padrão de BarrasDeFaixa
  segmentos: readonly SegmentoDeRosca[];
  rotuloCentral?: string; // ex. "Recorrente"
  valorCentral?: string; // ex. "68%"
}
```

Centro do anel mostra `rotuloCentral`/`valorCentral` (maior segmento) quando fornecidos — opcional, sem quebrar
o componente quando ausente. Legenda é lista textual ao lado (não dentro do SVG), reaproveitando o padrão de
lista com marcador de cor que `BarrasDeFaixa` já usa hoje — leitor de tela lê a legenda, não o SVG (SVG leva
`aria-hidden`, `descricao` vai em texto visível/associado).

Cor: `tokenDeCor` é resolvido via `getComputedStyle` (mesmo mecanismo que `Sparkline`/`BarrasDeFaixa` já usam
para ler `--ah-*` em runtime e funcionar nos dois temas).

Estado vazio (`segmentos` vazio ou soma zero): não renderiza o SVG — a page já decide isso fora do componente,
como faz hoje com `EmptyState` antes de `BarrasDeFaixa`. Mesmo padrão se repete aqui.

### `BarrasVerticais` (`packages/ui/src/components/BarrasVerticais.tsx`)

Recharts `BarChart` com `layout` vertical padrão (colunas, eixo Y numérico) — o inverso de `BarrasDeFaixa`, que
usa `layout="vertical"` do Recharts para barras *horizontais*. `YAxis` com grid (`CartesianGrid`), `XAxis`
categórico com o rótulo da faixa embaixo de cada coluna, `LabelList` com o valor formatado no topo da barra
(mesmo padrão de `BarrasDeFaixa`). Mesmo wrapper de acessibilidade (tabela invisível + `aria-hidden` no SVG).

Props (mesma forma de dado que `BarrasDeFaixa`, reuso direto do array `faixas` que a page já monta):

```ts
interface FaixaVertical {
  rotulo: string;
  valor: number;
  tokenDeCor: string;
  valorLegivel: string;
}

interface BarrasVerticaisProps {
  testId: string;
  descricao: string;
  faixas: readonly FaixaVertical[];
}
```

Grid de fundo em `--ah-border-subtle`, mesma cor que o grid do `SerieFinanceira` evoluído usa — os dois gráficos
"lado a lado" (linha 4 do layout) compartilham a mesma textura de fundo.

### `SerieFinanceira` (evolução in-place)

Aditivo, sem mudar a prop pública (`pontos: { rotulo, faturadoMinor, recebidoMinor }[]`, `testId`, `descricao`):

- `<defs><linearGradient>` vertical, do tom de "recebido" (mesmo token que a linha já usa) a transparente,
  preenchendo a área sob a curva de recebido.
- Pontos (`<circle>`) nos vértices da linha de recebido, com o último ponto (mais recente) levemente maior —
  mesmo padrão do mockup de referência (ponto "atual" em destaque).
- Grid horizontal pontilhado leve de fundo (`stroke-dasharray`), 3–4 linhas guia.
- Linha de "faturado"/esperado, quando o dado existir, tracejada e mais fina que a linha de recebido — já existe
  um segundo valor por ponto (`faturadoMinor`); hoje o componente talvez não desenhe as duas linhas — checar
  implementação atual antes de decidir se é ativação de path já existente ou path novo.

Tabela invisível para leitor de tela que o componente já publica (regra do PRD: todo gráfico tem tabela
equivalente no DOM) não muda.

## `page.tsx` — nova hierarquia

1. Cabeçalho + filtro de período — inalterado.
2. **Hero KPIs** (3 cards, `estilos['heroKpis']` novo): Recebido, Assinaturas vigentes, Ticket médio. Cada um
   maior que os da faixa compacta, com:
   - Recebido: mantém o `Sparkline` que já tem hoje.
   - Badge de tendência (`↑ X% vs mês anterior`) **só quando o dado de mês anterior existir na série** — nunca
     inventar ou estimar percentual sem dado real. Se `resumo.serie.pontos` não tiver um ponto anterior ao atual,
     omite o badge (mesma disciplina que o `Ausente` já aplica a outros KPIs sem dado).
3. **Faixa compacta**: os KPIs restantes, exatamente como hoje, menos os 3 promovidos.
4. **Duas colunas** (`estilos['duasColunasGraficos']` novo, reaproveita breakpoint 1024px de `duasColunas`):
   `SerieFinanceira` (evoluído) à esquerda, `GraficoDeRosca` (método de pagamento) à direita.
5. **Duas colunas**: `BarrasVerticais` (aging da dívida) à esquerda, card de "Saúde do negócio & retenção" à
   direita — agrupa visualmente os KPIs de Novos alunos / Cancelamentos / Taxa de churn / LTV que hoje vivem
   soltos na faixa compacta. Decisão: eles **saem** da faixa compacta e viram os sub-cards deste bloco agrupado
   (evita duplicar o número em dois lugares da tela).
6. Base de cálculo (rodapé) — inalterado.

## Dados

Nenhum endpoint novo. `Resumo` (interface já declarada em `page.tsx`) contém tudo: `serie`, `quebraPorMetodo`,
`faixas`, os 12 KPIs atuais. `GraficoDeRosca` recebe `resumo.quebraPorMetodo` mapeado (mesmo `map` que hoje monta
prop de `BarrasDeFaixa`, adaptado pra forma de segmento). `BarrasVerticais` recebe `resumo.faixas` mapeado da
mesma forma.

## Testes

- `.spec.tsx` novo para `GraficoDeRosca` e `BarrasVerticais`: renderiza com dado, renderiza vazio (delega pra
  quem chama — verificar contrato), cor resolvida por token (mesmo padrão de teste que `BarrasDeFaixa.spec.tsx`
  já usa hoje — ler antes de escrever os novos).
- `SerieFinanceira.spec.tsx` existente: adicionar casos para gradiente/pontos/grid conforme o que for
  efetivamente adicionado (sem testar detalhe de pixel, testar presença de elemento e uso de token correto).
- `billing/page.test.tsx`: atualizar para os novos `data-testid` de hero card e dos dois blocos de gráfico
  novos. Verificar se os `data-testid` dos KPIs promovidos (`recebido-no-periodo`, `alunos-ativos`,
  `ticket-medio`) continuam os mesmos — só mudam de posição/CSS, não de identidade, então teste que os referencia
  deve continuar passando sem alteração de seletor.
- `tests/e2e`: grep por seletor da tela de billing antes de mexer, para achar dependência de estrutura que possa
  quebrar (ex. ordem de elementos, `data-testid` movido).

## Fora de escopo

- Endpoint/backend: zero mudança.
- Modal de "fila de cobrança" do mockup (aging list detalhada, ações em massa): não pedido, não faz parte deste
  redesign. Fica registrado aqui como possível fatia futura, decisão do PI se e quando abrir.
- Migração de outras telas do admin-web para os componentes novos: fora de escopo, só o painel financeiro usa
  `GraficoDeRosca`/`BarrasVerticais` por ora.
