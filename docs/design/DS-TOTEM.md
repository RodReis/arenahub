# DS-TOTEM — Design System do Totem de Autoatendimento

Clínica de Musculação · plataforma ArenaHub
Arquivo de referência: `Totem.dc.html`
Versão 2.1 — rebrand azul, totem somente leitura, evolução 3D, home pública em grade densa

---

## 1. Sobre o produto

O totem é um terminal vertical instalado na recepção da academia. Ele tem dois modos de uso que nunca se misturam:

**Área externa (pública)** — a tela que qualquer pessoa vê ao passar. Funciona como mídia da academia: comunica marca, conteúdo, eventos e patrocínio. Nenhum dado de aluno aparece aqui. Todo o conteúdo é configurável pelo painel administrativo.

**Área interna (autenticada)** — depois que o aluno se identifica. Mostra situação do plano, avaliação física do mês, evolução, pagamentos e ranking. **O totem é somente leitura para avaliação**: ele não realiza medição de bioimpedância. A medição e o lançamento dos dados acontecem no painel web da recepção. O totem apenas exibe o que já foi confirmado.

### Contexto físico

| Aspecto | Definição |
|---|---|
| Formato de tela | 1080 × 1920 px (retrato, 9:16) |
| Distância de leitura | 60–100 cm, aluno em pé |
| Entrada | Toque capacitivo, sem teclado físico |
| Iluminação | Ambiente de academia, luz alta e reflexos — exige contraste forte |
| Uso típico | 20–90 segundos por sessão |
| Acessibilidade | Alto contraste alternável na tela pública; alvos grandes; sem gestos complexos |

---

## 2. Fundamentos visuais

### 2.1 Cor

A paleta parte da identidade da Clínica de Musculação: azul royal metálico sobre preto. O azul é a cor de ação e de destaque; o fundo é escuro para leitura à distância e para sobreviver ao reflexo de luz da academia.

**Superfícies**

| Token | Hex | Uso |
|---|---|---|
| `bg/base` | `#0A0B0D` | Fundo de todas as telas |
| `bg/surface` | `#121417` | Cards, botões secundários, listas |
| `border/hairline` | `#1A2032` | Divisores internos, linhas de tabela |
| `border/default` | `#232A3D` | Borda de card e de botão secundário (2 px) |

**Marca e ação**

| Token | Hex | Uso |
|---|---|---|
| `brand/500` | `#4D7CFF` | Cor primária. Anéis, barras de progresso, indicadores |
| `brand/400` | `#5B86FF` | Início do gradiente de CTA |
| `brand/600` | `#3E63E8` | Fim do gradiente de CTA |
| `brand/300` | `#7DA2FF` | Ícones sobre fundo escuro |
| `brand/200` | `#8FB0FF` | Texto de apoio em azul, rótulos de seção, links |
| `brand/tint` | `rgba(77,124,255,.14)` | Fundo de ícone tonal, linha destacada de tabela |

**Gradiente de ação** — usado somente em CTA primário:
`linear-gradient(100deg, #5B86FF, #3E63E8)` · texto `#FFFFFF` · sombra `0 8px 32px rgba(77,124,255,.25)`

**Texto**

| Token | Hex | Uso |
|---|---|---|
| `text/primary` | `#FFFFFF` | Títulos, valores, rótulos de botão |
| `text/secondary` | `#A6AEB9` | Descrições, metadados, legendas |
| `text/tertiary` | `#565E69` | Cabeçalho de tabela, comparativos "vs anterior" |

**Semântica**

| Token | Hex | Significado |
|---|---|---|
| `success` | `#3DDC84` | Plano ativo, pagamento pago, métrica em faixa boa |
| `warning` | `#F5A524` | Pendência financeira, métrica acima da faixa |
| `danger` | `#FF6B6B` | Alerta clínico que exige atendimento humano |

Cada estado semântico usa a mesma receita: borda `2px solid rgba(cor,.4)`, fundo `rgba(cor,.10)`, ícone e título na cor cheia, corpo do texto em branco.

**Regras de cor**

