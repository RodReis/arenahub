# ArenaHub — Design System da superfície `kiosk`

> Totem de autoatendimento. Recorte da direção **Carbono Adaptativo** para a superfície de recepção.
> Fonte: `uploads/DESIGN-UI.md`. Este documento é o contrato de implementação do totem.
> Data: 16/08/2026 · Status: `RASCUNHO`

---

## 1. Identidade da superfície

**Alto contraste, poucos elementos, ações grandes.** Dark exclusivo, `carbon-950`. Sem light mode: o totem controla o próprio ambiente visual.

| Atributo | Valor |
|---|---|
| Seletores | `data-surface="kiosk"` · `data-mode="dark"`, sem alternância |
| Resolução | 1080 × 1920, retrato |
| Passo de espaço | 8 px, com mínimos maiores |
| Corpo de texto | 24 / 34 — **nada abaixo de 20 px** |
| Altura de ação | 88 px, largura mínima 320 px |
| Alvo de toque | 88 × 88 |
| Contraste | **7:1 texto normal** · 4.5:1 texto grande |

O alvo de 7:1 excede AA deliberadamente: a leitura acontece em pé, a 60–100 cm, sob luz variável de recepção, muitas vezes com o aluno em movimento.

**Uma pergunta por tela. No máximo três ações visíveis.**

---

## 2. Paleta

Ratios calculados contra `carbon-950` `#0A0B0D`.

| Token | Hex | vs `carbon-950` | Uso |
|---|---|---|---|
| `carbon-950` | `#0A0B0D` | — | fundo único de toda tela e de todo conteúdo |
| `carbon-900` | `#121417` | 1.06 | card e superfície elevada |
| `carbon-800` | `#1F2328` | 1.31 | trilho de barra de progresso, tecla |
| `carbon-700` | `#2B3037` | 1.56 | borda de 2 px |
| `carbon-300` | `#A6AEB9` | 8.80 | texto de apoio — **mínimo aceitável** |
| branco | `#FFFFFF` | 19.69 | título, valor, rótulo de botão |
| `accent-300` | `#4FD5E3` | 11.21 | ação sólida, foco de 4 px, barra de sessão |
| `accent-500` | `#00A9B8` | 6.91 | só no gradiente do atrator, **nunca em texto** |
| `silver-500` | `#A8B2BD` | 9.16 | filete metálico da moldura |

### 2.1 Accent

```
--ah-action-solid      accent-300     tom com contraste(carbon-950) ≥ 7
--ah-action-on-solid   carbon-950
--ah-action-text       accent-300
--ah-action-subtle-bg  não usar nesta superfície
--ah-focus-ring        accent-300, 4 px
```

O accent é resolvido em **configuração de provisionamento** — o totem pertence a um tenant e a uma unidade —, não em runtime. Sem `ThemeProvider`, sem flash.

### 2.2 Prata — só acabamento

`silver-gradient: linear-gradient(145deg,#D8DEE5,#8D97A3 45%,#E9EDF1)`

Filete de 1–2 px: moldura do totem e do card ativo. **Prata nunca é fundo de texto.**

### 2.3 Semânticos em `carbon-950`

| Papel | Hex | Ratio | Ícone | Observação |
|---|---|---|---|---|
| Sucesso · liberado | `#3DDC84` | 11.03 | `check-circle` | confirmação de pagamento, acesso liberado |
| Atenção · pendência | `#F5A524` | 9.65 | `alert-circle` | **nunca acompanhado de valor** nesta superfície |
| Erro · negado | `#FF6B6B` | 7.09 | `x-circle` | razão pública sempre genérica |
| Informação · processando | `#6AB0FF` | 8.69 | `clock` | espera de webhook |
| Neutro · sem dado | `#A6AEB9` | 8.80 | `minus` | ausência de dado nunca é zero |

Badge no totem: altura 52 px, raio pill, borda de 2 px, rótulo em 20 px. Fundo a 14% do tom, borda a 40%.

### 2.4 Alto contraste sob demanda

Botão na tela inicial eleva todo texto para `#FFFFFF` puro, remove glow e gradiente e engrossa a borda para 2 px. É um **modo**, não um tema alternativo: a estrutura não muda.

---

## 3. Tipografia

