# ArenaHub — DESIGN-UI

> Documento de identidade visual e sistema de design das três superfícies do ArenaHub.
> Fonte funcional: `docs/prd/README.md` e `docs/prd/academia/MVP-00..06`.

## 1. Estado do documento

- Produto: ArenaHub — módulo Academia
- Superfícies cobertas: `admin-web` (painel), `mobile` (app do aluno), `kiosk` (totem)
- Direção adotada: **Carbono Adaptativo**
- Status: `RASCUNHO` — aguarda aprovação de produto e validação de contraste com o accent real do Complexo Arena Positiva
- Data: 14/08/2026

### 1.1 O que este documento decide

Tokens, paleta, tipografia, densidade, componentes de `packages/ui`, rótulos PT-BR dos enums de domínio e regras de acessibilidade obrigatórias.

### 1.2 O que este documento NÃO decide

- Conteúdo editorial, copy final e textos legais (LGPD, termos, privacidade) — são gate de entrada do MVP 4, não design.
- Layout da tela pública da catraca: os PRDs a definem **apenas por proibições** (MVP-01 §14). Sem requisito positivo, este documento propõe um padrão mínimo na §12.4 e o marca como pendente.
- Escolha de biblioteca headless (Radix vs. Base UI vs. Ark) — decisão de engenharia registrada na §15.

---

## 2. Antes de aceitar a direção: onde ela é frágil

A direção proposta ("Carbono primária, accent por tenant, três expressões") é implementável, mas tem quatro pontos de falha que precisam de solução explícita antes de virar código. Ignorar qualquer um deles produz um sistema que quebra em produção.

### 2.1 "Carbono" não é uma cor primária — é uma cor de estrutura

No vocabulário de design tokens, *primária* costuma significar a cor de ação: botão principal, link, foco, seleção. Carbono é um neutro escuro. Se ele for literalmente o `primary`, todo botão de ação vira cinza-escuro e a interface fica sem hierarquia de ação — o problema clássico de painéis "monocromáticos elegantes" que ninguém consegue operar rápido.

**Consequência estrutural:** se Carbono é estrutura, quem carrega a ação é o **accent do tenant**. Isso significa que o accent **deixa de ser decorativo e vira caminho crítico de acessibilidade e usabilidade**. Uma academia que configurar amarelo-neon quebra o contraste de todos os botões primários das três superfícies.

**Resolução adotada:** Carbono é `surface`/`chrome`/`text`. Accent é `action`. E o accent passa por um pipeline obrigatório de derivação e validação (§7). Não existe "aplicar o hex do cliente direto no CSS".

### 2.2 Accent configurável colide com WCAG 2.2 AA, que é requisito em quatro PRDs

`M1-NFR-008`, `M3-NFR-007`, `M4-NFR-007` e `M5-NFR-008` exigem WCAG 2.2 AA. Um valor de cor livre, definido por um recepcionista no cadastro da academia, é incompatível com uma promessa de conformidade — a menos que o sistema recuse o valor ou o corrija.

**Resolução adotada:** o tenant informa **um hue seed**, não um conjunto de cores. O sistema gera uma rampa de 10 tons e escolhe, por papel e por superfície, o tom que atende o mínimo de contraste. Se nenhum tom da rampa atender, o cadastro é rejeitado com motivo (§7.4).

### 2.3 Accent não pode carregar significado de estado

Os PRDs exigem repetidamente que **cor não seja o único indicador** (MVP-01 §14, MVP-03 §14) e que status apareça como "resultado e razão". Se o accent do tenant for verde e o sistema usa verde para `ALLOW`/sucesso, a recepção perde a leitura mais importante da operação — a catraca liberou ou negou.

**Resolução adotada:** a paleta semântica (sucesso, atenção, erro, informação, faixas de risco) é **fixa e não configurável**. O accent nunca aparece em badge de estado, em decisão de acesso, em faixa de risco ou em alerta. Isso é regra de lint, não recomendação (§14.3).

### 2.4 "Totem futurista com efeitos" colide com `M4-NFR-004` e com contraste

Efeito visual custa GPU, custa tempo de transição e tende a reduzir contraste (glow, glass, gradiente sobre texto). O totem tem três restrições duras: limpar tudo e voltar ao início **em até 2 s** (`M4-NFR-004`), WCAG 2.2 AA (`M4-NFR-007`) e não vazar nada do usuário anterior (`M4-AC-008`).

**Resolução adotada:** efeito vive **apenas na tela atrator e nas transições de estado não-crítico**. Nenhum efeito atrás de texto, valor, QR ou botão de ação. A limpeza de sessão é um corte seco, sem animação de saída — animação de saída é exatamente o que atrasa os 2 s e mantém pixel do aluno anterior na tela.

---

## 3. Recomendação base de design system

Antes de comparar direções estéticas, esta é a fundação recomendada — ela vale para qualquer direção escolhida.

### 3.1 Arquitetura de tokens em três camadas

```
Camada 1 — Primitivos          --ah-carbon-800, --ah-accent-600, --ah-red-500
   valores brutos, sem semântica, nunca usados diretamente em componente

Camada 2 — Semânticos          --ah-surface, --ah-text-primary, --ah-action,
                                --ah-state-allow, --ah-border-subtle
   um papel por token; é isto que o componente consome

Camada 3 — Expressão           --ah-radius-control, --ah-space-control-y,
                                --ah-duration-ui, --ah-font-size-body
   varia por superfície (painel / app / totem) e por densidade
```

Regra: **componente só lê camada 2 e 3**. Se um componente referencia `--ah-carbon-700`, é bug.

O accent do tenant entra apenas na camada 1, como rampa gerada. Isso permite trocar de tenant sem recompilar nem tocar em componente.

### 3.2 Stack recomendada