- Máximo dois níveis de superfície por tela (`bg/base` + `bg/surface`).
- O gradiente azul é exclusivo de CTA primário. Nunca em card, header ou fundo de tela.
- Laranja e vermelho nunca decoram: significam pendência e alerta clínico.
- Verde nunca é cor de botão — só de estado.

### 2.2 Tipografia

**Inter** para toda a interface. **JetBrains Mono** apenas para o campo de CPF (leitura dígito a dígito).

| Papel | Tamanho / linha | Peso | Onde |
|---|---|---|---|
| Hero | 72 / 78 px | 900 | Headline da tela pública |
| Título de tela | 64 / 68 px | 800 | "Minha área", "Pagamentos", "Avaliações" |
| Título de tela médio | 56 / 62 px | 800 | Telas com muito conteúdo (avaliação, evolução 3D) |
| Kicker | 22 px, tracking .16em | 800 | "MUSCULAÇÃO · SAÚDE · PERFORMANCE" |
| Valor grande | 44–56 px | 800 | Pontuação, valor de fatura, métrica principal |
| Título de card | 28 px | 700 | Nome do módulo, mês da fatura |
| Rótulo de botão | 26–30 px | 700 | Todos os botões |
| Corpo | 23–26 px | 400–500 | Descrições e avisos |
| Metadado | 19–21 px | 500–600 | Legendas, sub-rótulos, status |
| Cabeçalho de tabela | 20 px, tracking .06em | 700 | DATA, PESO, GORDURA |

Regras: mínimo absoluto **19 px** (nada menor é legível a 80 cm). Números sempre com `font-variant-numeric: tabular-nums`. Títulos com `letter-spacing: -0.02em`. Texto corrido com `text-wrap: pretty`.

### 2.3 Espaçamento e forma

Escala base 4 px, trabalhando em múltiplos de 8: **8 · 12 · 16 · 20 · 24 · 28 · 32 · 36 · 40 · 56 · 64**.

| Contexto | Valor |
|---|---|
| Padding da tela pública | 44 px topo / 52 px lateral / 36 px base |
| Padding das telas internas | 64 px lateral, 64 px topo, 24 px base |
| Gap entre blocos verticais | 28–36 px |
| Gap em grade de cards | 20–24 px |
| Padding de card | 22–32 px |

**Raios**

| Elemento | Raio |
|---|---|
| Moldura do totem | 46 px |
| Card, bloco de mídia | 24–28 px |
| Botão grande | 22–24 px |
| Ícone tonal | 16–20 px |
| Chip / pill | 999 px |
| Barra de progresso | metade da altura |

**Bordas** sempre 2 px — a 1 px desaparece a distância de leitura.

### 2.4 Alvos de toque

| Elemento | Altura mínima |
|---|---|
| CTA primário | 112–116 px |
| Botão secundário | 88–96 px |
| Tecla do teclado numérico | 132 px |
| Card-módulo tocável | 210 px |
| Linha de lista (não tocável) | 100–112 px |

Nada tocável abaixo de **88 px**.

### 2.5 Ícones

Traço, 24×24 viewBox, `stroke-width` 1.7–2.2, `stroke-linecap/linejoin: round`, sem preenchimento. Tamanho 22–52 px conforme contexto. Sobre fundo escuro: `brand/300`. Dentro de CTA: `currentColor`. Em estado semântico: a cor do estado.

Ícone tonal = quadrado de 56–76 px, raio 16–20 px, fundo `brand/tint`, glifo em `brand/300`.

### 2.6 Movimento

Discreto. O totem é lido, não assistido.

| Animação | Definição | Uso |
|---|---|---|
| `ah-pulse` | opacidade .7 → .15, 5 s, infinito | Ponto de acento no hero |
| `ah-spin` | rotação 360°, 1.4 s linear | Spinner de confirmação de pagamento |
| Barra de sessão | `transition: width 1s linear` | Contagem regressiva |

Nada pisca, nada desliza, nada dança. Alto contraste desliga todos os efeitos decorativos.

---

## 3. Componentes

### 3.1 Moldura do totem

Contêiner de 1080 × 1920 px com borda metálica de 2 px (`linear-gradient(145deg,#D8DEE5,#8D97A3 45%,#E9EDF1)`), raio externo 48 px, interno 46 px, `overflow: hidden`. Glow azul opcional: `0 0 64px rgba(77,124,255,.14), 0 24px 64px rgba(10,11,13,.4)` — removido em alto contraste.

