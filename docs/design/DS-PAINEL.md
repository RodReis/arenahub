# DS-PAINEL — Design System do Painel Administrativo

Academia ArenaHub · plataforma ArenaHub
Arquivo de referência: `Painel Admin.dc.html`
Versão 1.0 — sistema completo: tokens, grids, componentes, formulários, feedback

---

## 1. Sobre o produto

Painel web operado pelo time da academia (recepção, gerência, super admin). É a única superfície onde se **escreve** dado: cadastro de aluno, biometria facial, planos, cobrança, lançamento de bioimpedância, configuração do totem. O app e o totem são superfícies de leitura e de transação do aluno.

### Princípios

**Densidade sobre respiro.** É uma ferramenta de trabalho usada 8 h por dia em tela de 1366–1920 px. Alturas de controle de 36 px, texto de corpo em 13 px, linhas de tabela de 44–48 px. Não é um site.

**Cada ação sensível deixa rastro.** Desbloqueio de catraca, revogação de consentimento, alteração de CPF, sessão elevada: exigem motivo e entram em auditoria imutável.

**O sistema nunca decide sozinho em saúde.** O painel exibe medição, faixa e alerta. Diagnóstico é do profissional.

**Nada é definitivo sem confirmação escrita.** Ações irreversíveis passam por modal com resumo do que muda e campo de motivo.

### Contexto

| Aspecto | Definição |
|---|---|
| Largura de trabalho | 1366–1920 px; conteúdo com `max-width: 1180px` centralizado |
| Entrada | Mouse + teclado; atalhos e tab-order importam |
| Densidade | Compacta (36 px de controle, 13 px de corpo) |
| Fuso | America/Sao_Paulo, exibido no rodapé do login |
| Locale | pt-BR — `R$ 1.234,56`, `dd/mm/aaaa`, `92,25 kg` |

---

## 2. Tokens

### 2.1 Cor — neutros

Escala fria única, do papel ao quase-preto. Toda a interface se resolve com ela; cor só entra para significar.

| Token | Hex | Uso |
|---|---|---|
| `canvas` | `#F5F7F9` | Fundo da aplicação, fundo de campo somente-leitura, fundo de resumo em modal |
| `surface` | `#FFFFFF` | Card, tabela, painel, campo editável |
| `border/subtle` | `#E5E9EE` | Divisor interno: linha de tabela, borda de aba, separador de bloco |
| `border/default` | `#CBD1D9` | Borda de card, input, botão secundário |
| `text/placeholder` | `#7B8491` | Placeholder, matrícula secundária, chevron de combo |
| `text/muted` | `#565E69` | Metadado, label de KPI, hint de campo, breadcrumb |
| `text/label` | `#3C424B` | Label de formulário, valor de célula secundária |
| `text/body` | `#2B3037` | Corpo, nome em célula, valor de tabela |
| `text/strong` | `#1F2328` | Título de tela, valor de KPI |
| `chrome` | `#121417` | Topbar e sidebar, painel escuro do login |
| `chrome/raised` | `#1F2328` | Botão dentro da topbar |
| `chrome/border` | `#2B3037` | Divisor e borda dentro do chrome |
| `chrome/text` | `#E5E9EE` | Texto sobre chrome |
| `chrome/text-muted` | `#A6AEB9` | Texto secundário sobre chrome |

### 2.2 Cor — marca

| Token | Hex | Uso |
|---|---|---|
| `brand/700` | `#005760` | Hover de botão primário, hover de link |
| `brand/600` | `#00707B` | **Primária.** Botão primário, link, avatar, switch ligado, aba ativa |
| `brand/tint` | `#EAF6F7` | Fundo de badge de marca |
| `brand/accent` | `#4FD5E3` | Somente o ponto do logotipo `arenahub.` |

O acento ciano é ornamento de marca — nunca cor de estado, nunca fundo de área.

### 2.3 Cor — semântica

Seis tons. Cada um é uma tripla `[texto, fundo, borda]`, com fundo a 10% e borda a 32% de opacidade — o que mantém o badge legível sobre `surface` e sobre `canvas`.

| Tom | Texto | Fundo | Borda | Significado |
|---|---|---|---|---|
| `ok` | `#157F3D` | `rgba(21,127,61,.10)` | `rgba(21,127,61,.32)` | Ativo, pago, sincronizado, dentro da faixa |
| `warn` | `#8A5200` | `rgba(138,82,0,.10)` | `rgba(138,82,0,.32)` | Vence hoje, pendente de revisão, atenção |
| `err` | `#C22B2B` | `rgba(194,43,43,.10)` | `rgba(194,43,43,.32)` | Bloqueado, falha, inadimplente, revogar |
| `info` | `#1F5FD0` | `rgba(31,95,208,.10)` | `rgba(31,95,208,.32)` | Em processamento, experimental, informativo |
| `risk` | `#B4470B` | `rgba(180,71,11,.10)` | `rgba(180,71,11,.32)` | Risco de churn, ação sensível, sessão elevada |
| `neu` | `#565E69` | `rgba(86,94,105,.10)` | `rgba(86,94,105,.32)` | Inativo, arquivado, sem dado |