| Item | Escolha | Motivo |
|---|---|---|
| Estilo web | Tailwind CSS v4 com `@theme` | tokens viram CSS custom properties nativas; accent por tenant sem rebuild |
| Primitivos acessíveis | Radix Primitives | cobre foco, `aria-*` e teclado de dialog, popover, tabs — exigências de `M1-NFR-008` |
| Componentes | `packages/ui` próprio, sem copiar shadcn inteiro | shadcn assume `primary` colorido e `neutral` decorativo; nossa inversão exige tokens próprios |
| Ícones | Lucide | licença permissiva, cobertura suficiente, peso consistente |
| Gráficos | Recharts no web | precisa de `<table>` equivalente ao lado (MVP-03 §14) — não usar canvas puro |
| Mobile | Expo + `unistyles` ou StyleSheet tipado sobre os mesmos tokens em JS | tokens compartilhados via `packages/ui/tokens` (JSON → CSS + TS) |
| Fonte da verdade dos tokens | JSON em `packages/ui/tokens/*.json` | gera `.css` para web e `.ts` para Expo; um único build |

### 3.3 Como os tokens atravessam RSC, PWA e Expo

O README §5.1 fixa Server Components como padrão e restringe `use client`. O accent do tenant é dado de sessão, portanto:

- **admin-web / kiosk**: o layout de servidor injeta as CSS variables do tenant no `<html style>` a partir do `TenantContext`. Zero JS, zero flash de cor errada, zero `use client`.
- **mobile**: o accent chega no payload de bootstrap da sessão e vive num `ThemeProvider` de raiz.
- **kiosk**: o accent é fixo por provisionamento (`M4-FR-015` — totem pertence a um tenant e unidade), então é resolvido em build/config, não em runtime.

### 3.4 O que o sistema precisa ter que um design system genérico não tem

Estes são componentes exigidos pelos PRDs e que não existem em nenhuma biblioteca pronta:

1. `ProblemDetail` — renderiza `application/problem+json` com `correlationId` copiável (README §6.2).
2. `StateBadge` — 8 máquinas de estado, ~40 estados, sempre ícone + texto (§13).
3. `DataFreshness` — carimbo de atualização e marca de dado obsoleto (`M4-NFR-002`, `M6-BR-009`).
4. `TenantDateTime` — formata no timezone da **unidade**, nunca do navegador (README §6.2).
5. `Money` — recebe inteiro em centavos, nunca `float` (`M2-BR-001`).
6. `ChartWithTable` — todo gráfico com tabela equivalente (MVP-03 §14, MVP-04 §12).
7. `SensitiveAction` — confirmação explícita + step-up auth (`M1` §14, `M2` §15, `M4-FR-005`).
8. `KioskSession` — contagem regressiva com botão "preciso de mais tempo" (MVP-04 §12).

---

## 4. Três direções comparadas

| | A — Carbono Puro | B — **Carbono Adaptativo** | C — Marca do Tenant |
|---|---|---|---|
| Estrutura | Carbono nas 3 superfícies, idêntico | Carbono nas 3, densidade e temperatura diferentes | Superfície e chrome derivam da marca do cliente |
| Accent | fixo ArenaHub | seed do tenant → rampa validada | paleta completa do tenant |
| Reconhecimento do produto | alto | alto | baixo — vira ferramenta genérica |
| Custo de QA de contraste | baixo | médio, automatizável | alto, manual por tenant |
| Encaixe com `MVP-01 §6` ("customização profunda de marca" fora de escopo) | ✅ | ✅ accent é customização rasa | ❌ é exatamente o que foi excluído |
| Encaixe com "painel denso / app leve / totem alto contraste" | ❌ mesma expressão para tudo | ✅ é o ponto da direção | ⚠️ depende do tenant |
| Risco | totem fica sem impacto; app fica frio | requer pipeline de derivação (§7) | quebra WCAG e identidade |

**Escolha: B — Carbono Adaptativo.** É a única que atende simultaneamente ao multi-tenant do README §6.1 e ao limite de escopo do `MVP-01 §6`. O custo é o pipeline de accent — um trabalho de meio dia que elimina uma classe inteira de bug de acessibilidade.

---

## 5. Identidade ArenaHub

### 5.1 Conceito

**Carbono é a matéria; o accent é a energia da academia.**

O ArenaHub é infraestrutura: catraca, biometria, cobrança, dado de saúde. Infraestrutura confiável se comunica com sobriedade, peso e precisão — daí o carbono. A energia visível pertence a quem opera a academia, não ao fornecedor de software — daí o accent do tenant.

### 5.2 Atributos

| É | Não é |
|---|---|
| Preciso, operacional, legível sob pressão | Lúdico, gamificado por padrão, "fofo" |
| Sóbrio no painel, encorajador no app | Motivacional agressivo, linguagem de culpa |
| Físico e material (carbono, prata, metal escovado) | Skeuomórfico, com textura literal |
| Instantâneo (p95 < 300 ms na catraca) | Cheio de animação de transição |

### 5.3 Tom de voz — regras já fixadas pelos PRDs

Estas não são preferências, são requisitos:

- Erro sempre traz **ação possível**, nunca detalhe técnico (`MVP-04 §12`, README §6.5).
- Falha de sync traz **dispositivo, código, última tentativa e ação recomendada** — quatro campos (MVP-01 §14).
- Streak rompido **nunca usa linguagem de culpa**; pausa ou lesão não gera pressão (MVP-05 §13).
- Análise de IA de saúde tem aviso **persistente** (não dispensável) e canal para falar com profissional (MVP-03 §14).
- Score de retenção é "recomendação operacional, não fato sobre o aluno" (`M6-BR-001`).
- XP não usa vocabulário financeiro — nada de "carteira", "saldo", "resgatar" (`M5-BR-010`).

### 5.4 Marca

Logotipo em três formas: `arenahub` completo (painel, login), monograma `AH` em carbono sólido (favicon, app icon, canto do totem) e versão monocromática branca para fundo carbono. O logotipo do ArenaHub **nunca** aparece na tela pública do totem em concorrência com a marca da academia: a academia é a marca visível; o ArenaHub assina discreto no rodapé.

---

## 6. Paleta

Todos os ratios abaixo foram calculados, não estimados.

