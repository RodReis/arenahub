# ArenaHub — Design System da superfície `mobile`

> App do aluno (Expo / React Native). Recorte da direção **Carbono Adaptativo** para a superfície de progresso.
> Fonte: `uploads/DESIGN-UI.md`. Este documento é o contrato de implementação do app.
> Data: 16/08/2026 · Status: `RASCUNHO`

---

## 1. Identidade da superfície

**Leve, encorajador, orientado a progresso.** Dark-first (`carbon-900`), light seguindo o sistema operacional. Dark porque o uso acontece dentro da academia, muitas vezes com luz baixa, e porque o accent do tenant brilha melhor sobre carbono — é no app que a marca da academia aparece.

| Atributo | Valor |
|---|---|
| Seletores | `data-surface="app"` · `data-mode="dark"` por padrão |
| Passo de espaço | 8 px |
| Corpo de texto | 16 / 24 |
| Altura de controle | 48 px |
| Alvo de toque | 44 × 44 |
| Contraste | 4.5:1 texto normal · 3:1 texto grande e componentes |

**Regra estrutural:** o app **não recalcula** estado financeiro, de acesso ou de saúde. Ele renderiza a decisão do backend. Nenhum `if (dueDate < today) show('atrasado')` no cliente — o backend manda estado e rótulo; o app escolhe cor e ícone a partir do enum.

---

## 2. Paleta

### 2.1 Superfícies em dark

Elevação é **luminância, não sombra**. Cada camada sobe um passo de carbono.

| Token | Hex | Uso |
|---|---|---|
| `carbon-900` | `#121417` | fundo da tela |
| `carbon-850` | `#181B1F` | card padrão |
| `carbon-800` | `#1F2328` | card de destaque, avatar, chip |
| `carbon-700` | `#2B3037` | borda e divisor |

### 2.2 Texto sobre `carbon-900`

| Token | Hex | Ratio | Uso |
|---|---|---|---|
| branco | `#FFFFFF` | 18.45 | título, valor em destaque |
| `carbon-50` | `#F5F7F9` | 17.18 | corpo |
| `carbon-300` | `#A6AEB9` | 8.24 | texto secundário e apoio |
| `carbon-400` | `#7B8491` | 4.88 | legenda, carimbo de atualização |

Em dark, `carbon-400` **passa** como texto secundário (4.88 ≥ 4.5) — ao contrário do que acontece em light.

### 2.3 Semânticos em dark — fixos, não configuráveis

| Papel | Hex | vs `carbon-900` | Ícone | Uso |
|---|---|---|---|---|
| Sucesso | `#3DDC84` | 10.34 | `check-circle` | plano ativo, pagamento confirmado, meta atingida |
| Atenção | `#F5A524` | 9.04 | `alert-circle` | em atraso, streak, chama de sequência |
| Erro | `#FF6B6B` | 6.65 | `x-circle` | pagamento recusado, alerta de saúde |
| Informação | `#6AB0FF` | 8.14 | `clock` | aguardando webhook, aviso de IA |
| Risco alto | `#FF8A3D` | 7.87 | `alert-triangle` | **não exibido ao aluno** — existe só no painel |
| Neutro | `carbon-400` | 4.88 | `minus` | ausência de dado |

Badge em dark: fundo = tom a 18%, borda = tom a 34%, texto e ícone = tom sólido. Raio pill (999).

### 2.4 Accent resolvido para dark

| Tom | Hex | vs `carbon-900` | Papel |
|---|---|---|---|
| `accent-300` | `#4FD5E3` | 10.51 | `--ah-action-text`, link, ícone de ação, `--ah-focus-ring` |
| `accent-400` | `#1FBED0` | 8.20 | `--ah-action-solid` — texto sobre ela é `carbon-950` |
| `accent-500` | `#00A9B8` | 6.47 | indicador ao vivo, barra de progresso |
| `accent-900 @ 24%` | — | — | `--ah-action-subtle-bg` |

O accent chega no payload de bootstrap da sessão e vive num `ThemeProvider` de raiz.

**Accent é proibido em:** badge de estado, decisão de acesso, faixa de risco, alerta, toast de erro e gráfico de saúde onde a cor indica melhora ou atenção.

