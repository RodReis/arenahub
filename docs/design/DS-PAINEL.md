# ArenaHub — Design System da superfície `admin-web`

> Painel administrativo. Recorte da direção **Carbono Adaptativo** para a superfície de operação.
> Fonte: `uploads/DESIGN-UI.md`. Este documento é o contrato de implementação do painel.
> Data: 16/08/2026 · Status: `RASCUNHO`

---

## 1. Identidade da superfície

**Denso, operacional, orientado a dados.** Light-first: canvas `carbon-50`, cards `#FFFFFF`, chrome (topbar + sidebar) `carbon-900`. Dark mode fica para v2 — a recepção opera sob luz fluorescente forte e com documento físico ao lado, e light reduz troca de contexto.

| Atributo | Valor |
|---|---|
| Seletores | `data-surface="panel"` · `data-mode="light"` |
| Resolução mínima | 1280 px para operação · 1024 px degradado |
| Passo de espaço | 4 px |
| Corpo de texto | 14 / 20 |
| Altura de controle | 36 px |
| Alvo de toque | 24 × 24 (AA) · 32 × 32 recomendado |
| Contraste | 4.5:1 texto normal · 3:1 texto grande e componentes |

Carbono é **estrutura, superfície e texto**. O accent do tenant é **ação**. Nenhum dos dois carrega significado de estado.

---

## 2. Paleta

### 2.1 Carbono

| Token | Hex | vs `#FFFFFF` | Uso no painel |
|---|---|---|---|
| `carbon-900` | `#121417` | 18.45 | chrome: topbar e sidebar |
| `carbon-800` | `#1F2328` | 15.80 | título de página, seletor no chrome |
| `carbon-700` | `#2B3037` | 13.29 | texto forte |
| `carbon-600` | `#3C424B` | 10.13 | rótulo de campo |
| `carbon-500` | `#565E69` | 6.56 | texto secundário |
| `carbon-400` | `#7B8491` | 3.78 | ícone, borda, placeholder |
| `carbon-300` | `#A6AEB9` | 2.24 | divisor forte, texto sobre chrome |
| `carbon-200` | `#CBD1D9` | 1.54 | borda padrão do card |
| `carbon-100` | `#E5E9EE` | 1.22 | divisor de linha de tabela |
| `carbon-50` | `#F5F7F9` | 1.07 | canvas da página |

> ⚠️ **`carbon-400` reprova como texto de corpo em fundo claro** (3.78 < 4.5). Existe para borda, ícone decorativo e placeholder. Texto informativo usa `carbon-500` ou mais escuro. Isto é regra de lint.

### 2.2 Semânticos — fixos, não configuráveis

| Papel | Hex | vs `#FFFFFF` | Ícone | Exemplo |
|---|---|---|---|---|
| Sucesso · `ALLOW` · `PAID` | `#157F3D` | 5.08 | `check-circle` | Liberado |
| Atenção · `OVERDUE` · `DEGRADED` | `#8A5200` | 6.39 | `alert-circle` | Em atraso |
| Erro · `DENY` · `FAILED` | `#C22B2B` | 5.72 | `x-circle` | Negado |
| Informação · `PENDING` | `#1F5FD0` | 5.82 | `clock` | Na fila |
| Risco alto | `#B4470B` | 5.46 | `alert-triangle` | Alto |
| Neutro · `NOT_APPLICABLE` | `carbon-500` | 6.56 | `minus` | Não aplicável |

Badge: fundo = tom a 10%, borda = tom a 32%, texto e ícone = tom sólido.

### 2.3 Accent do tenant

O tenant fornece **um hex seed**. O sistema deriva 10 tons em OKLCH e escolhe por contraste calculado — nunca por número fixo de tom. Rampa do padrão comercial **Ciano Arena** `#00A9B8`:

| Tom | Hex | vs `#FFFFFF` | Papel no painel |
|---|---|---|---|
| `accent-100` | `#C2F2F7` | 1.21 | fundo de seleção leve |
| `accent-500` | `#00A9B8` | 2.85 | indicador ao vivo (não texto) |
| `accent-600` | `#008C99` | 4.03 ❌ | **reprova** para texto branco |
| `accent-700` | `#00707B` | 5.83 ✅ | `--ah-action-solid`, link, foco |
| `accent-800` | `#005760` | 8.29 ✅ | hover da ação sólida |

Papéis resolvidos:

```
--ah-action-solid      accent-700     menor tom com contraste(#FFF) ≥ 4.5
--ah-action-on-solid   #FFFFFF
--ah-action-text       accent-700
--ah-action-subtle-bg  accent-50
--ah-focus-ring        accent-700, 2 px + offset 2 px
```

**Accent é proibido em:** badge de qualquer máquina de estado, decisão de acesso, faixa de risco, alerta, toast de erro, banner de degradação e gráfico onde a cor indica melhora ou atenção.

---

## 3. Tipografia

Inter Variable para interface, JetBrains Mono para dado técnico. Nenhuma família decorativa.

| Token | Especificação | Uso |
|---|---|---|
| `display` | 28 / 34 · 700 | KPI, valor de destaque |
| `title` | 20 / 26 · 600 | título de página |
| `heading` | 16 / 22 · 600 | título de card |
| `body` | 14 / 20 · 400 | corpo, célula de tabela |
| `body-strong` | 14 / 20 · 600 | nome de aluno, valor em linha |
| `caption` | 12 / 16 · 400 | carimbo de atualização, contexto |
| `mono` | 12 / 16 · 400 | matrícula, `correlationId`, código de erro, `enrollid` |

`font-variant-numeric: tabular-nums` é **obrigatório** em tabela financeira, valores, horários e contadores.

Zoom de texto até 200% sem perda de conteúdo: nenhum container de texto usa altura fixa em px.

---

## 4. Espaço, raio, elevação, movimento

| Item | Valor |
|---|---|
| Passo efetivo | 4 px (base 4) |
| Padding de card | 16 px |
| Altura de linha de tabela | 40 px |
| Altura de controle | 36 px |
| Gutter de página | 24 px |
| Raio · controle / card / badge / modal | 6 / 8 / 4 / 10 px |

Elevação — sombra **apenas** em camada que flutua. Card não tem sombra: tem borda `carbon-200`. Superfície plana lê melhor em densidade alta.

```
--ah-elev-1: 0 1px 2px  rgb(10 11 13 / .06)   /* dropdown */
--ah-elev-2: 0 4px 12px rgb(10 11 13 / .10)   /* popover  */
--ah-elev-3: 0 12px 32px rgb(10 11 13 / .18)  /* modal    */
```

Movimento — feedback de controle 120 ms, abertura de camada 180 ms, easing `cubic-bezier(.2,0,.2,1)`. `prefers-reduced-motion: reduce` desliga animação decorativa e mantém só opacidade ≤ 100 ms.

---

## 5. Shell

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

O **seletor de unidade** fica no topbar porque toda data, horário e política dependem dele. Trocar de unidade sem perceber é o erro operacional mais caro do painel.

**Banner de sessão elevada (Super Admin):** faixa `#B4470B` de 4 px no topo da viewport, persistente, com tenant alvo, justificativa e contagem até a expiração. O operador precisa ver que está elevado o tempo todo.

**Paginação por cursor.** Sem numeração de páginas: "Anteriores / Próximos" mais contador de itens carregados.

---

## 6. Controles

| Variante | Especificação |
|---|---|
| Solid | `accent-700`, texto `#FFFFFF`, hover `accent-800` |
| Outline | borda `carbon-200`, texto `carbon-600`, hover borda `carbon-400` |
| Ghost | sem borda, texto `accent-700`, hover fundo `carbon-50` |
| Destructive | borda e texto `#C22B2B`, fundo branco, hover `rgba(194,43,43,.06)` |
| Disabled | fundo `carbon-50`, borda `carbon-100`, texto `carbon-400` |

Botão destrutivo usa o **verbo real** ("Revogar biometria"), nunca "OK".

Campos: altura 36 px, raio 6 px, borda `carbon-200`, foco `accent-700` 2 px + offset 2 px. Unidade de medida ao lado do rótulo, **nunca no placeholder**. Formulário nunca limpa dado em erro recuperável.

---

## 7. `StateBadge` — dicionário canônico

Domínio em inglês no código, **português na interface**. O mapa `enum → { label, tone, icon }` vive num único arquivo em `packages/ui/domain/state-labels.ts`. Nenhum componente escreve rótulo inline. O badge não renderiza sem `label`.