### 6.1 Carbono — estrutura, texto e superfície

| Token | Hex | vs `#FFFFFF` | vs carbono-900 | Uso |
|---|---|---|---|---|
| `carbon-950` | `#0A0B0D` | 19.69 | — | fundo do totem |
| `carbon-900` | `#121417` | 18.45 | — | fundo dark do app, chrome do painel |
| `carbon-850` | `#181B1F` | 17.28 | 1.07 | superfície elevada dark |
| `carbon-800` | `#1F2328` | 15.80 | 1.17 | card dark, sidebar do painel |
| `carbon-700` | `#2B3037` | 13.29 | 1.39 | borda em dark, texto forte em light |
| `carbon-600` | `#3C424B` | 10.13 | 1.82 | texto primário em light |
| `carbon-500` | `#565E69` | 6.56 | 2.81 | texto secundário em light ✅ AA |
| `carbon-400` | `#7B8491` | 3.78 | 4.88 | texto secundário em **dark** ✅ AA; em light só para ícone/borda ❌ |
| `carbon-300` | `#A6AEB9` | 2.24 | 8.24 | texto em dark, divisor forte em light |
| `carbon-200` | `#CBD1D9` | 1.54 | 12.00 | borda padrão em light |
| `carbon-100` | `#E5E9EE` | 1.22 | 15.13 | divisor sutil, fundo de linha alternada |
| `carbon-50` | `#F5F7F9` | 1.07 | 17.18 | canvas do painel |

⚠️ `carbon-400` reprova como texto de corpo sobre fundo claro (3.78 < 4.5). Ele existe para borda, ícone decorativo e placeholder — **nunca** para texto informativo em light. Regra de lint.

### 6.2 Prata — detalhe material

Prata não é uma segunda escala de cinza; é a camada de acabamento do totem e das bordas metálicas.

| Token | Hex | Uso |
|---|---|---|
| `silver-500` | `#A8B2BD` | traço de borda metálica |
| `silver-300` | `#D8DEE5` | superfície clara elevada no painel |
| `silver-gradient` | `linear-gradient(145deg,#D8DEE5,#8D97A3 45%,#E9EDF1)` | moldura do card do totem, borda de 1 px apenas |

Prata **nunca** é fundo de texto. Gradiente prata só como borda ou filete de 1–2 px.

### 6.3 Semânticos — fixos, não configuráveis

Dois conjuntos: `light` (sobre `#FFFFFF` / `carbon-50`) e `dark` (sobre `carbon-900` / `carbon-950`).

| Papel | Light | vs `#FFF` | Dark | vs carbon-900 | vs carbon-950 (totem) |
|---|---|---|---|---|---|
| Sucesso / `ALLOW` / `PAID` | `#157F3D` | 5.08 ✅ | `#3DDC84` | 10.34 ✅ | 11.03 ✅ |
| Atenção / `OVERDUE` / `DEGRADED` | `#8A5200` | 6.39 ✅ | `#F5A524` | 9.04 ✅ | 9.65 ✅ |
| Erro / `DENY` / `FAILED` | `#C22B2B` | 5.72 ✅ | `#FF6B6B` | 6.65 ✅ | 7.09 ✅ |
| Informação / `PENDING` | `#1F5FD0` | 5.82 ✅ | `#6AB0FF` | 8.14 ✅ | 8.69 ✅ |
| Risco alto | `#B4470B` | 5.46 ✅ | `#FF8A3D` | 7.87 ✅ | 8.40 ✅ |
| Neutro / `NOT_APPLICABLE` | `carbon-500` | 6.56 ✅ | `carbon-400` | 4.88 ✅ | 5.20 ✅ |

O totem tem alvo mais alto que AA: **7:1 para todo texto** (§11.3). Todos os tons dark acima passam.

### 6.4 Faixas de risco de retenção — `M6` §16

`M6` §16 proíbe probabilidade com falsa precisão e exige quatro faixas. Cada faixa tem cor **e** ícone **e** rótulo:

| Faixa | Light | Dark | Ícone | Nunca |
|---|---|---|---|---|
| `BAIXO` | `#157F3D` | `#3DDC84` | `shield-check` | mostrar % |
| `MÉDIO` | `#8A5200` | `#F5A524` | `alert-circle` | mostrar % |
| `ALTO` | `#B4470B` | `#FF8A3D` | `alert-triangle` | mostrar % |
| `CRÍTICO` | `#C22B2B` | `#FF6B6B` | `octagon-alert` | mostrar % |

Ao lado da faixa, sempre: intervalo publicado e versão da regra (`M6-FR-005`).

---

## 7. Accent do tenant — contrato e guardas

### 7.1 O que o tenant fornece

**Um único hex** — o seed. Nada mais. Não existe campo para "cor de botão", "cor de link" ou "cor de hover".

### 7.2 Rampa derivada

O sistema gera 10 tons preservando o hue e ajustando lightness/chroma em OKLCH. Exemplo com o accent padrão do ArenaHub, **Ciano Arena** (`#00A9B8`), usado quando o tenant não configura nada:

| Tom | Hex | vs `#FFF` | vs carbon-900 | vs carbon-950 |
|---|---|---|---|---|
| `accent-100` | `#C2F2F7` | 1.21 | 15.23 | 16.26 |
| `accent-300` | `#4FD5E3` | 1.76 | 10.51 ✅ | 11.21 ✅ |
| `accent-400` | `#1FBED0` | 2.25 | 8.20 ✅ | 8.75 ✅ |
| `accent-500` | `#00A9B8` | 2.85 | 6.47 ✅ | 6.91 |
| `accent-600` | `#008C99` | 4.03 ❌ | 4.58 | 4.89 |
| `accent-700` | `#00707B` | 5.83 ✅ | 3.17 | 3.38 |
| `accent-800` | `#005760` | 8.29 ✅ | 2.22 | 2.37 |

Repare no ponto de falha real: **texto branco sobre `accent-600` dá 4.03 e reprova**. Um sistema que usasse "o tom 600 é o botão primário" — convenção comum — entregaria botão inacessível. Por isso a seleção é por contraste calculado, não por número fixo.