Chamada no código: `bdg(tone, icon, label, prefixo)` → devolve `{ bC, bBg, bBd, bD, bLabel }`. O prefixo permite dois badges na mesma linha (`bdg(tone,…,'es')` + `bdg(rTone,…,'er')`).

**Regras.** `risk` é a cor da ação sensível — desbloqueio de catraca, sessão elevada, churn. `err` é falha e destruição. Nunca usar verde como cor de botão. Nunca comunicar estado só por cor: badge sempre tem ícone e texto.

### 2.4 Tipografia

**Inter** na interface. **JetBrains Mono** em identificador técnico: CPF, matrícula, IP, serial, firmware, referência de fatura, versão.

| Papel | Tamanho / linha | Peso | Cor |
|---|---|---|---|
| Título de tela (`h1`) | 20 / 26 px | 600 | `text/strong` |
| Título de painel de login | 32 / 38 px | 700 | branco |
| Valor de KPI | 26 / 32 px | 700 | `text/strong` |
| Valor destacado | 24 px | 700 | `text/strong` |
| Título de card / seção | 14 px | 600 | `text/strong` |
| Corpo, célula de tabela | 13 px | 400–500 | `text/body` |
| Rótulo de botão | 13 px | 600 | conforme variante |
| Label de campo | 12 px | 600 | `text/label` |
| Metadado, breadcrumb, hint | 12 px | 400 | `text/muted` |
| Overline / label de KPI | 11 px, tracking .06em, uppercase | 600 | `text/muted` |
| Hint de campo em duas linhas | 11 / 15 px | 400 | `text/muted` |
| Mono técnico | 11–12 px | 400 | `text/muted` |

Mínimo 11 px, e só em overline e hint. Todo número em coluna leva `font-variant-numeric: tabular-nums`. Títulos com `letter-spacing: -0.01em`; logotipo com `-0.02em`.

### 2.5 Espaçamento

Escala de 2 px: **2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 48**.

| Contexto | Valor |
|---|---|
| Padding da área de conteúdo | `20px 24px 48px` |
| Largura máxima do conteúdo | 1180 px, centralizado |
| Padding de card | 16 px (20 px em corpo de aba) |
| Padding de célula de tabela | `10px 16px` |
| Gap entre cards de uma grade | 12 px |
| Gap entre blocos verticais | 16 px |
| Gap label→campo | 5–6 px |
| Gap em grade de formulário | `14px 16px` |
| Gap em barra de filtros | 8 px |

### 2.6 Raio, borda, elevação

| Elemento | Raio |
|---|---|
| Modal | 10 px |
| Card, tabela, painel | 8 px |
| Input, select, botão, aba | 6 px |
| Badge, botão fantasma pequeno | 4 px |
| Switch | 11 px (pill) |
| Avatar | circular |

Bordas de **1 px**: `border/default` no que é interativo ou contido, `border/subtle` no que apenas separa.

Elevação só em camada flutuante:
- Modal: `0 12px 32px rgba(10,11,13,.18)` sobre scrim `rgba(10,11,13,.5)`
- Dropdown, popover, toast: `0 8px 24px rgba(10,11,13,.14)`
- Card não tem sombra. Nunca.

### 2.7 Alturas

| Elemento | Altura |
|---|---|
| Topbar | 52 px |
| Faixa de sessão elevada | 28 px (com `border-top` 4 px) |
| Input, select, botão padrão | 36 px |
| Botão dentro de tabela / secundário compacto | 28 px |
| Botão fantasma em célula | 26 px |
| Item de navegação | 34 px |
| Botão de ícone na topbar | 32 px |
| Aba | 42 px |
| Badge | 22 px |
| Switch | 22 × 38 px |
| Linha de tabela | 44–48 px (`min-height`) |
| Cabeçalho de tabela | 36 px |

### 2.8 Largura de coluna e ícones

Sidebar 204 px · painel de login 42% (mín. 360 px) · card de login 340 px · modal 460 px · busca 280 px.

Ícones: traço, `viewBox` 24×24, `stroke-width: 2`, `linecap/linejoin: round`, sem fill. 13 px em badge e chevron, 15 px na navegação, 16 px na topbar, 14 px na faixa elevada. Cor por `currentColor`.

### 2.9 Movimento

Praticamente nenhum. `@keyframes ah-pulse` (opacidade 1 → .3) marca indicador ao vivo. Switch move o knob por `transform: translateX(16px)`. Toast entra e sai em 160 ms. Nada mais anima.