| Máquina | Estado | Rótulo PT-BR | Tom | Ícone |
|---|---|---|---|---|
| `student` | `LEAD` | Lead | neutro | `user-plus` |
| | `TRIAL` | Experimental | info | `hourglass` |
| | `ACTIVE` | Ativo | sucesso | `user-check` |
| | `SUSPENDED` | Suspenso | atenção | `user-minus` |
| | `BLOCKED` | Bloqueado | erro | `user-x` |
| | `CANCELLED` | Cancelado | neutro | `x-circle` |
| | `ARCHIVED` | Arquivado | neutro | `archive` |
| `subscription` | `PENDING` | Aguardando início | info | `clock` |
| | `ACTIVE` | Ativa | sucesso | `check-circle` |
| | `PAST_DUE` | Em atraso | atenção | `alert-circle` |
| | `PAUSED` | Pausada | neutro | `pause-circle` |
| | `CANCELLED` | Cancelada | neutro | `x-circle` |
| | `EXPIRED` | Expirada | neutro | `calendar-x` |
| `entitlement` | `SCHEDULED` | Agendado | info | `calendar-clock` |
| | `ACTIVE` | Válido | sucesso | `key-round` |
| | `SUSPENDED` | Suspenso | atenção | `key-off` |
| | `REVOKED` | Revogado | erro | `ban` |
| | `EXPIRED` | Expirado | neutro | `calendar-x` |
| `biometric` | `PENDING_CONSENT` | Aguardando consentimento | info | `file-signature` |
| | `ACTIVE` | Cadastrada | sucesso | `scan-face` |
| | `REVOKED` | Revogada | neutro | `ban` |
| | `DELETION_PENDING` | Exclusão em andamento | atenção | `trash-2` |
| | `DELETED` | Excluída | neutro | `trash-2` |
| `syncJob` | `PENDING` | Na fila | info | `clock` |
| | `PROCESSING` | Processando | info | `loader` |
| | `SYNCED` | Sincronizado | sucesso | `check` |
| | `FAILED` | Falhou | erro | `x-octagon` |
| | `RETRYING` | Tentando novamente | atenção | `refresh-cw` |
| | `REMOVED` | Removido | neutro | `minus-circle` |
| `device` | `PROVISIONING` | Provisionando | info | `settings` |
| | `ONLINE` | Online | sucesso | `wifi` |
| | `DEGRADED` | Degradado | atenção | `wifi-low` |
| | `OFFLINE` | Offline | erro | `wifi-off` |
| | `RETIRED` | Desativado | neutro | `power-off` |
| `access` | `ALLOW` / `DENY` | Liberado / Negado | sucesso / erro | `check-circle` / `x-circle` |
| `passage` | `NOT_APPLICABLE` | Não aplicável | neutro | `minus` |
| | `PENDING` | Aguardando giro | info | `loader` |
| | `CONFIRMED` | Confirmada | sucesso | `check` |
| | `TIMED_OUT` | Sem giro | atenção | `timer-off` |
| `invoice` | `DRAFT` / `OPEN` / `PAID` / `OVERDUE` / `CANCELLED` / `REFUNDED` | Rascunho / Em aberto / Paga / Vencida / Cancelada / Estornada | neutro / info / sucesso / atenção / neutro / neutro | — |
| `payment` | `PENDING` / `PROCESSING` / `CONFIRMED` / `FAILED` / `CANCELLED` / `REFUND_PENDING` / `REFUNDED` | Pendente / Processando / Confirmado / Falhou / Cancelado / Estorno em andamento / Estornado | info / info / sucesso / erro / neutro / atenção / neutro | — |
| `paymentAttempt` | `REQUIRES_ACTION` | Ação necessária | atenção | `hand` |
| `reconciliation` | `MATCHED` / `MISSING_INTERNAL` / `MISSING_EXTERNAL` / `AMOUNT_MISMATCH` / `RESOLVED` | Conciliado / Ausente no ArenaHub / Ausente no provedor / Valor divergente / Resolvido | sucesso / erro / erro / atenção / neutro | — |
| `riskBand` | `BAIXO` / `MÉDIO` / `ALTO` / `CRÍTICO` | Baixo / Médio / Alto / Crítico | sucesso / atenção / risco / erro | `shield-check` / `alert-circle` / `alert-triangle` / `octagon-alert` |

**`passage: NOT_APPLICABLE` importa:** nem todo equipamento confirma giro. A UI não pode assumir que toda decisão tem passagem — este estado existe para impedir que a operação leia "sem confirmação" como falha.

### Fazer / não fazer