### 7.3 Papéis resolvidos por superfície

| Papel semântico | Painel (light) | App (dark) | Totem (dark, alvo 7:1) |
|---|---|---|---|
| `--ah-action-solid` | menor tom com `contraste(#FFF) ≥ 4.5` → `accent-700` | menor tom com `contraste(carbon-950) ≥ 4.5` → `accent-400` | tom com `contraste(carbon-950) ≥ 7` → `accent-300` |
| `--ah-action-on-solid` | `#FFFFFF` | `carbon-950` | `carbon-950` |
| `--ah-action-text` | `accent-700` | `accent-300` | `accent-300` |
| `--ah-action-subtle-bg` | `accent-50` | `accent-900 @ 24%` | não usar |
| `--ah-focus-ring` | `accent-700`, 2 px + offset 2 px | `accent-300` | `accent-300`, 4 px |

### 7.4 Validação no cadastro do tenant

Ao salvar o seed, o backend executa e persiste o resultado:

1. Gera a rampa.
2. Verifica se existe tom com `≥ 4.5` sobre branco **e** tom com `≥ 4.5` sobre `carbon-950` **e** tom com `≥ 7` sobre `carbon-950`.
3. Se qualquer verificação falhar → rejeita com `problem+json`, `code: ACCENT_CONTRAST_UNREACHABLE`, e mensagem com ação: *"Esta cor não atinge o contraste mínimo exigido. Escolha um tom mais saturado ou mais escuro."* (padrão de mensagem da README §6.5: impacto + ação.)
4. Se passar, persiste a rampa resolvida — a UI **nunca** recalcula em runtime.

Um preview lado a lado (botão, link, badge, foco) acompanha o campo. Sem preview, o cliente escolhe pelo swatch e reclama depois.

### 7.5 Onde o accent é proibido

- Badge de qualquer máquina de estado (§13).
- Decisão de acesso `ALLOW`/`DENY`.
- Faixa de risco de retenção.
- Alerta, toast de erro, banner de degradação.
- Gráfico de saúde onde a cor indica melhora/atenção (`MVP-03 §14`).
- Qualquer superfície onde a cor seja o único portador de significado.

---

## 8. Tipografia

### 8.1 Famílias

| Papel | Família | Motivo |
|---|---|---|
| Interface | **Inter Variable** | altura-x alta, legível em 12 px no painel e a 1 m no totem; numerais tabulares |
| Números tabulares | Inter com `font-variant-numeric: tabular-nums` | obrigatório em tabela financeira, valores e horários |
| Técnico | **JetBrains Mono** | `correlationId`, código de erro, `enrollid`, versão de firmware, matrícula |
| Display do totem | Inter Variable, peso 700–800, tracking `-0.02em` | não introduzir família decorativa — custo de carga e risco de legibilidade |

Nenhuma fonte decorativa. "Futurista" no totem vem de escala, espaço negativo e luz, não de tipo.

### 8.2 Escala por superfície

| Papel | Painel | App | Totem |
|---|---|---|---|
| `display` | 28 / 34 | 32 / 38 | **64 / 68** |
| `title` | 20 / 26 | 24 / 30 | 40 / 46 |
| `heading` | 16 / 22 | 18 / 24 | 32 / 38 |
| `body` | **14 / 20** | **16 / 24** | **24 / 34** |
| `body-strong` | 14 / 20, peso 600 | 16 / 24, peso 600 | 24 / 34, peso 600 |
| `caption` | 12 / 16 | 13 / 18 | 20 / 28 |
| `mono` | 12 / 16 | 13 / 18 | não usar |

O corpo do totem é 24 px porque a leitura acontece em pé, a 60–100 cm, muitas vezes com o aluno em movimento. Nada abaixo de 20 px na superfície do totem.

Zoom de texto até 200% sem perda de conteúdo é requisito WCAG 2.2 AA — nenhum container do painel usa altura fixa em `px` para texto.

---

## 9. Espaçamento, raio, elevação e movimento

### 9.1 Espaço

Base 4 px. A superfície escolhe o passo:

| | Painel | App | Totem |
|---|---|---|---|
| Passo efetivo | 4 px | 8 px | 8 px, mínimos maiores |
| Padding de card | 16 | 20 | 40 |
| Altura de linha de tabela | 40 | — | — |
| Altura de controle | 36 | 48 | **88** |
| Alvo de toque mínimo | 24×24 (AA) | 44×44 | **88×88** |
| Gutter de página | 24 | 16 | 64 |

O alvo de 88 px no totem não vem de WCAG (que exige 24×24); vem de operação real com mão suada, luva e usuário apressado.

### 9.2 Raio

| | Painel | App | Totem |
|---|---|---|---|
| Controle | 6 | 12 | 20 |
| Card | 8 | 16 | 28 |
| Badge | 4 | 999 (pill) | 999 |
| Modal / painel de sessão | 10 | 20 | 32 |

### 9.3 Elevação

Painel usa sombra funcional apenas para camadas que flutuam (dropdown, popover, modal) — card não tem sombra, tem borda `carbon-200`. Superfície plana lê melhor em densidade alta.

```
--ah-elev-1: 0 1px 2px rgb(10 11 13 / .06)          /* dropdown */
--ah-elev-2: 0 4px 12px rgb(10 11 13 / .10)         /* popover  */
--ah-elev-3: 0 12px 32px rgb(10 11 13 / .18)        /* modal    */
```

No dark (app e totem), elevação é **luminância**, não sombra: `carbon-900 → carbon-850 → carbon-800`.

### 9.4 Movimento

| Contexto | Duração | Easing |
|---|---|---|
| Painel — feedback de controle | 120 ms | `cubic-bezier(.2,0,.2,1)` |
| Painel — abertura de camada | 180 ms | idem |
| App — transição de tela | 260 ms | spring suave |
| App — progresso, streak, XP | 400 ms | `ease-out` |
| Totem — atrator | loop 8 s | linear |
| Totem — avanço de passo | 300 ms | `ease-out` |
| **Totem — limpeza de sessão** | **0 ms** | corte seco |

