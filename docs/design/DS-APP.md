# DS-APP — Design System do Aplicativo do Aluno

Academia ArenaHub · plataforma ArenaHub
Arquivo de referência: `App Mobile.dc.html`
Versão 2.0 — rebrand azul alinhado ao totem, avaliação 3D na aba Evolução

---

## 1. Sobre o produto

App do aluno. É a superfície **pessoal** da plataforma: carteirinha, plano, pagamento, evolução física e ranking. O painel web é onde a academia escreve o dado; o totem é o terminal compartilhado da recepção; o app é o único lugar onde o aluno tem a leitura completa da própria evolução, com histórico e laudo.

### Princípios

**Uma coisa por tela.** Cada aba responde a uma pergunta: como estou? o que devo? como evoluí? onde estou no grupo? Nada de dashboard com tudo ao mesmo tempo.

**O alerta vem antes do conteúdo.** Fatura vencida, bloqueio de catraca e achado clínico aparecem no topo da Home e da aba correspondente, nunca enterrados.

**Escuro por padrão.** O app é usado na academia, com luz baixa, celular na mão e suor. Fundo escuro, contraste alto, alvos grandes.

**Mesma marca em todas as superfícies.** App, totem e painel são a mesma Clínica de Musculação: azul royal sobre preto, mesma escala de superfícies e mesmos tons semânticos. Um aluno que vê a avaliação no totem reconhece a mesma leitura no app.

**O app nunca diagnostica.** Mostra medição, faixa, comparação e histórico. Interpretação clínica é do profissional, e toda tela de saúde declara isso.

**Privacidade opt-in.** Ranking é opcional e pode ser desligado dentro do app. Desligado, o aluno some da lista dos outros.

### Contexto

| Aspecto | Definição |
|---|---|
| Moldura | iPhone, 390 × 780 px (`ios-frame.jsx`, `dark="true"`) |
| Safe area superior | 58 px de `padding-top` no shell |
| Entrada | Toque, uma mão, polegar na metade inferior |
| Densidade | Confortável: controles de 44–48 px, corpo de 14–15 px |
| Locale | pt-BR — `R$ 129,90`, `dd/mm`, `92,25 kg` |
| Marca | Clínica de Musculação · "Disciplina hoje, resultados sempre." |
| Versão exibida | Rodapé do login (`v2.3.0`) |

---

## 2. Tokens

### 2.1 Cor — superfícies

Três níveis de escuro. Nunca mais do que isso na mesma tela.

| Token | Hex | Uso |
|---|---|---|
| `bg/app` | `#0A0B0D` | Fundo do app, poço interno (trilho de barra, campo dentro de card) |
| `bg/surface` | `#121417` | Card padrão, campo de texto, sheet, tile de atalho |
| `bg/raised` | `#1A2032` | Card em destaque (plano, fatura), avatar, chip inativo, barra vazia |
| `border/default` | `#232A3D` | Borda de card, input, botão secundário, divisor interno |
| `brand/frame` | `#0D1226` | Miolo da moldura de gradiente da marca |
| `scrim` | `rgba(10,11,13,.7)` | Fundo atrás do sheet da carteirinha |
| `ink/on-accent` | `#FFFFFF` | Texto e ícone sobre azul de ação |

Mesma escala do totem: base `#0A0B0D`, superfície `#121417`, borda `#232A3D`. `bg/raised` é a variação azulada do app para o card que precisa se destacar dentro da tela.

### 2.2 Cor — texto

| Token | Hex | Uso |
|---|---|---|
| `text/primary` | `#F5F7F9` | Título, valor, corpo forte |
| `text/secondary` | `#A6AEB9` | Descrição, label, métrica secundária |
| `text/muted` | `#7B8491` | Metadado, timestamp, matrícula, placeholder |

### 2.3 Cor — marca