### 3.2 Cabeçalho de marca (externo)

Logo em bloco de 84 px (moldura em gradiente azul, símbolo halter + batimento), nome da academia em 32 px/800, slogan em 20 px/600 azul com tracking .04em, e à direita o botão de alto contraste. Altura total 84 px.

### 3.3 Bloco hero

Kicker azul → headline em duas linhas, sendo a segunda em gradiente azul recortado no texto (`background-clip: text`). Atrás, forma angular diagonal (`clip-path: polygon(38% 0,100% 0,62% 100%,0 100%)`) com gradiente azul a 34% de opacidade, mais um ponto pulsante. A forma angular é o único elemento decorativo permitido na tela pública.

### 3.4 Bloco de mídia (reel / vídeo)

Card de raio 28 px em altura total da coluna esquerda, imagem/poster em `object-fit: cover`. Sobrepostos: gradiente de legibilidade (topo 35%, base 80%), chip de origem no canto superior esquerdo (`rgba(10,11,13,.72)`, 52 px, "reel · @clinicadamusculacao"), botão de play circular de 104 px em `brand/500` a 44% da altura, e legenda na base (título 28 px/700 + "reel da semana · reproduz sem som, com legenda" 20 px).

Reprodução: **sempre sem som, sempre com legenda**. Nunca depende de áudio.

### 3.4b Carrossel de imagens

Card de raio 28 px, imagem em `object-fit: cover; object-position: center top` (posters de Instagram são retrato — topo preservado). Avança sozinho a cada **6 s**. Sobrepostos: chip "GALERIA" no topo, gradiente de legibilidade, e na base título 26 px/700 + subtítulo 19 px + dots (ativo 30×8 px `brand/500`, inativos 10×8 px `rgba(255,255,255,.28)`, `transition: width .3s`).

Regra de implementação: cada slide é um `<img>` com `src` **literal** dentro do seu próprio `sc-if` — nunca `src="{{ hole }}"`, que dispara requisição do texto literal durante o streaming. Só o primeiro slide tem `hint-placeholder-val` verdadeiro.

### 3.4c Ranking público (resumo)

Card com título "Ranking do mês" 26 px/800 + chip de período/métrica ("AGOSTO · TREINOS"). Cinco linhas: medalhão 52 px (1º em `brand/500` com texto branco; 2º–3º em `brand/tint` com texto `brand/200`; demais em `border/hairline`), nome abreviado 24 px/700, métrica 22 px tabular. Rodapé: "Participação opcional · nomes abreviados". **Nomes sempre abreviados em tela pública.**

### 3.5 Card de evento

Linha horizontal com bloco de data (64 px, `brand/tint`, dia em 24 px/800 + mês em 15 px/700 tracking .08em) seguido de título 24 px/700 e info 19 px.

### 3.6 Card de informação ao vivo

Rótulo 19 px/600 secundário → valor 44 px/800 tabular → delta 18 px/700 na cor semântica. Três por linha.

### 3.7 Faixa de patrocínio

Separada por `border-top` de 2 px. Rótulo "ESPAÇO PATROCINADO" 17 px/700 tracking .14em à esquerda, atribuição "tecnologia arenahub" à direita. Abaixo, até 5 blocos de 64 px de altura, `flex: 1`, com nome do patrocinador em 18 px/600. Quando houver logotipo, ele substitui o texto respeitando 64 px de altura e o mesmo raio de 14 px.

### 3.8 CTA primário

Nas telas internas: altura 112–116 px, largura total, gradiente azul, texto branco 30 px/700, ícone 34 px opcional à esquerda, gap 18 px, raio 24 px, sombra azul. **Um único CTA primário por tela.**

Na tela pública o CTA de entrada é **compacto**: pill de 64 px no cabeçalho (ícone 24 px + "Entrar", 22 px/700, gradiente azul). A tela inteira continua tocável, com hint de 19 px acima da faixa de patrocínio ("Toque na tela para entrar na sua área").

### 3.9 Botão secundário