A limpeza do totem é instantânea por requisito: `M4-NFR-004` dá 2 s para voltar ao início e limpar tudo, e `M4-AC-008` proíbe qualquer resquício visual do aluno anterior. Animação de saída trabalha contra os dois.

`prefers-reduced-motion: reduce` desliga toda animação decorativa nas três superfícies e mantém apenas mudança de opacidade ≤ 100 ms.

---

## 10. As três expressões

### 10.1 Painel administrativo — denso, operacional, orientado a dados

**Modo:** light-first. Canvas `carbon-50`, cards `#FFFFFF`, chrome (sidebar + topbar) `carbon-900`. Dark mode fica para v2 — a recepção opera sob luz fluorescente forte e com documento físico ao lado; light reduz troca de contexto.

**Shell:**

```
┌─ topbar carbon-900 ────────────────────────────────────────┐
│ logo │ seletor de unidade ▾ │        │ alertas │ usuário ▾ │
├──────┬──────────────────────────────────────────────────────┤
│ side │  breadcrumb                                          │
│ bar  │  título da página            [ ações primárias ]     │
│ car- │  ──────────────────────────────────────────────      │
│ bon  │  conteúdo, canvas carbon-50                          │
│ 900  │                                                      │
└──────┴──────────────────────────────────────────────────────┘
```

O **seletor de unidade** fica no topbar porque toda data, horário e política dependem dele (README §6.2 — apresentação no timezone da unidade). Trocar de unidade sem perceber é o erro operacional mais caro do painel.

**Banner de sessão elevada (Super Admin):** faixa `#B4470B` de 4 px no topo da viewport, persistente, com tenant alvo, justificativa e contagem até a expiração. README §6.1 exige elevação auditada, nunca bypass silencioso — o operador precisa **ver** que está elevado o tempo todo.

**Densidade:** tabela de 40 px por linha, 14 px de corpo, colunas com `tabular-nums`. Paginação **por cursor** (README §6.2) — sem numeração de páginas; controles são "Anteriores / Próximos" mais contador de itens carregados.

**Dashboard operacional (Slice 1.6):** quatro grupos fixos — dispositivos, acessos, recusas, backlog. O aceite exige operar um turno completo sem tocar em banco, terminal ou log bruto. Isso significa que cada card com problema precisa levar direto à ação, não a um relatório.

### 10.2 App do aluno — leve, motivacional, orientado a progresso

**Modo:** dark-first (`carbon-900`), light seguindo o sistema operacional. Dark porque o uso acontece dentro da academia, muitas vezes com luz baixa, e porque o accent do tenant brilha melhor sobre carbono — é ali que a marca da academia aparece.

**Home (`GET /mobile/home`):**

```
┌──────────────────────────────────┐
│  Bom treino, Rodrigo             │  saudação neutra, sem métrica de culpa
│  ┌────────────────────────────┐  │
│  │ PLANO ATIVO                │  │  StateBadge, cor semântica (não accent)
│  │ Próxima cobrança 05/09     │  │  TenantDateTime
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ [ Carteirinha ]            │  │  ação primária, accent-solid
│  └────────────────────────────┘  │
│  Frequência · últimos 30 dias    │  ChartWithTable
│  ▁▃▅▂▆▇▃                        │
│  Atualizado às 14:32             │  DataFreshness — obrigatório (MVP-04 §12)
└──────────────────────────────────┘
```

**Regra estrutural — `M4-BR-008`:** o app **não recalcula** estado financeiro, de acesso ou de saúde. Ele renderiza a decisão do backend. Na prática: nenhum `if (dueDate < today) show('atrasado')` no cliente. O backend manda estado e rótulo; o app escolhe cor e ícone a partir do enum.

**Carteirinha com QR rotativo:** QR grande, centralizado, com barra de validade decrescente. `M4-BR-002` — token opaco, sem PII. Nada de nome grande, CPF ou valor em aberto na mesma tela, porque a carteirinha é mostrada a terceiros.

**Pagamento:** após o checkout, a tela é **"Aguardando confirmação"**, nunca "Pago". `M4-BR-001` e `M2-BR-004` são explícitos: retorno visual do checkout não confirma pagamento; só o webhook confirma. A tela de espera mostra o SLO real (`M2-NFR-001`, p95 < 30 s) e permite sair sem perder o contexto.

**Engajamento:** todos os toggles nascem **desligados** (`M5-BR-001`). Opt-out e denúncia ficam a no máximo dois toques da tela de engajamento (`MVP-05 §13` — "não escondidos em menus profundos"). Streak rompido usa fato, não julgamento: *"Sua sequência recomeça hoje"*, não *"Você perdeu sua sequência"*.

### 10.3 Totem — alto contraste, poucos elementos, ações grandes

**Modo:** dark exclusivo, `carbon-950`. Sem light mode — o totem controla o próprio ambiente visual.

**Onde mora o "futurista":** exclusivamente na tela atrator e na moldura.

- Atrator: gradiente radial lento do accent sobre carbono, partículas discretas, logo da academia em prata, chamada única — *"Toque para começar"*.
- Moldura do card ativo: filete de 1 px com `silver-gradient` e um glow externo do accent a 12% de opacidade.
- Barra de progresso da sessão: linha de 4 px no topo, accent, decrescente.

**Onde ele é proibido:** atrás de texto, valor, QR ou botão. Fundo de conteúdo é `carbon-950` chapado.

**Uma pergunta por tela.** No máximo **três** ações visíveis. Botão de 88 px de altura, largura mínima de 320 px, rótulo em 24 px.

**Sessão (`M4-FR-019`, `M4-BR-005`, `MVP-04 §12`):**

