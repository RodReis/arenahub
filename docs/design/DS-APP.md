# DS-APP — Design System do Aplicativo do Aluno

Academia ArenaHub · plataforma ArenaHub
Arquivo de referência: `App Mobile v2.dc.html` (Claude Design) — protótipo escuro. **Não há protótipo "v2 claro"**: o tema claro segue os mesmos tokens desta versão, mas o layout novo (abertura com arte 3D, cinco abas, laudo) só foi verificado visualmente no escuro (emulador Android, Pixel 10 Pro XL). Quem alterar uma tela deste app deve conferir o tema claro antes de dar como pronto — a montagem é por token, então costuma funcionar por construção, mas isso nunca foi confirmado com os olhos.
Versão 3.0 — redesenho completo do layout (14/09/2026, PR [#332](https://github.com/RodReis/arenahub/pull/332)). Os arquivos `App Mobile.dc.html` / `App Mobile Claro.dc.html` (v2.1, versão anterior) saem de referência: a **barra de quatro abas**, a **Home com atalhos em grade** e a **carteirinha em sheet** que eles descreviam **não existem mais** no app. Se você achar um componente com esse nome no código antigo ou numa PR velha, ele foi removido, não renomeado.

---

## 1. Sobre o produto

App do aluno. É a superfície **pessoal** da plataforma: plano, pagamento, evolução física e engajamento (XP, ranking e desafios). O painel web é onde a academia escreve o dado; o totem é o terminal compartilhado da recepção; o app é o único lugar onde o aluno tem a leitura completa da própria evolução, com histórico e laudo.

**Sem carteirinha.** A Slice 4.2 (F24) cortou a carteirinha com QR na abertura da fatia, por decisão do PI: falta responder *quem escaneia o QR na recepção* antes de desenhar o fluxo (`M4-FR-007` segue sem executor). O protótipo v2 desenha uma carteirinha — o app não a implementa, e nenhuma tela deste documento a descreve.

### Princípios

**Uma coisa por tela.** Cada aba responde a uma pergunta: como estou? onde estou no grupo? como evoluí? o que devo? quem sou eu no cadastro? Nada de dashboard com tudo ao mesmo tempo.

**O alerta vem antes do conteúdo.** Fatura vencida, plano suspenso e achado de saúde aparecem no topo da tela correspondente, nunca enterrados.

**Escuro por padrão, claro por escolha.** O app é usado na academia, com luz baixa, celular na mão e suor — o tema escuro é o padrão do sistema operacional (`useColorScheme`, sem seletor dentro do app). O tema claro reusa os neutros do painel web. Mesma estrutura, mesmos componentes, mesma marca: **só os tokens mudam.**

**Mesma marca em todas as superfícies.** App, totem e painel são a mesma Clínica de Musculação: azul royal sobre carbono, mesma escala de superfícies e mesmos tons semânticos.

**O app nunca diagnostica.** Mostra medição, faixa, comparação e histórico. A leitura da faixa (`BELOW`/`WITHIN`/`ABOVE`/`AT_LIMIT`/`UNKNOWN`) é **neutra e decidida no servidor** — nunca "excelente" nem "ruim", porque quem interpreta saúde é o profissional, não a cor do texto. Toda tela de medição declara isso.

**Engajamento é opt-in, e cada seção pode não existir.** Ranking, conquistas e desafios são preferência do aluno e configuração do tenant — uma seção desligada pela academia **some da tela inteira**, não aparece vazia. Sair do ranking custa dois toques (tocar, depois confirmar), pela mesma regra do PRD que exige confirmação em ação que muda privacidade.

### Contexto

| Aspecto | Definição |
|---|---|
| Plataforma | Expo / React Native — iOS e Android, sem versão web |
| Largura de referência | iPhone 390 px no protótipo; verificado no build real num Android de 420 dp lógicos (Pixel 10 Pro XL) |
| Safe area superior | `useSafeAreaInsets()`, com mínimo de 58 px (`APP_SIZE.safeAreaTop`) |
| Entrada | Toque, uma mão, polegar na metade inferior |
| Densidade | Confortável: controles de 44–48 px, corpo de 14–15 px |
| Locale | pt-BR — `R$ 129,90`, `dd/mm`, `92,3 kg`. **Sem `Intl`/`toLocaleString`** no app: o formatador segue o idioma do APARELHO, e a lint do design system barra o uso fora dos dois componentes autorizados (regra 5, `packages/config/eslint/design-system.js`) |
| Marca | Clínica de Musculação · "Disciplina hoje, resultados sempre." |
| Nome do aluno | Sempre em **Title Case** na tela (`nomeParaExibir`, `src/ui/nome.ts`), nunca na caixa em que o cadastro chegou. O cadastro migrado vem em CAIXA ALTA, e mostrar "RODRIGO REIS" foi um defeito real, achado na revisão final desta versão |
| Versão exibida | Rodapé da aba Perfil (`v0.1.0 · tecnologia arenahub`, `APP_VERSION` de `app.json`) |

---

## 2. Tokens

Fonte única: `packages/ui/src/app-tokens.generated.ts` (`APP_TOKENS`, `APP_SIZE`, `APP_RADIUS`, `APP_SPACE`, `APP_TYPE`, `APP_FONT`, `APP_MOTION`, `APP_STATE_TINT`), gerado de `packages/ui/tokens/app.json` por `scripts/build-tokens.mjs`. O app lê daqui e de nenhum outro lugar — hex literal em `apps/mobile` é erro de lint (regra 1).

### 2.1 Cor — superfícies

Três níveis de escuro. Nunca mais do que isso na mesma tela.

| Token | Hex | Uso |
|---|---|---|
| `bg/app` | `#0A0B0D` | Fundo do app, poço interno (trilho de barra, campo de texto) |
| `bg/surface` | `#121417` | Card padrão, sheet, tile de atalho |
| `bg/raised` | `#1A2032` | Card em destaque (plano, fatura, XP), avatar, chip inativo, barra vazia |
| `border/default` | `#5F71A0` | Borda de **controle tocável**: campo de texto, botão secundário. Alvo de contraste 3:1 (WCAG 1.4.11) — é o par que o gate de contraste da F43 corrigiu de `#232A3D` para este valor |
| `border/hairline` | `#232A3D` | Borda de **card e divisor**: contorno de card, linha entre itens de lista, linha de tabela. É deliberadamente mais sutil que `border/default` — separa card de fundo sem competir com a borda de um campo tocável na mesma tela |
| `brand/frame` | `#0D1226` | Miolo do símbolo da marca |
| `scrim` | `rgba(10,11,13,.7)` | Fundo atrás de toda folha (`Folha`, `src/ui/Folha.tsx`) |
| `ink/on-accent` | `#FFFFFF` | Texto e ícone sobre azul de ação |

**`border/default` e `border/hairline` são dois tokens diferentes, não dois nomes para o mesmo hex** — essa é a correção mais importante desta versão do documento. A tabela anterior (v2.1) listava só `border/default` com o valor `#232A3D`, que hoje é o hairline; usar esse hex num controle tocável reprova o gate de contraste (medido em 1,19:1 contra o alvo de 3,0 — DS §2.8 do totem tem o mesmo achado, mesma correção).

Mesma escala do totem: base `#0A0B0D`, superfície `#121417`, hairline `#232A3D`.

#### Tema claro

Mesmos papéis, neutros do painel web (DS-PAINEL §2.1). Card branco **sempre com borda** — sem ela a hierarquia some, medida em contraste de superfície de 1,07–1,22 entre os três níveis, que não separa nada visualmente.

| Token | Escuro | Claro | Observação no claro |
|---|---|---|---|
| `bg/app` | `#0A0B0D` | `#EDF0F5` | Fundo do app e poço interno |
| `bg/surface` | `#121417` | `#FFFFFF` | Card · `border: 1px solid #E5E9EE` |
| `bg/raised` | `#1A2032` | `#E4EAF6` | Card em destaque · `border: 1px solid #CFDAF0` |
| `border/default` | `#5F71A0` | `#7B8491` | Campo de texto, botão secundário |
| `border/hairline` | `#232A3D` | `#E5E9EE` | Contorno de card, linha de tabela |
| `brand/frame` | `#0D1226` | `#0D1226` | Miolo da marca permanece escuro |
| `scrim` | `rgba(10,11,13,.7)` | `rgba(31,35,40,.45)` | Atrás da folha |
| `ink/on-accent` | `#FFFFFF` | `#FFFFFF` | Texto sobre azul de ação |

### 2.2 Cor — texto

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `text/primary` | `#F5F7F9` | `#1F2328` | Título, valor, corpo forte |
| `text/secondary` | `#A6AEB9` | `#565E69` | Descrição, label, métrica secundária |
| `text/muted` | `#7B8491` | `#7B8491` | Metadado, timestamp, matrícula |
| `text/placeholder` | `#565E69` | `#9AA3AE` | Placeholder de campo |
| `text/on-image` | `#FFFFFF` | `#FFFFFF` | Título e valor sobre a arte 3D com gradiente de legibilidade (boas-vindas, banner de desafio, hero do plano) — **não inverte** entre temas |
| `text/on-image-muted` | `#E5E9EE` | `#E5E9EE` | Legenda sobre a mesma arte — idem, não inverte |

### 2.3 Cor — marca

| Token | Hex | Uso |
|---|---|---|
| `accent/solid` | `#4D7CFF` | Barra de frequência, aba de segmento ativa, chip de período ativo, medalhão da própria linha no ranking, "Atual" no comparativo, medalhão central da barra de abas |
| `accent/gradient` (`gradientFrom` → `gradientTo`) | `linear-gradient(100deg,#5B86FF,#3E63E8)` | **Ação.** Fundo de todo botão primário e do medalhão central da barra de abas |
| `accent/gradient-hover` | `linear-gradient(100deg,#6B92FF,#4A6FF0)` | Estado pressionado de botão primário |
| `accent/ink` | `#7DA2FF` (escuro) / `#3E63E8` (claro) | Traço de ícone sobre a marca e sobre superfície (tiles da boas-vindas) |
| `accent/text` | `#8FB0FF` (escuro) / `#2E4FD0` (claro) | Link, texto de botão fantasma, hover de borda, rótulo de eixo, overline azul |
| `accent/soft` | `#C9D9FF` (escuro) / `#1B3AAE` (claro) | Nome do aluno no rodapé do ranking ("Você aparece como…") |
| `accent/tint` | `rgba(77,124,255,.12)` | Fundo da própria linha no placar |
| `brand/mark` (`markFrom` → `markMid` 55% → `markTo`) | `linear-gradient(145deg,#7DA2FF,#2E4FD0 55%,#9DB8FF)` | Moldura do símbolo da marca (`Marca`, `src/ui/Marca.tsx`) e anel do avatar com destaque (`Avatar anel`) |

Regra: **gradiente é ação, tinta é informação.** Botão primário sempre com `accent/gradient` + texto branco; nunca `accent/solid` chapado como fundo de botão. `accent/ink` para traço de ícone, `accent/text` para texto — não inverter, o mais claro é o que precisa de contraste em corpo pequeno.

No **tema claro** o gradiente, o hover e `accent/solid` são idênticos — azul de ação não muda entre temas. Só as tintas de leitura escurecem para ter contraste sobre branco (valores já na tabela acima).

### 2.4 Cor — semântica

Quatro tons: `ok`, `warn`, `err`, `info`. Fundo e borda são **calculados em runtime** a partir do hex do tom (`t.tint(tom)`, `src/ui/theme.tsx`), não hex fixo — a opacidade vem de `APP_STATE_TINT`, mais opaca no escuro (fundo 16%, borda 34%) que no claro (fundo 10%, borda 30%), porque 16% sobre branco reprovaria o `err` em 4,43:1 contra o alvo de 4,5:1.

| Tom | Texto escuro | Texto claro | Significado |
|---|---|---|---|
| `ok` | `#3DDC84` | `#157F3D` | Plano ativo, pago, métrica melhorando (a favor do objetivo) |
| `warn` | `#F5A524` | `#8A5200` | Fatura vencida, métrica em atenção, sequência de treino |
| `err` | `#FF6B6B` | `#C22B2B` | Bloqueio, falha, ação destrutiva ("Sair da conta") |
| `info` | `#6AB0FF` | `#1F5FD0` | Em aberto, processando, spinner |

`t.tint(tom)` é a receita `[texto, fundo, borda]` inteira; nenhum componente monta `rgba()` na mão a partir do hex de texto.

**A "direção boa" de um delta depende da MÉTRICA, não é sempre "cair".** Peso e gordura: cair é `ok`. Massa muscular e massa livre de gordura: **subir** é `ok` (conjunto nomeado `SOBE_E_BOM` em `avaliacoes.tsx`). O sinal (`+`/`−`) está sempre no texto — cor nunca é o único canal.

### 2.5 Tipografia

**Inter** na interface, em cinco pesos carregados como **famílias separadas** via `@expo-google-fonts/inter` (`Inter_400Regular` … `Inter_800ExtraBold`). **JetBrains Mono** 400 (`@expo-google-fonts/jetbrains-mono`) em identificador: matrícula, código PIX copia-e-cola.

**Família por peso, nunca `fontWeight` sobre uma família só.** No Android, uma fonte carregada por `expo-font` ignora a prop `fontWeight` — o título de 800 sairia no peso regular. `t.fonte(peso)` (`theme.tsx`) resolve o nome da família certa; nenhum componente escreve `fontWeight` numérico.

| Papel | Tamanho / linha | Peso | Token (`APP_TYPE`) |
|---|---|---|---|
| Título da abertura (boas-vindas) | 32 / 36 px | 800 | literal no componente, ainda não virou token |
| Saudação / título de tela | 24 / 30 px | 800 | `screenTitle` (peso registrado como 700; o app usa 800 — débito de token, ver nota abaixo) |
| Valor grande (fatura, XP) | 30 px | 700–800 | `value` |
| Título de folha (sheet) | 18–20 px | 700 | `sheetTitle` |
| Título de card | 16 px | 600 | `cardTitle` |
| Rótulo de botão primário | 16 px | 700 | `buttonPrimary` |
| Rótulo de botão secundário | 15 px | 600 | `buttonSecondary` |
| Corpo | 14 / 20 px | 400 | `body` |
| Label de campo | 13 px | 600 | `fieldLabel` |
| Rótulo de tile / chip | 13 px | 600 | `tileLabel` |
| Metadado | 12 px | 400 | `meta` |
| Rótulo de aba | 10–11 px | 600–700 | `tabLabel` |

**Débito registrado:** o título da abertura (32/36/800) e o título de tela em 800 (em vez do 700 que `APP_TYPE.screenTitle` declara) são literais nos componentes, não tokens — nasceram durante esta versão e ainda não voltaram para `packages/ui/tokens/app.json`. Quem tocar tipografia de novo deveria fechar essa lacuna em vez de acumular um terceiro literal.

Todo número em série leva `fontVariant: ['tabular-nums']`. Nome do aluno em Title Case (§1).

### 2.6 Espaçamento

Escala de 2 px: **2 · 4 · 5 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 24 · 32** (`APP_SPACE`).

| Contexto | Valor |
|---|---|
| Padding lateral do conteúdo | 20 px |
| Padding de card | `18px 20px` |
| Padding de folha (sheet) | `14px 20px 32px` (+ inset inferior do aparelho) |
| Gap entre blocos da tela | 14 px |
| Gap interno de card | 8–12 px |
| Gap label→campo | 6 px |
| Safe area superior | mínimo 58 px |

### 2.7 Raio e forma

| Elemento | Raio |
|---|---|
| Folha (sheet) | 22 px no topo (`APP_RADIUS.sheet + 2`) |
| Card | 16 px |
| Botão, campo, segmento | 12 px |
| Segmento (aba interna) | 9 px |
| Barra de progresso / faixa | 4 px |
| Barra de frequência | 3 px |
| Badge, chip, pílula de período | 999 px (pill) |
| Avatar, medalhão | circular |

Bordas de 1 px — `border/default` em controle, `border/hairline` em card (§2.1). Sem sombra decorativa em superfície plana; sombra só nos dois elementos que flutuam sobre a tela: o medalhão central da barra de abas e o CTA "Entrar" da abertura.

### 2.8 Alturas

| Elemento | Altura |
|---|---|
| Botão primário / campo | 48 px |
| Botão secundário em card | 44 px |
| Tile de atalho | 64 px |
| Segmento (PIX/Cartão) | 40 px |
| Pílula de período | 30 px |
| Badge / chip de status | 26 px |
| Linha de lista (`LinhaDeLista`) | 56 px |
| Linha de tabela | 44 px |
| Barra de abas | 56 px + safe area inferior |
| Avatar padrão | 42–44 px · Perfil com anel: 84 px |
| Medalhão central da barra de abas | 56 px (anel de recorte de 66 px) |

Nada tocável abaixo de **44 px**, exceto a pílula de período (30 px, com `hitSlop` estendendo a área de toque).

### 2.9 Ícones

Dicionário de traço em `src/ui/traco.tsx` (`Traco`, componente único — não um arquivo por ícone). `viewBox` 24×24, `stroke-width` 2 por padrão, `linecap`/`linejoin: round`, sem fill. Tamanhos por uso: 13–15 px em badge e linha de lista, 16–20 px em tile e cabeçalho, 20–24 px na barra de abas, 34 px em spinner.

Cor sempre de fora, nunca fixa no componente: `accent/ink` em traço sobre superfície neutra, cor do tom (`t.cor.state[tom]`) em ícone de estado (o mesmo que acompanha um `Badge` — cor nunca é o único canal).

Os ícones de **estado** (badge, alerta) moram em `src/ui/icones.tsx` (`ICONE_DO_TOM`), separados do dicionário de traço geral — são a dupla obrigatória de todo `Badge` (§4.4), nunca escolhidos livremente.

### 2.10 Movimento

`APP_MOTION`: `pulse` e `spin`, 1400 ms — os únicos dois valores nomeados. Além deles, a abertura tem três movimentos autorais (§4.1) e o card de XP tem um quarto (§4.6), todos com `Animated` do React Native (`useNativeDriver: true`) e todos **desligados quando `AccessibilityInfo.isReduceMotionEnabled()` é verdadeiro** — a arte continua visível, parada; nenhuma informação se perde, porque o movimento é atmosfera, não conteúdo.

### 2.11 Manter os dois temas

O tema é resolvido em runtime por token (`ProvedorDeTema`, `useColorScheme`), não por arquivo irmão como no protótipo web — mudar de tela no meio do app troca o tema sem recarregar nada. Toda cor literal fora de `APP_TOKENS` é erro de lint (regra 1); não há como um componente "esquecer" o tema claro por escrever hex direto.

Três armadilhas já encontradas nesta versão e na anterior:

1. **Texto sobre foto** — não inverte (§2.2, `text/on-image`).
2. **QR Code** — tinta escura (`#1F2328`) sobre bloco branco nos dois temas; inverter o torna ilegível para a câmera.
3. **Card sem borda no claro** — contraste de superfície de 1,07–1,22 não separa nada; todo card leva `border/hairline` (§2.1), nos dois temas — a versão anterior deste documento dizia "sem borda quando o contraste já separa", e essa frase estava errada.

---

## 3. Estrutura e navegação

### 3.1 Abertura → login

Quem não tem sessão vê a **abertura** (`BoasVindas`, `src/features/boas-vindas/boas-vindas.tsx`) antes de qualquer aba: arte 3D em tela cheia (`app-bio-3d.jpg`) com gradiente de legibilidade, os três movimentos autorais (§4.1), quatro blocos com o que o app entrega, e o CTA "Entrar" que abre o **login numa folha** (`Folha`, §4.2) por cima da própria abertura — não uma tela nova.

```
┌─────────────────────────┐
│  marca      Já sou aluno│  toque abre a folha direto
│                         │
│     arte 3D + efeitos   │
│                         │
│  kicker · título · sub  │
│  ┌────┐┌────┐          │
│  │tile││tile│  2×2      │
│  └────┘└────┘          │
│      [ Entrar ]         │  também abre a folha
└─────────────────────────┘
         ↓ toque
┌─────────────────────────┐
│  ═══  alça               │
│  Entrar                  │
│  e-mail/telefone          │
│  senha                    │
│  [ Entrar ]               │
│  Esqueci minha senha      │
└─────────────────────────┘
```

A abertura é a **única** tela do app fora do shell de abas e sem `Tela`/`TituloDaTela` (§4.7) — é tela cheia, com tema escuro **forçado** independente do sistema: a arte é escura, e o claro pintaria o título em carvão sobre a foto preta.

### 3.2 Shell de abas

```
┌─────────────────────────┐
│  respiro da safe area   │  anteparo com gradiente (§4.7)
├─────────────────────────┤
│                         │
│   área rolável          │  puxar para atualizar
│                         │
├─────────────────────────┤
│  ⌂    ↗    ✦    ▤    ◔  │  5 itens, o 3º elevado
│Início Eventos Evo Planos│
│              Perfil     │
└─────────────────────────┘
```

`expo-router` `Tabs` com `tabBar` customizado (`BarraDeAbas`, §4.3). O laudo é uma **sexta rota escondida** (`href: null`) dentro do mesmo grupo — a barra continua visível com a aba Evolução acesa enquanto o aluno lê o laudo, porque ele é detalhe da Evolução, não uma tela nova.

| Aba | Pergunta que responde | Conteúdo |
|---|---|---|
| **Início** | Como estou? | Saudação, banner de desafio (quando há), frequência dos últimos 90 dias, avisos |
| **Eventos** | Onde estou no grupo? | XP do mês, ranking opt-in, conquistas, desafios da academia |
| **Evolução** (central, elevada) | Como evoluí? | Métricas do mês, avaliação em destaque, histórico por medida, comparativo, leitura assistida → laudo |
| **Planos** | O que devo? | Plano atual, fatura em aberto (PIX/cartão), histórico de pagamentos |
| **Perfil** | Quem sou no cadastro? | Identidade, dados, atalhos (avisos, frequência, permissões, exportação), sair |

As cinco abas são irmãs: qualquer uma alcança qualquer outra em um toque, sem hierarquia e sem pilha de navegação entre elas. Um atalho da Home (banner de desafio → Eventos) **navega para a aba**, nunca empilha tela nova — o estado da barra acompanha.

**O que mudou desde a v2.1:** a Home perdeu a grade de atalhos e a carteirinha; "Pagar" virou "Planos" e ganhou o plano junto (antes eram conceitos separados); "Ranking" virou "Eventos" e ganhou XP e desafios; nasceu "Perfil" como aba própria, puxando para si os atalhos que viviam soltos na Home (avisos, frequência, permissões, exportação — funções que já existiam desde a F24–F29 e não podiam desaparecer no redesenho).

### 3.3 Segmentos e período (dentro de tela)

Diferentes da barra de abas: alternam conteúdo **dentro** da mesma aba.

**Segmento** (`Segmentado`, §4.4a): container `bg/surface`, raio de controle, padding 4 px. Cada opção `flex: 1`, altura 40 px, raio de segmento. Ativa: fundo `accent/solid`, texto branco. Inativa: transparente, `text/secondary`. Uso: PIX / Cartão na aba Planos.

**Pílula de período** (`Pilulas`, §4.4b): `30D · 90D · 6M · 1A` na aba Evolução, 30 px, raio pill. Mesma regra de cor do segmento. Trocar o período reconsulta o servidor — o app **não** filtra a série já carregada no cliente, porque `30D` e `1A` são agregações diferentes do mesmo dado, e recortar no cliente inventaria um número que o painel não confirma.

---

## 4. Componentes

### 4.1 Efeitos da abertura (`EfeitosDoHero`)

Três movimentos sobre a arte da boas-vindas, todos `pointerEvents="none"` e desligados por `prefers-reduced-motion`:

1. **Linha de escaneamento** — gradiente horizontal que sobe e desce, 4,5 s, brilho em `accent/ink`.
2. **Dois anéis em órbita**, um girando cada sentido, 14 s / 26 s (dashed).
3. **Brilho radial** (SVG `RadialGradient`, não é possível fazer radial em `LinearGradient` do React Native) que pulsa de opacidade a cada 2,5 s.

### 4.2 Folha (`Folha`, sheet reutilizável)

Substitui a "Sheet da carteirinha" da v2.1 como o componente genérico de folha inferior — hoje usado no **login** e na **confirmação de saída da conta**; qualquer confirmação nova do app deveria reusar este componente, não um `Modal` próprio.

`Modal` nativo (não uma `View` absoluta): prende o foco do leitor de tela dentro da folha e o botão voltar do Android fecha a folha em vez de sair do app. Alça de 36×4 px em `border/hairline`, painel `bg/surface`, raio de folha, `KeyboardAvoidingView behavior="padding"` **nos dois sistemas** — no Android, com o layout edge-to-edge do SDK 57, o `Modal` translúcido não redimensiona sozinho, e sem esse comportamento o teclado cobria os campos de login (achado no emulador). `paddingBottom` soma o inset inferior do aparelho.

### 4.3 Barra de abas (`BarraDeAbas`)

Cinco itens, `border-top: 1px solid border/hairline`, fundo `bg/app`. A aba do meio (Evolução) é um **medalhão elevado**: círculo de 56 px em `accent/gradient` com sombra colorida (`shadowColor: accent/solid`), dentro de um anel de recorte de 66 px na cor do fundo, escala 1,08 quando ativo. Ícone branco de 24 px dentro do medalhão; as outras quatro abas usam o traço simples (§2.9) de 20 px, `accent/text` quando ativa e `text/muted` quando não.

Cor **nunca** é o único canal do estado ativo: `accessibilityState.selected` informa o leitor de tela, e o rótulo (10 px) está sempre escrito abaixo do ícone.

### 4.4a Segmento — ver §3.3 · 4.4b Pílula de período — ver §3.3

### 4.4 Badge

Pill de 26 px, padding lateral 10–12 px, gap 6 px, 12–13 px/600, `white-space: nowrap`. Fundo, borda e texto da tripla do tom (§2.4); ícone de 12–14 px em `currentColor`, sempre um dos `ICONE_DO_TOM` (§2.9) — nunca opcional.

### 4.5 Card e lista

**Card** (`Card`, `src/ui/Card.tsx`): `bg/surface` (ou `bg/raised` quando é o destaque da tela), raio de card, padding `18px 20px`. Borda **sempre** em `border/hairline` — ver a armadilha 3 do §2.11.

**Card de lista** (`CardDeLista` + `LinhaDeLista`, `src/ui/CardDeLista.tsx`): substitui o padrão "lista dentro de card" que a v2.1 descrevia caso a caso (avisos, histórico, ranking). Cabeçalho opcional com fio embaixo; linhas de 56 px separadas por `border-top: 1px solid border/hairline`, sem padding lateral no container — a linha é quem tem o respiro, para o fio atravessar o card de ponta a ponta. `destaque` pinta a própria linha em `accent/tint` (linha do aluno no placar).

### 4.6 Card de XP (aba Eventos)

`bg/raised`, raio de card + 2. Imagem do troféu (`app-trophy-3d.jpg`) com halo radial atrás (mesma técnica SVG do §4.1) e um quarto movimento autoral: a imagem sobe e desce 8 px a cada 2,5 s (flutua), também desligado por `prefers-reduced-motion`. Kicker "XP DE `<MÊS>`" em `accent/text`, valor tabular 24/800 + "XP" em peso menor, texto de sequência ("N semanas seguidas · recorde de M") ou convite a começar quando `atual` é zero.

### 4.7 Casca de tela (`Tela`, `TituloDaTela`, `Voltar`, `Carregando`, `Indisponivel`)

Toda aba usa a mesma casca (`src/ui/Tela.tsx`): `ScrollView` com fundo `bg/app`, padding lateral de 20 px, respiro superior de pelo menos 58 px, 14 px entre blocos, `RefreshControl` quando a tela tem do que reler. Um **anteparo com gradiente** no topo (sólido até 70% da altura da safe area, depois esvaindo) evita que o conteúdo role visualmente por baixo do relógio do sistema — achado no emulador nesta versão, não existia na v2.1.

`TituloDaTela`: 24 px/800, `letterSpacing: -0.5`. `Voltar`: link com seta + rótulo, usado no laudo e nas telas de detalhe herdadas da F24–F29 (avisos, frequência, consentimentos, exportação). `Indisponivel`: card "Sem conexão com a academia" — toda leitura que falha cai aqui, **nunca** mostra o dado antigo como se fosse atual (`M4-NFR-002`).

### 4.8 Marca e avatar (`Marca`, `Avatar`, `src/ui/Marca.tsx`)

**Marca**: quadrado com `padding: 1px` em `brand/mark`, miolo em `brand/frame`, símbolo (halter) em `accent/ink`. Tamanho padrão 36 px na abertura.

**Avatar**: iniciais (`iniciaisDe` — primeira letra do primeiro e do último nome, nunca inventa uma segunda letra quando só há um nome) sobre `bg/raised`, com `border/hairline` quando simples (botão de perfil na Home, 42 px) ou anel em `brand/mark` quando em destaque (`anel`, identidade da aba Perfil, 84 px).

### 4.9 Botão (`Botao`)

| Variante | Fundo | Borda | Texto | Uso |
|---|---|---|---|---|
| Primário | `accent/gradient` → hover `accent/gradient-hover` | — | branco 16/700 | Uma ação principal por tela |
| Secundário | transparente | `border/default` → hover `accent/text` | `accent/text` 15/600 | Ação de apoio |
| Neutro | transparente | `border/default` | `text/primary` 15/600 | Fechar, cancelar |
| **Destrutivo** | transparente | `state/err` | `state/err` 15/600 | Confirmar uma ação que não volta ("Sair da conta") — variante nova desta versão; a v2.1 não tinha, e o primeiro build usava o gradiente azul da marca num botão que deveria ser vermelho |

Altura 48 px (principal), 44 px dentro de card e folha. Raio de controle.

### 4.10 Campo de texto (`Campo`)

Label 13/600 `text/secondary` → input 48 px, fundo `bg/app` (o poço, igual ao trilho de barra — não `bg/surface` como a v2.1 descrevia, porque o campo agora vive dentro de uma folha `bg/surface`, e precisa de um nível a mais para se destacar dela), borda `border/default`, raio de controle, 16 px `text/primary`. Foco: borda `accent/text`. Sempre com `autocomplete` correto e `<label>`/`accessibilityLabel` associado.

### 4.11 Estado de espera (`EstadoDeEspera`)

Card centralizado: spinner em `info` → título 18/700 "Aguardando confirmação" → explicação → badge `info` "Processando" → botão secundário "Voltar". **Nunca escreve "Pago"**: o retorno do checkout do provedor não confirma pagamento (`M4-BR-001`/INV-081) — só o status que o webhook já gravou confirma, e este componente existe para que nenhum texto novo escreva a palavra errada por engano.

### 4.12 Hero de arte 3D (banner de desafio, plano, avaliação em destaque)

Três usos do mesmo padrão visual — imagem de tela cheia dentro de um card, gradiente de escurecimento, texto em `text/on-image`/`text/on-image-muted` por cima:

- **Banner de desafio** (Início): `app-hero-3d.jpg`, só aparece quando existe um desafio aberto — não é decoração fixa.
- **Card do plano** (Planos): `app-card-3d.jpg`, gradiente lateral (0,9 → 0,6 → 0,2), nome do plano ou "Acesso sem plano assinado" quando não há assinatura (nunca inventa um nome comercial).
- **Card da avaliação em destaque** (Evolução): `app-bio-3d.jpg` — a arte `avaliacao-atual-3d` do protótipo **não é usada**: ela trazia peso e gordura escritos na própria imagem, números de outra pessoa numa tela de saúde do aluno.

Altura de render fixada em `APP_SIZE.render3d` (200 px) quando aplicável.

### 4.13 Gráfico e tabela de evolução

SVG de 300×130 (área útil x: 8–292, y: 18–112), linha em `accent/ink`, `stroke-width: 2.5`, três linhas-guia em `border/hairline`. Eixo escalado ao min/max do período, não ao zero. `viewBox` com `preserveAspectRatio="none"` para caber em qualquer largura de tela sem recalcular pontos. Tabela: linhas de 36–44 px, `border-top` hairline, delta na cor semântica da métrica (§2.4 — a direção "boa" depende da métrica).

Os **chips de medida** (trocar entre Peso/Gordura/Músculo…) rolam horizontalmente até a borda do próprio card (`marginHorizontal` negativo cancelando o padding do card) — cortar dentro do padding deixava a última palavra do chip ("Ma…") visualmente truncada, achado na revisão final.

### 4.14 Laudo — faixa com marcador (`escalaDaFaixa`, `src/features/laudo/laudo.tsx`)

Barra de 8 px em `bg/app`; a **zona** de referência do fabricante pintada em `ok` a baixa opacidade, e um **marcador** de 3 px na cor da leitura, posicionado pela função pura `escalaDaFaixa` (folga de 60% da largura da faixa para cada lado, para a zona não encostar nas bordas e o marcador fora dela continuar visível). É geometria de desenho — a decisão de "dentro"/"fora" vem sempre do campo `leitura` que o servidor já resolveu (§1), nunca recalculada aqui.

Texto da leitura **neutro**: "Abaixo da faixa" / "Na faixa" / "Acima da faixa" / "No limite" / "Sem faixa" — nunca "excelente" nem "ruim". "Sem faixa" (não "0–0") quando o fabricante não publicou referência para aquela medida.

### 4.15 Estado vazio

Dentro do card, 24 px de padding vertical, centralizado: frase 14/20 `text/secondary` dizendo o que falta → ação quando houver caminho. Sem ilustração, sem texto motivacional. O **gráfico de frequência** é um caso à parte: no estado zero ele não some — desenha um traço baixo por semana elegível, porque "zero treinos" é um fato do período, e o trilho inteiro sumindo (defeito real desta versão, corrigido na revisão final) parecia um componente quebrado, não um dado ausente.

---

## 5. Padrões

### 5.1 Pendência financeira

1. Badge de status no card do plano.
2. Fatura em aberto no topo da aba Planos, com valor e vencimento.
3. Botão primário para pagar dentro do próprio bloco da fatura.

Um só caminho. Nunca bloquear a navegação do app por pendência — o bloqueio é da catraca, não do aplicativo.

### 5.2 Pagamento PIX / cartão

Segmento PIX/Cartão → PIX: código gerado **só no toque** (abrir a aba não cria cobrança) + QR + chave copiável (mono) → "Já paguei" → `EstadoDeEspera`. Cartão: **sem formulário próprio** — abre o checkout hospedado do provedor de pagamento; o app nunca coleta número, validade ou CVV (INV-098). Confirmação real vem sempre do polling do status que o servidor já gravou, nunca de uma ação local.

### 5.3 Dado de saúde e leitura assistida

Valor + unidade + delta contra a medição anterior + faixa quando existir (§4.14). Delta em `ok`/`warn`, nunca `err` — `err` é reservado a bloqueio e ação destrutiva. `AvisoDeIA` (não dispensável, `dismissible: false` no tipo) sempre antes do texto de qualquer leitura assistida, carregando `NOT_MEDICAL_DIAGNOSIS`. Nenhuma tela deste app conta pontuação física nem classifica "tipo de corpo" — não existe no domínio, e o protótipo v2 que desenha isso não foi seguido nesse ponto.

### 5.4 Engajamento (XP, ranking, desafios)

Sem conceito de **nível** — o domínio de engajamento (F31) não tem faixa de XP, e o protótipo v2 desenha "NÍVEL 3 · ATLETA"; a tela mostra o que existe: saldo do mês e sequência de semanas.

Ranking **opt-in** (`M5-BR-002`): fora dele, XP e conquistas continuam contando — só o placar não mostra o aluno. Participar é um toque; sair pede confirmação (tocar "Sair do ranking", depois confirmar) — mesma régua do PRD para mudança de privacidade reversível. O nome exibido no placar nunca é o cadastro cru: é o que o aluno escolheu (primeiro nome, apelido moderado ou anônimo), sempre em Title Case.

Uma seção desligada pelo tenant (`rankingEnabled`/`challengesEnabled`/`achievementsEnabled` em `false`) **não aparece** — nem card vazio, nem "em breve".

### 5.5 Confirmação de ação irreversível

Sair da conta (e qualquer confirmação futura do mesmo peso) usa a `Folha` (§4.2): título curto, uma frase dizendo a consequência ("Para voltar você vai precisar do e-mail e da senha"), botão **destrutivo** (§4.9) primeiro, "Cancelar" (neutro) depois.

---

## 6. Conteúdo e escrita

- Português do Brasil, tratamento direto ao aluno.
- Nome do aluno sempre em Title Case (§1), nunca na caixa do cadastro migrado.
- Título é substantivo ("Evolução", "Eventos"); botão é verbo ("Pagar", "Sair da conta").
- Leitura de faixa é neutra (§4.14) — nunca um adjetivo de valor.
- Número sempre com unidade e locale pt-BR, formatado à mão (§2 contexto) — nunca `toLocaleString`.
- Sem emoji, sem exclamação, sem gamificação forçada.
- Seção desligada pelo tenant não aparece — nunca "em breve" nem placeholder cinza.
- Estado de espera diz o que acontece se o aluno sair da tela.

---

## 7. Acessibilidade

- Contraste mínimo 4,5:1 em corpo; alvo tocável de controle a 3:1 contra a superfície (`border/default`, §2.1).
- Alvo mínimo de 44 px, exceto a pílula de período (30 px + `hitSlop`).
- Todo campo com `<label>`/`accessibilityLabel` e `autocomplete` correto.
- Estado nunca só por cor: badge sempre com ícone e texto; aba ativa sempre com `accessibilityState.selected` além da cor.
- Gráfico fora da árvore de acessibilidade (`accessibilityElementsHidden`); a tabela equivalente é o conteúdo real para quem usa leitor de tela.
- Movimento autoral respeita `AccessibilityInfo.isReduceMotionEnabled()` (§2.10) — não é CSS `prefers-reduced-motion`, é a API nativa do React Native.
- `Modal` (folha) prende o foco e o botão voltar do Android fecha a folha, não o app.

---

## 8. Checklist de revisão

**Tokens**
- [ ] Nenhum hex fora de `APP_TOKENS`
- [ ] `border/default` só em controle tocável; `border/hairline` só em card e divisor — nunca o mesmo hex para os dois
- [ ] Botão primário com `accent/gradient` e texto branco — nunca azul chapado
- [ ] `accent/ink` em traço de ícone, `accent/text` em texto — não invertidos
- [ ] Delta de métrica considera qual direção é boa PARA AQUELA MÉTRICA (§2.4) — nunca sempre "cair é bom"
- [ ] Peso obtido com `t.fonte(peso)`, nunca `fontWeight` numérico

**Tema claro**
- [ ] Card com borda `border/hairline` nos dois temas, sem exceção
- [ ] Texto sobre foto permanece `text/on-image`/`text/on-image-muted`, não inverte
- [ ] QR em `#1F2328` sobre branco, sem exceção
- [ ] **Conferido visualmente** — não há protótipo "v2 claro" para copiar; se ninguém abriu a tela no claro, isso não está verificado

**Layout**
- [ ] Só a área central rola; barra de abas e safe area fixas
- [ ] Anteparo da barra de status presente em toda tela dentro do shell (§4.7)
- [ ] Padding lateral de 20 px em todo conteúdo
- [ ] Números em série com `tabular-nums`

**Navegação**
- [ ] Cinco abas irmãs, Evolução no meio e elevada
- [ ] Atalho de tela muda de aba, nunca empilha tela nova
- [ ] Segmento interno com no máximo 2–3 opções
- [ ] Laudo é rota escondida (`href: null`) sob a aba Evolução, não uma sexta aba visível

**Componentes**
- [ ] Nada tocável abaixo de 44 px
- [ ] Um botão primário por tela; ação irreversível usa a variante destrutiva
- [ ] `EstadoDeEspera` nunca escreve "Pago" nem qualquer sinônimo de confirmado
- [ ] Estado vazio de frequência desenha os traços baixos, nunca some por inteiro
- [ ] Cartão de pagamento nunca tem campo de número/validade/CVV (INV-098)

**Saúde e engajamento**
- [ ] `AvisoDeIA` antes de qualquer texto de leitura assistida, nunca dispensável
- [ ] Leitura de faixa é o texto que o servidor mandou, nunca "excelente"/"ruim" escrito na tela
- [ ] Nenhuma tela mostra nível de XP, pontuação física nem tipo de corpo
- [ ] Ranking opt-in, com saída em dois toques
- [ ] Seção desligada pelo tenant não aparece — nunca "em breve"

**Ausências deliberadas (não reintroduzir sem decisão do PI)**
- [ ] Carteirinha com QR — `M4-FR-007` sem executor
- [ ] Formulário de dados de cartão — INV-098
- [ ] Login por biometria — sem endpoint
- [ ] Contato de WhatsApp / "Editar dados" no Perfil — sem dado nem endpoint a oferecer