| Token | Hex | Uso |
|---|---|---|
| `accent/solid` | `#4D7CFF` | Barra de frequência, aba de segmento ativa, chip de período ativo, medalhão da própria linha, "Atual" no comparativo |
| `accent/gradient` | `linear-gradient(100deg,#5B86FF,#3E63E8)` | **Ação.** Fundo de todo botão primário |
| `accent/gradient-hover` | `linear-gradient(100deg,#6B92FF,#4A6FF0)` | Hover de botão primário |
| `accent/ink` | `#7DA2FF` | Traço de ícone sobre escuro, marca |
| `accent/text` | `#8FB0FF` | Link, texto de botão fantasma, hover de borda, rótulo de eixo, overline azul |
| `accent/soft` | `#C9D9FF` | Hover de link |
| `accent/tint` | `rgba(77,124,255,.12)` | Fundo da própria linha no ranking |
| `brand/mark` | `linear-gradient(145deg,#7DA2FF,#2E4FD0 55%,#9DB8FF)` | Moldura do símbolo da marca |

Regra: **gradiente é ação, tinta é informação.** Botão primário sempre com `accent/gradient` + texto branco; nunca `accent/solid` chapado como fundo de botão. `accent/ink` para traço de ícone, `accent/text` para texto — não inverter, o mais claro é o que precisa de contraste em corpo pequeno.

### 2.4 Cor — semântica

Quatro tons. Tripla `[texto, fundo 16%, borda 34%]` — mais opaca que no painel, porque o fundo aqui é escuro.

| Tom | Texto | Fundo | Borda | Significado |
|---|---|---|---|---|
| `ok` | `#3DDC84` | `rgba(61,220,132,.16)` | `rgba(61,220,132,.34)` | Plano ativo, pago, métrica melhorando |
| `warn` | `#F5A524` | `rgba(245,165,36,.16)` | `rgba(245,165,36,.34)` | Fatura vencida, métrica piorando, sequência |
| `err` | `#FF6B6B` | `rgba(255,107,107,.16)` | `rgba(255,107,107,.34)` | Bloqueio, falha, alerta clínico |
| `info` | `#6AB0FF` | `rgba(106,176,255,.16)` | `rgba(106,176,255,.34)` | Em aberto, processando, spinner |

No código: `T.ok[0]` texto, `T.ok[1]` fundo, `T.ok[2]` borda. Delta de métrica usa `ok` quando melhora e `warn` quando piora — nunca `err`, que é reservado a falha e alerta clínico.

### 2.5 Tipografia

**Inter** na interface. **JetBrains Mono** em identificador: matrícula, chave PIX, referência de fatura.

| Papel | Tamanho / linha | Peso | Cor |
|---|---|---|---|
| Título de login | 26 / 32 px | 700 | `text/primary` |
| Saudação / título de tela | 24 / 30 px | 700 | `text/primary` |
| Valor grande (fatura, peso) | 30 px | 700 | `text/primary` |
| Título de sheet / bloco | 18 px | 700 | `text/primary` |
| Título de card | 16 px | 600 | `text/primary` |
| Rótulo de botão primário | 16 px | 700 | `ink/on-accent` |
| Rótulo de botão secundário | 15 px | 600 | `accent/hover` |
| Corpo | 14 / 20 px | 400 | `text/secondary` |
| Label de campo | 13 px | 600 | `text/secondary` |
| Rótulo de tile / chip | 13 px | 600 | `text/primary` |
| Metadado | 12 px | 400 | `text/muted` |
| Rótulo de aba | 10–11 px | 600 | conforme estado |

Mínimo 10 px, só no rótulo da tab bar. Todo número em série leva `font-variant-numeric: tabular-nums`. Títulos com `letter-spacing: -0.01em`.

### 2.6 Espaçamento

Escala de 2 px: **2 · 4 · 5 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 24 · 32**.

| Contexto | Valor |
|---|---|
| Padding lateral do conteúdo | 20 px |
| Padding vertical da área rolável | `8px … 20px` |
| Padding de card | `18px 20px` |
| Padding de sheet | `20px 20px 32px` |
| Gap entre cards | 14 px |
| Gap interno de card | 8–12 px |
| Gap label→campo | 6 px |
| Gap em grade de atalhos | 10 px |
| Safe area superior | 58 px |

