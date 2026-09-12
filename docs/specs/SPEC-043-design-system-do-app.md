# SPEC-043 — Design system da superfície `mobile`

| campo | valor |
|---|---|
| **Fatia** | F43 |
| **MVP** | 2.5 |
| **Slice** | **2.5.2** — definida no **ADR-025** (o design system não tem PRD) |
| **Fonte de verdade** | [`docs/design/DS-APP.md`](../design/DS-APP.md) — contrato de implementação |
| **Referência visual** | `docs/design/DS App.dc.html` e `ios-frame.jsx` — protótipo, **não é código a instalar** (ADR-026 decisão 2) |
| **Status** | ✅ **entregue** em 12/09/2026 — PR [#321](https://github.com/RodReis/arenahub/pull/321), aguardando aceite |
| **Gate de entrada** | **aberto em 11/09/2026** — o PI mandou executar F43 e F23, e escolheu a ordem (design system primeiro). `apps/mobile` existe |
| **ADRs que bloqueiam** | nenhum. Depende do card `[INFRA]` do pipeline de tokens e de F42 |

> **Esta spec é um ponteiro (ADR-022).** O escopo mora em `docs/design/DS-APP.md`.
>
> **Aprovada pelo PI em 16/08/2026** — aprovada, **não liberada**. Ver o gate acima.

---

## 1. O que esta fatia entrega

Camada de UI do app do aluno em Expo / React Native, conforme `docs/design/DS-APP.md`:

- **§2** — superfícies em dark por luminância (elevação **não** é sombra), texto sobre
  `carbon-900`, semânticos de dark e accent resolvido para fundo escuro.
- **§3–§4** — tipografia com corpo em 16 px (evita o zoom automático de campo no iOS), passo de
  8 px, alvo de toque 44 × 44, movimento celebrativo restrito a progresso, streak e XP.
- **§5–§6** — barra de quatro abas, Home, controles de 48 px.
- **§7** — os quatro padrões que o app não pode errar: espera de pagamento, carteirinha, saúde e
  IA, engajamento opt-in.
- **§8** — tom de voz.
- **§10** — as 10 regras estruturais.

## 2. Decisões específicas desta fatia

1. **O app não recalcula estado.** `DS-APP.md` §10 regra 1: nenhum `if (dueDate < today)` no
   cliente. O backend manda enum e o app escolhe cor e ícone. Isto não é preferência de
   arquitetura — é a mesma razão do **ADR-003**: quem decide direito é o servidor, e um cliente
   que deriva estado inventa uma segunda autoridade.
2. **Nunca "Pago".** `DS-APP.md` §7.1: o retorno do checkout **não confirma pagamento**; só o
   webhook confirma. A tela é "Aguardando confirmação", com o SLO real. Consistente com o
   **ADR-006** — o efeito só existe quando o evento idempotente chega.
3. **Risco alto não aparece para o aluno.** `DS-APP.md` §2.3 marca a cor de risco como existente
   só no painel. Score de churn é ferramenta de retenção do operador; mostrá-lo ao titular é
   outro produto e outra conversa de LGPD.
4. **Toggles de engajamento nascem desligados**, com opt-out a no máximo dois toques
   (`DS-APP.md` §7.4). Padrão opt-in é requisito, não cortesia.

### Decisões tomadas durante a execução (12/09/2026)

5. **A borda do card é o padrão, não a exceção** — e isso contraria a letra do `DS-APP.md` §4.3
   ("sem borda quando o contraste de superfície já separa"). A razão é medida: a separação entre
   as três superfícies fica entre **1,07 e 1,22 nos dois temas**, e nesse patamar ela não separa
   nada. Sem borda o card desaparece no fundo — visível assim que a vitrine abriu no tema claro.
   O §2.7 continua valendo no que ele decide de fato (**nada de sombra**); o que muda é que a
   hierarquia passa a vir do contorno. O §4.3 foi emendado com a medição.

6. **`border/default` do dark subiu de `#2B3037` para `#646D79`** — o valor da v1.0 entregava
   1,19 sobre `bg/raised`, contra o alvo de 3,0 da WCAG 1.4.11, e essa borda delimita o alvo
   tocável do campo (§4.1) e do botão secundário (§4.2). Mesmo defeito e mesma correção do totem
   (PR #232). Decidido pelo PI; §2.1 emendado.

7. **O tint do badge é por tema** — 16% no dark (receita do §2.4) e 10% no light (a do painel).
   Um número único para os dois reprovava: a 16% sobre branco o `err` entrega 4,43 contra o alvo
   de 4,5. A mesma opacidade em fundos opostos não produz o mesmo par.

8. **O app não emite CSS.** React Native não lê custom property, então a superfície sai só em
   TypeScript, por entrypoint próprio (`@arenahub/ui/app-tokens`) — o entrypoint principal exporta
   componente React web e arrastaria `react-dom` e `recharts` para o bundle do celular. Pelo mesmo
   motivo nasceu `@arenahub/ui/domain`, que é como `state-labels.ts` fica **compartilhado** sem
   duplicação (§6 deste documento).

## 3. Escopo negativo

- **`apps/mobile` em si** — telas, navegação, chamadas de API e autenticação são das fatias do
  MVP 4 (F23–F29). Esta fatia entrega **tokens e componentes**, não produto.
- **Light mode do app** — segue o SO a partir do MVP 4; falta validar contraste dos semânticos em
  light (`DS-APP.md` §12 pendência 1).
- **Notificação push** — tom e frequência saem com o módulo de notificações.
- **Widget de carteirinha fora do app** — fora de escopo até o piloto.

## 4. Invariantes que esta fatia precisa preservar

| invariante | onde aparece |
|---|---|
| Dinheiro é inteiro na menor unidade e **nunca calculado no cliente** | `Money` · §10 regra 4 |
| Data e hora no timezone da **unidade**, nunca do aparelho | `TenantDateTime` · §10 regra 3 |
| Nunca expor PII em superfície mostrada a terceiros | carteirinha §7.2 — token opaco, sem nome completo, CPF ou valor |
| IA não publica dado de saúde sozinha, e não diagnostica | `AIDisclaimer` persistente §7.3 |
| Ausência de dado não é zero | `—`; no gráfico a linha **quebra** · §10 regra 5 |
| Cor nunca é o único canal | §10 regra 9 |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Esta fatia é construída **antes** das telas do MVP 4, ou junto com elas? O ADR-025 registra o risco de componente sem consumidor; o gate diz "não pegar antes do MVP 4", mas a ordem dentro do MVP 4 é sua | **Antes**, em PR próprio; a F23 vem em seguida. O risco do ADR-025 foi mitigado com uma **vitrine** (`apps/mobile/app/index.tsx`) que dá consumidor real aos componentes — e ela se pagou: foi ela que revelou que nenhum card desenhava borda | 11/09/2026 |
| 2 | Semânticos em light mode do app — validar agora junto de F42, ou adiar para o MVP 4 como o §12 propõe? | **Validar agora, reusando a paleta do painel.** Não há hex novo a inventar: o dark do app já é a rampa carbon invertida, então o light é a mesma rampa lida no sentido do painel, com contraste já validado. Derivar uma segunda paleta criaria hex que nenhum documento define | 11/09/2026 |

## 6. Antes de codificar, confirme

- [ ] Status desta spec é `aprovada-pi`
- [ ] **O gate abriu** — o PI priorizou o MVP 4
- [ ] F42 entregue: os JSON de token existem e `build.ts` já gera `tokens.ts`
- [ ] `state-labels.ts` é compartilhado com o painel, não duplicado
