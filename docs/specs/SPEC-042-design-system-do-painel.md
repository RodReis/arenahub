# SPEC-042 — Design system da superfície `admin-web`

| campo | valor |
|---|---|
| **Fatia** | F42 |
| **MVP** | 2.5 |
| **Slice** | **2.5.1** — definida no **ADR-025** (o design system não tem PRD) |
| **Fonte de verdade** | [`docs/design/DS-PAINEL.md`](../design/DS-PAINEL.md) — contrato de implementação |
| **Referência visual** | `docs/design/DS Painel.dc.html` — protótipo, **não é código a instalar** (ADR-026 decisão 2) |
| **Status** | `aprovada-pi` |
| **ADRs que bloqueiam** | nenhum. Depende do card `[INFRA]` do pipeline de tokens (ADR-025 decisão 1) |

> **Esta spec é um ponteiro (ADR-022).** O escopo mora em `docs/design/DS-PAINEL.md`. Este
> arquivo não o copia — copiar cria uma segunda verdade que diverge na primeira mudança.
>
> **Aprovada pelo PI em 16/08/2026.**

---

## 1. O que esta fatia entrega

`packages/ui` para a superfície painel, conforme `docs/design/DS-PAINEL.md`:

- **§2–§4** — paleta carbono, semânticos fixos, rampa de accent derivada, tipografia, espaço,
  raio, elevação, movimento.
- **§5–§6** — shell (topbar, sidebar, seletor de unidade, `ElevatedSessionBanner`) e controles.
- **§7** — `StateBadge` e o dicionário canônico em `packages/ui/domain/state-labels.ts`.
- **§8** — `ProblemDetail`, `DataFreshness`, `SensitiveAction`, `FieldReview`.
- **§9** — inventário de 17 componentes.
- **§10–§11** — acessibilidade WCAG 2.2 AA e as 6 regras de lint.
- **§12** — injeção do tema no Server Component, sem provider de cliente.

**Dívida que esta fatia fecha.** `admin-web` está na `main` com F6, F7 e F11 **sem CSS**. O Toast
exigido pelo `CLAUDE.md` → *Convenções de código* nunca foi implementado: as telas usam
`role="alert"`/`role="status"` crus. Esta fatia é a que torna a regra verdadeira.

## 2. Decisões específicas desta fatia

1. **Razões de `DENY` seguem o ADR-024, não o §8.5 do documento de design.** Oito rótulos —
   `ACTIVE_ENTITLEMENT`, `MANUAL_OVERRIDE`, `ADMIN_BLOCK`, `STUDENT_BLOCKED`, `STUDENT_INACTIVE`,
   `NO_ENTITLEMENT`, `WRONG_UNIT`, `OUTSIDE_SCHEDULE`. **`SUBSCRIPTION_OVERDUE` não existe** como
   razão do motor. Fundamento em ADR-026, *Ressalva*. O documento de design foi corrigido junto
   desta spec.
2. **A frase pt-BR de cada razão continua aberta.** O ADR-024 fixou o **código estável**, não o
   texto de tela. `DS-PAINEL.md` §13 pendência 3 permanece — ver §5 abaixo.
3. **Exceção de contraste para controle desabilitado.** `DS-PAINEL.md` §2.1 declara `carbon-400`
   como texto um erro de lint (3.78 < 4.5), e §6 usa `carbon-400` no estado *Disabled*. WCAG 2.2
   §1.4.3 isenta componente inativo. A regra 4 de lint (§11) **precisa da exceção escrita**, ou
   reprova o próprio componente do contrato.
4. **`entitlement: REVOKED` é tom erro; `biometric: REVOKED` é tom neutro.** Não é inconsistência:
   revogar consentimento é **direito do titular** (ADR-008 decisão 3), não falha do sistema.
   `state-labels.ts` carrega essa justificativa em comentário — dicionário canônico que dá dois
   tons ao mesmo verbo precisa dizer por quê, senão alguém "conserta".

## 3. Escopo negativo

- **Pipeline de tokens, Tailwind v4 e esqueleto de `packages/ui`** — card `[INFRA]` (ADR-025
  decisão 1). Esta fatia consome o pipeline, não o constrói.
- **Superfícies `mobile` e `kiosk`** — F43 e F44, com gate no MVP 4.
- **Dark mode do painel** — v2 após o piloto (`DS-PAINEL.md` §13 pendência 1).
- **Tela pública da catraca** (`DS-PAINEL.md` §8.5) — proposta pendente de aprovação; sai por F44,
  onde a superfície existe.
- **Componentes de MVP futuro** — `Money`, `AsyncJobStatus` (MVP 2), `ChartWithTable`,
  `AIDisclaimer`, `FieldReview` (MVP 3), `RiskBand` (MVP 6): entram como **contrato e token**,
  sem tela consumidora. Construir a tela é da fatia do MVP correspondente.

## 4. Invariantes que esta fatia precisa preservar

*(cada um precisa de teste — `docs/REVIEW.md` §3)*

| invariante | onde aparece na UI |
|---|---|
| Dinheiro é inteiro na menor unidade | `Money` — aritmética em `number` fora dele é erro de lint (§11 regra 6) |
| Data e hora no timezone da **unidade** | `TenantDateTime` — `toLocaleString()` fora dele é erro (§11 regra 5) |
| Nunca logar nem exibir template biométrico, token de pagamento ou PII em erro | `ProblemDetail` §8.1 — sem stack, sem detalhe interno |
| Razão pública de `DENY` é sempre genérica | tela pública não diferencia motivo — diferenciar expõe situação financeira |
| IA e OCR não publicam dado de saúde sozinhos | `FieldReview` §8.4 — nada grava antes da confirmação campo a campo |
| Cor nunca é o único canal | todo estado carrega ícone **e** rótulo (§10 item 1) |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Dicionário pt-BR das 6 razões de `DENY` — qual frase o painel mostra para cada código? A tela pública já está resolvida (frase única genérica); falta a do painel | — | — |
| 2 | A exceção de contraste para *Disabled* (§2 item 3) entra como exceção nomeada na lint, ou o *Disabled* muda para `carbon-500`? | — | — |
| 3 | `DS-PAINEL.md` §13 pendência 2 — breakpoints 1280 px mínimo e 1024 px degradado: confirma? | — | — |

## 6. Antes de codificar, confirme

- [ ] Status desta spec é `aprovada-pi`
- [ ] O card `[INFRA]` do pipeline de tokens foi entregue
- [ ] As três perguntas da §5 têm resposta, ou o escopo delas está fora desta entrega
- [ ] `packages/access-policy/src/types.ts` é a fonte dos códigos de razão — `state-labels.ts`
      importa de lá, nunca redeclara