### 2.7 Raio e forma

| Elemento | Raio |
|---|---|
| Sheet | `20px 20px 0 0` |
| Card, bloco de QR | 16 px |
| Botão, campo, tile, chip de período | 12 px |
| Barra de frequência | 3 px |
| Barra de progresso | 2 px |
| Badge, chip de status | 999 px (pill) |
| Avatar, medalhão | circular |

Bordas de 1 px em `border/default`. Sem sombra em lugar nenhum — a hierarquia vem dos três níveis de superfície.

### 2.8 Alturas

| Elemento | Altura |
|---|---|
| Botão primário / campo | 48 px |
| Botão secundário em card | 44 px |
| Tile de atalho | 64 px |
| Aba de segmento (PIX/Cartão, Freq./Evolução) | 36 px |
| Chip de período | 32 px |
| Badge / chip de status | 24–26 px |
| Linha de ranking | 44 px |
| Tab bar | 56 px + safe area |
| Avatar de carteirinha | 44 px |

Nada tocável abaixo de **44 px**, exceto o chip de período (32 px, com área de toque estendida pelo padding do container).

### 2.9 Ícones

Traço, `viewBox` 24×24, `stroke-width: 2`, `linecap/linejoin: round`, sem fill. 13 px em badge, 16 px em tile e linha, 17 px em botão primário, 20 px na tab bar, 34 px em spinner. Cor: `accent/hover` sobre escuro, `currentColor` dentro de botão e badge, cor do tom em estado semântico.

### 2.10 CSS global

O único CSS fora do inline — tudo o que não pode ser expresso em `style`:

```css
body { margin: 0; background: #F5F7F9; -webkit-font-smoothing: antialiased; }
a { color: #8FB0FF; }
a:hover { color: #C9D9FF; }
input::placeholder { color: #565E69; }

@keyframes ah-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }
@keyframes ah-spin  { to { transform: rotate(360deg) } }
```

Fontes: `Inter` 400–800 e `JetBrains Mono` 400/600 via Google Fonts com `preconnect`.

O `#F5F7F9` do `body` é o fundo da **página que hospeda a moldura**, não do app — dentro do frame o fundo é `bg/app`.

**Estados interativos** usam `style-hover` / `style-active` no elemento (o DC compila para pseudo-estado), nunca classe CSS:

```html
<!-- botão primário -->
style-hover="background:linear-gradient(100deg,#6B92FF,#4A6FF0)"
<!-- botão secundário, campo, tile -->
style-hover="border-color:#8FB0FF"
<!-- campo em foco -->
style-focus="border-color:#8FB0FF;outline:2px solid #8FB0FF;outline-offset:2px"
```

---

## 3. Estrutura e navegação

### 3.1 Shell

```
┌─────────────────────────┐
│      safe area 58px     │
├─────────────────────────┤
│                         │
│   área rolável          │  flex:1; overflow:auto
│   padding 8px 20px 20px │  max 3 níveis de superfície
│                         │
├─────────────────────────┤
│  ⌂     ⊞     ↗     ♛    │  tab bar 56px
│ Home  Pagar  Evol. Rank │
└─────────────────────────┘
```

`position: relative; display: flex; flex-direction: column; height: 100%` no shell. Só a área central rola. Sheets e overlays são `position: absolute; inset: 0` sobre o shell, com `z-index: 20`.

### 3.2 Fluxo de navegação