**Exceção do dashboard — emenda de 01/09/2026 (F57, decisão do PI).** A tela de dashboard
operacional acrescenta duas animações, e só ela:

| o que | duração | o que comunica |
|---|---|---|
| `ah-halo` — anel que expande e some sob o ponto "ao vivo" | 2 s, contínuo | o feed está recarregando **agora**; para junto com a recarga quando a aba fica oculta |
| `ah-entra` — linha nova do feed desliza 6 px e aparece | 220 ms, `cubic-bezier(0.16, 1, 0.3, 1)` | alguém acabou de passar na catraca |

As duas passam em `transform` e `opacity` (compositor, sem recálculo de layout) e **desligam em
`prefers-reduced-motion: reduce`**, onde o estado continua legível por cor, ícone e texto. Nenhuma
delas é transição entre telas, que continua proibida.

### 2.10 Superfície tingida por estado — dashboard

**Emenda de 01/09/2026 (F57, decisão do PI).** A célula de KPI do dashboard pinta o próprio fundo
com `color-mix(in srgb, currentColor 7%, var(--ah-surface-raised))` e ganha aresta superior de
3 px na cor cheia do tom.

- **7% e não os 10% do `StateBadge`**: a área pintada é uma célula inteira, e o mesmo alfa numa
  faixa de quatro vira bloco de cor em vez de tinta.
- **Sem estado, sem tinta.** Célula neutra fica branca — a faixa nunca tem quatro cores.
- **Contraste medido**, não estimado: valor entre 5,13 e 5,77 e rótulo entre 5,88 e 5,95 nos quatro
  tons, contra os 3,0 (texto grande) e 4,5 (texto normal) exigidos.
- **Não vale para as demais telas.** Grid, cobrança e operação seguem a §4.6.

---

## 3. Grids e layout

### 3.1 Estrutura da aplicação

```
┌──────────────────────────────────────────────────────┐
│ ⚠ Sessão elevada (Super Admin) · expira em 09:41     │ 28px · condicional
├──────────────────────────────────────────────────────┤
│ arenahub. │ [Academia ▾]              🔔  [RN] Renata│ 52px topbar
├──────────┬───────────────────────────────────────────┤
│ Dashboard│  Operação                                 │
│ Alunos   │  Dashboard operacional        ● ao vivo   │
│ Biometria│  ┌────────┐┌────────┐┌────────┐┌────────┐ │
│ Planos   │  │  KPI   ││  KPI   ││  KPI   ││  KPI   │ │
│ Inadimpl.│  └────────┘└────────┘└────────┘└────────┘ │
│ Bioimped.│  ┌─────────────────────────────────────┐  │
│ Totem    │  │ tabela / painel                     │  │
│ ─────────│  └─────────────────────────────────────┘  │
│ Sair     │                                           │
└──────────┴───────────────────────────────────────────┘
  204px       flex:1 · overflow:auto · max-width 1180px
```

`display: flex; min-height: 100vh` no shell; a área de conteúdo é a única que rola (`flex: 1; overflow: auto; min-height: 0`).

### 3.2 Grade de KPI

`grid-template-columns: repeat(4, 1fr); gap: 12px`. Três colunas quando há gráfico ao lado. Cada card: overline → valor 26 px → badge opcional.

### 3.3 Grade de formulário

`grid-template-columns: 1fr 1fr; gap: 14px 16px`. Campo largo (endereço, observação) ocupa as duas colunas. Nunca três colunas em formulário — o olho perde o par label/campo.

### 3.4 Grade de tabela

Tabelas são **grid explícito**, não `<table>` — permite alinhar cabeçalho e linha com a mesma declaração e usar `minmax(0,1fr)` para a coluna que trunca.

```
grid-template-columns: 1fr 140px 150px 160px 130px 100px;
gap: 8px;
```

Regras:
- Coluna de texto variável: `1fr` ou `minmax(0,1fr)`, com `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`.
- Colunas fixas para data, valor, status, ações.
- Valor monetário e numérico: `text-align: right` + `tabular-nums`.
- Coluna de ações: `justify-content: flex-end`.
- Cabeçalho repete exatamente as mesmas colunas, 12 px/600 em `text/muted`, `border-bottom: 1px solid border/subtle`.
- Tabela larga: `overflow-x: auto` no wrapper + `min-width` na linha (ex. 640 px).

### 3.5 Grade de cards de plano

`repeat(auto-fill, minmax(260px, 1fr)); gap: 12px`.

### 3.6 Layout de ficha (detalhe)

Duas colunas: coluna principal em `minmax(0,1fr)` com as abas, coluna lateral de 300 px com resumo, ações sensíveis e atalhos. A lateral não rola separado.

---

## 4. Componentes

### 4.1 Topbar