Inter Variable, pesos 700–800 no display com tracking `-0.02em`. **Mono não é usado nesta superfície.**

| Token | Especificação | Exemplo |
|---|---|---|
| `display` | 64 / 68 · 800 · −0.02em | Situação do plano |
| `title` | 40 / 46 · 800 · −0.01em | Pagamento confirmado |
| `heading` | 32 / 38 · 700 | Pendência em aberto |
| `body` | 24 / 34 · 400 | Regularize para liberar o acesso. |
| `caption` | 20 / 28 · 400 | Sessão encerra em 40 s |

> Nenhuma família decorativa. O "futurista" do totem vem de **escala, espaço negativo e luz** — nunca de tipo. Introduzir família decorativa custa carga e risco de legibilidade.

---

## 4. Espaço, raio, ação

| Item | Valor |
|---|---|
| Passo efetivo | 8 px |
| Padding de card | 40 px |
| Gutter de tela | 64 px |
| Altura de ação | 88 px |
| Largura mínima de ação | 320 px |
| Rótulo de ação | 24 px |
| Tecla numérica | 132 px de altura |
| Alvo de toque mínimo | 88 × 88 px |
| Raio · controle / card / badge / modal | 20 / 28 / pill / 32 px |

O alvo de 88 px **não vem de WCAG** (que exige 24 × 24). Vem de operação real: mão suada, luva, usuário apressado.

---

## 5. Efeito visual — onde vive e onde é proibido

Efeito custa GPU, custa tempo de transição e tende a reduzir contraste. Ele fica confinado à tela atrator e à moldura.

### ✅ Permitido

- Gradiente radial lento do accent sobre carbono, **só no atrator**.
- Partículas discretas em `accent-300`, opacidade máxima de 70%.
- Filete de 1 px em `silver-gradient` na moldura do card ativo.
- Glow externo do accent a 12% de opacidade, **fora** do conteúdo.
- Barra de progresso da sessão: linha de 4–6 px no topo, accent, decrescente.

### ❌ Proibido

- Qualquer efeito atrás de texto, valor, QR ou botão. Fundo de conteúdo é `carbon-950` chapado.
- Glass, blur ou gradiente sob conteúdo — reduz contraste.
- Animação de saída ao encerrar sessão.
- Accent como fundo de badge de estado ou de decisão de acesso.

### Movimento

| Contexto | Duração | Observação |
|---|---|---|
| Atrator | loop 8 s, linear | sem começo nem fim perceptível |
| Avanço de passo | 300 ms, `ease-out` | só na direção do fluxo |
| **Limpeza de sessão** | **0 ms** | corte seco — requisito, não estilo |

A limpeza é instantânea por requisito: há 2 s para voltar ao início e limpar tudo, e é proibido qualquer resquício visual do aluno anterior. Animação de saída trabalha contra os dois.

---

## 6. `KioskSession` — o componente mais importante

```
┌─ carbon-950 ─────────────────────────────────────────┐
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░  accent, decrescente       │
│                                                       │
│                Situação do plano                      │
│                                                       │
│     ┌───────────────────────────────────────┐         │
│     │  ⚠  Pendência em aberto               │         │  sem valor
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

**"Preciso de mais tempo" é requisito**, de acessibilidade e de WCAG 2.2 AA (*Timing Adjustable*). Precisa estar **sempre visível** durante a contagem, nunca escondido atrás de um modal de aviso.

Timeout sugerido: 60 s, com aviso aos 20 s. Toque em qualquer ação reinicia a contagem.

**Encerramento:** ao expirar, cortar para o atrator em 0 ms e limpar memória, storage, cache visual, clipboard, autofill e fila de impressão.

---

## 7. Entrada de dados

Todo input do totem tem `autocomplete="off"` e `inputmode` explícito.

Teclado de CPF: teclas de 132 px em grade de 3 colunas, dígitos em 32 px, "Limpar" e apagar em tom `carbon-300`. Máscara progressiva `000.000.000-00` com posições vazias em `carbon-500`. O botão de continuar só ativa com 11 dígitos — antes disso fica em `carbon-800` com texto `carbon-500`, e o estado desabilitado é visível, não apenas inerte.

**Tela técnica:** acessível **sem abrir sessão de aluno**, por gesto reservado (toque longo de 5 s no canto inferior direito) mais PIN do operador. Mostra versão, conectividade, unidade, tenant e última sincronização. **Nenhum dado de aluno.**

---

## 8. Resultado de acesso — tela pública

Mostra **apenas o resultado**.

```
   ✓  ACESSO LIBERADO          ✕  ACESSO NÃO LIBERADO
      Rodrigo R.                  Procure a recepção