`bg/surface`, borda 2 px `border/default`, texto branco 26–30 px/700, raio 22–24 px, altura 88–112 px. Terciário: fundo transparente, mesma borda ou nenhuma, texto secundário.

### 3.10 Card-módulo (área interna)

Botão de 210 px de altura em coluna, `space-between`: ícone tonal de 72 px no topo, título 28 px/700 e subtítulo 21 px/500 na base. Padding 30 px. Grade de 2 colunas, gap 24 px.

### 3.11 Faixa de estado

Borda 2 px `rgba(cor,.4)`, fundo `rgba(cor,.10)`, raio 28 px, padding 32×36 px. Ícone 48 px à esquerda, título 30 px/700 na cor do estado, corpo 23/32 px branco. Pode ter ação à direita (botão de 88 px na cor cheia do estado, texto escuro).

### 3.12 Anel de pontuação

`<svg>` 140 px: trilho `border/hairline` de 14 px, arco `brand/500` de 14 px com `stroke-linecap: round`, `stroke-dasharray` proporcional (perímetro 364), rotação −90°. Centro: valor 44 px/800 e rótulo "PONTOS" 17 px/700 tracking .1em. Ao lado: veredito na cor semântica e explicação secundária.

### 3.13 Card de métrica

Rótulo 21 px secundário → valor 40 px/800 tabular → delta 21 px/700 na cor semântica, com referência de comparação em `text/tertiary`. Grade de 3 colunas, gap 20 px.

### 3.14 Card de fase de evolução

Título de eixo 22 px/700 azul → delta agregado 38 px/800 na cor semântica → três linhas de fase. Cada fase: rótulo e valor na mesma linha (`space-between`, baseline), barra de largura total abaixo (14 px, raio 7 px, trilho `bg/base`). A fase atual usa cor semântica; as anteriores usam `border/default`.

Regra: **nunca** colocar rótulo, barra e valor na mesma linha em card estreito — a barra colapsa. Rótulo/valor acima, barra abaixo.

### 3.15 Card de segmento corporal

Sigla de 2 letras em quadrado tonal de 56 px, região em 24 px/700 e valores de gordura/músculo em 20 px tabular na mesma linha. Usado ao lado do render 3D.

### 3.16 Lista de histórico

Card com `overflow: hidden`. Linhas de 100–112 px separadas por `border-top` de 2 px `border/hairline`. Valores monetários e chips com `white-space: nowrap; flex-shrink: 0` — obrigatório, sem isso quebram em duas linhas. Linha do registro mais recente com fundo `brand/tint` e peso 800.

Cabeçalho de tabela: 20 px/700 tracking .06em em `text/tertiary`, mesmas larguras de coluna das linhas.

### 3.17 Chip de status

Pill de 56 px, padding lateral 24 px, `min-width` 150 px, fundo `rgba(cor,.14)`, texto 21 px/700 na cor do estado, `nowrap` e `flex-shrink: 0`.

### 3.18 Barra e rodapé de sessão

Topo: trilho de 6 px, preenchimento `brand/500` decrescente com transição de 1 s.
Base: `border-top` 2 px, padding 28/64/40 px. À esquerda o texto "Sessão encerra em N s"; à direita "Preciso de mais tempo" (borda azul, texto `brand/200`, +30 s até o teto de 99) e "Encerrar" (borda neutra).

### 3.19 Teclado numérico

Grade 3×4, teclas de 132 px, dígitos em 40 px/700 branco, "Limpar" e "⌫" em `text/secondary`. Campo de CPF acima: 132 px de altura, JetBrains Mono 52 px, máscara `000.000.000-00` com `_` para posições vazias; borda vira `brand/500` quando os 11 dígitos estão completos. O CTA "Continuar" fica desabilitado (`bg #1A2032`, texto `#565E69`, cursor `not-allowed`) até completar.

---

## 4. Área externa — tela pública

Grade densa: coluna esquerda com o reel em altura total, coluna direita com carrossel e ranking empilhados. Sem espaço ocioso — hero comprimido em duas linhas de cabeçalho + uma linha de headline. Cada bloco pode ser ligado e desligado no painel administrativo. A tela inteira é tocável e leva à identificação.