52 px, `chrome`. Da esquerda: logotipo `arenahub.` 16 px/800 com ponto em `brand/accent`; divisor de 1 px × 20 px; seletor de tenant/unidade (botão 30 px em `chrome/raised`, borda `chrome/border`, chevron 13 px); espaçador; botão de notificação 32 px com contador (`min-width:14px; height:14px; border-radius:7px; background:err`); menu de usuário com avatar 24 px em `brand/600` e iniciais 10 px/700.

### 4.2 Faixa de sessão elevada

Aparece só em sessão de Super Admin. Fundo `risk`, `border-top: 4px solid #7A2F06`, texto branco 12 px/600, escudo 14 px, tenant e motivo declarados, tempo restante em mono, botão "Encerrar" com borda `rgba(255,255,255,.6)`. É a única faixa colorida de largura total do sistema.

### 4.3 Navegação lateral

204 px, `chrome`, padding `12px 10px`, gap 2 px. Item: 34 px, raio 6 px, ícone 15 px + label 13 px. Ativo: fundo `chrome/raised`, texto branco. Inativo: transparente, texto `chrome/text-muted`, hover para `chrome/text`. "Sair" separado por `border-top: 1px solid chrome/border` com margem `8px 2px`, sempre no fim (`flex: 1` no espaçador).

### 4.4 Cabeçalho de tela

Breadcrumb 12 px `text/muted` → linha com `h1` 20 px/600 à esquerda e indicador de atualidade à direita (ícone 13 px + texto 12 px na cor do tom; `ah-pulse` quando ao vivo). Margem `2px 0 16px`.

### 4.5 Card

`surface`, borda 1 px `border/default`, raio 8 px, padding 16 px. Sem sombra. Cabeçalho interno: título 14 px/600 + ação à direita, separado por `border-bottom: 1px solid border/subtle` quando o card contém lista.

### 4.6 Card de KPI

Overline 11 px uppercase → valor 26/32 px 700 tabular (margem `6px 0 8px`) → badge ou sublinha 12 px. Valor pode assumir cor semântica quando o próprio número é o alerta.

### 4.7 Badge

`inline-flex`, 22 px, padding lateral 8 px, raio 4 px, gap 6 px, 12 px/600. Fundo, borda e texto vêm da tripla do tom; ícone 13 px em `currentColor`. Em célula de tabela leva `white-space: nowrap`.

### 4.8 Botões

| Variante | Fundo | Borda | Texto | Uso |
|---|---|---|---|---|
| Primário | `brand/600` → hover `brand/700` | — | branco | Uma por tela |
| Secundário | `surface` → hover `canvas` | `border/default` | `text/label` | Ações de apoio |
| Fantasma | transparente | — | `text/label` | Terciária, em célula |
| Destrutivo | transparente → hover `rgba(194,43,43,.08)` | — | `err` | Revogar, excluir |
| Sensível | transparente | `risk` a 30% | `risk` | Desbloquear catraca |
| Sobre chrome | `chrome/raised` | `chrome/border` | `chrome/text` | Topbar |

Altura 36 px (padrão), 28 px (em tabela), 26 px (fantasma em célula). Raio 6 px, 4 px no fantasma pequeno. Peso 600. `font-family: inherit` obrigatório.

### 4.9 Campo de texto

```
label 12px/600 text/label   [• obrigatório] [alterado]
┌────────────────────────────────────────┐  36px
│ valor 13px                             │  1px border/default, raio 6px
└────────────────────────────────────────┘
hint 11/15px text/muted
```

Estados: foco `border: brand/600` + `box-shadow: 0 0 0 3px rgba(0,112,123,.12)`; somente-leitura fundo `canvas` e cursor `default`; erro borda `err` + mensagem 11 px em `err`; identificador técnico em JetBrains Mono. Campo obrigatório marca ponto de 4 px em `err` ao lado do label. Campo alterado e não salvo recebe badge `info` "alterado".

### 4.10 Select nativo

36 px, `surface`, borda `border/default`, raio 6 px, padding lateral 8 px, 13 px, `color: text/label`. Usar quando as opções são poucas, curtas e conhecidas — status, unidade, dia de vencimento, forma de cobrança, motivo. Rótulo da opção já carrega o contexto ("Status: todos", "Dia 5", "Motivo: falha no facial"), o que evita label redundante em barra de filtros.

### 4.11 Combobox com busca

Para listas longas ou que exigem digitação: aluno, plano, cidade, professor. O select nativo não serve.

```
┌────────────────────────────────────────┐ 36px
│ Buscar aluno…                        ▾ │
└────────────────────────────────────────┘
┌────────────────────────────────────────┐ popover
│ Recentes                               │ overline 11px
│  RN  Rodrigo Reis        mat 004821    │ 36px, hover canvas
│  FC  Fernanda Costa      mat 004102    │ selecionado: brand/tint
│ ──────────────────────────────────────  │
│ 12 resultados · refine a busca         │ 11px text/muted
└────────────────────────────────────────┘
```