```
                    ┌─────────┐
                    │  Login  │  sem tab bar
                    └────┬────┘
                         │ entrar
        ┌────────────────┼────────────────┬───────────────┐
        ▼                ▼                ▼               ▼
   ┌─────────┐     ┌──────────┐    ┌───────────┐   ┌──────────┐
   │  Home   │◄───►│  Pagar   │◄──►│ Evolução  │◄─►│ Ranking  │
   └────┬────┘     └────┬─────┘    └─────┬─────┘   └────┬─────┘
        │               │                │              │
        │ carteirinha   │ PIX │ Cartão   │ 30D 90D      │ Freq. │
        ▼               ▼                │ 6M  1A       │ Evol. │
   ┌─────────┐    ┌───────────┐          │              │
   │  Sheet  │    │ aguardando│          ▼              ▼
   │   QR    │    │ confirmação│     gráfico +      ranking +
   └─────────┘    └───────────┘      tabela        conquistas
```

As quatro abas são irmãs: qualquer uma alcança qualquer outra em um toque, sem hierarquia e sem botão "voltar". Login é a única tela fora do shell de abas (`isTabs: scr !== 'login'`).

Atalhos da Home (Pagar, Evolução, Ranking) **navegam para a aba**, não abrem tela nova — o estado da tab bar acompanha. A carteirinha é a única exceção: abre como sheet sobre a Home, porque é consultada em 3 segundos na catraca e voltar custaria um toque a mais.

### 3.3 Tab bar

Quatro itens, `border-top: 1px solid border/default`, fundo `bg/app`, 56 px + safe area inferior. Cada item: ícone 20 px sobre rótulo 10–11 px/600, gap 4 px, `flex: 1`.

| Estado | Ícone | Rótulo |
|---|---|---|
| Ativa | `accent/text` | `accent/text`, peso 700 |
| Inativa | `text/muted` | `text/muted`, peso 600 |

A aba com pendência (fatura vencida) mostra ponto de 6 px em `warn` no canto superior direito do ícone.

| Aba | Pergunta que responde | Conteúdo |
|---|---|---|
| **Home** | Como estou? | Plano, carteirinha, frequência, atalhos |
| **Pagar** | O que devo? | Fatura aberta, PIX/cartão, histórico |
| **Evolução** | Como evoluí? | Avaliação 3D do mês, gráfico de peso, período, tabela, laudo |
| **Ranking** | Onde estou no grupo? | Top 6, conquistas, opt-in |

### 3.4 Abas de segmento (dentro de tela)

Diferentes da tab bar: alternam conteúdo **dentro** da mesma aba, sem mudar de tela.

Container: `bg/surface`, raio 12 px, padding 4 px, `display: flex`. Cada segmento: `flex: 1`, altura 40 px, raio 9 px, 14 px/600. Ativo: fundo `accent/solid`, texto branco. Inativo: fundo transparente, texto `text/secondary`.

Usos atuais: **PIX / Cartão** na aba Pagar; **Frequência / Evolução** na aba Ranking.

Regra: máximo 2–3 segmentos. Mais do que isso vira chip rolável (como o seletor de período).

### 3.5 Chips de período

`30D · 90D · 6M · 1A` na aba Evolução. Chip de 30 px, raio 999 px, 12 px/600. Ativo: fundo `accent/solid`, texto branco. Inativo: fundo `bg/app`, texto `text/secondary`. Mudar o período recalcula gráfico e tabela na hora, sem carregar tela.

---

## 4. Componentes

### 4.1 Campo de texto

Label 13 px/600 `text/secondary` → input 48 px, fundo `bg/surface`, borda 1 px `border/default`, raio 12 px, padding lateral 14 px, 15 px `text/primary`. Placeholder em `#565E69`. Foco: `style-hover="border-color:#4FD5E3"`. Sempre com `autocomplete` correto (`username`, `current-password`) e `<label for>` associado.

### 4.2 Botões

| Variante | Fundo | Borda | Texto | Uso |
|---|---|---|---|---|
| Primário | `accent/gradient` → hover `accent/gradient-hover` | — | branco 16 px/700 | Uma ação principal por tela |
| Secundário | transparente | `border/default` → hover `accent/text` | `accent/text` 15 px/600 | Ação de apoio |
| Neutro | transparente | `border/default` | `text/primary` 15 px/600 | Fechar, cancelar |
| Tile | `bg/surface` | `border/default` → hover `accent/text` | `text/primary` 13 px/600, ícone `accent/ink` | Atalho da Home |