```
┌─ carbon-950 ─────────────────────────────────────────┐
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░  accent, decrescente       │
│                                                       │
│                Situação do plano                      │
│                                                       │
│     ┌───────────────────────────────────────┐         │
│     │  ⚠  Pendência em aberto               │         │  sem valor (M4-BR-007)
│     │     Regularize para liberar o acesso  │         │
│     └───────────────────────────────────────┘         │
│                                                       │
│     [        Pagar com PIX        ]  88 px            │
│     [        Ver no celular       ]                   │
│                                                       │
│                                    [ Encerrar ]       │
│  Sessão encerra em 40 s   [ Preciso de mais tempo ]   │
└───────────────────────────────────────────────────────┘
```

O botão **"Preciso de mais tempo"** é requisito de acessibilidade (`MVP-04 §12` — "tempo adicional sob solicitação") e também requisito de WCAG 2.2 AA (critério *Timing Adjustable*). Ele precisa estar sempre visível durante contagem, não escondido atrás de um modal de aviso.

**Encerramento:** ao expirar, cortar para o atrator em 0 ms e limpar memória, storage, cache visual, clipboard, autofill e fila de impressão (`M4-FR-020`, `M4-BR-006`). Todo input do totem tem `autocomplete="off"` e `inputmode` explícito.

**Tela técnica (`M4-FR-022`):** acessível **sem abrir sessão de aluno**, por gesto reservado (toque longo de 5 s no canto inferior direito) mais PIN do operador. Mostra versão, conectividade, unidade, tenant e última sincronização. Nenhum dado de aluno.

**Alto contraste sob demanda:** botão na tela inicial eleva todo texto para `#FFFFFF` puro, remove glow e gradiente e aumenta a espessura de borda para 2 px.

---

## 11. Acessibilidade — WCAG 2.2 AA

Exigido por `M1-NFR-008`, `M3-NFR-007`, `M4-NFR-007` e `M5-NFR-008`.

### 11.1 Regras não negociáveis

1. **Cor nunca é o único canal.** Todo estado carrega ícone + rótulo textual (MVP-01 §14, MVP-03 §14). `StateBadge` torna isso estrutural: o componente não aceita renderizar sem `label`.
2. **Todo gráfico tem tabela equivalente.** `ChartWithTable` renderiza `<table>` real, disponível por toggle e sempre presente no DOM para leitor de tela (MVP-03 §14, MVP-04 §12).
3. **Formulário nunca limpa dado em erro recuperável** (MVP-01 §14).
4. **Unidade de medida ao lado do campo**, não no placeholder (MVP-03 §14).
5. **Ausência de dado não é zero.** Renderizar `—` com `aria-label="não informado"`; no gráfico, quebrar a linha, nunca plotar 0 (`M3-BR-005`).
6. **Foco visível em tudo**, anel de 2 px + offset de 2 px, 4 px no totem.
7. **Ação destrutiva e logout exigem confirmação** (MVP-04 §12).
8. **Zoom até 200%** sem perda de conteúdo ou função.

### 11.2 Alvos de toque

| Superfície | Mínimo | Base |
|---|---|---|
| Painel | 24×24 (AA) | 32×32 recomendado |
| App | 44×44 | — |
| Totem | 88×88 | — |

### 11.3 Contraste

| Superfície | Alvo |
|---|---|
| Painel e app | 4.5:1 texto normal, 3:1 texto grande e componentes |
| **Totem** | **7:1 texto normal**, 4.5:1 texto grande |

O totem excede AA deliberadamente por causa da distância de leitura e da variação de luz ambiente na recepção.

### 11.4 Verificação

- `axe-core` no Playwright cobrindo os fluxos essenciais do painel, do kiosk e as telas do app com `jest-axe` equivalente.
- Teste unitário de token que falha o build se qualquer par `text/surface` da camada 2 ficar abaixo do alvo — incluindo os pares derivados do accent do tenant.

---

## 12. Padrões críticos

### 12.1 Erro — `problem+json` (README §6.2)

```
┌──────────────────────────────────────────────┐
│ ⚠  Não foi possível sincronizar o dispositivo│  title
│    Catraca 02 · Recepção                     │  contexto
│    Última tentativa: 14:32 (America/Sao_Paulo)│
│    O que fazer: verifique a rede local e     │  ação — obrigatório
│    tente novamente.                          │
│    [ Tentar novamente ]                      │
│    DEVICE_SYNC_TIMEOUT · a1b2c3d4  [copiar]  │  code + correlationId, mono
└──────────────────────────────────────────────┘
```

O `correlationId` é copiável em um clique — é o que o suporte pede. Detalhe interno, stack e PII nunca aparecem.

### 12.2 Dado desatualizado (`M4-NFR-002`, `M6-BR-009`, MVP-01 §14)

Três estados distintos, nunca colapsados:

| Estado | Visual |
|---|---|
| Atual | `Atualizado às 14:32` em `caption` neutro |
| Desatualizado | mesma linha em cor de atenção + ícone `clock-alert` + idade explícita (`há 3 dias`) |
| Indisponível | skeleton + `Não foi possível carregar` + ação de recarregar |

O painel operacional mostra **idade do cache offline do Edge**, não apenas online/offline (MVP-01 §14).

### 12.3 Ação sensível — `SensitiveAction`

Override manual de acesso, revogação biométrica, estorno, pagamento manual acima do limite e kill switch de modelo compartilham o mesmo padrão: modal com resumo do efeito, **motivo obrigatório**, step-up authentication quando o valor ou a permissão exigirem (`M2` §15, `M4-FR-005`), botão de confirmação com o verbo real ("Revogar biometria"), nunca "OK".

### 12.4 Tela pública da catraca — **proposta, pendente de aprovação**

Os PRDs só a definem por proibições. Proposta mínima: fundo `carbon-950`, resultado em `display` 64 px, razão em `body` 24 px, ícone grande, sem nome completo, sem CPF, sem valor, sem qualquer menção a pendência financeira.

```
   ✓  ACESSO LIBERADO          ✕  ACESSO NÃO LIBERADO
      Rodrigo R.                  Procure a recepção
```