Popover: `surface`, borda `border/default`, raio 6 px, sombra de dropdown, `max-height: 280px` com rolagem, `min-width` igual ao gatilho. Item 36 px, padding lateral 10 px, 13 px; trecho correspondente à busca em peso 600; secundária (matrícula, mono 11 px) alinhada à direita em `text/placeholder`. Item ativo por teclado: fundo `canvas`; selecionado: fundo `brand/tint` + check 13 px em `brand/600`.

Teclado: `↑ ↓` navega, `Enter` confirma, `Esc` fecha e devolve o foco, digitação filtra, `Backspace` no campo vazio remove o último chip em modo múltiplo.

Múltipla escolha: valores viram chips de 22 px dentro do gatilho (fundo `canvas`, borda `border/default`, raio 4 px, `×` de 11 px). Acima de 3 chips, colapsa em "3 selecionados".

Vazio: "Nenhum resultado para <termo>" 13 px `text/muted` + ação "Cadastrar novo" quando fizer sentido.

### 4.12 Campo de data

Entrada digitável com máscara `dd/mm/aaaa` em JetBrains Mono, mais botão de calendário 28 px à direita da borda interna. **Digitar é o caminho principal** — recepção digita mais rápido do que clica.

```
┌──────────────────────────┐
│ 03/08/2026            📅 │ 36px, mono 13px
└──────────────────────────┘
┌──────────────────────────┐ popover 260px
│  ‹   agosto 2026     ›   │ 36px, 13px/600
│  D  S  T  Q  Q  S  S     │ 11px/600 text/muted
│                    1  2  │ célula 32px, raio 4px
│  3  4  5  6  7  8  9     │
│ 10 11 12 13 14 15 16     │
│ ─────────────────────────│
│ Hoje            Limpar   │ 12px, brand/600
└──────────────────────────┘
```

Célula 32 px, 13 px tabular. Hoje: borda 1 px `brand/600`. Selecionado: fundo `brand/600`, texto branco. Fora do mês: `text/placeholder`. Indisponível: `text/placeholder` com `cursor: not-allowed`, sem hover. Fim de semana não recebe tratamento especial — academia abre sábado.

**Intervalo** (relatórios, faturas, frequência): dois campos com "até" 12 px `text/muted` entre eles, um só popover de dois meses lado a lado (520 px). Extremos com fundo `brand/600`; miolo com fundo `brand/tint` e raio 0, exceto nas pontas. Acima, atalhos como chips de 26 px: Hoje · 7 dias · 30 dias · Este mês · Mês passado.

Validação: data inválida ou fora do intervalo → borda `err` + mensagem 11 px ("Data final anterior à inicial"). Nunca corrigir silenciosamente o que o operador digitou.

### 4.13 Switch

38 × 22 px, raio 11 px. Ligado: fundo e borda `brand/600`, knob branco em `translateX(16px)`. Desligado: fundo `surface`, borda `border/default`, knob `text/placeholder` em `translateX(0)`. Knob de 16 px com transição de 120 ms. Sempre `role="switch"` e `aria-label`. Padrão de linha: título 13 px/600 + nota 12/17 px `text/muted` à esquerda, switch à direita.

### 4.14 Abas

Faixa de 42 px com `border-bottom: 1px solid border/subtle` e `overflow-x: auto`. Aba: padding lateral 14 px, 13 px, `border-bottom: 2px`. Ativa: borda `brand/600`, texto `text/strong`, peso 600. Inativa: borda transparente, texto `text/muted`, peso 500. Aba com pendência recebe ponto de 6 px em `warn` após o rótulo.

**Implementado em 11/09/2026 (F68) como `Tabs`, com três emendas ao parágrafo acima:**

- **O realce da ativa é um pseudo-elemento de 2 px**, não `border-bottom` na aba: a borda empurraria o
  texto 2 px a cada troca, e o pseudo-elemento recuado 10 px de cada lado cobre a régua da faixa,
  formando um traço só em vez de dois paralelos. A cor é `--ah-action-solid` — accent é legítimo aqui
  porque aba selecionada é **localização**, o mesmo papel do item ativo da navegação, e não estado de
  domínio (regra 3 do §11).
- **O ponto de pendência virou contador**, porque o número é o que manda alguém entrar na aba: quantos arquivos de marca já
  subiram informa, um ponto de cor não. Badge de 18 px, `tabular-nums`, em `surface/sunken`
  na aba inativa e `action/subtle-bg` na ativa.
- **Todos os painéis ficam montados**, e só o inativo recebe `hidden`. Desmontar é o desenho óbvio e faz
  o formulário esvaziar quando alguém troca de aba e volta — o que o §10 item 3 proíbe. O `hidden`
  também tira o painel da ordem de tabulação e da árvore de acessibilidade, o que `display: none` por
  CSS não garante.