```
┌─────────────────────────────────────────┐
│ [logo] Clínica de Musculação [contraste][Entrar] │  cabeçalho — fixo
│        DISCIPLINA HOJE, RESULTADOS SEMPRE        │
├─────────────────────────────────────────┤
│ MUSCULAÇÃO · SAÚDE · PERFORMANCE                 │  hero — fixo
│ Disciplina hoje. Resultados sempre.    ◣ azul    │  (1 linha, 54 px)
├────────────────────┐┌────────────────────┤
│ ┌────────────────┐ ││ ┌────────────────┐ │
│ │ reel · @clinica  │ ││ │ GALERIA          │ │  carrossel · 6 s
│ │                  │ ││ │ poster + legenda │ │  blocoCarrossel
│ │       ▶          │ ││ │ ▬ ● ● ●          │ │
│ │                  │ ││ └────────────────┘ │
│ │ Acompanhe a      │ ││ ┌────────────────┐ │
│ │ Clínica no IG    │ ││ │ Ranking do mês   │ │  ranking público
│ └────────────────┘ ││ │ top 5 abreviado  │ │  blocoRanking
│   blocoReel          ││ └────────────────┘ │
├────────────────────┴┴────────────────────┤
│  Toque na tela para entrar na sua área           │  hint — fixo
├─────────────────────────────────────────┤
│ ESPAÇO PATROCINADO          tecnologia arenahub  │  patrocínio
│ [ ][ ][ ][ ][ ]                                  │  blocoPatrocinio
└─────────────────────────────────────────┘
```

### Blocos configuráveis

| Bloco | Prop | Conteúdo esperado |
|---|---|---|
| Reel / vídeo | `blocoReel` | Reel do Instagram (poster + play), coluna esquerda em altura total |
| Carrossel | `blocoCarrossel` | Posts/posters de Instagram em retrato, avanço automático a cada 6 s, legenda + dots |
| Ranking público | `blocoRanking` | Top 5 do mês, nomes abreviados, métrica de treinos |
| Patrocínio | `blocoPatrocinio` | Até 5 marcas, nome ou logotipo |

Fixos e não removíveis: cabeçalho de marca (com o botão Entrar), hero de uma linha e hint de toque. O totem precisa sempre dizer onde está e como entrar.

### Conteúdo atual do carrossel

| Slide | Asset | Legenda |
|---|---|---|
| 1 | `assets/post-mutirao.png` | Mutirão da Bioimpedância · sábado 08, 07h–10h, em jejum |
| 2 | `assets/post-equipe.png` | Quem forma a nossa equipe? · Tácio Denner Gomes |
| 3 | `assets/post-evolucao.png` | Sua evolução acompanhada de perto · ECG, pressão, oximetria |
| 4 | `assets/post-jiujitsu.png` | Jiu-jitsu infanto-juvenil · seg e qua, 19h |

### Regras da tela pública

- Nenhum dado pessoal de aluno. Ranking público só com nomes abreviados e participação opcional.
- Vídeo sempre sem som e com legenda.
- Carrossel avança sozinho a cada 6 s; dots sempre visíveis.
- Se um bloco da coluna direita for desligado, o outro ocupa a coluna inteira; se a coluna toda for desligada, o reel ocupa a largura total.
- Alto contraste: remove glow, gradiente de fundo, forma angular e ponto pulsante; texto secundário passa a branco.
- Em `src` de imagem nunca usar hole `{{ }}` — sempre caminho literal por slide (o hole dispara requisição inválida durante o streaming).

---

## 5. Área interna — telas autenticadas

### 5.1 Identificação

Três caminhos, em ordem de esforço: reconhecimento facial (CTA primário), digitar CPF, QR Code do aplicativo. Cada opção é um botão de 132 px com ícone 48–52 px, título 30 px/700 e explicação de 22 px. Rodapé com "Voltar ao início".

### 5.2 Minha área

Saudação + título, faixa de estado do plano (pendência com ação "Pagar agora", ou plano ativo), e grade de 6 módulos:

| Módulo | Destino | Natureza |
|---|---|---|
| Avaliação do mês | Resultado de agosto | leitura |
| Evolução 3D | Corpo, músculo, gordura | leitura |
| Histórico de avaliações | Uma por mês | leitura |
| Pagamento | PIX na hora | transação |
| Histórico de pagamentos | Faturas e comprovantes | leitura |
| Ranking do mês | Frequência da unidade | leitura |