| ✅ | ❌ |
|---|---|
| Sempre ícone + rótulo textual | Ponto colorido sem texto |
| Rótulo em PT-BR do dicionário central | Rótulo escrito direto no componente |
| Tom semântico fixo por papel | Accent do tenant em badge de estado |
| Faixa de risco com intervalo publicado e versão da regra | Percentual de risco com falsa precisão |
| `role="status"` quando o estado muda em tempo real | Mudança silenciosa para leitor de tela |

---

## 8. Padrões críticos

### 8.1 `ProblemDetail` — quatro campos obrigatórios

```
⚠  Não foi possível sincronizar o dispositivo        ← título
   Catraca 02 · Recepção                             ← contexto
   Última tentativa: 14:32 (America/Sao_Paulo)
   O que fazer: verifique a rede local e             ← ação possível
   tente novamente.
   [ Tentar novamente ]
   DEVICE_SYNC_TIMEOUT · a1b2c3d4  [copiar]          ← código copiável
```

`correlationId` copiável em um clique — é o que o suporte pede. Stack, detalhe interno e PII nunca aparecem.

### 8.2 `DataFreshness` — três estados, nunca colapsados

| Estado | Visual |
|---|---|
| Atual | `Atualizado às 14:32` em caption neutro |
| Desatualizado | cor de atenção + ícone `clock-alert` + idade explícita (`há 3 dias`) |
| Indisponível | skeleton + `Não foi possível carregar` + ação de recarregar |

O painel operacional mostra a **idade do cache offline do Edge**, não apenas online/offline.

### 8.3 `SensitiveAction`

Override manual de acesso, revogação biométrica, estorno, pagamento manual acima do limite e kill switch de modelo compartilham o mesmo padrão: modal com resumo do efeito, **motivo obrigatório**, step-up authentication quando o valor ou a permissão exigirem, e confirmação com o verbo real.

### 8.4 Revisão de dado extraído por OCR ou imagem

Bioimpedância e ECG vindos de laudo entram por leitura de imagem. **Nada é gravado antes da confirmação campo a campo.** Cada campo exibe valor extraído, faixa de referência, **origem** (qual arquivo) e **confiança**. Ausência de dado renderiza `—` com `aria-label="não informado"`, nunca zero.

Análise de IA de saúde tem aviso **persistente** (não dispensável), versão de modelo e prompt visíveis, e canal para falar com um profissional. Achado de aparelho (ex.: possível fibrilação atrial no ECG) é atribuído ao equipamento e nunca apresentado como diagnóstico da plataforma.

### 8.5 Tela pública da catraca — **proposta, pendente de aprovação**

Fundo `carbon-950`, resultado em display 64 px, razão em body 24 px, ícone grande. Sem nome completo, sem CPF, sem valor, sem menção a pendência financeira.

```
   ✓  ACESSO LIBERADO          ✕  ACESSO NÃO LIBERADO
      Rodrigo R.                  Procure a recepção
```

Em `DENY` a razão pública é **sempre a mesma frase genérica**. A razão técnica vai só para o painel.

**Lista canônica — ADR-024** (corrigida em 16/08/2026 por ADR-026; a versão anterior deste parágrafo vinha da Especificação e do `ARCHITECTURE.md` §4.3, os dois desatualizados):

| código | outcome | significado |
|---|---|---|
| `ACTIVE_ENTITLEMENT` | `ALLOW` | único caminho de entrada pelo motor |
| `MANUAL_OVERRIDE` | `ALLOW` | liberação assistida da recepção — exclusivo de `mode = OVERRIDE` |
| `ADMIN_BLOCK` | `DENY` | bloqueio administrativo vigente |
| `STUDENT_BLOCKED` | `DENY` | aluno `BLOCKED` |
| `STUDENT_INACTIVE` | `DENY` | aluno em qualquer outro estado ≠ `ACTIVE` |
| `NO_ENTITLEMENT` | `DENY` | nenhum direito vigente na data |
| `WRONG_UNIT` | `DENY` | há direito vigente, mas não para esta unidade |
| `OUTSIDE_SCHEDULE` | `DENY` | há direito para esta unidade, fora da janela |

> ⚠️ **`SUBSCRIPTION_OVERDUE` não é razão do motor.** A Regra de arquitetura 1 e o ADR-003 proíbem a catraca de consultar assinatura ou invoice: inadimplência atua **suspendendo o entitlement**, e a razão que chega é `NO_ENTITLEMENT`. `WRONG_UNIT` substitui o antigo `UNIT_NOT_ALLOWED`.