Teclado completo (WAI-ARIA Tabs): setas navegam e levam o foco junto, Home e End vão aos extremos, e
só a aba ativa fica na ordem de tabulação — com as quatro tabuláveis, alcançar o conteúdo custaria
quatro Tabs.

### 4.15 Modal de confirmação

Scrim `rgba(10,11,13,.5)`, `z-index: 60`. Caixa 460 px, `surface`, raio 10 px, sombra de modal, padding 20 px, gap 14 px, `role="dialog" aria-modal="true"`.

Ordem: título 16 px/600 → bloco de resumo em `canvas` (raio 6 px, padding `12px 14px`, 13/19 px, com aluno e identificador em mono) → campo de motivo quando a ação é sensível → linha de ações com secundário "Cancelar" e primário/destrutivo à direita.

O título diz o que vai acontecer, não pergunta genérica: "Desbloquear catraca para Rodrigo Reis". Motivo é obrigatório em ação sensível e o botão fica desabilitado até haver texto.

**Implementado em 11/09/2026 (F68) como `ConfirmDialog`**, que é a moldura e delega o conteúdo ao
`SensitiveAction` que já existia. A separação importa: dentro de um formulário o bloco em fluxo está
certo, e embrulhar aquele caso num modal interromperia quem já estava decidido. O modal é para o ato
disparado de uma **linha de tabela ou de um menu**, onde o bloco em fluxo esticaria a linha.

`<dialog>` nativo com `showModal()`, e não o atributo `open`: só o método cria a camada superior,
prende o foco, torna o resto da página `inert` e liga o Esc. Um `<dialog open>` renderiza igual e não
faz nenhuma das quatro coisas — a diferença só aparece para quem navega por teclado. O conteúdo monta
com o diálogo: mantê-lo montado faria a próxima abertura vir com o motivo digitado da anterior, que
num menu de linha é o motivo de **outro** cliente.

### 4.16 Toast

Feedback de ação assíncrona já executada. **Não** substitui modal de confirmação nem mensagem de erro de campo.

```
                    ┌──────────────────────────────────┐
                    │ ✓  Ficha salva                   │
                    │    Rodrigo Reis · 3 campos       │  Desfazer  ×
                    └──────────────────────────────────┘
```

Pilha no canto inferior direito, 24 px da borda, gap 8 px, empilhamento invertido (mais novo embaixo), máximo 3 visíveis — o quarto substitui o mais antigo.

Caixa: largura 320 px (`max-width: 420px`), `surface`, borda 1 px na cor de borda do tom, raio 8 px, sombra de dropdown, padding `12px 14px`, gap 10 px. `border-left: 3px solid` na cor de texto do tom. Ícone 15 px no tom; título 13 px/600 `text/strong`; detalhe 12/17 px `text/muted`; ação opcional 12 px/600 em `brand/600`; fechar `×` de 12 px em `text/placeholder`.

| Tom | Quando | Duração |
|---|---|---|
| `ok` | Salvo, sincronizado, cobrança enviada | 4 s |
| `info` | Processando em segundo plano, exportação na fila | 4 s |
| `warn` | Concluído com ressalva ("2 de 14 sem foto") | 6 s |
| `err` | Falhou | persistente até fechar |

Regras: ação destrutiva reversível ganha "Desfazer" e 8 s. Toast com `err` sempre traz o que fazer em seguida. Não fecha por hover. `role="status"` para `ok`/`info`, `role="alert"` para `warn`/`err`. Erro de validação de campo é da linha do campo — nunca de toast.

### 4.17 Faixa de aviso em conteúdo

Para condição persistente da tela (não evento). Borda 1 px e fundo do tom, raio 8 px, padding `12px 14px`, ícone 15 px, título 13 px/600 no tom, corpo 12/17 px `text/body`, ação opcional à direita. Fica no topo da área de conteúdo, abaixo do cabeçalho.

### 4.18 Estado vazio

Dentro do card: 32 px de padding vertical, centralizado. Ícone 24 px `text/placeholder` → frase 13 px `text/muted` dizendo o que falta → ação primária quando existir caminho. Sem ilustração e sem texto motivacional.

### 4.19 Avatar

Circular, 24 px (topbar) ou 36 px (grade de alunos). Iniciais 10–13 px/700 em branco sobre tom derivado do nome. Na grade de alunos ganha anel de 2 px na cor do status. Foto substitui as iniciais quando existir.

### 4.20 Miniatura de frequência

Sparkline de barras: 8–12 barras de 3 px, raio 1 px, altura proporcional, `brand/600` nas semanas com treino e `border/default` nas vazias, gap 2 px. Sempre acompanhada do número — a miniatura é reforço, não dado.