---

## 3. Tipografia

| Token | Especificação | Uso |
|---|---|---|
| `display` | 32 / 38 · 800 | valor monetário grande, número de destaque |
| `title` | 24 / 30 · 700 | saudação, título de tela |
| `heading` | 18 / 24 · 600 | título de card, estado de espera |
| `body` | 16 / 24 · 400 | corpo |
| `body-strong` | 16 / 24 · 600 | nome do plano, item de lista |
| `caption` | 13 / 18 · 400 | carimbo de atualização, apoio |
| `mono` | 13 / 18 · 400 | matrícula |

Corpo em 16 px também evita o zoom automático de campo em iOS. `tabular-nums` em todo valor, peso, medida e contador.

---

## 4. Espaço, raio, movimento

| Item | Valor |
|---|---|
| Passo efetivo | 8 px |
| Padding de card | 20 px |
| Gutter de tela | 16 px |
| Altura de controle | 48 px |
| Alvo de toque mínimo | 44 × 44 px |
| Raio · controle / card / badge / sheet | 12 / 16 / pill / 20 px |

| Contexto | Duração | Easing |
|---|---|---|
| Transição de tela | 260 ms | spring suave |
| Progresso, streak, XP | 400 ms | `ease-out` |
| Feedback de toque | 120 ms | — |
| `prefers-reduced-motion` | só opacidade ≤ 100 ms | — |

Progresso, streak e XP são o **único** lugar do sistema onde a animação é celebrativa.

---

## 5. Estrutura

Barra de abas com quatro destinos, sempre ícone **mais** rótulo: Início, Pagar, Evolução, Ranking.

### Home (`GET /mobile/home`)

```
┌──────────────────────────────────┐
│  Boa tarde, Rodrigo              │  saudação neutra, sem métrica de culpa
│  ┌────────────────────────────┐  │
│  │ Mensal Fit        [Ativa]  │  │  StateBadge, cor semântica
│  │ Próxima cobrança 01/09     │  │  TenantDateTime
│  └────────────────────────────┘  │
│  [ Abrir carteirinha ]           │  ação primária, accent-400
│  Frequência · 30 dias            │  ChartWithTable
│  ▁▃▅▂▆▇▃                        │
│  🔥 6 semanas consecutivas        │
│  Atualizado às 14:32             │  DataFreshness — obrigatório
└──────────────────────────────────┘
```

Dia sem treino é um traço de 8 px em `carbon-800` — nunca uma barra vazia de altura total, que lê como falha.

---

## 6. Controles

| Variante | Especificação |
|---|---|
| Solid | `accent-400`, texto `carbon-950`, hover `accent-300` |
| Outline | borda `carbon-700`, texto `accent-300` |
| Ghost | texto `accent-300`, fundo de pressão `carbon-800` |
| Destructive | borda `rgba(255,107,107,.5)`, texto `#FF6B6B` |
| Disabled | fundo e borda `carbon-800`, texto `carbon-500` |

Campos: altura 48 px, raio 12 px, fundo `carbon-900`, borda `carbon-700`, foco `accent-300` 2 px + offset 2 px. `inputmode` explícito em todo campo numérico.

---

## 7. Padrões que o app não pode errar

### 7.1 Pagamento — nunca "Pago"

Após o checkout a tela é **"Aguardando confirmação"**. O retorno visual do checkout **não confirma pagamento**; só o webhook confirma. A tela mostra o SLO real (p95 < 30 s) e permite sair sem perder o contexto.

```
┌────────────────────────────────┐
│           ⟳                    │
│   Aguardando confirmação        │
│   O banco confirma em até 30 s. │
│   Você pode sair desta tela.    │
│        [ Processando ]          │
└────────────────────────────────┘
```

### 7.2 Carteirinha — mostrada a terceiros

QR grande, centralizado, com barra de validade decrescente. Token **opaco, sem PII**. Nada de nome completo, CPF ou valor em aberto na mesma tela.

### 7.3 Saúde e IA

Aviso **persistente e não dispensável** em toda tela de saúde, com o canal para falar com um profissional ao lado dele. Todo gráfico tem tabela equivalente por alternador. Ausência de dado renderiza `—`; no gráfico, a linha **quebra** em vez de plotar zero.