```

Resultado em display 64 px, razão em body 24 px, ícone grande.

**Nunca nesta tela:** nome completo, CPF, valor, plano, motivo técnico da recusa ou qualquer menção a pendência financeira.

Em `DENY` a frase pública é **sempre a mesma**. A razão técnica existe só no painel: diferenciar publicamente expõe situação financeira.

**Lista canônica — ADR-024** (corrigida em 16/08/2026 por ADR-026): seis razões de `DENY` — `ADMIN_BLOCK`, `STUDENT_BLOCKED`, `STUDENT_INACTIVE`, `NO_ENTITLEMENT`, `WRONG_UNIT`, `OUTSIDE_SCHEDULE` — e duas de `ALLOW` — `ACTIVE_ENTITLEMENT` e `MANUAL_OVERRIDE`. Tabela completa em `DS-PAINEL.md` §8.5.

> ⚠️ **`SUBSCRIPTION_OVERDUE` não é razão do motor.** Inadimplência suspende o entitlement; a razão que chega à catraca é `NO_ENTITLEMENT` (Regra de arquitetura 1 e ADR-003).

---

## 9. Conteúdo sensível no totem

O totem fica na recepção, com fila atrás. Três consequências:

1. **Situação do plano sem valor.** A etapa de situação diz que há pendência e o que fazer; valor e detalhe da fatura só aparecem na etapa de pagamento, depois de uma ação deliberada do aluno.
2. **Bioimpedância resumida.** O totem mostra faixas e comparação com a medição anterior em tipo grande. A leitura completa, o histórico e a análise detalhada ficam no aplicativo.
3. **Saúde não é diagnóstico.** Aviso explícito na tela de resultado; achado de aparelho encaminha para a recepção, com a frase orientando a conversa e sem nomear condição clínica.

---

## 10. Componentes desta superfície

| Componente | Observação |
|---|---|
| `KioskAction` | 88 px de altura, largura mínima 320 px, rótulo 24 px |
| `KioskSession` | contagem + barra decrescente + "Preciso de mais tempo" |
| `KioskKeypad` | teclas de 132 px, máscara progressiva |
| `StateBadge` | 52 px, borda 2 px, rótulo 20 px |
| `Money` | centavos inteiros, display 56 px |
| `TenantDateTime` | timezone da unidade |
| `AIDisclaimer` | persistente na tela de resultado de saúde |
| `TechnicalScreen` | fora da sessão do aluno, PIN do operador |
| `AttractorScreen` | único lugar com efeito visual |

---

## 11. Regras não negociáveis

1. Uma pergunta por tela. No máximo três ações visíveis.
2. Nada abaixo de 20 px. Corpo em 24 px.
3. Contraste de 7:1 para texto normal, acima de AA.
4. Foco visível de 4 px em `accent-300`.
5. "Preciso de mais tempo" sempre visível durante a contagem.
6. Encerramento em 0 ms, com limpeza completa de sessão.
7. Nenhum efeito atrás de texto, valor, QR ou botão.
8. Sem light mode e sem alternância de tema — só alto contraste sob demanda.
9. Accent resolvido em provisionamento, nunca em runtime.
10. A marca visível é a **da academia**; o ArenaHub assina discreto no rodapé.
11. Nenhum dado do aluno anterior sobrevive ao encerramento — memória, storage, cache, clipboard, autofill e fila de impressão.
12. Cor nunca é o único canal: todo estado carrega ícone e rótulo.

---

## 12. Pendências desta superfície

| # | Pendência | Proposta |
|---|---|---|
| 1 | Timeout de inatividade em segundos | 60 s com aviso aos 20 s |
| 2 | O que o totem imprime | definir no MVP 4 |
| 3 | Layout da tela pública da catraca | §8 — aprovar ou substituir |
| 4 | Aviso sonoro na recusa | proposto ligado por padrão, configurável por unidade |