Em `DENY`, a razão exibida ao público é sempre a mesma frase genérica — a razão técnica (`NO_ENTITLEMENT`, `OUTSIDE_SCHEDULE`, `ADMIN_BLOCK`, inadimplência) vai só para o painel. Diferenciar publicamente expõe situação financeira, o que `M2` §15 e `M4-BR-007` proíbem.

---

## 13. Estados de domínio → badges

README §8 fixa: domínio em inglês no código, **português na interface**. Este é o dicionário canônico.

| Máquina | Estado | Rótulo PT-BR | Cor | Ícone |
|---|---|---|---|---|
| Student | `LEAD` | Lead | neutro | `user-plus` |
| | `TRIAL` | Experimental | info | `hourglass` |
| | `ACTIVE` | Ativo | sucesso | `user-check` |
| | `SUSPENDED` | Suspenso | atenção | `user-minus` |
| | `BLOCKED` | Bloqueado | erro | `user-x` |
| | `CANCELLED` | Cancelado | neutro | `x-circle` |
| | `ARCHIVED` | Arquivado | neutro | `archive` |
| Subscription | `PENDING` | Aguardando início | info | `clock` |
| | `ACTIVE` | Ativa | sucesso | `check-circle` |
| | `PAST_DUE` | Em atraso | atenção | `alert-circle` |
| | `PAUSED` | Pausada | neutro | `pause-circle` |
| | `CANCELLED` | Cancelada | neutro | `x-circle` |
| | `EXPIRED` | Expirada | neutro | `calendar-x` |
| Entitlement | `SCHEDULED` | Agendado | info | `calendar-clock` |
| | `ACTIVE` | Válido | sucesso | `key-round` |
| | `SUSPENDED` | Suspenso | atenção | `key-off` |
| | `REVOKED` | Revogado | erro | `ban` |
| | `EXPIRED` | Expirado | neutro | `calendar-x` |
| BiometricIdentity | `PENDING_CONSENT` | Aguardando consentimento | info | `file-signature` |
| | `ACTIVE` | Cadastrada | sucesso | `scan-face` |
| | `REVOKED` | Revogada | neutro | `ban` |
| | `DELETION_PENDING` | Exclusão em andamento | atenção | `trash-2` |
| | `DELETED` | Excluída | neutro | `trash-2` |
| DeviceSyncJob | `PENDING` | Na fila | info | `clock` |
| | `PROCESSING` | Processando | info | `loader` |
| | `SYNCED` | Sincronizado | sucesso | `check` |
| | `FAILED` | Falhou | erro | `x-octagon` |
| | `RETRYING` | Tentando novamente | atenção | `refresh-cw` |
| | `REMOVED` | Removido | neutro | `minus-circle` |
| Device | `PROVISIONING` | Provisionando | info | `settings` |
| | `ONLINE` | Online | sucesso | `wifi` |
| | `DEGRADED` | Degradado | atenção | `wifi-low` |
| | `OFFLINE` | Offline | erro | `wifi-off` |
| | `RETIRED` | Desativado | neutro | `power-off` |
| AccessDecision | `ALLOW` | Liberado | sucesso | `check-circle` |
| | `DENY` | Negado | erro | `x-circle` |
| Passage | `NOT_APPLICABLE` | Não aplicável | neutro | `minus` |
| | `PENDING` | Aguardando giro | info | `loader` |
| | `CONFIRMED` | Confirmada | sucesso | `check` |
| | `TIMED_OUT` | Sem giro | atenção | `timer-off` |
| Invoice | `DRAFT` / `OPEN` / `PAID` / `OVERDUE` / `CANCELLED` / `REFUNDED` | Rascunho / Em aberto / Paga / Vencida / Cancelada / Estornada | neutro / info / sucesso / atenção / neutro / neutro | — |
| Payment | `PENDING` / `PROCESSING` / `CONFIRMED` / `FAILED` / `CANCELLED` / `REFUND_PENDING` / `REFUNDED` | Pendente / Processando / Confirmado / Falhou / Cancelado / Estorno em andamento / Estornado | info / info / sucesso / erro / neutro / atenção / neutro | — |
| PaymentAttempt | `REQUIRES_ACTION` | Ação necessária | atenção | `hand` |
| Reconciliation | `MATCHED` / `MISSING_INTERNAL` / `MISSING_EXTERNAL` / `AMOUNT_MISMATCH` / `RESOLVED` | Conciliado / Ausente no ArenaHub / Ausente no provedor / Valor divergente / Resolvido | sucesso / erro / erro / atenção / neutro | — |

**`Passage: NOT_APPLICABLE` importa:** nem todo equipamento confirma giro. A UI não pode assumir que toda decisão tem passagem — este estado existe para impedir que a operação leia "sem confirmação" como falha.

Regra de implementação: o mapa enum → `{ label, tone, icon }` vive num único arquivo em `packages/ui`. Nenhum componente escreve rótulo inline.

---

## 14. Componentes de `packages/ui`

### 14.1 Inventário mínimo

| Componente | Superfícies | Origem do requisito |
|---|---|---|
| `Button` (solid / outline / ghost / destructive) | todas | — |
| `StateBadge` | painel, app | §13 |
| `ProblemDetail` | todas | README §6.2 |
| `DataFreshness` | app, painel | `M4-NFR-002`, `M6-BR-009` |
| `TenantDateTime` | todas | README §6.2 |
| `Money` (centavos → BRL) | painel, app, totem | `M2-BR-001` |
| `MaskedCPF` | painel | MVP-01 §14 |
| `DataTable` (cursor) | painel | README §6.2 |
| `ChartWithTable` | painel, app | MVP-03 §14 |
| `SensitiveAction` | painel, app | §12.3 |
| `ConsentCard` | painel, app | `M1-FR-013`, `M3-FR-001`, `M5-FR-001` |
| `EmptyState` | todas | Slice 4.2 |
| `AsyncJobStatus` | painel, app | `M1-NFR-009`, `M3-NFR-003` |
| `RiskBand` | painel | `M6` §16 |
| `AIDisclaimer` (persistente) | painel, app | MVP-03 §14 |
| `KioskSession` | totem | `M4-FR-019`, `M4-BR-005` |
| `KioskAction` (88 px) | totem | §9.1 |
| `ElevatedSessionBanner` | painel | README §6.1 |