Altura 48 px (principal), 44 px (dentro de card e sheet), 64 px (tile). Raio 12 px. `font-family: inherit` obrigatório.

### 4.3 Card

`bg/surface` (ou `bg/raised` quando é o card em destaque da tela), raio 16 px, padding `18px 20px`, `display: flex; flex-direction: column; gap: 8–12px`. Sem borda quando o contraste de superfície já separa; com borda `border/default` quando está sobre superfície de mesmo nível.

Cabeçalho interno: título 16 px/600 à esquerda, badge ou métrica à direita, `justify-content: space-between`. Divisor interno: `border-top: 1px solid border/default; padding-top: 12px`.

### 4.4 Badge

Pill de 24–26 px, padding lateral 10–12 px, gap 6 px, 12–13 px/600, `white-space: nowrap`. Fundo, borda e texto da tripla do tom; ícone 13–14 px em `currentColor`.

### 4.5 Card de plano

`bg/raised`. Nome do plano 16 px/600 + badge de status na mesma linha; descrição 14/20 px `text/secondary`; botão primário de 44 px aparece só quando há pendência (`sc-if` em `overdue`).

### 4.5b Marca

Quadrado de 52 px com `padding: 1px` e fundo `brand/mark`; dentro, miolo de raio 15 px em `brand/frame` com o símbolo halter + batimento (SVG de 32 px, traço `accent/ink`, `stroke-width: 1.7`). Usado no login. Não substituir por iniciais.

### 4.6 Card de frequência

Título "Frequência · 30 dias" + contagem tabular à direita. Abaixo, sparkline de 21 barras: largura `flex: 1`, gap 5 px, altura 56 px, raio 3 px; barra vazia com 8 px de altura em `bg/raised`, barra com treino em 55% ou 100% em `accent/solid`. Divisor, linha de conquista (ícone 16 px `warn` + texto 14 px) e timestamp 12 px `text/muted`.

### 4.7 Grade de atalhos

`grid-template-columns: repeat(3, 1fr); gap: 10px`. Tile de 64 px em coluna: ícone 16 px `accent/hover` sobre rótulo 13 px/600, gap 6 px.

### 4.8 Sheet da carteirinha

Overlay `position: absolute; inset: 0`, scrim `rgba(10,11,13,.7)`, `align-items: flex-end`, `z-index: 20`. Painel: largura total, `bg/surface`, raio `20px 20px 0 0`, padding `20px 20px 32px`, gap 14 px, centralizado.

Ordem: alça de 36 × 4 px em `border/default` → linha de identidade (avatar 44 px, nome 16 px/600, matrícula em mono 12 px `text/muted`, plano/unidade 12 px à direita) → QR de 180 px em bloco branco de raio 16 px e padding 16 px → barra de renovação (trilho 4 px `bg/app`, preenchimento `accent/hover`) com legenda "Código renova em 28 s · token de uso único, sem dados pessoais" → botão neutro "Fechar".

O QR **sempre** sobre branco. Token de uso único, sem dado pessoal embutido — e o app diz isso ao aluno.

### 4.9 Bloco de fatura

`bg/raised`. Referência 13 px `text/secondary` + badge de status (`warn` "Vencida" / `info` "Em aberto") na mesma linha; valor 30 px/700 tabular e vencimento 13 px tabular alinhados pela baseline.

### 4.10 Estado de espera

Card centralizado: spinner 34 px em `info` com `ah-spin 1.4s linear infinite` → título 18 px/700 → explicação 14/20 px → badge `info` "Processando" → botão secundário para voltar.

O texto diz o que acontece se o aluno sair da tela ("avisaremos quando o pagamento for confirmado"). Nunca prender o aluno numa tela de espera.

### 4.10b Card de avaliação 3D