### 4.21 Card de seção — `SectionCard`

**Acrescentado em 11/09/2026 (F68).** Enquadra um assunto dentro de uma tela que tem vários. Nasceu
da superfície da plataforma, onde quatro formulários de gravidade diferente — cadastro, marca,
situação e suporte — empilhavam direto sobre a página, sem nada dizendo onde um terminava.

Borda 1 px `border/default`, raio de card, **sem sombra** — sombra continua reservada à camada que
flutua (§2.6). Cabeçalho em `surface/sunken` com régua inferior `border/subtle`, padding `13px
16px`: é a mesma relação do `thead` da tabela com as linhas, e mantê-la faz formulário e tabela
lerem como um sistema só. Glifo opcional de 30 px em caixa de raio de controle. Título 13 px/600
`text/strong`, resumo 12 px `text/muted` com medida máxima de 68ch. Ações do cabeçalho à direita.

**Variante de perigo** (`tom="perigo"`): cabeçalho tingido a 6 % do tom `danger`, régua e caixa do
glifo a 22 %/30 %, glifo na cor cheia. Só para o bloco que **executa** o ato destrutivo — não para
toda seção importante. Um card já inativo volta ao neutro: a ação disponível ali é reativar, que não
destrói nada, e gastar o vermelho nele apaga o sinal onde ele importa.

### 4.22 Faixa de resumo — `SummaryStrip`

**Acrescentado em 11/09/2026 (F68).** Números que se leem de longe, acima de uma tabela. Grade
`auto-fit` com piso de 190 px — quatro células a 1280 px, duas a 768, uma a 360, sem media query.
Célula com borda de card, rótulo em caixa alta com tracking (o mesmo do `thead`), valor em
`type/heading` com `tabular-nums`, apoio 12 px `text/muted`. Marcação `<dl>` com um par por célula,
e não grade de `<div>` com número grande: o leitor de tela anuncia rótulo e valor juntos.

**Herda a §2.10 e estende a licença nominalmente:** quando a célula descreve um **estado**, ela tinge
o fundo a 7 % e ganha aresta superior de 3 px na cor cheia — as mesmas medidas do KPI do dashboard,
pelo mesmo motivo. **Sem estado, sem tinta:** "clientes" e "alunos na base" são fatos, não notícias,
e pintá-los gastaria a cor que a inadimplência precisa. Cada célula tingida carrega glifo **e**
rótulo textual — cor nunca é canal único.

Fora do dashboard, **só a lista de clientes** usa a faixa: é a tela de resumo do dono do SaaS, a
única da área que alguém olha de longe. Planos, índices e contratos são superfícies de trabalho e
seguem a §4.6.

### 4.23 Menu de ações de linha — `RowMenu`

**Acrescentado em 11/09/2026 (F68).** Quando uma linha de tabela tem três ou mais atos, eles vão para
um menu em vez de ocupar a coluna. A 1280 px — o monitor do balcão — quatro botões lado a lado
reservam mais de 400 px e empurram as colunas de número para fora da tela.

**Popover nativo, não `<div>` posicionado**, e a razão é técnica: a área de rolagem do `DataTable` é
`overflow-x: auto`, e todo menu absoluto dentro dela é cortado na linha próxima da borda. A camada
superior do navegador escapa do recorte e traz Esc, clique-fora e fechamento mútuo de graça. A
posição vem do retângulo do gatilho, medida na abertura: `anchor-name` resolveria isso em CSS puro
mas ainda não tem suporte no Firefox nem no Safari, e o menu cairia no centro da tela justamente
onde ninguém testaria. Vira para cima quando não há espaço abaixo.

Largura mínima 208 px, raio de card, `--ah-elev-2`. Item com padding `8px 10px`, glifo 16 px
`text/icon`, hover em `surface/sunken`. **Item destrutivo fica por último, separado por `<hr>`, e
veste o tom `danger` no glifo e no texto — nunca em fundo cheio.** Item com `href` renderiza `<a>` de
verdade; abrir em nova aba e copiar o endereço não se recuperam com JavaScript.

**Ação de leitura frequente fica fora do menu**, como botão visível: esconder um download atrás de
dois cliques cobra o preço do menu de quem não corre risco nenhum. **Linha sem ato nenhum não ganha
gatilho** — menu que abre lista inerte promete ação onde não há.

### 4.24 Campo com máscara — `MaskedField`

**Acrescentado em 11/09/2026 (F68).** O `Field` da §4.9 com formatação a cada tecla. A máscara roda
na **digitação**, nunca no `blur`: campo que só se formata ao sair deixa quem digita sem saber se já
pôs os catorze dígitos, e o erro aparece um campo tarde demais. O valor mascarado é o que vai no
`FormData` — a Server Action limpa a pontuação, que é o que permite ao servidor aceitar
`12.345.678/0001-95` e `12345678000195` do mesmo jeito.