### 14.2 `StateBadge` — especificação

**API**

| Prop | Tipo | Padrão | Descrição |
|---|---|---|---|
| `machine` | `'student' \| 'subscription' \| 'entitlement' \| 'biometric' \| 'syncJob' \| 'device' \| 'access' \| 'passage' \| 'invoice' \| 'payment' \| 'reconciliation'` | — | seleciona o dicionário |
| `state` | string do enum | — | valor técnico vindo da API |
| `size` | `'sm' \| 'md'` | `'md'` | — |
| `showIcon` | `boolean` | `true` | **não pode ser `false` quando o badge é o único portador de estado** |

**Estados visuais:** fundo = tom semântico a 10% (light) ou 18% (dark); borda = tom a 30%; texto e ícone = tom sólido validado.

**Acessibilidade:** `role="status"` quando muda em tempo real; o texto é conteúdo real, não `aria-label` — leitor de tela e usuário veem a mesma coisa.

| ✅ Fazer | ❌ Não fazer |
|---|---|
| `<StateBadge machine="device" state="DEGRADED" />` | ponto colorido sem texto |
| Manter o rótulo PT-BR no dicionário central | escrever "Offline" inline no JSX |
| Usar tom semântico | usar accent do tenant |

### 14.3 Regras de lint que sustentam o sistema

Sem estas, o sistema degrada em três sprints:

1. Proibir hex literal fora de `packages/ui/tokens` (`no-restricted-syntax` sobre `/#[0-9a-f]{3,8}/i`).
2. Proibir componente que leia token da camada 1 (`--ah-carbon-*`, `--ah-accent-[0-9]`).
3. Proibir `--ah-action-*` dentro de arquivos de badge, alerta e gráfico de estado.
4. Falhar o build se um par texto/superfície da camada 2 ficar abaixo do alvo de contraste, incluindo os derivados do accent.
5. Proibir `new Date().toLocaleString()` fora de `TenantDateTime`.
6. Proibir aritmética de moeda em `number` fora de `Money`.

---

## 15. Implementação

### 15.1 Fonte da verdade

```
packages/ui/
├── tokens/
│   ├── primitive.json      # carbono, prata, semânticos
│   ├── semantic.json       # camada 2, por modo (light/dark)
│   ├── expression.json     # camada 3, por superfície
│   └── build.ts            # → theme.css (web) + tokens.ts (Expo)
├── domain/
│   └── state-labels.ts     # dicionário do §13
├── primitives/             # Button, Badge, Input, ...
├── patterns/               # ProblemDetail, DataTable, ChartWithTable, ...
└── kiosk/                  # KioskAction, KioskSession
```

### 15.2 Accent no servidor, sem flash e sem `use client`

```tsx
// apps/admin-web/app/layout.tsx  — Server Component
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { accentRamp } = await getTenantTheme(); // rampa já validada e persistida
  return (
    <html lang="pt-BR" data-surface="panel" data-mode="light" style={accentRamp.cssVars}>
      <body>{children}</body>
    </html>
  );
}
```

`data-surface` seleciona a camada 3; `data-mode` seleciona a camada 2. Nenhum provider de tema no cliente, nenhum flash de cor errada.

### 15.3 Expo

Os mesmos JSON geram `tokens.ts`. O accent chega no bootstrap da sessão e alimenta um contexto de raiz. O app é `data-surface="app"`, `data-mode="dark"` por padrão.

### 15.4 Kiosk

Accent resolvido em configuração de provisionamento (`M4-FR-015`), não em runtime. `data-surface="kiosk"`, `data-mode="dark"`, sem alternância de modo.

---

## 16. Rollout por MVP

| MVP | Entrega de design |
|---|---|
| 1 | Tokens completos, expressão do painel, `StateBadge`, `ProblemDetail`, `DataTable`, `TenantDateTime`, `SensitiveAction`, `ElevatedSessionBanner`, pipeline de accent |
| 2 | `Money`, `AsyncJobStatus`, padrão de timeline financeira, tela de aguardando confirmação |
| 3 | `ChartWithTable`, `AIDisclaimer`, padrão de revisão campo a campo com confiança e origem |
| 4 | Expressão do app e do totem, `KioskSession`, `KioskAction`, alto contraste sob demanda, tela técnica |
| 5 | Padrões de opt-in, identidade pública, estado "ranking indisponível por privacidade" |
| 6 | `RiskBand`, card de score com os oito elementos do `M6` §16 |

---

## 17. Decisões pendentes

Nenhuma delas foi inventada aqui — todas são lacunas reais dos PRDs.

| # | Pendência | Origem | Proposta deste documento |
|---|---|---|---|
| 1 | Tela pública da catraca só tem proibições | MVP-01 §14 | §12.4 — aprovar ou substituir |
| 2 | Lista canônica de razões de `DENY` não está fechada | README §8 dá 3; `M1-FR-020` avalia 5 dimensões; MVP-2 acrescenta inadimplência | fechar a lista antes do dicionário de rótulos |
| 3 | Timeout de inatividade do totem em segundos | `M4-BR-005` só diz "antes da sessão mobile" | sugerido 60 s com aviso aos 20 s |
| 4 | Dark mode do painel | não consta | v2, após o piloto |
| 5 | i18n multi-idioma | README §8 fixa só PT-BR | fora de escopo; estruturar rótulos em dicionário desde já |
| 6 | O que o totem imprime | `M4-FR-020` cita impressão, sem conteúdo | definir no MVP 4 |
| 7 | Accent padrão comercial do ArenaHub | não consta | Ciano Arena `#00A9B8` — validar com marketing |
| 8 | Breakpoints e responsividade do painel | não consta | mínimo 1280 px para operação; 1024 px degradado |