### 5.3 Avaliação do mês

Somente leitura. A medição é feita e confirmada no painel web da recepção; o totem exibe o resultado já validado.

```
Avaliação de agosto                    ┌──────────────┐
Medida na recepção em 03/08 ·          │  ◯ 80 PONTOS │
balança CF610_G · somente leitura      │  Condição boa│
                                       └──────────────┘
┌───────────────────┐ ┌────────────────────────────┐
│  render 3D        │ │ [BR] Braços  G 1,3 M 3,8   │
│  COMPOSIÇÃO DE    │ │ [TR] Tronco  G 11,6 M 30,8 │
│  AGOSTO           │ │ [PE] Pernas  G 3,0 M 11,2  │
└───────────────────┘ └────────────────────────────┘
┌─────────┐┌─────────┐┌─────────┐
│ Peso    ││ Gordura ││ Músculo │   … 6 métricas
└─────────┘└─────────┘└─────────┘
⚠ Procure a recepção antes do próximo treino
A leitura completa fica no aplicativo. Não é diagnóstico médico.
[Voltar]  [Ver minha evolução 3D]
```

Render 3D: bloco de raio 28 px, `min-height` 520 px, imagem em `object-fit: cover` com `object-position: 52% center`, gradiente de legibilidade e selo "COMPOSIÇÃO DE <MÊS>" em pill de 48 px.

Métricas exibidas: peso, gordura corporal, músculo esquelético, água corporal total, gordura visceral, metabolismo basal — cada uma com delta contra o mês anterior.

Alerta clínico: quando a avaliação traz achado que precisa de leitura médica (frequência cardíaca fora da faixa, achado de ECG), aparece a faixa `danger` orientando procurar a recepção. O totem nunca interpreta nem diagnostica.

### 5.4 Evolução 3D

Render comparativo início → progresso → atual, seguido de três cards de eixo:

| Eixo | Métrica |
|---|---|
| Evolução corporal | Peso |
| Evolução muscular | Massa muscular esquelética |
| Evolução gordura | Relação de gordura |

Cada card mostra o delta agregado e as três fases com barra proporcional. Rodapé: "Gerado a partir das suas avaliações mensais. Visual ilustrativo — os números são os medidos na balança."

### 5.5 Histórico de avaliações

Três cards de métrica atual + tabela de uma linha por mês (data, peso, gordura, músculo, pontuação). Linha mais recente destacada. Ação "Evolução 3D" no cabeçalho. Rodapé: "Somente leitura no totem. Laudo completo e gráficos no aplicativo."

### 5.6 Pagamento PIX

Título, QR Code em card branco de raio 28 px com padding 36 px (o QR **sempre** sobre branco), valor 56 px/800, descrição da fatura, instrução de 3 linhas. Ações: "Voltar" e "Já fiz o pagamento".

Sequência: PIX → aguardando confirmação (spinner, ~5 s simulados) → confirmado (ícone verde 120 px, "Seu acesso já está liberado na catraca").

### 5.7 Histórico de pagamentos

Seis linhas (últimos 6 meses): ícone de estado, mês, meio e data do pagamento, valor, chip de status. Fatura em aberto sempre no topo com ícone e chip `warning`, seguida de CTA "Pagar fatura em aberto · R$ X".

### 5.8 Ranking

Lista de 5 posições: medalhão de 64 px, nome, métrica. A posição do aluno logado tem fundo `brand/tint`, medalhão `brand/500` e peso 800. Abaixo, chips de conquista (sequência, XP). Participação é opcional e o nome aparece abreviado.

---

## 6. Sessão e privacidade

| Regra | Definição |
|---|---|
| Duração | 60 s, reiniciados a cada toque |
| Aviso | Barra superior + contador no rodapé, sempre visíveis |
| Extensão | "Preciso de mais tempo" soma 30 s, teto de 99 s |
| Encerramento | Manual ou por tempo; volta à tela pública e limpa CPF e estado |
| Limpeza | Nenhum dado de aluno permanece na tela após o encerramento |
| Escopo | Totem não edita cadastro, não cadastra biometria, não realiza medição |

