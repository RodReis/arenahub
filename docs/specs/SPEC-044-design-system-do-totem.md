# SPEC-044 — Design system da superfície `kiosk`

| campo | valor |
|---|---|
| **Fatia** | F44 |
| **MVP** | 2.5 |
| **Slice** | **2.5.3** — definida no **ADR-025** (o design system não tem PRD) |
| **Fonte de verdade** | [`docs/design/DS-TOTEM.md`](../design/DS-TOTEM.md) — contrato de implementação |
| **Referência visual** | `docs/design/DS Totem.dc.html` — protótipo, **não é código a instalar** (ADR-026 decisão 2) |
| **Status** | `aprovada-pi` |
| **Gate de entrada** | **o PI priorizar o MVP 4.** `apps/kiosk` não existe |
| **ADRs que bloqueiam** | nenhum. Depende do card `[INFRA]` do pipeline de tokens e de F42 |

> **Esta spec é um ponteiro (ADR-022).** O escopo mora em `docs/design/DS-TOTEM.md`.
>
> **Aprovada pelo PI em 16/08/2026** — aprovada, **não liberada**. Ver o gate acima.

---

## 1. O que esta fatia entrega

Camada de UI do totem de autoatendimento (Next.js PWA em modo quiosque), conforme
`docs/design/DS-TOTEM.md`:

- **§1–§2** — dark exclusivo em `carbon-950`, contraste alvo **7:1** para texto normal, accent
  resolvido em **provisionamento** e não em runtime, prata só como acabamento, alto contraste sob
  demanda como *modo* e não como tema alternativo.
- **§3–§4** — corpo em 24 px, nada abaixo de 20 px, ação de 88 px, tecla de 132 px.
- **§5** — onde o efeito visual vive (atrator e moldura) e onde é proibido (atrás de conteúdo).
- **§6** — `KioskSession`, o componente mais importante da superfície.
- **§7–§9** — entrada de dados, tela técnica, resultado de acesso, conteúdo sensível com fila
  atrás.
- **§11** — as 12 regras não negociáveis.

## 2. Decisões específicas desta fatia

1. **"Preciso de mais tempo" é requisito, não cortesia.** WCAG 2.2 §2.2.1 *Timing Adjustable*.
   Precisa estar **sempre visível** durante a contagem, nunca atrás de um modal de aviso
   (`DS-TOTEM.md` §6).
2. **Encerramento em 0 ms.** Corte seco para o atrator, sem animação de saída, com limpeza de
   memória, storage, cache visual, clipboard, autofill e fila de impressão. É requisito de
   privacidade: nenhum resquício do aluno anterior sobrevive. Animação de saída trabalha contra
   os dois (`DS-TOTEM.md` §5 e §11 regras 6 e 11).
3. **Situação do plano sem valor.** O totem fica na recepção com fila atrás. Valor e detalhe da
   fatura só depois de ação deliberada do aluno (`DS-TOTEM.md` §9 item 1).
4. **Razões de `DENY` seguem o ADR-024.** Mesma correção da F42: `SUBSCRIPTION_OVERDUE` não é
   razão do motor; entram `STUDENT_BLOCKED` e `STUDENT_INACTIVE`. A frase pública continua
   **sempre a mesma** — diferenciar publicamente expõe situação financeira, e este é o motivo, não
   simplificação de UI.
5. **O alvo de 88 px não vem de WCAG.** WCAG exige 24 × 24. Os 88 px vêm de operação real: mão
   suada, luva, usuário apressado, leitura em pé a 60–100 cm. Registrado para que ninguém
   "otimize" o número para o mínimo normativo.

## 3. Escopo negativo

- **`apps/kiosk` em si** — fluxos, sessão de aluno, integração com pagamento e com o Edge são
  fatias do MVP 4 (F23–F29).
- **Tela pública da catraca** — o layout de `DS-TOTEM.md` §8 é **proposta**; `DESIGN-UI.md` §17
  pendência 1 e `DS-TOTEM.md` §12 pendência 3 continuam abertas. Aprovar o layout é decisão do PI.
- **O que o totem imprime** — `M4-FR-020` cita impressão sem definir conteúdo; MVP 4.
- **Aviso sonoro na recusa** — proposto ligado por padrão e configurável por unidade; não decidido.

## 4. Invariantes que esta fatia precisa preservar

| invariante | onde aparece |
|---|---|
| Razão pública de `DENY` é sempre genérica | §8 — razão técnica só no painel |
| A tela pública nunca vaza PII nem situação financeira | §8 — sem nome completo, CPF, valor, plano ou menção a pendência |
| Nenhum dado do aluno anterior sobrevive à sessão | §11 regra 11 — memória, storage, cache, clipboard, autofill, impressão |
| Dinheiro é inteiro na menor unidade | `Money`, display 56 px |
| Data e hora no timezone da **unidade** | `TenantDateTime` |
| IA não diagnostica | §9 item 3 — achado de aparelho encaminha para a recepção, sem nomear condição clínica |
| Cor nunca é o único canal | §11 regra 12 |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Tela pública da catraca (`DS-TOTEM.md` §8) — aprova o layout proposto ou substitui? Fecha `DESIGN-UI.md` §17 pendência 1 | — | — |
| 2 | Timeout de inatividade: 60 s com aviso aos 20 s, como proposto? Fecha `DESIGN-UI.md` §17 pendência 3 | — | — |
| 3 | Aviso sonoro na recusa — ligado por padrão e configurável por unidade? | — | — |
| 4 | Contraste 7:1 encarece a rampa de accent: um seed de tenant que não alcance 7:1 sobre `carbon-950` cai para qual comportamento — clarear até alcançar, ou recusar o seed no provisionamento? | — | — |

## 6. Antes de codificar, confirme

- [ ] Status desta spec é `aprovada-pi`
- [ ] **O gate abriu** — o PI priorizou o MVP 4
- [ ] F42 entregue: os JSON de token existem e `build.ts` já gera `theme.css`
- [ ] As perguntas 1 e 4 da §5 têm resposta — as duas mudam componente, não só texto