O espelho da tela "Avaliação do mês" do totem, no topo da aba Evolução. Card de raio 16 px, `overflow: hidden`, sem padding externo.

```
┌────────────────────────────────────┐
│ COMPOSIÇÃO DE AGOSTO               │ chip 28px, 11px/700
│                                    │
│        render 3D · 200px           │ object-position: 52% center
│                                    │
│ Avaliação de agosto            80  │ 16px/700 · 22px/800
│ medida na recepção em 03/08 PONTOS │ 12px muted · 10px/700 accent
├────────────────────────────────────┤
│ EVOLUÇÃO CORPORAL        +2,40 kg  │ 12px/700 accent · 15px/700 tom
│ Início    ▬▬▬▬▬▬▬▬░░     89,85 kg  │ barra 8px, raio 4px
│ Progresso ▬▬▬▬▬▬▬▬▬░     90,60 kg  │
│ Atual     ▬▬▬▬▬▬▬▬▬▬     92,25 kg  │ azul
│ EVOLUÇÃO MUSCULAR         +2,4 kg  │ verde no atual
│ EVOLUÇÃO GORDURA          −1,9 pp  │ laranja no atual
├────────────────────────────────────┤
│ Render ilustrativo…                │ 11/16px muted
└────────────────────────────────────┘
```

Render 3D de 200 px de altura com gradiente de legibilidade (topo 35%, base 72%), chip de período no canto e, na base, título + pontuação alinhados por `space-between`.

Cada eixo: overline `accent/text` 12 px/700 com o delta agregado à direita na cor semântica; três linhas de fase com rótulo de 64 px, barra `flex: 1` e valor de 60 px à direita (`tabular-nums`, `nowrap`). Fase atual na cor semântica do eixo (`accent/solid` no corporal, `ok` no muscular, `warn` na gordura); fases anteriores em `border/default`.

Rodapé obrigatório: o render é ilustrativo, os números vêm da balança.

### 4.11 Gráfico de evolução

SVG de 300 × 130 px (área útil x: 8–292, y: 18–112). Linha em `accent/text`, `stroke-width: 2.5`, ponto final de 4 px, três linhas-guia em `border/default`. Eixo escalado ao min/max do período, não ao zero — a variação de peso é pequena e o zero achataria a curva. Abaixo, rótulos de extremo 12 px `text/muted` e alternância para tabela.

### 4.12 Tabela de evolução

Linhas de 44 px separadas por `border-top: 1px solid border/default`: data 13 px `text/secondary`, valor 14 px/600 tabular, delta 13 px/600 na cor semântica (`ok` se caiu, `warn` se subiu, `text/muted` na primeira linha, que não tem comparação).

### 4.13 Linha de ranking

56 px, gap 12 px: medalhão circular de 28 px (fundo `bg/raised`, ou `accent/solid` com texto branco quando é o aluno), nome 15 px (peso 700 na própria linha), métrica 14 px `text/secondary` tabular à direita. A própria linha recebe fundo `accent/tint`.

Ranking é **opt-in**: com o switch desligado, a lista dá lugar a um estado vazio explicando que o aluno não aparece para os outros e oferecendo participar.

### 4.14 Estado vazio

Dentro do card: 24 px de padding vertical, centralizado. Ícone 24 px `text/muted` → frase 14/20 px `text/secondary` dizendo o que falta → ação secundária quando houver caminho. Sem ilustração, sem texto motivacional.

---

## 5. Padrões

### 5.1 Pendência financeira

1. Badge `warn` no card de plano da Home.
2. Botão primário "Pagar agora" dentro do próprio card.
3. Ponto `warn` no ícone da aba Pagar.
4. Fatura no topo da aba Pagar, com valor e vencimento.

Um só caminho, repetido onde o aluno olha. Nunca bloquear a navegação do app por pendência — o bloqueio é da catraca, não do aplicativo.

### 5.2 Pagamento PIX