---

## 7. Configuração e personalização

### 7.1 Props do componente

```json
{
  "pendencia":        { "editor": "boolean", "default": true },
  "blocoReel":        { "editor": "boolean", "default": true },
  "blocoCarrossel":   { "editor": "boolean", "default": true },
  "blocoRanking":     { "editor": "boolean", "default": true },
  "blocoPatrocinio":  { "editor": "boolean", "default": true }
}
```

`pendencia` alterna o estado financeiro do aluno demonstrado (pendência em aberto ou plano ativo) e afeta a faixa de estado, o CTA de pagamento e o histórico.

### 7.2 O que a academia configura no painel web

**Marca**
- Logotipo (SVG ou PNG com fundo transparente, mínimo 256 px de altura)
- Nome da academia e da unidade
- Slogan
- Cor de marca (o sistema deriva as variações 200–600 e o gradiente de CTA)

**Tela pública**
- Ligar e desligar os quatro blocos opcionais (reel, carrossel, ranking, patrocínio)
- Conteúdo de cada bloco: reel em destaque, imagens/posters do carrossel, métrica do ranking, patrocinadores
- Tempo de exibição por item do carrossel (padrão 6 s)
- Ativar alto contraste como padrão da unidade

**Área interna**
- Quais dos seis módulos aparecem (por unidade)
- Duração da sessão e do incremento de tempo
- Exibir ou não o ranking, e qual métrica ele usa
- Métodos de identificação habilitados
- Meios de pagamento habilitados

**Avaliação**
- Quais métricas aparecem no resumo do totem
- Ativar o render 3D e a tela de evolução
- Texto do aviso clínico e do rodapé de responsabilidade

### 7.3 Assets

| Arquivo | Uso | Especificação |
|---|---|---|
| `assets/ig-clinicadamusculacao-equipe.png` | Poster do reel na tela pública | ≥ 1080 px de largura, foco central |
| `assets/post-mutirao.png` | Carrossel · slide 1 | Poster IG retrato, ≥ 670 px de largura |
| `assets/post-equipe.png` | Carrossel · slide 2 | Poster IG retrato |
| `assets/post-evolucao.png` | Carrossel · slide 3 | Poster IG retrato |
| `assets/post-jiujitsu.png` | Carrossel · slide 4 | Poster IG quadrado/retrato |
| `assets/avaliacao-atual-3d.jpg` | Render da avaliação do mês | 16:9, corpo centralizado, fundo claro |
| `assets/evolucao-3d.jpg` | Comparativo da evolução 3D | 16:9, três corpos lado a lado |

Todo render 3D recebe gradiente de legibilidade e selo identificando o período. Renders são **ilustrativos**: os números vêm sempre da balança, nunca da imagem.

---

## 8. Checklist de revisão

**Legibilidade**
- [ ] Nenhum texto abaixo de 19 px
- [ ] Nenhum alvo tocável abaixo de 88 px
- [ ] Bordas de 2 px, nunca 1 px
- [ ] Números tabulares em toda métrica

**Layout**
- [ ] Conteúdo cabe em 1920 px sem rolagem (`scrollHeight === clientHeight`)
- [ ] Valores monetários e chips com `nowrap` e `flex-shrink: 0`
- [ ] Barras de progresso com largura própria — rótulo e valor acima, nunca ao lado em card estreito
- [ ] Um único CTA primário por tela

**Marca**
- [ ] Gradiente azul só em CTA primário
- [ ] No máximo dois níveis de superfície
- [ ] Laranja e vermelho apenas como estado

**Conteúdo e privacidade**
- [ ] Tela pública sem dado pessoal de aluno (ranking só abreviado)
- [ ] Vídeo sem som e com legenda
- [ ] Toda tela de avaliação marcada como somente leitura
- [ ] Rodapé de "não é diagnóstico médico" presente em avaliação e evolução
- [ ] Sessão limpa o estado ao encerrar

**Acessibilidade**
- [ ] Alto contraste remove todo efeito decorativo
- [ ] Estado nunca comunicado apenas por cor — sempre com ícone ou texto