---

## 9. Inventário de componentes

| Componente | Requisito |
|---|---|
| `Button` | solid / outline / ghost / destructive |
| `StateBadge` | §7 — 11 máquinas, ~40 estados |
| `ProblemDetail` | `application/problem+json` |
| `DataTable` | paginação por cursor |
| `DataFreshness` | atual / desatualizado / indisponível |
| `TenantDateTime` | timezone da **unidade**, nunca do navegador |
| `Money` | centavos inteiros, nunca `float` |
| `MaskedCPF` | `•••.412.876-••` |
| `ChartWithTable` | `<table>` equivalente sempre no DOM |
| `SensitiveAction` | motivo obrigatório + step-up |
| `ConsentCard` | versão, data, IP, dispositivo |
| `RiskBand` | faixa, intervalo publicado, versão da regra |
| `AIDisclaimer` | persistente, não dispensável |
| `ElevatedSessionBanner` | faixa de 4 px persistente |
| `FieldReview` | valor extraído + faixa + origem + confiança |
| `EmptyState` | com ação de saída |
| `AsyncJobStatus` | progresso de tarefa longa |

---

## 10. Acessibilidade — WCAG 2.2 AA

1. **Cor nunca é o único canal.** Todo estado carrega ícone e rótulo textual.
2. **Todo gráfico tem tabela equivalente** real no DOM.
3. **Formulário nunca limpa dado** em erro recuperável.
4. **Unidade de medida ao lado do rótulo**, não no placeholder.
5. **Ausência de dado não é zero.** `—` com `aria-label="não informado"`; no gráfico, quebrar a linha.
6. **Foco visível em tudo**: anel de 2 px + offset de 2 px.
7. **Ação destrutiva e logout exigem confirmação.**
8. **Zoom até 200%** sem perda de conteúdo ou função.

Verificação: `axe-core` no Playwright cobrindo os fluxos essenciais, e teste unitário de token que falha o build se qualquer par texto/superfície ficar abaixo do alvo — incluindo os pares derivados do accent.

---

## 11. Regras de lint

1. Hex literal fora de `packages/ui/tokens` é erro.
2. Componente que lê token primitivo (`--ah-carbon-*`, `--ah-accent-[0-9]`) é erro.
3. `--ah-action-*` dentro de arquivo de badge, alerta ou gráfico de estado é erro.
4. Par texto/superfície da camada semântica abaixo do alvo falha o build, incluindo os derivados do accent.
5. `new Date().toLocaleString()` fora de `TenantDateTime` é erro.
6. Aritmética de moeda em `number` fora de `Money` é erro.

---

## 12. Implementação

```tsx
// apps/admin-web/app/layout.tsx — Server Component
export default async function RootLayout({ children }) {
  const { accentRamp } = await getTenantTheme(); // rampa já validada e persistida
  return (
    <html lang="pt-BR" data-surface="panel" data-mode="light" style={accentRamp.cssVars}>
      <body>{children}</body>
    </html>
  );
}
```

`data-surface` seleciona a camada de expressão; `data-mode` seleciona a camada semântica. Nenhum provider de tema no cliente, nenhum flash de cor errada, nenhum `use client`.

---

## 13. Pendências desta superfície

| # | Pendência | Proposta |
|---|---|---|
| 1 | Dark mode do painel | v2, após o piloto |
| 2 | Breakpoints de responsividade | 1280 px mínimo · 1024 px degradado |
| 3 | Dicionário PT-BR das razões de `DENY` | ADR-024 fixa **8** códigos estáveis (2 `ALLOW` + 6 `DENY`); a frase de tela continua aberta — ver SPEC-042 §5 pergunta 1 |
| 4 | ~~Accent padrão comercial~~ **FECHADA em 16/08/2026** | **Ciano Arena `#00A9B8`, adotado como padrão revisável** (decidido pelo PI). O §7 do `DESIGN-UI.md` trata accent como parâmetro de tenant em runtime — trocar depois não exige rebuild nem retrofit. Validação com marketing continua, sem bloquear implementação |
| 5 | Exceção de contraste para controle *Disabled* | §6 usa `carbon-400` como texto, que §2.1 declara erro de lint. WCAG 2.2 §1.4.3 isenta componente inativo — a regra 4 de §11 precisa da exceção escrita. SPEC-042 §5 pergunta 2 |