Máscaras do painel (`lib/mascaras`): CPF, CNPJ, CEP, telefone, dinheiro e percentual. **Dinheiro
preenche pelos centavos, da direita para a esquerda** — é como a calculadora do balcão se comporta, e
evita o vaivém do cursor da máscara que caminha para a direita. **Percentual preserva o sinal
negativo**: mês de deflação existe, e uma máscara que come o `-` transforma queda em alta sem ninguém
ver.

---

## 5. Padrões

### 5.1 Ação sensível

1. Botão em `risk` (ou destrutivo em `err`) — nunca primário.
2. Modal com resumo do alvo e do efeito.
3. Motivo obrigatório; confirmação desabilitada sem texto.
4. Toast `ok` com "Desfazer" quando reversível.
5. Registro em auditoria com autor, data, IP, dispositivo e identificador.

Cobre: desbloqueio de catraca, revogação de consentimento, alteração de CPF, exclusão de biometria, cancelamento de assinatura, sessão elevada.

### 5.2 Formulário de ficha

Abas por assunto (pessoais, endereço, administrativo, plano, consentimentos, histórico). Grade de 2 colunas. Campo alterado e não salvo recebe badge "alterado" e a aba correspondente ganha ponto `warn`. Barra de ação fixa no fim do card com contagem ("3 alterações"), "Descartar" e "Salvar". Histórico é imutável e declara isso em texto.

### 5.3 Tabela de trabalho

Barra de filtros acima (busca 280 px com ícone à esquerda, selects, espaçador, primário à direita), cabeçalho, linhas, e rodapé com contagem e paginação. Ações por linha à direita, fantasmas de 26–28 px. Seleção múltipla adiciona barra de ação em lote no topo da tabela, em `canvas`.

### 5.4 Dado de saúde

Valor + unidade + faixa de referência + comparação com a medição anterior. Alerta clínico em faixa `err` orientando encaminhamento humano. Nunca palavra diagnóstica. Toda tela de bioimpedância declara "não é diagnóstico médico".

### 5.5 Revisão de OCR

Campo a campo, com valor lido, confiança e original ao lado; confiança baixa destaca a linha em `warn`. Nada é gravado antes da confirmação explícita do operador.

---

## 6. Conteúdo e escrita

- Português do Brasil, tratamento direto, sem gerúndio de espera ("Salvando…" e não "Estamos salvando").
- Título de tela é substantivo ("Inadimplência e cobrança"); botão é verbo ("Enviar cobrança").
- Erro diz o que aconteceu e o que fazer. Sem "Ops" e sem culpa ao operador.
- Número sempre com unidade e locale pt-BR.
- Sem emoji. Sem exclamação.
- Data relativa só até 7 dias ("há 2 dias"); depois, data absoluta.

---

## 7. Acessibilidade

- Contraste mínimo 4,5:1 em texto de corpo. `text/muted` em 12 px sobre `surface` passa; não usar `text/placeholder` para informação.
- Todo controle interativo alcançável por Tab, na ordem visual. Foco visível: `box-shadow: 0 0 0 3px rgba(0,112,123,.12)` + borda `brand/600`.
- Modal captura o foco e devolve ao gatilho ao fechar; `Esc` fecha.
- Switch com `role="switch"` e `aria-label`; toast com `role="status"`/`alert`; tabela com cabeçalho associado.
- Estado nunca só por cor — badge sempre com ícone e texto.

---

## 8. Checklist de revisão

**Tokens**
- [ ] Nenhum hex fora das tabelas da seção 2
- [ ] Semântica via `bdg()`, não cor solta
- [ ] `brand/accent` só no ponto do logotipo

**Layout**
- [ ] Conteúdo em `max-width: 1180px`
- [ ] Só a área de conteúdo rola
- [ ] Cabeçalho e linhas de tabela com colunas idênticas
- [ ] Coluna de texto com `minmax(0,1fr)` + ellipsis
- [ ] Valor e data com `tabular-nums`; monetário à direita

**Componentes**
- [ ] Controles em 36 px; 28 px dentro de tabela
- [ ] Um único botão primário por tela
- [ ] Card sem sombra; sombra só em camada flutuante
- [ ] Select nativo só para lista curta; lista longa é combobox
- [ ] Campo de data digitável com máscara, calendário como apoio

**Feedback**
- [ ] Toast só para ação já executada; erro de campo na linha do campo
- [ ] Toast `err` persistente e com próximo passo
- [ ] Ação sensível com modal, motivo obrigatório e auditoria

**Saúde e privacidade**
- [ ] Medição com faixa, comparação e aviso de não-diagnóstico
- [ ] Consentimento com versão, data, IP e dispositivo
- [ ] Histórico declarado como imutável