Segmento PIX/Cartão → QR + chave copiável (mono, botão "copiar" que vira "copiado ✓") → "Já paguei" → estado de espera → confirmação. A confirmação real vem do backend; o app nunca afirma pagamento por ação do usuário.

### 5.3 Dado de saúde

Valor + unidade + comparação com a medição anterior + faixa quando existir. Delta em `ok`/`warn`, nunca `err`. Achado que exige atendimento aparece em card `err` orientando procurar a recepção. Toda tela de bioimpedância declara "não é diagnóstico médico".

### 5.3b Continuidade com o totem

A avaliação é mensal e medida na recepção. As três superfícies mostram a mesma medição em profundidades diferentes:

| Superfície | O que mostra |
|---|---|
| Painel web | Revisão campo a campo do OCR, confirmação, laudo completo, alerta clínico |
| Totem | Resumo somente leitura: pontuação, segmentos, 6 métricas, evolução 3D |
| App | Tudo do totem + faixas de referência, regiões do corpo, análise escrita e PDF |

O card de avaliação 3D do app usa os mesmos números, as mesmas três fases e o mesmo render do totem — é o que faz o "veja no aplicativo" do totem entregar o que promete.

### 5.4 Privacidade

Ranking com opt-in explícito e reversível dentro do app. Carteirinha com token de uso único e sem dado pessoal. Nome de terceiro no ranking sempre abreviado ("Fê Costa", "Paulo H.").

---

## 6. Conteúdo e escrita

- Português do Brasil, tratamento direto ao aluno ("Seu acesso já está liberado").
- Título é substantivo ("Evolução"); botão é verbo ("Pagar agora", "Abrir carteirinha").
- Estado de espera diz o que fazer e quanto tempo leva.
- Número sempre com unidade e locale pt-BR.
- Sem emoji, sem exclamação, sem gamificação forçada ("Mandou bem!" não).
- Data relativa só até 7 dias; depois, data absoluta.

---

## 7. Acessibilidade

- Contraste mínimo 4,5:1 em corpo. `text/muted` só em metadado, nunca em informação necessária.
- Alvo mínimo de 44 px.
- Todo campo com `<label for>` e `autocomplete` correto.
- Estado nunca só por cor: badge sempre com ícone e texto; barra de frequência sempre acompanhada do número.
- Sheet fecha por botão explícito (o scrim sozinho não basta para alvo de polegar).
- `ah-pulse` e `ah-spin` são os únicos movimentos; nada pisca fora deles.

---

## 8. Checklist de revisão

**Tokens**
- [ ] Nenhum hex fora das tabelas da seção 2
- [ ] Máximo 3 níveis de superfície por tela
- [ ] Botão primário com `accent/gradient` e texto branco — nunca azul chapado
- [ ] `accent/ink` em traço de ícone, `accent/text` em texto — não invertidos
- [ ] Delta de métrica em `ok`/`warn`, nunca `err`
- [ ] Superfícies iguais às do totem (`#0A0B0D` / `#121417` / `#232A3D`)

**Layout**
- [ ] Só a área central rola; tab bar e safe area fixas
- [ ] Padding lateral de 20 px em todo conteúdo
- [ ] Sem sombra em nenhum elemento
- [ ] Números em série com `tabular-nums`

**Navegação**
- [ ] Quatro abas irmãs, qualquer uma em um toque
- [ ] Atalho da Home muda a aba, não empilha tela
- [ ] Aba com pendência marcada com ponto `warn`
- [ ] Segmento interno com no máximo 3 opções

**Componentes**
- [ ] Nada tocável abaixo de 44 px
- [ ] Um botão primário por tela
- [ ] QR sempre sobre branco
- [ ] Estado de espera com saída e explicação

**Saúde e privacidade**
- [ ] Aviso de não-diagnóstico em toda tela de medição
- [ ] Render 3D declarado como ilustrativo, com números da balança
- [ ] Ranking opt-in e reversível no app
- [ ] Carteirinha declarada como token de uso único
- [ ] Nome de terceiro sempre abreviado