Achado de aparelho (ex.: possível fibrilação atrial no ECG) é atribuído ao equipamento, apresentado como pedido de avaliação médica e nunca como diagnóstico. A ação primária é agendar conversa com o profissional.

### 7.4 Engajamento

Todos os toggles nascem **desligados**. Opt-out e denúncia ficam a no máximo **dois toques** da tela de engajamento, nunca escondidos em menu profundo. Quando o aluno está fora do ranking, a tela explica a escolha e como aparecer — não trata a ausência como erro.

XP não usa vocabulário financeiro: nada de "carteira", "saldo" ou "resgatar".

---

## 8. Tom de voz

| ✅ Escrever assim | ❌ Nunca assim |
|---|---|
| Sua sequência recomeça hoje. | Você perdeu sua sequência. |
| Aguardando confirmação do banco. | Pagamento aprovado! |
| Fatura de agosto vencida em 10/08. O acesso é liberado assim que o pagamento for confirmado. | Você está inadimplente e bloqueado. |
| Ponto de atenção: hidratação abaixo da faixa nas duas últimas medições. | Você está desidratado. |
| Não foi possível carregar sua frequência. Tentar novamente. | Erro 500: falha interna do servidor. |
| 1.240 XP no total · +10 por treino. | Saldo de 1.240 pontos · resgatar. |

Erro sempre traz **ação possível**, nunca detalhe técnico. Streak rompido usa fato, não julgamento — pausa ou lesão não gera pressão.

---

## 9. Componentes usados nesta superfície

| Componente | Observação |
|---|---|
| `Button` | 48 px, raio 12 |
| `StateBadge` | pill, fundo a 18% |
| `DataFreshness` | obrigatório em toda tela com dado remoto |
| `TenantDateTime` | timezone da unidade, nunca do aparelho |
| `Money` | centavos inteiros, nunca calculado no cliente |
| `ChartWithTable` | tabela equivalente por alternador |
| `AIDisclaimer` | persistente, não dispensável |
| `ConsentCard` | revogação de consentimento opcional pelo app |
| `SensitiveAction` | cancelamento de plano, revogação de biometria |
| `EmptyState` | ranking indisponível por privacidade, sem avaliação ainda |
| `AsyncJobStatus` | espera de webhook de pagamento |

---

## 10. Regras estruturais

1. O app não recalcula estado financeiro, de acesso ou de saúde — renderiza a decisão do backend com o enum recebido.
2. Nenhuma comparação de data para derivar estado no cliente.
3. Toda data e horário no timezone da **unidade**, nunca do aparelho.
4. Valor monetário chega em centavos inteiros e nunca é calculado no cliente.
5. Ausência de dado renderiza `—`; no gráfico, a linha quebra.
6. Foco visível de 2 px em `accent-300` em todo controle, inclusive com teclado externo.
7. Aviso de IA persistente e não dispensável em toda tela de saúde.
8. Opt-in de engajamento desligado por padrão, com opt-out a dois toques.
9. Cor nunca é o único canal: todo estado carrega ícone e rótulo.
10. Zoom de texto do sistema até 200% sem perda de conteúdo.

---

## 11. Implementação

Os mesmos JSON de `packages/ui/tokens` geram `tokens.ts` para Expo. O accent chega no bootstrap da sessão e alimenta um contexto de raiz. O app é `data-surface="app"`, `data-mode="dark"` por padrão, com light seguindo o sistema operacional.

```
packages/ui/tokens/
├── primitive.json    # carbono, prata, semânticos
├── semantic.json     # por modo (light/dark)
├── expression.json   # por superfície
└── build.ts          # → theme.css (web) + tokens.ts (Expo)
```

---

## 12. Pendências desta superfície

| # | Pendência | Proposta |
|---|---|---|
| 1 | Light mode do app | seguir o SO desde o MVP 4; validar contraste dos semânticos light |
| 2 | Notificação push — tom e frequência | definir junto com o módulo de notificações |
| 3 | Widget de carteirinha fora do app | fora de escopo até o piloto |
