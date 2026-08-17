# F42 — Design system da superfície `admin-web` · Plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam
> caixa de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** entregar os componentes do design system do painel em `packages/ui`, consumindo o
pipeline de tokens do card [#79](https://github.com/RodReis/arenahub/issues/79), e aplicá-los às
telas que hoje estão na `main` com markup semântico e zero CSS.

**Arquitetura:** componentes React em `packages/ui/src/components/`, todos Server Components por
padrão — só `Toast`, `SensitiveAction` e `MaskedCPF` (revelar) levam `'use client'`, porque
dependem de estado ou evento. O dicionário pt-BR de estados vive em um único arquivo,
`packages/ui/src/domain/state-labels.ts`, que **importa** os códigos de `@arenahub/access-policy`
e nunca os redeclara. Estilo em CSS Modules por componente, lendo apenas a camada semântica de
tokens — token primitivo em componente é erro de lint (regra 2).

## Esta fatia é EXTRAÇÃO, não criação

Decisão do PI em 16/08/2026, a partir da crítica de `/impeccable critique`. Seis dos 17
componentes **já existem**, espalhados e duplicados nas telas de F6, F7 e F11:

| componente | onde a lógica já vive hoje |
|---|---|
| `StateBadge` | 5 dicionários: `src/operations/formatar.ts`, `src/students/formatar.ts`, e inline em `devices/page.tsx:32-44` e `biometrics/page.tsx:39-55` |
| `TenantDateTime` | 2 cópias de `formatarInstante` (`devices:46-50`, `biometrics:57-61`) + `instanteLegivel` e `dataLegivel` |
| `ProblemDetail` | 6 blocos de erro duplicados (`units:30`, `students:67`, `access-events:76`, `operations:90`, `devices:70`, `override:41`) |
| `EmptyState` | 8 mensagens de vazio espalhadas |
| `SensitiveAction` | 1 implementação exemplar em `formulario-de-override.tsx` — é o molde, não o alvo |
| `DataTable` | 12 tabelas, 2 paginações diferentes |

**A consequência prática muda o plano de teste.** Cada tarefa começa lendo a lógica existente e
termina provando que o comportamento **não mudou**. Componente novo escrito do zero perde nuance
que a lógica atual já acertou — `traduzir()` caindo para o código cru em vez de sumir com `—` é o
exemplo que a crítica destacou.

### Regra de precedência quando código e contrato divergem

Eles divergem em vários pontos. A ordem é:

1. **Frase de tela: o código existente vence.** As frases em produção foram escritas com o
   raciocínio certo — `WRONG_UNIT` = *"O plano vale em outra unidade"*, não "unidade errada",
   porque, nas palavras do próprio comentário, *"as frases dizem O QUE ACONTECEU, não o que o
   sistema concluiu"*. Trocar por rótulo curto seria regressão. A crítica chamou esse dicionário de
   *"a peça mais valiosa do repositório"*.
2. **Nome de estado, razão ou enum: o ADR de domínio vence** e o documento de design é corrigido
   (ADR-026, *Exceção*).
3. **Aparência (cor, tipografia, espaço, raio): o `.dc.html` vence.**
4. **Divergência entre duas cópias do próprio código:** vence a que bate com o contrato.
   `RETRYING` = "Tentando novamente" (contrato) e não "Tentando de novo" (`devices/page.tsx`).

Ajustes de texto aprovados pelo PI, os únicos desta fatia:

- `passage.NOT_APPLICABLE`: `'—'` → **"Não confirma giro"**. Hoje colapsa *"equipamento não
  confirma giro"* com *"dado ausente"* — exatamente o que o §7 diz que o estado existe para
  impedir.
- `syncJob.RETRYING`: unificado em **"Tentando novamente"**.

Todo o resto do texto de tela permanece **byte a byte** como está.

**Stack:** React 19.2 · Next.js 16.3 (App Router, Server Components) · TypeScript estrito ·
Vitest 4.1 + Testing Library · Playwright 1.62 + axe-core · CSS Modules.

**Spec:** [`docs/specs/SPEC-042-design-system-do-painel.md`](../../specs/SPEC-042-design-system-do-painel.md)
· contrato de implementação em [`docs/design/DS-PAINEL.md`](../../design/DS-PAINEL.md)

## Restrições globais

Valores copiados literalmente do contrato. Todo requisito de tarefa inclui esta seção.

- **Superfície:** `data-surface="panel"` · `data-mode="light"`. Dark mode é v2, fora desta fatia.
- **Resolução:** 1280 px operacional · 1024 px degradado. Confirmado pelo PI em 16/08/2026.
- **Contraste:** 4.5:1 texto normal · 3:1 texto grande e componente. `carbon-400` **reprova** como
  texto de corpo (3.78) — existe para borda, ícone decorativo e placeholder.
- **Exceção nomeada:** controle *Disabled* usa `carbon-400` como texto, isento por WCAG 2.2 §1.4.3.
  Decisão do PI, opção A. Já implementada no pipeline como `$exempt` — **não remover**.
- **Accent é ação, nunca estado.** `--ah-action-*` é proibido em badge de máquina de estado,
  decisão de acesso, faixa de risco, alerta, toast de erro e banner de degradação. Regra 3 de lint.
- **Token primitivo é proibido em componente.** Componente lê `--ah-surface-*`, `--ah-text-*`,
  `--ah-border-*`, `--ah-action-*`, `--ah-success`/`--ah-warning`/`--ah-danger`/`--ah-info`/`--ah-risk`.
  Nunca `--ah-carbon-*` nem `--ah-accent-<n>`. Regra 2 de lint.
- **Hex literal fora de `packages/ui/tokens/` é erro.** Regra 1 de lint.
- **Cor nunca é o único canal.** Todo estado carrega ícone **e** rótulo textual (§10 item 1).
- **Ausência de dado não é zero.** `—` com `aria-label="não informado"`, nunca `0`.
- **Idioma:** identificador e domínio em inglês; texto de tela em pt-BR.
- **Nunca exibir** template biométrico, token de pagamento, dado de cartão ou PII em erro.

> 🎯 **O alvo visual é [`docs/design/DS Painel.dc.html`](../../design/DS%20Painel.dc.html).** A tela
> entregue tem de ficar **igual ao protótipo** — é a referência visual que a SPEC-042 nomeia e o
> ADR-026 ratifica. Ele é **claro**: canvas `#F5F7F9`, cards `#FFFFFF`, chrome `#121417`,
> `data-mode="light"` — idêntico ao que o `DS-PAINEL.md` §1 escreve. Protótipo e contrato não
> divergem em nada.
>
> ⚠️ **Igual na aparência, não no código.** ADR-026 decisão 2: o `.dc.html` é protótipo visual,
> **não código a instalar** — colar o arquivo produz o hex literal que a regra 1 de lint proíbe.
> Cada tela se aproxima do protótipo pelos **tokens** (`--ah-surface-canvas`, `--ah-surface-raised`,
> `--ah-surface-chrome`), nunca pelo valor copiado. Comparar o resultado com o protótipo lado a
> lado é parte da Task 10.
>
> *Nota de sessão:* o PI mostrou duas imagens em dark mode vindas de outra ferramenta; confirmou em
> 16/08/2026 que são exploração à parte e **não substituem o `.dc.html`**. Nenhuma decisão do plano
> saiu delas.

> ⚠️ **`FieldReview` aparece nos dois lados e o escopo negativo vence.** A spec §1 o lista em
> "§8 — `ProblemDetail`, `DataFreshness`, `SensitiveAction`, `FieldReview`", mas a §3 o nomeia
> explicitamente entre os "componentes de MVP futuro" que entram "como contrato e token, sem tela
> consumidora". A §3 é a mais específica e cita o MVP dono (3), então `FieldReview` fica na Task 9
> como interface de props. Construir a tela sem avaliação física para consumi-la produziria código
> morto que envelhece antes do primeiro uso.

---

## Estrutura de arquivos

```
packages/ui/src/
  domain/
    state-labels.ts          dicionário canônico enum → { label, tone, icon }
    state-labels.spec.ts
  components/
    Icon.tsx                 conjunto fechado de ícones inline, sem dependência externa
    Button.tsx               solid / outline / ghost / destructive
    Button.module.css
    StateBadge.tsx           §7 — consome state-labels, nunca escreve rótulo
    StateBadge.module.css
    ProblemDetail.tsx        §8.1 — quatro campos, correlationId copiável
    ProblemDetail.module.css
    DataFreshness.tsx        §8.2 — atual / desatualizado / indisponível
    DataFreshness.module.css
    DataTable.tsx            paginação por cursor
    DataTable.module.css
    TenantDateTime.tsx       timezone da unidade, nunca do navegador
    Money.tsx                centavos inteiros
    MaskedCPF.tsx            •••.412.876-••
    EmptyState.tsx           com ação de saída
    EmptyState.module.css
    Toast.tsx                'use client' — info / warn / error do CLAUDE.md
    Toast.module.css
    SensitiveAction.tsx      'use client' — motivo obrigatório + verbo real
    SensitiveAction.module.css
    ElevatedSessionBanner.tsx  faixa 4 px persistente
    ElevatedSessionBanner.module.css
    ConsentCard.tsx          versão, data, IP, dispositivo
    ConsentCard.module.css
    shell/
      AppShell.tsx           topbar + sidebar + área de conteúdo
      AppShell.module.css
      UnitSelector.tsx       'use client' — troca de unidade
      PageHeader.tsx         breadcrumb + título + ações
  contracts/
    future-components.ts     contrato e token dos componentes sem tela (§3 da spec)

apps/admin-web/app/
  globals.css                       + camadas de componente
  layout.tsx                        injeção do tema (§12)
  (protected)/layout.tsx            passa a usar AppShell
  (protected)/students/page.tsx     passa a usar DataTable + StateBadge
  ...demais telas
```

**Fronteira de responsabilidade.** `packages/ui` não sabe o que é aluno nem invoice: recebe
`estado` e `máquina` e devolve badge. Quem traduz domínio para props é a tela. É o que permite ao
`state-labels.ts` ser o único lugar com rótulo pt-BR.

---

## Task 1: Infraestrutura de teste de componente em `packages/ui`

Hoje `packages/ui` tem Vitest em `environment: 'node'` e nenhuma dependência de React. Sem isto,
nenhuma tarefa seguinte consegue testar componente. Esta tarefa não entrega componente — entrega a
possibilidade de testar um.

**Arquivos:**
- Criar: `packages/ui/vitest.config.ts`
- Modificar: `packages/ui/package.json` (dependências e `exports`)
- Modificar: `packages/ui/tsconfig.json` (`jsx: react-jsx`)
- Criar: `packages/ui/src/components/Icon.tsx`
- Criar: `packages/ui/src/components/Icon.spec.tsx`

**Interfaces:**
- Consome: nada. É a primeira tarefa.
- Produz:
  - `<Icon name={IconName} />` — `IconName` é união literal fechada; `Icon` renderiza
    `<svg aria-hidden="true" focusable="false">`. Toda tarefa seguinte usa `Icon`.
  - `<Ausente />` — `<span aria-label="não informado">—</span>`. Usado a partir da Task 3.

- [ ] **Passo 1: adicionar dependências**

```bash
pnpm --filter @arenahub/ui add react@19.2.8 react-dom@19.2.8
pnpm --filter @arenahub/ui add -D @testing-library/react@16.3.0 @testing-library/jest-dom@6.9.1 \
  jsdom@27.0.0 @types/react@19.2.14 @types/react-dom@19.2.4
```

`react` entra como dependência normal, não `peerDependency`: o monorepo é privado, a versão é
única e fixada na raiz, e `peer` só criaria um aviso a mais sem impedir nada.

- [ ] **Passo 2: criar `packages/ui/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `jsdom`, nao `node`: componente precisa de DOM para render e query.
    // O pipeline de tokens continua testado em `accent.spec.ts`, que nao
    // toca DOM e roda igual nos dois ambientes.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
  },
});
```

- [ ] **Passo 3: criar `packages/ui/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Passo 4: ligar JSX no `tsconfig.json`**

Em `packages/ui/tsconfig.json`, dentro de `compilerOptions`, acrescentar:

```json
"jsx": "react-jsx",
"lib": ["ES2023", "DOM", "DOM.Iterable"]
```

- [ ] **Passo 5: escrever o teste do `Icon` que falha**

Criar `packages/ui/src/components/Icon.spec.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon.js';

describe('Icon', () => {
  it('renderiza svg escondido do leitor de tela', () => {
    const { container } = render(<Icon name="check-circle" />);
    const svg = container.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('usa currentColor para herdar o tom de quem o contem', () => {
    const { container } = render(<Icon name="x-circle" />);

    expect(container.querySelector('svg')).toHaveAttribute('stroke', 'currentColor');
  });
});
```

**Por que `aria-hidden`:** o ícone nunca é o canal de informação — o rótulo textual ao lado é. Um
ícone anunciado pelo leitor de tela duplicaria a leitura ("check-circle Liberado"). A regra §10
item 1 exige os dois canais na tela, não duas leituras no áudio.

- [ ] **Passo 6: rodar e ver falhar**

```bash
pnpm --filter @arenahub/ui test
```

Esperado: FAIL — `Cannot find module './Icon.js'`.

- [ ] **Passo 7: implementar `packages/ui/src/components/Icon.tsx`**

```tsx
/**
 * Conjunto FECHADO de icones, inline, sem dependencia externa.
 *
 * Nao instalamos `lucide-react` nem equivalente: o painel usa ~20 icones de um
 * catalogo de milhares, e a arvore inteira entraria no bundle do Server
 * Component. Uniao literal em vez de `string` faz o compilador recusar nome
 * inexistente -- icone que nao renderiza vira erro de build, nao quadrado vazio
 * em producao.
 *
 * Traçado do Lucide (ISC), redesenhado em 24x24 com stroke 2.
 */
export type IconName =
  | 'check-circle'
  | 'x-circle'
  | 'alert-circle'
  | 'alert-triangle'
  | 'clock'
  | 'minus'
  | 'ban'
  | 'user-check'
  | 'user-minus'
  | 'user-x'
  | 'user-plus'
  | 'key-round'
  | 'scan-face'
  | 'wifi'
  | 'wifi-off'
  | 'copy'
  | 'refresh-cw'
  | 'archive'
  | 'calendar-x'
  | 'hourglass';

const PATHS: Record<IconName, readonly string[]> = {
  'check-circle': ['M21.8 10A10 10 0 1 1 17 3.34', 'm9 11 3 3L22 4'],
  'x-circle': ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'm15 9-6 6', 'm9 9 6 6'],
  'alert-circle': ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 8v4', 'M12 16h.01'],
  'alert-triangle': [
    'm21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z',
    'M12 9v4',
    'M12 17h.01',
  ],
  clock: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 6v6l4 2'],
  minus: ['M5 12h14'],
  ban: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'm4.9 4.9 14.2 14.2'],
  'user-check': ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'm16 11 2 2 4-4'],
  'user-minus': ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M22 11h-6'],
  'user-x': ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'm17 8 5 5', 'm22 8-5 5'],
  'user-plus': ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M19 8v6', 'M22 11h-6'],
  'key-round': [
    'M2.6 13.4A6 6 0 0 1 11 5a6 6 0 0 1 8.5 8.5L21 15l-2 2-2-2-2 2-2-2-2 2-2.6-2.6z',
    'M7.5 15.5h.01',
  ],
  'scan-face': [
    'M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2',
    'M7 21H5a2 2 0 0 1-2-2v-2', 'M9 10h.01', 'M15 10h.01', 'M9 15c.8.6 1.9 1 3 1s2.2-.4 3-1',
  ],
  wifi: ['M5 12.5a10 10 0 0 1 14 0', 'M8.5 16a5 5 0 0 1 7 0', 'M12 20h.01'],
  'wifi-off': ['m2 2 20 20', 'M8.5 16a5 5 0 0 1 7 0', 'M12 20h.01', 'M5 12.5a10 10 0 0 1 3-2'],
  copy: ['M9 9h10v10H9z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  'refresh-cw': ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  archive: ['M3 3h18v4H3z', 'M5 7v13h14V7', 'M10 12h4'],
  'calendar-x': ['M3 5h18v16H3z', 'M8 3v4', 'M16 3v4', 'M3 10h18', 'm10 14 4 4', 'm14 14-4 4'],
  hourglass: ['M6 2h12', 'M6 22h12', 'M8 2c0 5 8 5 8 10s-8 5-8 10'],
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
```

- [ ] **Passo 8: rodar e ver passar**

```bash
pnpm --filter @arenahub/ui test
```

Esperado: PASS, 2 testes.

- [ ] **Passo 9: criar `packages/ui/src/components/Ausente.tsx`**

Nasce aqui porque a Task 3 já o consome — um componente cujo primeiro uso vem antes da sua criação
deixa a tarefa intermediária sem como passar no próprio teste.

```tsx
/**
 * Ausencia de dado NAO e zero -- DS-PAINEL.md §10 item 5.
 *
 * Existe como componente para o `aria-label` nunca divergir: "—" sozinho e
 * lido como "traco" ou pulado, dependendo do leitor de tela.
 */
export function Ausente() {
  return <span aria-label="não informado">—</span>;
}
```

- [ ] **Passo 10: exportar em `src/index.ts`**

```ts
export { Ausente } from './components/Ausente.js';
export { Icon, type IconName } from './components/Icon.js';
```

- [ ] **Passo 11: gate e commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add packages/ui
git commit -m "feat(ui): infraestrutura de teste de componente e conjunto fechado de icones"
```

---

## Task 2: `state-labels.ts` — consolidar os 5 dicionários existentes

O coração da fatia, e o caso mais claro de extração. §7 do contrato: 11 máquinas, ~40 estados.
Hoje isso vive em **cinco lugares**, dois deles inline em página, e **já divergiu** antes de o
componente existir.

**Antes de escrever qualquer linha, leia as cinco fontes:**

```bash
sed -n '1,145p'  apps/admin-web/src/students/formatar.ts     # 5 dicionários + transições
sed -n '60,145p' apps/admin-web/src/operations/formatar.ts   # 6 dicionários + traduzir()
sed -n '32,44p'  "apps/admin-web/app/(protected)/operations/devices/page.tsx"
sed -n '39,55p'  "apps/admin-web/app/(protected)/students/[id]/biometrics/page.tsx"
```

O destino recebe **as frases que já estão lá**, acrescidas de `tone` e `icon`, que hoje não
existem em lugar nenhum. Só duas frases mudam, ambas aprovadas pelo PI (ver *Regra de
precedência*): `passage.NOT_APPLICABLE` e `syncJob.RETRYING`.

**Arquivos:**
- Criar: `packages/ui/src/domain/state-labels.ts`
- Criar: `packages/ui/src/domain/state-labels.spec.ts`
- Modificar: `packages/ui/package.json` (dependência `@arenahub/access-policy`)

**Interfaces:**
- Consome: `IconName` da Task 1. `DENY_REASON` e `ALLOW_REASON` de `@arenahub/access-policy`.
- Produz:
  - `type Tone = 'success' | 'warning' | 'danger' | 'info' | 'risk' | 'neutral'`
  - `type StateMachine = 'student' | 'subscription' | 'entitlement' | 'biometric' | 'syncJob' | 'device' | 'accessReason' | 'passage' | 'invoice' | 'payment' | 'reconciliation' | 'riskBand'`
  - `interface StateLabel { label: string; tone: Tone; icon: IconName }`
  - `function stateLabel(machine: StateMachine, state: string): StateLabel | undefined`

- [ ] **Passo 1: adicionar a dependência**

```bash
pnpm --filter @arenahub/ui add @arenahub/access-policy@workspace:*
```

- [ ] **Passo 2: escrever o teste que falha**

Criar `packages/ui/src/domain/state-labels.spec.ts`:

```tsx
import { ALLOW_REASON, DENY_REASON } from '@arenahub/access-policy';
import { describe, expect, it } from 'vitest';

import { STATE_LABELS, stateLabel } from './state-labels.js';

describe('state-labels', () => {
  it('cobre TODA razao do motor -- codigo sem rotulo e badge vazio em producao', () => {
    const codigos = [...Object.values(ALLOW_REASON), ...Object.values(DENY_REASON)];

    for (const codigo of codigos) {
      expect(stateLabel('accessReason', codigo), `sem rotulo para ${codigo}`).toBeDefined();
    }
  });

  it('nao inventa codigo que o motor nao produz', () => {
    const conhecidos = new Set<string>([
      ...Object.values(ALLOW_REASON),
      ...Object.values(DENY_REASON),
    ]);

    for (const codigo of Object.keys(STATE_LABELS.accessReason)) {
      expect(conhecidos.has(codigo), `${codigo} nao existe em access-policy`).toBe(true);
    }
  });

  it('SUBSCRIPTION_OVERDUE nao existe -- inadimplencia chega como NO_ENTITLEMENT', () => {
    expect(stateLabel('accessReason', 'SUBSCRIPTION_OVERDUE')).toBeUndefined();
  });

  it('erro so para decisao deliberada; contornavel e atencao', () => {
    expect(stateLabel('accessReason', 'ADMIN_BLOCK')?.tone).toBe('danger');
    expect(stateLabel('accessReason', 'STUDENT_BLOCKED')?.tone).toBe('danger');
    expect(stateLabel('accessReason', 'NO_ENTITLEMENT')?.tone).toBe('danger');

    expect(stateLabel('accessReason', 'STUDENT_INACTIVE')?.tone).toBe('warning');
    expect(stateLabel('accessReason', 'WRONG_UNIT')?.tone).toBe('warning');
    expect(stateLabel('accessReason', 'OUTSIDE_SCHEDULE')?.tone).toBe('warning');
  });

  /**
   * REGRESSAO: estas sao as frases que JA estao em producao, em
   * `apps/admin-web/src/operations/formatar.ts:93-102`. A extracao nao pode
   * reescreve-las.
   *
   * O comentario da linha 90 de la explica por que elas ganham de rotulo
   * curto: "as frases dizem O QUE ACONTECEU, nao o que o sistema concluiu --
   * 'o plano vale em outra unidade' e acionavel; 'unidade errada' acusa o
   * aluno". Trocar por "Outra unidade" seria regressao de produto disfarcada
   * de melhoria de layout.
   */
  it('preserva byte a byte as frases que ja estao em producao', () => {
    expect(stateLabel('accessReason', 'ACTIVE_ENTITLEMENT')?.label).toBe('Plano válido');
    expect(stateLabel('accessReason', 'MANUAL_OVERRIDE')?.label).toBe(
      'Liberado manualmente pela recepção',
    );
    expect(stateLabel('accessReason', 'NO_ENTITLEMENT')?.label).toBe('Sem plano vigente');
    expect(stateLabel('accessReason', 'WRONG_UNIT')?.label).toBe('O plano vale em outra unidade');
    expect(stateLabel('accessReason', 'OUTSIDE_SCHEDULE')?.label).toBe('Fora do horário do plano');
    expect(stateLabel('accessReason', 'STUDENT_BLOCKED')?.label).toBe('Aluno bloqueado');
    expect(stateLabel('accessReason', 'STUDENT_INACTIVE')?.label).toBe('Cadastro não está ativo');
    expect(stateLabel('accessReason', 'ADMIN_BLOCK')?.label).toBe('Bloqueio administrativo');
  });

  it('LEAD continua "Interessado" -- o codigo venceu o contrato aqui', () => {
    // `DS-PAINEL.md` §7 escreve "Lead"; a tela ja diz "Interessado", que e
    // portugues e e o que a recepcao le. Frase de tela: o existente vence.
    expect(stateLabel('student', 'LEAD')?.label).toBe('Interessado');
  });

  /**
   * As DUAS unicas frases que mudam nesta fatia -- aprovadas pelo PI em
   * 16/08/2026.
   */
  it('NOT_APPLICABLE deixa de ser travessao', () => {
    // Era '—', que colapsava "equipamento nao confirma giro" com "dado
    // ausente" -- o oposto do que o §7 diz que este estado existe para
    // impedir.
    expect(stateLabel('passage', 'NOT_APPLICABLE')?.label).toBe('Não confirma giro');
  });

  it('RETRYING tem UM nome so, e e o do contrato', () => {
    // `devices/page.tsx:32-44` dizia "Tentando de novo"; o contrato §7 diz
    // "Tentando novamente". Duas telas, dois nomes, mesmo estado.
    expect(stateLabel('syncJob', 'RETRYING')?.label).toBe('Tentando novamente');
  });

  it('entitlement REVOKED e erro; biometric REVOKED e neutro', () => {
    expect(stateLabel('entitlement', 'REVOKED')?.tone).toBe('danger');
    expect(stateLabel('biometric', 'REVOKED')?.tone).toBe('neutral');
  });

  it('todo rotulo e pt-BR nao vazio', () => {
    for (const [maquina, estados] of Object.entries(STATE_LABELS)) {
      for (const [estado, rotulo] of Object.entries(estados)) {
        expect(rotulo.label.trim(), `${maquina}.${estado}`).not.toBe('');
      }
    }
  });

  it('estado desconhecido devolve undefined em vez de rotulo inventado', () => {
    expect(stateLabel('student', 'NAO_EXISTE')).toBeUndefined();
  });
});
```

**Por que o teste de cobertura importa:** o motor pode ganhar `PAYMENT_OVERDUE` no MVP 2 — o
comentário em `access-policy/src/types.ts` diz isso literalmente. Sem este teste, o código novo
chegaria à tela como badge vazio, e ninguém descobriria até a recepção reclamar.

- [ ] **Passo 3: rodar e ver falhar**

```bash
pnpm --filter @arenahub/ui test state-labels
```

Esperado: FAIL — `Cannot find module './state-labels.js'`.

- [ ] **Passo 4: implementar `packages/ui/src/domain/state-labels.ts`**

> ✅ **ENTREGUE em 16/08/2026, commit `d2fffdf`.** Se você está lendo isto numa tarefa posterior,
> **o arquivo real é a fonte, não este bloco.**
>
> 🔴 **Sete rótulos deste bloco estavam ERRADOS** e foram corrigidos na implementação. Eles traziam
> a frase do `DS-PAINEL.md` §7 onde a produção diz outra coisa — contradizendo a *Regra de
> precedência* que este mesmo plano define ("frase de tela: o código existente vence"):
>
> | chave | este bloco dizia | produção diz, e prevaleceu |
> |---|---|---|
> | `entitlement.ACTIVE` | Válido | **Ativo** |
> | `subscription.PENDING` | Aguardando início | **Pendente** |
> | `syncJob.PENDING` | Na fila | **Aguardando** |
> | `syncJob.PROCESSING` | Processando | **Em andamento** |
> | `biometric.ACTIVE` | Cadastrada | **Ativa** |
> | `biometric.DELETION_PENDING` | Exclusão em andamento | **Revogada — aguardando exclusão nos leitores** |
> | `biometric.DELETED` | Excluída | **Excluída de todos os leitores** |
>
> Os sete estão travados por teste em `state-labels.spec.ts` — "mantem a frase de producao, nao a
> do contrato". O bloco abaixo fica como registro do que foi planejado; **leia o arquivo entregue.**

```ts
import { ALLOW_REASON, DENY_REASON } from '@arenahub/access-policy';

import type { IconName } from '../components/Icon.js';

/**
 * Dicionario canonico de estado -- DS-PAINEL.md §7.
 *
 * Dominio em ingles no codigo, PORTUGUES na interface. Nenhum componente
 * escreve rotulo inline: quem precisa de texto de estado importa daqui.
 *
 * O motivo de existir um arquivo unico e a divergencia. Rotulo repetido em
 * cinco telas diverge na primeira correcao -- uma tela passa a dizer "Sem
 * plano" e outra "Sem direito vigente" para o MESMO codigo, e a recepcao
 * conclui que sao situacoes diferentes.
 */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'risk' | 'neutral';

export interface StateLabel {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: IconName;
}

export type StateMachine =
  | 'student'
  | 'subscription'
  | 'entitlement'
  | 'biometric'
  | 'syncJob'
  | 'device'
  | 'accessReason'
  | 'passage'
  | 'invoice'
  | 'payment'
  | 'reconciliation'
  | 'riskBand';

type Dictionary = Readonly<Record<StateMachine, Readonly<Record<string, StateLabel>>>>;

export const STATE_LABELS: Dictionary = {
  student: {
    // "Interessado", nao "Lead" -- o codigo em producao ja usa portugues aqui,
    // e frase de tela e o eixo onde o existente vence o contrato.
    LEAD: { label: 'Interessado', tone: 'neutral', icon: 'user-plus' },
    TRIAL: { label: 'Experimental', tone: 'info', icon: 'hourglass' },
    ACTIVE: { label: 'Ativo', tone: 'success', icon: 'user-check' },
    SUSPENDED: { label: 'Suspenso', tone: 'warning', icon: 'user-minus' },
    BLOCKED: { label: 'Bloqueado', tone: 'danger', icon: 'user-x' },
    CANCELLED: { label: 'Cancelado', tone: 'neutral', icon: 'x-circle' },
    ARCHIVED: { label: 'Arquivado', tone: 'neutral', icon: 'archive' },
  },

  subscription: {
    PENDING: { label: 'Aguardando início', tone: 'info', icon: 'clock' },
    ACTIVE: { label: 'Ativa', tone: 'success', icon: 'check-circle' },
    PAST_DUE: { label: 'Em atraso', tone: 'warning', icon: 'alert-circle' },
    PAUSED: { label: 'Pausada', tone: 'neutral', icon: 'minus' },
    CANCELLED: { label: 'Cancelada', tone: 'neutral', icon: 'x-circle' },
    EXPIRED: { label: 'Expirada', tone: 'neutral', icon: 'calendar-x' },
  },

  entitlement: {
    SCHEDULED: { label: 'Agendado', tone: 'info', icon: 'clock' },
    ACTIVE: { label: 'Válido', tone: 'success', icon: 'key-round' },
    SUSPENDED: { label: 'Suspenso', tone: 'warning', icon: 'alert-circle' },
    /**
     * Tom ERRO aqui, NEUTRO em `biometric.REVOKED` -- e deliberado.
     *
     * Revogar direito de acesso e falha de um contrato que deveria valer.
     * Revogar consentimento biometrico e DIREITO DO TITULAR (ADR-008 decisao
     * 3): o aluno exerceu a LGPD, e o sistema funcionou como devia. Pintar de
     * vermelho ensinaria a recepcao a tratar exercicio de direito como
     * problema a resolver.
     *
     * Se alguem "consertar" a inconsistencia, quebra a decisao -- por isso
     * esta escrita aqui e testada em `state-labels.spec.ts`.
     */
    REVOKED: { label: 'Revogado', tone: 'danger', icon: 'ban' },
    EXPIRED: { label: 'Expirado', tone: 'neutral', icon: 'calendar-x' },
  },

  biometric: {
    PENDING_CONSENT: { label: 'Aguardando consentimento', tone: 'info', icon: 'clock' },
    ACTIVE: { label: 'Cadastrada', tone: 'success', icon: 'scan-face' },
    REVOKED: { label: 'Revogada', tone: 'neutral', icon: 'ban' },
    DELETION_PENDING: { label: 'Exclusão em andamento', tone: 'warning', icon: 'clock' },
    DELETED: { label: 'Excluída', tone: 'neutral', icon: 'minus' },
  },

  syncJob: {
    PENDING: { label: 'Na fila', tone: 'info', icon: 'clock' },
    PROCESSING: { label: 'Processando', tone: 'info', icon: 'refresh-cw' },
    SYNCED: { label: 'Sincronizado', tone: 'success', icon: 'check-circle' },
    FAILED: { label: 'Falhou', tone: 'danger', icon: 'x-circle' },
    RETRYING: { label: 'Tentando novamente', tone: 'warning', icon: 'refresh-cw' },
    REMOVED: { label: 'Removido', tone: 'neutral', icon: 'minus' },
  },

  device: {
    PROVISIONING: { label: 'Provisionando', tone: 'info', icon: 'clock' },
    ONLINE: { label: 'Online', tone: 'success', icon: 'wifi' },
    DEGRADED: { label: 'Degradado', tone: 'warning', icon: 'alert-circle' },
    OFFLINE: { label: 'Offline', tone: 'danger', icon: 'wifi-off' },
    RETIRED: { label: 'Desativado', tone: 'neutral', icon: 'minus' },
  },

  /**
   * Razoes de acesso -- ADR-024, frases aprovadas pelo PI em 16/08/2026
   * (issue #81). Rotulo CURTO e operacional: cabe em coluna de tabela e a
   * recepcao le de relance. Explicacao longa vai para tooltip ou ficha.
   *
   * TOM: erro so para decisao deliberada. Vermelho quando alguem decidiu
   * barrar; ambar quando da para resolver no balcao. Achatar tudo em vermelho
   * faria "errou de porta" parecer "bloqueado pela gerencia", e a acao certa e
   * diferente em cada caso.
   *
   * As chaves vem de `@arenahub/access-policy` -- NUNCA redeclarar aqui
   * (SPEC-042 §6). O teste de cobertura falha se um codigo novo aparecer la
   * sem rotulo aqui.
   */
  accessReason: {
    [ALLOW_REASON.ACTIVE_ENTITLEMENT]: {
      label: 'Plano válido',
      tone: 'success',
      icon: 'check-circle',
    },
    /**
     * Rotulo PROPRIO, nunca "Plano valido". O motor nunca produz este valor:
     * quem o grava e o caso de uso de override. Confundir os dois faz
     * relatorio de "acesso por direito valido" contar excecao como regra.
     */
    [ALLOW_REASON.MANUAL_OVERRIDE]: {
      label: 'Liberado manualmente pela recepção',
      tone: 'success',
      icon: 'user-check',
    },
    [DENY_REASON.ADMIN_BLOCK]: {
      label: 'Bloqueio administrativo',
      tone: 'danger',
      icon: 'ban',
    },
    [DENY_REASON.STUDENT_BLOCKED]: {
      label: 'Aluno bloqueado',
      tone: 'danger',
      icon: 'user-x',
    },
    [DENY_REASON.STUDENT_INACTIVE]: {
      label: 'Cadastro não está ativo',
      tone: 'warning',
      icon: 'user-minus',
    },
    [DENY_REASON.NO_ENTITLEMENT]: {
      label: 'Sem plano vigente',
      tone: 'danger',
      icon: 'x-circle',
    },
    [DENY_REASON.WRONG_UNIT]: {
      label: 'O plano vale em outra unidade',
      tone: 'warning',
      icon: 'alert-circle',
    },
    [DENY_REASON.OUTSIDE_SCHEDULE]: {
      label: 'Fora do horário do plano',
      tone: 'warning',
      icon: 'clock',
    },
  },

  /**
   * `NOT_APPLICABLE` existe para impedir que a operacao leia "sem confirmacao"
   * como falha: nem todo equipamento confirma giro (DS-PAINEL.md §7).
   */
  passage: {
    /**
     * MUDA nesta fatia (PI, 16/08/2026): era `'—'` em
     * `ROTULO_DE_PASSAGEM.NOT_APPLICABLE`, o que colapsava "este equipamento
     * nao confirma giro" com "dado ausente" -- exatamente o que este estado
     * existe para impedir.
     */
    NOT_APPLICABLE: { label: 'Não confirma giro', tone: 'neutral', icon: 'minus' },
    PENDING: { label: 'Aguardando giro', tone: 'info', icon: 'clock' },
    // "Passou"/"Nao passou" vem da producao: dizem o que aconteceu no mundo,
    // nao o estado interno do registro.
    CONFIRMED: { label: 'Passou', tone: 'success', icon: 'check-circle' },
    TIMED_OUT: { label: 'Não passou', tone: 'warning', icon: 'alert-circle' },
  },

  invoice: {
    DRAFT: { label: 'Rascunho', tone: 'neutral', icon: 'minus' },
    OPEN: { label: 'Em aberto', tone: 'info', icon: 'clock' },
    PAID: { label: 'Paga', tone: 'success', icon: 'check-circle' },
    OVERDUE: { label: 'Vencida', tone: 'warning', icon: 'alert-circle' },
    CANCELLED: { label: 'Cancelada', tone: 'neutral', icon: 'x-circle' },
    REFUNDED: { label: 'Estornada', tone: 'neutral', icon: 'refresh-cw' },
  },

  payment: {
    PENDING: { label: 'Pendente', tone: 'info', icon: 'clock' },
    PROCESSING: { label: 'Processando', tone: 'info', icon: 'refresh-cw' },
    CONFIRMED: { label: 'Confirmado', tone: 'success', icon: 'check-circle' },
    FAILED: { label: 'Falhou', tone: 'danger', icon: 'x-circle' },
    CANCELLED: { label: 'Cancelado', tone: 'neutral', icon: 'minus' },
    REFUND_PENDING: { label: 'Estorno em andamento', tone: 'warning', icon: 'refresh-cw' },
    REFUNDED: { label: 'Estornado', tone: 'neutral', icon: 'refresh-cw' },
    REQUIRES_ACTION: { label: 'Ação necessária', tone: 'warning', icon: 'alert-circle' },
  },

  reconciliation: {
    MATCHED: { label: 'Conciliado', tone: 'success', icon: 'check-circle' },
    MISSING_INTERNAL: { label: 'Ausente no ArenaHub', tone: 'danger', icon: 'x-circle' },
    MISSING_EXTERNAL: { label: 'Ausente no provedor', tone: 'danger', icon: 'x-circle' },
    AMOUNT_MISMATCH: { label: 'Valor divergente', tone: 'warning', icon: 'alert-circle' },
    RESOLVED: { label: 'Resolvido', tone: 'neutral', icon: 'check-circle' },
  },

  riskBand: {
    LOW: { label: 'Baixo', tone: 'success', icon: 'check-circle' },
    MEDIUM: { label: 'Médio', tone: 'warning', icon: 'alert-circle' },
    HIGH: { label: 'Alto', tone: 'risk', icon: 'alert-triangle' },
    CRITICAL: { label: 'Crítico', tone: 'danger', icon: 'alert-triangle' },
  },
};

/**
 * Devolve `undefined` para estado desconhecido -- NUNCA um rotulo inventado
 * nem o codigo cru. Quem chama decide o que fazer com a ausencia; devolver o
 * codigo em ingles vazaria dominio para a tela do usuario.
 */
export function stateLabel(machine: StateMachine, state: string): StateLabel | undefined {
  return STATE_LABELS[machine][state];
}
```

- [ ] **Passo 5: rodar e ver passar**

```bash
pnpm --filter @arenahub/ui test state-labels
```

Esperado: PASS, 12 testes.

- [ ] **Passo 6: conferência cruzada contra as cinco fontes**

O teste prova o que ele lista. Este passo pega o que ele não lista. Para **cada** par
`codigo: 'frase'` das cinco fontes, confirme que a frase em `state-labels.ts` é idêntica:

⚠️ **Node não importa `.ts` direto** — `node --input-type=module -e "import … .ts"` falha, e
`console.log` em teste do Vitest não chega ao stdout desta configuração. Leia o arquivo e compare
com as fontes:

```bash
grep -E "label:" packages/ui/src/domain/state-labels.ts
```

Compare a saída com os dicionários de `src/operations/formatar.ts`, `src/students/formatar.ts`,
`devices/page.tsx:32-44` e `biometrics/page.tsx:39-55`. **Toda diferença é ou um dos dois ajustes
aprovados, ou um bug seu.** Não há terceira opção — e nenhuma diferença "melhora" texto.

⚠️ Colisão esperada: o mesmo código aparece em máquinas diferentes com rótulos legitimamente
diferentes (`entitlement.REVOKED` = "Revogado", `biometric.REVOKED` = "Revogada"; `ACTIVE` em
quatro máquinas). Por isso o dicionário é chaveado por máquina, e por isso o achatamento acima
serve só para conferência visual, nunca como estrutura.

- [ ] **Passo 7: exportar e commitar**

Em `src/index.ts`:

```ts
export {
  STATE_LABELS,
  stateLabel,
  type StateLabel,
  type StateMachine,
  type Tone,
} from './domain/state-labels.js';
```

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add packages/ui
git commit -m "feat(ui): dicionario canonico de estado com as frases aprovadas pelo PI"
```

---

## Task 3: `StateBadge`

**Arquivos:**
- Criar: `packages/ui/src/components/StateBadge.tsx`
- Criar: `packages/ui/src/components/StateBadge.module.css`
- Criar: `packages/ui/src/components/StateBadge.spec.tsx`

**Interfaces:**
- Consome: `stateLabel`, `Tone` (Task 2); `Icon` (Task 1).
- Produz: `<StateBadge machine={StateMachine} state={string} live={boolean?} />`.

- [ ] **Passo 1: escrever o teste que falha**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StateBadge } from './StateBadge.js';

describe('StateBadge', () => {
  it('mostra o rotulo pt-BR do dicionario, nunca o codigo cru', () => {
    render(<StateBadge machine="student" state="BLOCKED" />);

    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(screen.queryByText('BLOCKED')).not.toBeInTheDocument();
  });

  it('carrega icone E texto -- cor nunca e o unico canal', () => {
    const { container } = render(<StateBadge machine="device" state="OFFLINE" />);

    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('estado desconhecido nao renderiza badge vazio', () => {
    const { container } = render(<StateBadge machine="student" state="NAO_EXISTE" />);

    expect(container.querySelector('[data-tone]')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByLabelText('não informado')).toBeInTheDocument();
  });

  it('expoe o tom para o CSS sem embutir cor no componente', () => {
    const { container } = render(<StateBadge machine="access" state="X" />);
    render(<StateBadge machine="entitlement" state="ACTIVE" />);

    expect(screen.getByText('Ativo').closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'success',
    );
  });

  it('live liga role=status para o leitor anunciar mudanca em tempo real', () => {
    render(<StateBadge machine="device" state="DEGRADED" live />);

    expect(screen.getByRole('status')).toHaveTextContent('Degradado');
  });

  it('sem live nao ha role=status -- badge de tabela nao interrompe leitura', () => {
    render(<StateBadge machine="device" state="ONLINE" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
pnpm --filter @arenahub/ui test StateBadge
```

Esperado: FAIL — módulo não existe.

- [ ] **Passo 3: implementar `StateBadge.module.css`**

```css
/**
 * Badge -- DS-PAINEL.md §2.2: fundo = tom a 10%, borda = tom a 32%, texto e
 * icone = tom solido. `color-mix` resolve isso sem gerar 18 tokens extras.
 *
 * ACCENT E PROIBIDO AQUI (regra 3 de lint): badge fala de ESTADO, e o accent
 * do tenant e ACAO. Um tenant com accent vermelho faria "Ativo" parecer erro.
 */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid;
  border-radius: var(--ah-radius-badge);
  font-size: var(--ah-type-caption-size);
  line-height: var(--ah-type-caption-lh);
  font-weight: 600;
  white-space: nowrap;
}

.badge[data-tone='success'] { color: var(--ah-success); }
.badge[data-tone='warning'] { color: var(--ah-warning); }
.badge[data-tone='danger']  { color: var(--ah-danger); }
.badge[data-tone='info']    { color: var(--ah-info); }
.badge[data-tone='risk']    { color: var(--ah-risk); }
.badge[data-tone='neutral'] { color: var(--ah-text-muted); }

.badge[data-tone] {
  background: color-mix(in srgb, currentColor 10%, var(--ah-surface-raised));
  border-color: color-mix(in srgb, currentColor 32%, transparent);
}

/* Ausencia de dado NAO e zero nem badge vazio -- §10 item 5. */
.ausente {
  color: var(--ah-text-muted);
}
```

- [ ] **Passo 4: implementar `StateBadge.tsx`**

```tsx
import { Icon } from './Icon.js';
import { stateLabel, type StateMachine } from '../domain/state-labels.js';
import estilos from './StateBadge.module.css';

interface Props {
  readonly machine: StateMachine;
  readonly state: string;
  /**
   * Liga `role="status"` -- DS-PAINEL.md §7: estado que muda em tempo real
   * precisa ser anunciado. Fica DESLIGADO por padrao porque uma tabela de 20
   * linhas com `role="status"` em cada celula transforma o leitor de tela num
   * despejo continuo.
   */
  readonly live?: boolean;
}

export function StateBadge({ machine, state, live = false }: Props) {
  const rotulo = stateLabel(machine, state);

  /**
   * Estado desconhecido vira `—`, nao badge vazio nem codigo em ingles.
   * Acontece de verdade: enum novo no backend chega antes do rotulo aqui.
   */
  if (!rotulo) {
    return (
      <span className={estilos.ausente} aria-label="não informado">
        —
      </span>
    );
  }

  return (
    <span
      className={estilos.badge}
      data-tone={rotulo.tone}
      {...(live ? { role: 'status' } : {})}
    >
      <Icon name={rotulo.icon} />
      {rotulo.label}
    </span>
  );
}
```

- [ ] **Passo 5: ~~acrescentar tokens~~ — NÃO FAÇA. Os dois já existem.**

> 🔴 **Passo errado, descoberto na execução de 16/08/2026.** Este passo mandava criar
> `--ah-radius-badge` e `text.muted`. Nenhum dos dois deve ser criado:
>
> - **`--ah-radius-badge` já existe**, em `theme.css:118`. Sai da camada de **expressão**
>   (`tokens/expression.json` → `[data-surface="panel"]`), não da semântica. O plano supôs que a
>   semântica era a única fonte de token; não é — `radius.*` e `size.*` vivem na expressão, porque
>   variam por superfície.
> - **`text.muted` seria a segunda verdade que o pipeline existe para impedir.**
>   `semantic.json` já tem `text.secondary` → `carbon.500`, com `$role` escrito: *"piso para texto
>   informativo"*. O `CONTRAST_REPORT` já mede **6.56** sobre `surface.raised` — exatamente o ref e
>   o ratio que este passo pedia. Use `--ah-text-secondary`.
>
> **Lição para as tarefas seguintes:** antes de acrescentar token, procure em
> `dist-tokens/theme.css` **e** nas três camadas (`primitive`, `semantic`, `expression`). Token novo
> com valor idêntico a um existente é duplicata, e o `$role` do existente costuma já dizer para que
> ele serve.

Nenhum token muda nesta tarefa. Se `pnpm build` mexer em `theme.css`, é LF→CRLF — restaure.

- [ ] **Passo 6: rodar e ver passar**

```bash
pnpm --filter @arenahub/ui test StateBadge
```

Esperado: PASS, 6 testes.

- [ ] **Passo 7: exportar e commitar**

```ts
export { StateBadge } from './components/StateBadge.js';
```

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add packages/ui
git commit -m "feat(ui): StateBadge com icone e rotulo -- cor nunca e o unico canal"
```

---

> 📌 **Da Task 3, para todas as tarefas com CSS Module.** Duas coisas já resolvidas, não repita a
> descoberta:
>
> - **`packages/ui/src/css-modules.d.ts` existe.** Sem a declaração ambiente, o TypeScript trata
>   `import estilos from './X.module.css'` como `any` implícito e o lint reprova com
>   `no-unsafe-assignment`. Já está lá; nenhum componente novo precisa criá-la.
> - **O acesso é `estilos['badge']`, não `estilos.badge`.** O `noPropertyAccessFromIndexSignature`
>   do tsconfig base reprova o acesso por ponto com TS4111. Os blocos de código deste plano usam
>   `estilos.nome` — **troque para colchete** ao implementar.
> - **O Vitest resolve `.module.css` sem configuração.** Não mexa no `vitest.config.ts` por isso.

## Task 4: `Button`

**Arquivos:**
- Criar: `packages/ui/src/components/Button.tsx`, `Button.module.css`, `Button.spec.tsx`

**Interfaces:**
- Consome: nada além de tokens.
- Produz: `<Button variant="solid"|"outline"|"ghost"|"destructive" ...ButtonHTMLAttributes />`.

- [ ] **Passo 1: escrever o teste que falha**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button.js';

describe('Button', () => {
  it('type=button por padrao -- dentro de form, submit acidental e bug classico', () => {
    render(<Button>Salvar</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('respeita type explicito', () => {
    render(<Button type="submit">Enviar</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('expoe a variante para o CSS', () => {
    render(<Button variant="destructive">Revogar biometria</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'destructive');
  });

  it('desabilitado continua legivel pelo leitor de tela', () => {
    render(<Button disabled>Salvar</Button>);

    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
pnpm --filter @arenahub/ui test Button
```

- [ ] **Passo 3: implementar `Button.module.css`**

```css
/**
 * Controles -- DS-PAINEL.md §6. Altura 36 px, raio 6 px.
 */
.botao {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--ah-radius-control);
  font-family: inherit;
  font-size: var(--ah-type-body-size);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--ah-motion-control) var(--ah-motion-easing),
              border-color var(--ah-motion-control) var(--ah-motion-easing);
}

.botao[data-variant='solid'] {
  background: var(--ah-action-solid);
  color: var(--ah-action-on-solid);
}
.botao[data-variant='solid']:hover:not(:disabled) {
  background: var(--ah-action-solid-hover);
}

.botao[data-variant='outline'] {
  background: var(--ah-surface-raised);
  border-color: var(--ah-border-default);
  color: var(--ah-text-label);
}
.botao[data-variant='outline']:hover:not(:disabled) {
  border-color: var(--ah-border-strong);
}

.botao[data-variant='ghost'] {
  background: transparent;
  color: var(--ah-action-text);
}
.botao[data-variant='ghost']:hover:not(:disabled) {
  background: var(--ah-surface-canvas);
}

.botao[data-variant='destructive'] {
  background: var(--ah-surface-raised);
  border-color: var(--ah-danger);
  color: var(--ah-danger);
}
.botao[data-variant='destructive']:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ah-danger) 6%, var(--ah-surface-raised));
}

/**
 * Disabled -- EXCECAO NOMEADA de contraste, decidida pelo PI (opcao A).
 *
 * `--ah-text-disabled` resolve para carbon-400 (3.78), abaixo do alvo de 4.5.
 * WCAG 2.2 §1.4.3 isenta componente inativo. `carbon-500` foi RECUSADO: um
 * desabilitado escuro demais volta a ler como habilitado, trocando falha de
 * contraste por falha de affordance -- pior na recepcao.
 *
 * A isencao esta declarada em `tokens/semantic.json` como `$exempt`. Remover
 * de la derruba o build.
 */
.botao:disabled {
  background: var(--ah-surface-canvas);
  border-color: var(--ah-border-subtle);
  color: var(--ah-text-disabled);
  cursor: not-allowed;
}
```

- [ ] **Passo 4: implementar `Button.tsx`**

```tsx
import type { ButtonHTMLAttributes } from 'react';

import estilos from './Button.module.css';

type Variant = 'solid' | 'outline' | 'ghost' | 'destructive';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
}

/**
 * Botao destrutivo usa o VERBO REAL ("Revogar biometria"), nunca "OK"
 * -- DS-PAINEL.md §6. Isto e responsabilidade de quem chama; o componente so
 * garante que a variante exista e pareca perigosa.
 */
export function Button({ variant = 'solid', type = 'button', ...resto }: Props) {
  return <button {...resto} type={type} data-variant={variant} className={estilos.botao} />;
}
```

- [ ] **Passo 5: acrescentar tokens que faltam**

Em `tokens/semantic.json`:

```json
"text": {
  "label":    { "ref": "carbon.600" },
  "disabled": { "ref": "carbon.400", "$exempt": "WCAG 2.2 §1.4.3 -- componente inativo e isento de contraste minimo. Decisao do PI em 16/08/2026, opcao A." }
},
"border": {
  "subtle": { "ref": "carbon.100" }
},
"action": {
  "solid-hover": { "ref": "accent.800" }
}
```

- [ ] **Passo 6: rodar, exportar e commitar**

```bash
pnpm --filter @arenahub/ui build:tokens
pnpm --filter @arenahub/ui test Button
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add packages/ui
git commit -m "feat(ui): Button com as quatro variantes e a excecao nomeada do Disabled"
```

---

## Task 5: `ProblemDetail` e `Toast`

Os dois juntos porque compartilham o mapa de tom→ícone e o Toast consome o mesmo vocabulário de
erro. `Toast` fecha a dívida do `CLAUDE.md` → *Convenções*: "Não usar Alert para msg, sempre usar
Toast para Info, Warn e error".

**Extração — leia os 6 blocos de erro antes de escrever:**

```bash
sed -n '30,33p' "apps/admin-web/app/(protected)/units/page.tsx"
sed -n '67,70p' "apps/admin-web/app/(protected)/students/page.tsx"
sed -n '76,80p' "apps/admin-web/app/(protected)/access-events/page.tsx"
sed -n '90,94p' "apps/admin-web/app/(protected)/operations/page.tsx"
sed -n '70,74p' "apps/admin-web/app/(protected)/operations/devices/page.tsx"
sed -n '41,44p' "apps/admin-web/app/(protected)/access/override/page.tsx"
```

Os seis repetem `Sem permissão para X ({code})`. A crítica marcou isto como **[P1]**: o
`if (!resposta.ok)` cobre 500, timeout e rede caída, e todos viram "sem permissão" — duas causas
com ações opostas.

⚠️ **Corrigir a mensagem é comportamento, não estilo — está FORA desta fatia.** O que a Task 5
faz é dar ao painel o componente onde a correção vai caber: `ProblemDetail` aceita `hint` e expõe
`code` + `correlationId`. As seis telas passam a usá-lo com **o texto atual**, preservado. A
ramificação por status é card `[FIX]` separado, e o `ProblemDetail` é o pré-requisito dela.

Exemplo do que a Task 10 faz nessas telas — troca o `<p role="alert">` cru pelo componente,
mesmo texto:

```tsx
<ProblemDetail
  problem={{ ...resposta.erro, correlationId: resposta.correlationId }}
  context="Alunos"
/>
```

**Arquivos:**
- Criar: `ProblemDetail.tsx`, `ProblemDetail.module.css`, `ProblemDetail.spec.tsx`
- Criar: `Toast.tsx`, `Toast.module.css`, `Toast.spec.tsx`

**Interfaces:**
- Consome: `Icon` (Task 1), `Button` (Task 4).
- Produz:
  - `interface ProblemJson { type: string; title: string; status: number; code: string; correlationId: string; detail?: string }`
  - `<ProblemDetail problem={ProblemJson} context={string?} onRetry={(() => void)?} />`
  - `<ToastRegion />` e `useToast(): { show(kind, message): void }` (client)

- [ ] **Passo 1: escrever o teste do `ProblemDetail` que falha**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProblemDetail } from './ProblemDetail.js';

const PROBLEMA = {
  type: 'https://arenahub.dev/errors/device-sync-timeout',
  title: 'Não foi possível sincronizar o dispositivo',
  status: 504,
  code: 'DEVICE_SYNC_TIMEOUT',
  correlationId: 'a1b2c3d4',
};

describe('ProblemDetail', () => {
  it('mostra os quatro campos obrigatorios', () => {
    render(<ProblemDetail problem={PROBLEMA} context="Catraca 02 · Recepção" />);

    expect(screen.getByText('Não foi possível sincronizar o dispositivo')).toBeInTheDocument();
    expect(screen.getByText('Catraca 02 · Recepção')).toBeInTheDocument();
    expect(screen.getByText(/DEVICE_SYNC_TIMEOUT/)).toBeInTheDocument();
    expect(screen.getByText(/a1b2c3d4/)).toBeInTheDocument();
  });

  it('e um alerta para o leitor de tela', () => {
    render(<ProblemDetail problem={PROBLEMA} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('nao renderiza stack nem detalhe interno mesmo se vier no payload', () => {
    const comVazamento = {
      ...PROBLEMA,
      stack: 'Error: at DeviceService.sync (/app/src/device.ts:42)',
      detail: 'connection refused 192.168.2.188:7792',
    } as unknown as typeof PROBLEMA;

    render(<ProblemDetail problem={comVazamento} />);

    expect(screen.queryByText(/DeviceService\.sync/)).not.toBeInTheDocument();
    expect(screen.queryByText(/192\.168\.2\.188/)).not.toBeInTheDocument();
  });

  it('so mostra o botao de repetir quando ha o que repetir', () => {
    const { rerender } = render(<ProblemDetail problem={PROBLEMA} />);
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();

    rerender(<ProblemDetail problem={PROBLEMA} onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});
```

**Por que o teste de vazamento:** `application/problem+json` permite campos extras, e a API pode
ganhar um `detail` técnico numa fatia futura. O componente precisa ser burro de propósito — lê só
o que sabe ler. Sem este teste, um dia o IP da catraca aparece na tela da recepção.

- [ ] **Passo 2: rodar e ver falhar**

```bash
pnpm --filter @arenahub/ui test ProblemDetail
```

- [ ] **Passo 3: implementar `ProblemDetail.module.css`**

```css
.problema {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: var(--ah-surface-raised);
  border: 1px solid color-mix(in srgb, var(--ah-danger) 32%, transparent);
  border-radius: var(--ah-radius-card);
}

.titulo {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ah-danger);
  font-size: var(--ah-type-heading-size);
  line-height: var(--ah-type-heading-lh);
  font-weight: var(--ah-type-heading-weight);
}

.contexto,
.acao {
  margin: 0;
  color: var(--ah-text-default);
}

.codigo {
  margin: 0;
  color: var(--ah-text-muted);
  font-family: var(--ah-font-mono);
  font-size: var(--ah-type-mono-size);
}
```

- [ ] **Passo 4: implementar `ProblemDetail.tsx`**

```tsx
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import estilos from './ProblemDetail.module.css';

/**
 * `application/problem+json` -- CLAUDE.md → Convencoes de codigo.
 *
 * O tipo lista SO os campos que a tela mostra. Nao e descuido: o payload pode
 * trazer `stack` ou `detail` tecnico, e o componente e burro de proposito.
 * Stack, detalhe interno e PII nunca aparecem (DS-PAINEL.md §8.1).
 */
export interface ProblemJson {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly correlationId: string;
}

interface Props {
  readonly problem: ProblemJson;
  readonly context?: string;
  readonly hint?: string;
  readonly onRetry?: () => void;
}

export function ProblemDetail({ problem, context, hint, onRetry }: Props) {
  return (
    <div className={estilos.problema} role="alert">
      <p className={estilos.titulo}>
        <Icon name="alert-circle" />
        {problem.title}
      </p>

      {context ? <p className={estilos.contexto}>{context}</p> : null}
      {hint ? <p className={estilos.acao}>O que fazer: {hint}</p> : null}

      {onRetry ? (
        <p>
          <Button variant="outline" onClick={onRetry}>
            Tentar novamente
          </Button>
        </p>
      ) : null}

      {/*
        `correlationId` visivel e o que o suporte pede primeiro. Fica em mono
        porque e string tecnica que alguem le em voz alta no telefone.
      */}
      <p className={estilos.codigo} data-testid="codigo-do-erro">
        {problem.code} · {problem.correlationId}
      </p>
    </div>
  );
}
```

**Nota sobre "copiável".** O contrato §8.1 pede `correlationId` copiável em um clique. Copiar exige
`navigator.clipboard`, portanto `'use client'`. Fica para a Task 6 junto do `Toast` — que é o
feedback de "copiado" e já é client. Aqui o valor é selecionável, que já resolve o caso do
telefone.

- [ ] **Passo 5: rodar e ver passar**

```bash
pnpm --filter @arenahub/ui test ProblemDetail
```

Esperado: PASS, 4 testes.

- [ ] **Passo 6: escrever o teste do `Toast` que falha**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ToastProvider, useToast } from './Toast.js';

function Disparador() {
  const { show } = useToast();

  return (
    <>
      <button type="button" onClick={() => show('error', 'Falha ao salvar')}>
        erro
      </button>
      <button type="button" onClick={() => show('info', 'Aluno cadastrado')}>
        info
      </button>
    </>
  );
}

describe('Toast', () => {
  it('mostra a mensagem depois do disparo', async () => {
    render(
      <ToastProvider>
        <Disparador />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'info' }));

    expect(await screen.findByText('Aluno cadastrado')).toBeInTheDocument();
  });

  it('erro usa role=alert; info usa role=status', async () => {
    render(
      <ToastProvider>
        <Disparador />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'erro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao salvar');

    await userEvent.click(screen.getByRole('button', { name: 'info' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Aluno cadastrado');
  });

  it('da para dispensar pelo teclado', async () => {
    render(
      <ToastProvider>
        <Disparador />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'info' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dispensar' }));

    expect(screen.queryByText('Aluno cadastrado')).not.toBeInTheDocument();
  });
});
```

**Por que `role` diferente por tipo:** `alert` interrompe o leitor de tela na hora; `status` espera
a pausa. Erro merece interrupção — "falha ao salvar" precisa chegar antes de a pessoa sair da
página. Confirmação não merece: interromper a cada sucesso torna o painel insuportável no leitor.

- [ ] **Passo 7: rodar e ver falhar**

```bash
pnpm --filter @arenahub/ui test Toast
```

- [ ] **Passo 8: implementar `Toast.module.css`**

```css
.regiao {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 380px;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  background: var(--ah-surface-raised);
  border: 1px solid;
  border-left-width: 4px;
  border-radius: var(--ah-radius-card);
  box-shadow: var(--ah-elev-2);
  animation: entrar var(--ah-motion-layer) var(--ah-motion-easing);
}

/* ACCENT PROIBIDO: toast de erro fala de estado, nao de acao (regra 3). */
.toast[data-kind='error'] { color: var(--ah-danger); }
.toast[data-kind='warn']  { color: var(--ah-warning); }
.toast[data-kind='info']  { color: var(--ah-info); }

.toast[data-kind] {
  border-color: color-mix(in srgb, currentColor 32%, transparent);
}

.mensagem {
  flex: 1;
  color: var(--ah-text-default);
}

@keyframes entrar {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}

/**
 * `prefers-reduced-motion` -- DS-PAINEL.md §4: so opacidade, ate 100 ms.
 * Translacao sai inteira; quem pediu menos movimento nao quer nada deslizando
 * no canto da tela.
 */
@media (prefers-reduced-motion: reduce) {
  .toast {
    animation: aparecer 100ms var(--ah-motion-easing);
  }

  @keyframes aparecer {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
}
```

- [ ] **Passo 9: implementar `Toast.tsx`**

```tsx
'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { Icon, type IconName } from './Icon.js';
import estilos from './Toast.module.css';

export type ToastKind = 'info' | 'warn' | 'error';

interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
}

const ICONE: Record<ToastKind, IconName> = {
  info: 'check-circle',
  warn: 'alert-circle',
  error: 'x-circle',
};

const ToastContext = createContext<{ show: (kind: ToastKind, message: string) => void } | null>(
  null,
);

/**
 * Toast para Info, Warn e error -- CLAUDE.md → Convencoes de codigo:
 * "Nao usar Alert para msg, sempre usar Toast".
 *
 * As telas de F6, F7 e F11 usam `role="alert"` cru; esta fatia e a que torna a
 * regra verdadeira.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  const show = useCallback((kind: ToastKind, message: string) => {
    /**
     * `Date.now()` como id serve: a lista e efemera e de UI. Colisao exigiria
     * dois toasts no MESMO milissegundo, e o pior efeito seria um `key`
     * repetido no React -- nao ha nada persistido.
     */
    setToasts((atuais) => [...atuais, { id: Date.now() + atuais.length, kind, message }]);
  }, []);

  const dispensar = useCallback((id: number) => {
    setToasts((atuais) => atuais.filter((t) => t.id !== id));
  }, []);

  const valor = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={valor}>
      {children}
      <div className={estilos.regiao}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={estilos.toast}
            data-kind={toast.kind}
            /**
             * Erro INTERROMPE o leitor de tela (`alert`); confirmacao espera a
             * pausa (`status`). Interromper a cada sucesso torna o painel
             * insuportavel para quem depende de leitor.
             */
            role={toast.kind === 'error' ? 'alert' : 'status'}
          >
            <Icon name={ICONE[toast.kind]} />
            <span className={estilos.mensagem}>{toast.message}</span>
            <button type="button" onClick={() => dispensar(toast.id)} aria-label="Dispensar">
              <Icon name="x-circle" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const contexto = useContext(ToastContext);

  if (!contexto) {
    throw new Error('useToast exige <ToastProvider> acima na arvore.');
  }

  return contexto;
}
```

- [ ] **Passo 10: rodar, exportar e commitar**

```bash
pnpm --filter @arenahub/ui add -D @testing-library/user-event@14.6.1
pnpm --filter @arenahub/ui test
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add packages/ui
git commit -m "feat(ui): ProblemDetail sem vazamento e Toast que fecha a divida do CLAUDE.md"
```

---

## Task 6: `TenantDateTime`, `Money`, `MaskedCPF`, `DataFreshness`, `EmptyState`

Cinco componentes pequenos, cada um guardando uma invariante. Juntos porque são todos formatação
pura, sem estado — e a regra de lint 5 e 6 exige que existam antes de qualquer tela.

**Extração — `TenantDateTime` substitui quatro implementações existentes:**

```bash
sed -n '46,50p'   "apps/admin-web/app/(protected)/operations/devices/page.tsx"
sed -n '57,61p'   "apps/admin-web/app/(protected)/students/[id]/biometrics/page.tsx"
sed -n '125,134p' apps/admin-web/src/operations/formatar.ts   # instanteLegivel
sed -n '175,185p' apps/admin-web/src/students/formatar.ts     # dataLegivel
```

As quatro hardcodam `'America/Sao_Paulo'` e são as **4 violações da regra 5** que o CI não pega
(ver o card `[FIX]` do eslint). O componente as substitui recebendo `timeZone` por prop.

⚠️ **A prop `timeZone` é obrigatória e sem valor padrão.** Um default `'America/Sao_Paulo'`
reproduziria o bug com outro nome: `units/page.tsx` já renderiza uma coluna "Fuso horario" por
unidade, ou seja, o painel **já sabe** que unidades têm fusos diferentes. Enquanto o seletor de
unidade não existir (P1, fora desta fatia), a tela passa o fuso da unidade que já tem em mãos —
explicitamente, no ponto de chamada, onde se vê o que está sendo assumido.

`Money` e `MaskedCPF` não têm predecessor: o MVP 1 não tem dinheiro (`formulario-de-plano.tsx:51`:
*"não tem preço — `Plan` não carrega valor monetário no MVP 1"*), e o CPF já vem mascarado da API.
Estes dois são criação de fato, e entram como contrato que a fatia do MVP 2 vai consumir.

**`EmptyState` consolida 8 mensagens de vazio.** Preserve o texto de cada uma; o que muda é só
onde ele mora. Duas delas já são exemplares e definem o padrão: `students/page.tsx:136-138`
(*"Confira a grafia ou cadastre um novo aluno"*) e o vazio de `operations` (*"Ajuste os
filtros"*) — vazio com **saída**, não beco.

**Arquivos:**
- Criar: `TenantDateTime.tsx` + `.spec.tsx`
- Criar: `Money.tsx` + `.spec.tsx`
- Criar: `MaskedCPF.tsx` + `.spec.tsx`
- Criar: `DataFreshness.tsx`, `.module.css` + `.spec.tsx`
- Criar: `EmptyState.tsx`, `.module.css` + `.spec.tsx`

**Interfaces:**
- Consome: `Icon` (Task 1), `Button` (Task 4).
- Produz:
  - `<TenantDateTime iso={string} timeZone={string} format="date"|"datetime"|"time" />`
  - `<Money cents={number} currency="BRL" />`
  - `<MaskedCPF masked={string | null} />`
  - `<DataFreshness state="current"|"stale"|"unavailable" at={string?} timeZone={string} onReload={(() => void)?} />`
  - `<EmptyState title={string} hint={string?} action={ReactNode?} />`

- [ ] **Passo 1: escrever os testes que falham**

`TenantDateTime.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TenantDateTime } from './TenantDateTime.js';

describe('TenantDateTime', () => {
  it('formata no timezone da UNIDADE, nao no do navegador', () => {
    // 03:30 UTC = 00:30 em Sao_Paulo (dia anterior).
    render(
      <TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Sao_Paulo" format="datetime" />,
    );

    expect(screen.getByText(/16\/08\/2026, 00:30/)).toBeInTheDocument();
  });

  it('o mesmo instante em outro timezone da outro texto', () => {
    render(<TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Manaus" format="datetime" />);

    expect(screen.getByText(/15\/08\/2026, 23:30/)).toBeInTheDocument();
  });

  it('usa <time> com o instante legivel por maquina', () => {
    const { container } = render(
      <TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Sao_Paulo" />,
    );

    expect(container.querySelector('time')).toHaveAttribute('dateTime', '2026-08-16T03:30:00Z');
  });

  it('data ausente nao vira epoch zero', () => {
    render(<TenantDateTime iso={null} timeZone="America/Sao_Paulo" />);

    expect(screen.getByLabelText('não informado')).toHaveTextContent('—');
  });
});
```

`Money.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Money } from './Money.js';

describe('Money', () => {
  it('centavos inteiros viram reais sem float no caminho', () => {
    render(<Money cents={12345} />);

    expect(screen.getByText('R$ 123,45')).toBeInTheDocument();
  });

  it('o caso que quebra float: 0.1 + 0.2', () => {
    render(<Money cents={30} />);

    expect(screen.getByText('R$ 0,30')).toBeInTheDocument();
  });

  it('valor negativo mostra o sinal -- estorno existe', () => {
    render(<Money cents={-5000} />);

    expect(screen.getByText('-R$ 50,00')).toBeInTheDocument();
  });

  it('zero e zero, ausencia e travessao', () => {
    const { rerender } = render(<Money cents={0} />);
    expect(screen.getByText('R$ 0,00')).toBeInTheDocument();

    rerender(<Money cents={null} />);
    expect(screen.getByLabelText('não informado')).toHaveTextContent('—');
  });

  it('recusa valor nao inteiro em vez de arredondar em silencio', () => {
    expect(() => render(<Money cents={123.45} />)).toThrow(/inteiro/i);
  });
});
```

**Por que lançar em vez de arredondar:** `M2-BR-001` diz que dinheiro é inteiro na menor unidade.
Se um `float` chegou até aqui, alguém já errou lá atrás — arredondar esconderia o bug e produziria
diferença de centavo em conciliação. Falhar alto na primeira renderização é mais barato.

`MaskedCPF.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MaskedCPF } from './MaskedCPF.js';

describe('MaskedCPF', () => {
  it('mostra a mascara que a API mandou, sem remontar CPF', () => {
    render(<MaskedCPF masked="•••.412.876-••" />);

    expect(screen.getByText('•••.412.876-••')).toBeInTheDocument();
  });

  it('ausencia e travessao, nunca CPF vazio formatado', () => {
    render(<MaskedCPF masked={null} />);

    expect(screen.getByLabelText('não informado')).toHaveTextContent('—');
    expect(screen.queryByText(/•••\.\d/)).not.toBeInTheDocument();
  });

  it('recusa CPF completo -- o painel nunca recebe documento inteiro', () => {
    expect(() => render(<MaskedCPF masked="123.412.876-09" />)).toThrow(/mascarado/i);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
pnpm --filter @arenahub/ui test
```

- [ ] **Passo 3: implementar `TenantDateTime.tsx`**

```tsx
import { Ausente } from './Ausente.js';

type Format = 'date' | 'datetime' | 'time';

const OPCOES: Record<Format, Intl.DateTimeFormatOptions> = {
  date: { day: '2-digit', month: '2-digit', year: 'numeric' },
  datetime: {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
  time: { hour: '2-digit', minute: '2-digit' },
};

interface Props {
  readonly iso: string | null;
  /**
   * Timezone da UNIDADE, obrigatorio -- nunca o do navegador.
   *
   * A recepcao de Curitiba conferindo acesso da unidade de Manaus precisa ver
   * a hora de Manaus. `toLocaleString()` sem `timeZone` usa o relogio de quem
   * olha, e o horario da janela de acesso passa a depender de onde a pessoa
   * esta -- por isso a regra 5 de lint proibe a chamada crua fora daqui.
   */
  readonly timeZone: string;
  readonly format?: Format;
}

export function TenantDateTime({ iso, timeZone, format = 'datetime' }: Props) {
  if (!iso) return <Ausente />;

  const texto = new Intl.DateTimeFormat('pt-BR', { ...OPCOES[format], timeZone }).format(
    new Date(iso),
  );

  return <time dateTime={iso}>{texto}</time>;
}
```

- [ ] **Passo 4: implementar `Money.tsx`**

```tsx
import { Ausente } from './Ausente.js';

interface Props {
  readonly cents: number | null;
  readonly currency?: string;
}

/**
 * Dinheiro e INTEIRO na menor unidade monetaria -- `M2-BR-001`.
 *
 * A divisao por 100 acontece SO na formatacao, no ultimo instante antes do
 * olho humano. Aritmetica em `number` fora deste componente e erro de lint
 * (regra 6): `0.1 + 0.2 = 0.30000000000000004` em float, e conciliacao com
 * provedor de pagamento nao perdoa centavo.
 */
export function Money({ cents, currency = 'BRL' }: Props) {
  if (cents === null || cents === undefined) return <Ausente />;

  if (!Number.isInteger(cents)) {
    throw new Error(
      `Money recebeu ${cents}, que nao e inteiro. Valor monetario e centavo inteiro (M2-BR-001); ` +
        'arredondar aqui esconderia o bug de origem.',
    );
  }

  const texto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

  return <output data-numeric>{texto}</output>;
}
```

- [ ] **Passo 5: implementar `MaskedCPF.tsx`**

```tsx
import { Ausente } from './Ausente.js';

/** CPF completo tem 11 digitos; mascarado sempre traz `•`. */
const TEM_MASCARA = /•/;

export function MaskedCPF({ masked }: { readonly masked: string | null }) {
  if (!masked) return <Ausente />;

  /**
   * Guarda contra regressao de API, nao contra o proprio componente.
   *
   * O painel NUNCA recebe documento inteiro -- a API devolve `cpfMasked`. Se
   * um dia devolver o CPF cru, este erro aparece no primeiro render em vez de
   * o documento chegar calado na tela e nos logs de erro do navegador.
   */
  if (!TEM_MASCARA.test(masked)) {
    throw new Error('MaskedCPF exige CPF mascarado pela API, nunca o documento completo.');
  }

  return <span data-numeric>{masked}</span>;
}
```

- [ ] **Passo 6: implementar `DataFreshness.tsx` e `EmptyState.tsx`**

```tsx
// DataFreshness.tsx
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import { TenantDateTime } from './TenantDateTime.js';
import estilos from './DataFreshness.module.css';

type Estado = 'current' | 'stale' | 'unavailable';

interface Props {
  readonly state: Estado;
  readonly at?: string | null;
  readonly timeZone: string;
  readonly onReload?: () => void;
}

/**
 * Tres estados, NUNCA colapsados -- DS-PAINEL.md §8.2.
 *
 * "Desatualizado" e "indisponivel" sao coisas diferentes: no primeiro ha dado
 * antigo na tela e a operacao pode decidir se serve; no segundo nao ha dado
 * nenhum. Colapsar os dois em "erro" faz a recepcao tratar cache de 3 minutos
 * como catraca fora do ar.
 */
export function DataFreshness({ state, at, timeZone, onReload }: Props) {
  if (state === 'unavailable') {
    return (
      <p className={estilos.indisponivel} role="status">
        <Icon name="alert-circle" />
        Não foi possível carregar
        {onReload ? (
          <Button variant="ghost" onClick={onReload}>
            Recarregar
          </Button>
        ) : null}
      </p>
    );
  }

  return (
    <p className={estilos.carimbo} data-state={state}>
      <Icon name={state === 'stale' ? 'alert-circle' : 'clock'} />
      Atualizado às <TenantDateTime iso={at ?? null} timeZone={timeZone} format="time" />
    </p>
  );
}
```

```css
/* DataFreshness.module.css */
.carimbo,
.indisponivel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--ah-type-caption-size);
  line-height: var(--ah-type-caption-lh);
}

.carimbo[data-state='current'] { color: var(--ah-text-muted); }
.carimbo[data-state='stale']   { color: var(--ah-warning); }
.indisponivel                  { color: var(--ah-danger); }
```

```tsx
// EmptyState.tsx
import type { ReactNode } from 'react';

import estilos from './EmptyState.module.css';

interface Props {
  readonly title: string;
  readonly hint?: string;
  /** Vazio SEM saida e beco: §9 exige acao de saida. */
  readonly action?: ReactNode;
}

export function EmptyState({ title, hint, action }: Props) {
  return (
    <div className={estilos.vazio}>
      <p className={estilos.titulo}>{title}</p>
      {hint ? <p className={estilos.dica}>{hint}</p> : null}
      {action}
    </div>
  );
}
```

```css
/* EmptyState.module.css */
.vazio {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 32px 16px;
  background: var(--ah-surface-raised);
  border: 1px dashed var(--ah-border-default);
  border-radius: var(--ah-radius-card);
}

.titulo {
  margin: 0;
  font-weight: var(--ah-type-body-strong-weight);
}

.dica {
  margin: 0;
  color: var(--ah-text-muted);
}
```

- [ ] **Passo 7: rodar, exportar e commitar**

```bash
pnpm --filter @arenahub/ui test
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add packages/ui
git commit -m "feat(ui): formatadores que guardam invariante -- dinheiro, timezone, CPF e frescor"
```

---

## Task 7: `DataTable`, `AppShell` e `ElevatedSessionBanner`

Estrutura da página. `DataTable` com paginação por cursor (§5: sem numeração de páginas).

**Extração — 12 tabelas existentes, e elas já estão certas na parte difícil.** O detector
confirmou: **12/12 com `<caption>`, 61/61 `<th scope="col">`**. O componente preserva isso; se
sair uma tabela sem caption ou sem scope, é regressão.

```bash
sed -n '141,178p' "apps/admin-web/app/(protected)/students/page.tsx"
sed -n '146,197p' "apps/admin-web/app/(protected)/access-events/page.tsx"
```

O que a extração **conserta**, porque é divergência entre cópias e não mudança de comportamento:

- **Paginação de mão única.** Hoje só "Próxima página"; o §5 pede *"Anteriores / Próximos mais
  contador de itens carregados"*. As duas telas que paginam ganham os três.
- **Cursor heurístico frágil.** `students/page.tsx:83-94` deduz "há mais" de
  `alunos.length === POR_PAGINA` — com exatamente 20 resultados, oferece uma página vazia. O
  `DataTable` recebe `nextHref` já resolvido, então a heurística fica visível na tela que a
  produz, em vez de escondida no componente.

⚠️ **`caption` estático que descreve ordenação dinâmica.** `students/page.tsx:142` diz *"do
cadastro mais recente para o mais antigo"*, mas após uma busca a ordem vem do backend. A prop
`caption` é obrigatória; a tela é que decide o texto. Não corrija a frase nesta fatia — é
comportamento, e vira observação no PR.

**`AppShell` não tem predecessor.** `(protected)/layout.tsx:26-47` são 7 links num `<nav>`, sem
seletor de unidade, sem `aria-current`, sem skip link. O componente traz **estrutura** (topbar,
sidebar, área de conteúdo) e os dois itens de a11y que a crítica marcou (`aria-current="page"`,
skip link) — esses são acessibilidade, que a spec §1 põe explicitamente no escopo (§10).

**O seletor de unidade em si é [P1] e fica FORA.** `AppShell` recebe `unitSelector` como
`ReactNode` e a Task 10 passa o indicador da unidade ativa que a tela já conhece. Construir a
troca de unidade exige decisão de produto (persistência, escopo da sessão) — é fatia nova.

**Arquivos:**
- Criar: `DataTable.tsx`, `.module.css`, `.spec.tsx`
- Criar: `shell/AppShell.tsx`, `.module.css`
- Criar: `shell/PageHeader.tsx`
- Criar: `ElevatedSessionBanner.tsx`, `.module.css`, `.spec.tsx`

**Interfaces:**
- Consome: `Button` (Task 4), `EmptyState` (Task 6).
- Produz:
  - `interface Column<T> { key: string; header: string; render: (row: T) => ReactNode; numeric?: boolean }`
  - `<DataTable rows={T[]} columns={Column<T>[]} caption={string} rowKey={(row: T) => string} prevHref={string?} nextHref={string?} empty={ReactNode} />`
  - `<AppShell unitSelector={ReactNode} user={ReactNode} nav={ReactNode}>{children}</AppShell>`
  - `<PageHeader title={string} breadcrumb={ReactNode?} actions={ReactNode?} />`
  - `<ElevatedSessionBanner tenant={string} reason={string} expiresAt={string} timeZone={string} />`

- [ ] **Passo 1: escrever o teste do `DataTable` que falha**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataTable } from './DataTable.js';

interface Linha {
  readonly id: string;
  readonly nome: string;
}

const COLUNAS = [
  { key: 'nome', header: 'Nome', render: (l: Linha) => l.nome },
];

describe('DataTable', () => {
  it('tem caption -- tabela sem legenda e opaca no leitor de tela', () => {
    render(
      <DataTable
        rows={[{ id: '1', nome: 'Maria' }]}
        columns={COLUNAS}
        caption="Alunos, do cadastro mais recente para o mais antigo"
        rowKey={(l) => l.id}
        empty={<p>vazio</p>}
      />,
    );

    expect(screen.getByRole('table')).toHaveAccessibleName(/Alunos/);
  });

  it('cabecalho usa scope=col', () => {
    render(
      <DataTable rows={[{ id: '1', nome: 'Maria' }]} columns={COLUNAS} caption="c" rowKey={(l) => l.id} empty={<p>vazio</p>} />,
    );

    expect(screen.getByRole('columnheader', { name: 'Nome' })).toHaveAttribute('scope', 'col');
  });

  it('lista vazia mostra a saida, nao uma tabela de zero linhas', () => {
    render(
      <DataTable rows={[]} columns={COLUNAS} caption="c" rowKey={(l: Linha) => l.id} empty={<p>Nenhum aluno</p>} />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhum aluno')).toBeInTheDocument();
  });

  it('paginacao por CURSOR: anterior/proximo, nunca numero de pagina', () => {
    render(
      <DataTable
        rows={[{ id: '1', nome: 'Maria' }]}
        columns={COLUNAS}
        caption="c"
        rowKey={(l) => l.id}
        empty={<p>vazio</p>}
        nextHref="/students?cursor=abc"
      />,
    );

    expect(screen.getByRole('link', { name: 'Próximos' })).toHaveAttribute(
      'href',
      '/students?cursor=abc',
    );
    expect(screen.queryByRole('link', { name: '2' })).not.toBeInTheDocument();
  });

  it('sem proxima pagina, nao inventa link morto', () => {
    render(
      <DataTable rows={[{ id: '1', nome: 'Maria' }]} columns={COLUNAS} caption="c" rowKey={(l) => l.id} empty={<p>v</p>} />,
    );

    expect(screen.queryByRole('link', { name: 'Próximos' })).not.toBeInTheDocument();
  });
});
```

**Por que cursor e não página numerada:** a API devolve array puro com cursor pelo último id — a
tela de alunos na `main` já faz assim. Página numerada exigiria `COUNT(*)` a cada consulta, e o
total muda entre cliques enquanto a recepção cadastra. "Anteriores / Próximos" nunca mente.

- [ ] **Passo 2: rodar e ver falhar**

```bash
pnpm --filter @arenahub/ui test DataTable
```

- [ ] **Passo 3: implementar `DataTable.tsx`**

```tsx
import type { ReactNode } from 'react';

import estilos from './DataTable.module.css';

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  /** Liga numeral tabular -- coluna de valor, horario ou contador. */
  readonly numeric?: boolean;
}

interface Props<T> {
  readonly rows: readonly T[];
  readonly columns: readonly Column<T>[];
  readonly caption: string;
  readonly rowKey: (row: T) => string;
  readonly empty: ReactNode;
  readonly prevHref?: string;
  readonly nextHref?: string;
}

/**
 * Paginacao por CURSOR -- DS-PAINEL.md §5. Sem numeracao de paginas.
 *
 * Numero de pagina exigiria `COUNT(*)` a cada consulta e mentiria: o total
 * muda entre um clique e outro enquanto a recepcao cadastra.
 */
export function DataTable<T>({
  rows,
  columns,
  caption,
  rowKey,
  empty,
  prevHref,
  nextHref,
}: Props<T>) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <>
      <table className={estilos.tabela}>
        <caption className={estilos.legenda}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((coluna) => (
              <th key={coluna.key} scope="col">
                {coluna.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((linha) => (
            <tr key={rowKey(linha)}>
              {columns.map((coluna) => (
                <td key={coluna.key} {...(coluna.numeric ? { 'data-numeric': '' } : {})}>
                  {coluna.render(linha)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {prevHref || nextHref ? (
        <nav className={estilos.paginacao} aria-label="Paginação">
          {prevHref ? <a href={prevHref}>Anteriores</a> : null}
          <span className={estilos.contador}>{rows.length} itens carregados</span>
          {nextHref ? <a href={nextHref}>Próximos</a> : null}
        </nav>
      ) : null}
    </>
  );
}
```

- [ ] **Passo 4: implementar `DataTable.module.css`**

```css
.tabela {
  width: 100%;
  border-collapse: collapse;
  background: var(--ah-surface-raised);
  border: 1px solid var(--ah-border-default);
  border-radius: var(--ah-radius-card);
}

.legenda {
  padding: 12px 16px;
  color: var(--ah-text-muted);
  font-size: var(--ah-type-caption-size);
  text-align: left;
}

.tabela th,
.tabela td {
  height: 40px;
  padding: 0 16px;
  border-bottom: 1px solid var(--ah-border-subtle);
  text-align: left;
}

.tabela th {
  color: var(--ah-text-label);
  font-size: var(--ah-type-caption-size);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
}

.tabela tbody tr:last-child td {
  border-bottom: none;
}

.paginacao {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
}

.contador {
  color: var(--ah-text-muted);
  font-size: var(--ah-type-caption-size);
}
```

- [ ] **Passo 5: implementar `AppShell.tsx` e `PageHeader.tsx`**

```tsx
// shell/AppShell.tsx
import type { ReactNode } from 'react';

import estilos from './AppShell.module.css';

interface Props {
  /**
   * Seletor de unidade no TOPBAR, nao na sidebar -- DS-PAINEL.md §5.
   *
   * Toda data, horario e politica dependem da unidade. Trocar de unidade sem
   * perceber e o erro operacional mais caro do painel, e o topbar e o unico
   * lugar que a pessoa ve em qualquer tela.
   */
  readonly unitSelector: ReactNode;
  readonly user: ReactNode;
  readonly nav: ReactNode;
  readonly banner?: ReactNode;
  readonly children: ReactNode;
}

export function AppShell({ unitSelector, user, nav, banner, children }: Props) {
  return (
    <div className={estilos.shell}>
      {banner}
      <header className={estilos.topbar}>
        <span className={estilos.logo}>ArenaHub</span>
        {unitSelector}
        <div className={estilos.direita}>{user}</div>
      </header>
      <div className={estilos.corpo}>
        <nav className={estilos.sidebar} aria-label="Navegação principal">
          {nav}
        </nav>
        <main className={estilos.conteudo}>{children}</main>
      </div>
    </div>
  );
}
```

```css
/* shell/AppShell.module.css */
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Chrome escuro -- topbar e sidebar em `--ah-surface-chrome` (§1). */
.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 52px;
  padding: 0 24px;
  background: var(--ah-surface-chrome);
  color: var(--ah-text-on-chrome);
}

.logo {
  font-size: var(--ah-type-heading-size);
  font-weight: var(--ah-type-heading-weight);
}

.direita {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.corpo {
  flex: 1;
  display: grid;
  grid-template-columns: 224px 1fr;
}

.sidebar {
  background: var(--ah-surface-chrome);
  color: var(--ah-text-on-chrome);
  padding: 16px 12px;
}

.conteudo {
  padding: 24px;
  background: var(--ah-surface-canvas);
}

/**
 * 1024 px = modo DEGRADADO, confirmado pelo PI. A sidebar vira faixa
 * horizontal; a operacao continua possivel, so mais apertada. Abaixo disso
 * nao ha promessa -- o painel e ferramenta de balcao, nao app de bolso.
 */
@media (max-width: 1279px) {
  .corpo {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: flex;
    gap: 8px;
    overflow-x: auto;
  }
}
```

```tsx
// shell/PageHeader.tsx
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  breadcrumb,
  actions,
}: {
  readonly title: string;
  readonly breadcrumb?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header>
      {breadcrumb}
      <h1>{title}</h1>
      {actions}
    </header>
  );
}
```

- [ ] **Passo 6: implementar `ElevatedSessionBanner`**

```tsx
import { TenantDateTime } from './TenantDateTime.js';
import estilos from './ElevatedSessionBanner.module.css';

interface Props {
  readonly tenant: string;
  readonly reason: string;
  readonly expiresAt: string;
  readonly timeZone: string;
}

/**
 * Faixa PERSISTENTE de 4 px -- DS-PAINEL.md §5.
 *
 * Nao e dispensavel de proposito: o operador precisa ver que esta com sessao
 * elevada o tempo TODO. Banner que se fecha some da memoria em trinta
 * segundos, e ai alguem opera como Super Admin achando que e usuario comum.
 */
export function ElevatedSessionBanner({ tenant, reason, expiresAt, timeZone }: Props) {
  return (
    <div className={estilos.faixa} role="status">
      <strong>Sessão elevada</strong> · {tenant} · {reason} · expira às{' '}
      <TenantDateTime iso={expiresAt} timeZone={timeZone} format="time" />
    </div>
  );
}
```

```css
/* ElevatedSessionBanner.module.css */
.faixa {
  border-top: 4px solid var(--ah-risk);
  padding: 6px 24px;
  background: color-mix(in srgb, var(--ah-risk) 10%, var(--ah-surface-raised));
  color: var(--ah-risk);
  font-size: var(--ah-type-caption-size);
}
```

- [ ] **Passo 7: acrescentar `--ah-text-on-chrome` aos tokens**

Em `tokens/semantic.json`:

```json
"text": {
  "on-chrome": { "ref": "carbon.300" }
}
```

`carbon-300` sobre `carbon-900` dá 8.2:1 — passa folgado. É o par invertido: o `2.24` da tabela é
contra branco, não contra o chrome.

- [ ] **Passo 8: rodar, exportar e commitar**

```bash
pnpm --filter @arenahub/ui build:tokens && pnpm --filter @arenahub/ui test
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add packages/ui
git commit -m "feat(ui): DataTable por cursor, shell do painel e banner de sessao elevada"
```

---

## Task 8: `SensitiveAction` e `ConsentCard`

**Arquivos:**
- Criar: `SensitiveAction.tsx`, `.module.css`, `.spec.tsx`
- Criar: `ConsentCard.tsx`, `.module.css`, `.spec.tsx`

**Interfaces:**
- Consome: `Button` (Task 4), `TenantDateTime` (Task 6).
- Produz:
  - `<SensitiveAction verb={string} summary={string} onConfirm={(reason: string) => void} onCancel={() => void} />`
  - `<ConsentCard version={string} grantedAt={string} ip={string} device={string} timeZone={string} />`

- [ ] **Passo 1: escrever o teste que falha**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SensitiveAction } from './SensitiveAction.js';

describe('SensitiveAction', () => {
  it('nao confirma sem motivo -- motivo e OBRIGATORIO', async () => {
    const confirmar = vi.fn();
    render(
      <SensitiveAction
        verb="Revogar biometria"
        summary="A digital facial de Maria será excluída."
        onConfirm={confirmar}
        onCancel={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Revogar biometria' }));

    expect(confirmar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/motivo/i);
  });

  it('confirma com o motivo digitado', async () => {
    const confirmar = vi.fn();
    render(
      <SensitiveAction
        verb="Revogar biometria"
        summary="A digital facial de Maria será excluída."
        onConfirm={confirmar}
        onCancel={() => {}}
      />,
    );

    await userEvent.type(screen.getByLabelText(/motivo/i), 'Pedido da titular por telefone');
    await userEvent.click(screen.getByRole('button', { name: 'Revogar biometria' }));

    expect(confirmar).toHaveBeenCalledWith('Pedido da titular por telefone');
  });

  it('o botao usa o VERBO REAL, nunca "OK" nem "Confirmar"', () => {
    render(
      <SensitiveAction verb="Estornar pagamento" summary="x" onConfirm={() => {}} onCancel={() => {}} />,
    );

    expect(screen.getByRole('button', { name: 'Estornar pagamento' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
  });

  it('mostra o resumo do efeito antes de agir', () => {
    render(
      <SensitiveAction
        verb="Revogar biometria"
        summary="A digital facial de Maria será excluída."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText('A digital facial de Maria será excluída.')).toBeInTheDocument();
  });

  it('formulario nao limpa o motivo em erro recuperavel -- §10 item 3', async () => {
    render(
      <SensitiveAction verb="Revogar" summary="x" onConfirm={() => {}} onCancel={() => {}} />,
    );

    const campo = screen.getByLabelText(/motivo/i);
    await userEvent.type(campo, 'Motivo escrito');
    await userEvent.click(screen.getByRole('button', { name: 'Revogar' }));

    expect(campo).toHaveValue('Motivo escrito');
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
pnpm --filter @arenahub/ui test SensitiveAction
```

- [ ] **Passo 3: implementar `SensitiveAction.tsx`**

```tsx
'use client';

import { useId, useState } from 'react';

import { Button } from './Button.js';
import estilos from './SensitiveAction.module.css';

interface Props {
  /** VERBO REAL: "Revogar biometria", nunca "OK" (DS-PAINEL.md §6). */
  readonly verb: string;
  readonly summary: string;
  readonly onConfirm: (reason: string) => void;
  readonly onCancel: () => void;
}

/**
 * Padrao compartilhado por override manual, revogacao biometrica, estorno,
 * pagamento manual acima do limite e kill switch -- DS-PAINEL.md §8.3.
 *
 * Motivo OBRIGATORIO nao e burocracia: e o que transforma a acao em registro
 * auditavel. Sem ele, a auditoria mostra "fulano revogou" e nunca "por que".
 */
export function SensitiveAction({ verb, summary, onConfirm, onCancel }: Props) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState(false);
  const idMotivo = useId();

  const confirmar = () => {
    if (motivo.trim() === '') {
      setErro(true);

      return;
    }

    onConfirm(motivo.trim());
  };

  return (
    <div className={estilos.caixa} role="dialog" aria-label={verb}>
      <p className={estilos.resumo}>{summary}</p>

      <label htmlFor={idMotivo}>Motivo (obrigatório)</label>
      {/*
        `value` controlado, e o motivo NUNCA e limpo no erro -- §10 item 3.
        Perder o texto digitado por ter esquecido outro campo e a forma mais
        rapida de fazer alguem desistir de escrever motivo de verdade.
      */}
      <textarea
        id={idMotivo}
        value={motivo}
        rows={3}
        onChange={(evento) => {
          setMotivo(evento.target.value);
          setErro(false);
        }}
      />

      {erro ? (
        <p role="alert" className={estilos.erro}>
          Escreva o motivo antes de continuar.
        </p>
      ) : null}

      <div className={estilos.acoes}>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="destructive" onClick={confirmar}>
          {verb}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Passo 4: implementar `ConsentCard.tsx`**

```tsx
import { TenantDateTime } from './TenantDateTime.js';
import estilos from './ConsentCard.module.css';

interface Props {
  readonly version: string;
  readonly grantedAt: string;
  readonly ip: string;
  readonly device: string;
  readonly timeZone: string;
}

/**
 * Versao, data, IP e dispositivo -- DS-PAINEL.md §9.
 *
 * Consentimento biometrico e VERSIONADO (regra de arquitetura 7): provar o
 * consentimento exige saber QUAL texto a pessoa aceitou, nao so que aceitou.
 */
export function ConsentCard({ version, grantedAt, ip, device, timeZone }: Props) {
  return (
    <dl className={estilos.cartao}>
      <dt>Versão do termo</dt>
      <dd data-numeric>{version}</dd>

      <dt>Aceito em</dt>
      <dd>
        <TenantDateTime iso={grantedAt} timeZone={timeZone} format="datetime" />
      </dd>

      <dt>Endereço IP</dt>
      <dd data-numeric>{ip}</dd>

      <dt>Dispositivo</dt>
      <dd>{device}</dd>
    </dl>
  );
}
```

```css
/* ConsentCard.module.css */
.cartao {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
  padding: 16px;
  background: var(--ah-surface-raised);
  border: 1px solid var(--ah-border-default);
  border-radius: var(--ah-radius-card);
}

.cartao dt {
  color: var(--ah-text-label);
  font-size: var(--ah-type-caption-size);
}

.cartao dd {
  margin: 0;
}
```

```css
/* SensitiveAction.module.css */
.caixa {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: var(--ah-surface-raised);
  border: 1px solid var(--ah-border-default);
  border-radius: var(--ah-radius-modal);
  box-shadow: var(--ah-elev-3);
}

.resumo {
  margin: 0;
  font-weight: var(--ah-type-body-strong-weight);
}

.caixa textarea {
  padding: 8px;
  border: 1px solid var(--ah-border-default);
  border-radius: var(--ah-radius-control);
  font-family: inherit;
  font-size: var(--ah-type-body-size);
  resize: vertical;
}

.erro {
  margin: 0;
  color: var(--ah-danger);
}

.acoes {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
```

- [ ] **Passo 5: rodar, exportar e commitar**

```bash
pnpm --filter @arenahub/ui test
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add packages/ui
git commit -m "feat(ui): SensitiveAction com motivo obrigatorio e ConsentCard versionado"
```

---

## Task 9: contrato dos componentes de MVP futuro

SPEC-042 §3: `ChartWithTable`, `AIDisclaimer`, `RiskBand`, `FieldReview` e `AsyncJobStatus` entram
como **contrato e token, sem tela consumidora**. Construir a tela é da fatia do MVP correspondente.

**Arquivos:**
- Criar: `packages/ui/src/contracts/future-components.ts`
- Criar: `packages/ui/src/contracts/future-components.spec.ts`

**Interfaces:**
- Consome: `Tone` (Task 2).
- Produz: as interfaces de props, sem componente.

- [ ] **Passo 1: escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest';

import { AI_DISCLAIMER_CODE, RISK_BANDS } from './future-components.js';

describe('contrato de componente futuro', () => {
  it('o disclaimer de IA e o codigo exigido pela regra de arquitetura 8', () => {
    expect(AI_DISCLAIMER_CODE).toBe('NOT_MEDICAL_DIAGNOSIS');
  });

  it('faixa de risco tem intervalo publicado, nao percentual de falsa precisao', () => {
    for (const faixa of RISK_BANDS) {
      expect(faixa.range).toMatch(/^\d+–\d+$/);
    }
  });

  it('as faixas cobrem 0 a 100 sem buraco nem sobreposicao', () => {
    const limites = RISK_BANDS.map((f) => f.range.split('–').map(Number));

    expect(limites[0]?.[0]).toBe(0);
    expect(limites.at(-1)?.[1]).toBe(100);

    for (let i = 1; i < limites.length; i += 1) {
      expect(limites[i]?.[0]).toBe((limites[i - 1]?.[1] ?? 0) + 1);
    }
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
pnpm --filter @arenahub/ui test future-components
```

- [ ] **Passo 3: implementar**

```ts
import type { Tone } from '../domain/state-labels.js';

/**
 * Contrato dos componentes cuja TELA pertence a um MVP futuro -- SPEC-042 §3.
 *
 * Props e token entram agora; a implementacao entra com a fatia que tem tela
 * para consumi-la. Escrever o componente sem consumidor produziria codigo
 * morto que envelhece antes do primeiro uso -- e o contrato e o que impede a
 * fatia futura de reinventar o formato.
 */

/** MVP 3 -- regra de arquitetura 8: IA nunca publica dado de saude sozinha. */
export const AI_DISCLAIMER_CODE = 'NOT_MEDICAL_DIAGNOSIS' as const;

export interface AIDisclaimerProps {
  readonly disclaimerCode: typeof AI_DISCLAIMER_CODE;
  readonly modelVersion: string;
  readonly promptVersion: string;
  /** Persistente, NAO dispensavel -- DS-PAINEL.md §8.4. */
  readonly dismissible: false;
}

/** MVP 3 -- nada grava antes da confirmacao campo a campo. */
export interface FieldReviewProps {
  readonly field: string;
  readonly extracted: string;
  readonly referenceRange: string | null;
  readonly source: string;
  readonly confidence: number;
  readonly onConfirm: (value: string) => void;
}

/** MVP 6 -- faixa com intervalo publicado, nunca percentual de falsa precisao. */
export const RISK_BANDS = [
  { band: 'LOW', range: '0–24', tone: 'success' },
  { band: 'MEDIUM', range: '25–49', tone: 'warning' },
  { band: 'HIGH', range: '50–74', tone: 'risk' },
  { band: 'CRITICAL', range: '75–100', tone: 'danger' },
] as const satisfies readonly { band: string; range: string; tone: Tone }[];

export interface RiskBandProps {
  readonly band: (typeof RISK_BANDS)[number]['band'];
  readonly ruleVersion: string;
}

/** MVP 3 -- todo grafico tem tabela equivalente REAL no DOM (§10 item 2). */
export interface ChartWithTableProps<T> {
  readonly rows: readonly T[];
  readonly caption: string;
  readonly tableOnly?: boolean;
}

/** MVP 2 -- progresso de tarefa longa. */
export interface AsyncJobStatusProps {
  readonly state: 'PENDING' | 'PROCESSING' | 'SYNCED' | 'FAILED';
  readonly progress: number | null;
}
```

- [ ] **Passo 4: rodar, exportar e commitar**

```bash
pnpm --filter @arenahub/ui test future-components
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add packages/ui
git commit -m "feat(ui): contrato dos componentes de MVP futuro, sem tela consumidora"
```

---

## Task 10: migrar as telas e **apagar as duplicatas**

A dívida que a fatia fecha: F6, F7 e F11 estão na `main` sem CSS. Aqui elas passam a consumir o
design system — e, porque esta fatia é extração, aqui as fontes duplicadas **morrem**.

**Não alterar comportamento nem `data-testid`.** Os **39 testes E2E** e **45 unitários** existentes
são a rede de segurança desta tarefa: eles já afirmam coisas de UI (jornada só por teclado, erro
anunciável, tabela com cabeçalho, 390 px sem transbordo, "todo estado tem TEXTO, não só cor",
vazio explicativo, input preservado após erro). Se um deles cair, a migração mudou comportamento —
e a migração não pode mudar comportamento.

### O que apagar, e só depois de o substituto estar verde

| apagar | substituto |
|---|---|
| dicionário inline em `devices/page.tsx:32-44` | `stateLabel('syncJob', …)` / `stateLabel('device', …)` |
| dicionários inline em `biometrics/page.tsx:39-55` | `stateLabel('biometric', …)` |
| `formatarInstante` em `devices/page.tsx:46-50` | `<TenantDateTime>` |
| `formatarInstante` em `biometrics/page.tsx:57-61` | `<TenantDateTime>` |
| rótulos soltos em JSX (`access-events:176`, `plans:102`, `units:64`, `operations:247`) | `<StateBadge>` |

⚠️ **`src/operations/formatar.ts` e `src/students/formatar.ts` NÃO são apagados por inteiro.** Eles
têm 45 testes e contêm lógica que não é rótulo: `impedeAcesso`, `situacoesPossiveis`,
`TRANSICOES_DE_SITUACAO`, `janelaLegivel`, `horaDoMinuto`, `idadeLegivel`. Só os **dicionários de
rótulo** migram; o resto fica onde está. Apagar um `Record` cujo teste ainda existe quebra a
suíte — e nesse caso apague o teste do dicionário junto, nunca a função vizinha.

**`units/page.tsx` está sem acentuação** ("Sem permissao", "Codigo", "Fuso horario") enquanto todas
as outras telas acentuam. Corrigir é uma linha e é texto de tela, não comportamento — faça junto,
e cite no PR.

**Arquivos:**
- Modificar: `apps/admin-web/app/layout.tsx` (injeção do tema, §12)
- Modificar: `apps/admin-web/app/(protected)/layout.tsx` (AppShell + ToastProvider)
- Modificar: `apps/admin-web/app/(protected)/students/page.tsx` (DataTable + StateBadge)
- Modificar: `apps/admin-web/app/globals.css` (camada de componente)
- Modificar: `apps/admin-web/vitest.config.ts` (`environment: 'jsdom'`)

**Interfaces:**
- Consome: tudo de `@arenahub/ui`.
- Produz: telas estilizadas. Nenhuma API nova.

- [ ] **Passo 1: ligar `jsdom` no `admin-web`**

```ts
// apps/admin-web/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

```bash
pnpm --filter @arenahub/admin-web add -D jsdom@27.0.0
```

- [ ] **Passo 2: injetar o tema no `layout.tsx`**

```tsx
import type { Metadata } from 'next';

import { accentCssVars, ACCENT_SEED_DEFAULT, resolveAccent } from '@arenahub/ui';

import './globals.css';

export const metadata: Metadata = {
  title: 'ArenaHub',
};

/**
 * Injecao do tema no SERVER COMPONENT -- DS-PAINEL.md §12.
 *
 * Sem provider de cliente, sem `use client`, sem flash de cor errada: as
 * variaveis saem no HTML da primeira resposta. `data-surface` seleciona a
 * camada de expressao; `data-mode`, a semantica.
 *
 * O seed vem do padrao comercial (Ciano Arena). A rampa POR TENANT em runtime
 * e escopo negativo desta fatia -- `getTenantTheme()` entra quando houver
 * mais de um tenant com marca propria.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const accent = resolveAccent(ACCENT_SEED_DEFAULT);

  return (
    <html lang="pt-BR" data-surface="panel" data-mode="light">
      <body style={accentCssVars(accent)}>{children}</body>
    </html>
  );
}
```

- [ ] **Passo 3: rodar o dev e conferir na tela**

```bash
pnpm --filter @arenahub/admin-web dev
```

Abrir `http://localhost:3000/login` e confirmar no DevTools que `--ah-action-solid` resolve para
`#00707b` no `<body>`.

- [ ] **Passo 4: montar o shell em `(protected)/layout.tsx`**

Ler o arquivo atual antes de editar — ele já tem a guarda de sessão, que **não muda**. Envolver o
`children` com `AppShell` e `ToastProvider`, mantendo a lógica de redirecionamento intacta.

- [ ] **Passo 5: converter a tela de alunos**

Trocar a `<table>` manual por `DataTable`, e a coluna Situação por `StateBadge`:

```tsx
<DataTable
  rows={alunos}
  rowKey={(aluno) => aluno.id}
  caption="Alunos, do cadastro mais recente para o mais antigo"
  columns={[
    { key: 'matricula', header: 'Matrícula', numeric: true, render: (a) => a.membershipNumber },
    { key: 'nome', header: 'Nome', render: (a) => <a href={`/students/${a.id}`}>{a.fullName}</a> },
    {
      key: 'nascimento',
      header: 'Nascimento',
      render: (a) => <TenantDateTime iso={a.birthDate} timeZone={TZ} format="date" />,
    },
    { key: 'cpf', header: 'CPF', render: (a) => <MaskedCPF masked={a.cpfMasked} /> },
    { key: 'situacao', header: 'Situação', render: (a) => <StateBadge machine="student" state={a.status} /> },
  ]}
  nextHref={proxima || undefined}
  empty={
    <EmptyState
      title={termo ? 'Nenhum aluno encontrado com esse termo.' : 'Nenhum aluno cadastrado ainda.'}
      hint={termo ? 'Confira a grafia ou cadastre um novo aluno.' : 'Comece cadastrando o primeiro.'}
      action={<a href="/students/novo">Cadastrar aluno</a>}
    />
  }
/>
```

⚠️ **Preservar `data-testid`.** Os E2E procuram `tabela-de-alunos`, `aluno-${id}`, `sem-alunos` e
`proxima-pagina`. Repassar via props ou manter o wrapper — mudar quebra teste que não é sobre
aparência.

- [ ] **Passo 6: rodar os E2E e confirmar que continuam verdes**

```bash
pnpm --filter @arenahub/admin-web test:e2e
```

Esperado: PASS, 39 testes. Qualquer falha aqui é regressão de comportamento, não de estilo —
corrigir antes de seguir.

- [ ] **Passo 7: comparar com o protótipo, lado a lado**

O alvo é ficar **igual ao `.dc.html`**. Sirva o protótipo e o painel ao mesmo tempo:

```bash
# terminal 1 -- protótipo
cd docs/design && python -m http.server 8765

# terminal 2 -- painel
pnpm --filter @arenahub/admin-web dev
```

Abra `http://localhost:8765/DS%20Painel.dc.html` e o painel em 1280 px. Confira **componente a
componente**, não a página inteira — o `.dc.html` é o catálogo do design system, não uma tela:

| no catálogo | confira no painel |
|---|---|
| Botões · altura 36 px · raio 6 px | as 4 variantes: sólido, secundário, ghost, destrutivo, desabilitado |
| Campos · foco 2 px + offset 2 px | borda, altura, anel de foco, estado de erro com o valor preservado |
| `StateBadge` por máquina | ícone + rótulo, fundo a 10%, borda a 32% |
| Carbono | canvas `carbon-50`, card branco com **borda**, chrome `carbon-900` |

⚠️ **Igual na aparência, não no código.** O `.dc.html` usa hex literal em `style=` inline — é
protótipo, não fonte (ADR-026 decisão 2). Copiar o valor viola a regra 1 de lint. Se uma cor não
bate, o conserto é no **token**, nunca no componente.

- [ ] **Passo 8: commitar**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add apps/admin-web packages/ui
git commit -m "feat(admin-web): telas de F6, F7 e F11 passam a consumir o design system"
```

---

## Task 11: acessibilidade verificada com axe-core

§10 exige verificação, não intenção: "axe-core no Playwright cobrindo os fluxos essenciais".

**Arquivos:**
- Criar: `apps/admin-web/tests/e2e/acessibilidade.e2e-spec.ts`
- Modificar: `apps/admin-web/package.json` (dependência `@axe-core/playwright`)

**Interfaces:**
- Consome: as telas da Task 10.
- Produz: nada além do teste.

- [ ] **Passo 1: instalar**

```bash
pnpm --filter @arenahub/admin-web add -D @axe-core/playwright@4.10.2
```

- [ ] **Passo 2: escrever o teste**

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * WCAG 2.2 AA nos fluxos essenciais -- DS-PAINEL.md §10.
 *
 * `axe-core` nao prova acessibilidade: prova AUSENCIA de uma lista conhecida
 * de defeitos. Contraste calculado, foco visivel e ordem de tabulacao ele
 * pega; "o rotulo diz a coisa certa" nenhuma ferramenta pega.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

async function entrar(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const TELAS = ['/students', '/plans', '/units', '/operations', '/access-events'];

test.describe('acessibilidade WCAG 2.2 AA', () => {
  test('a tela de login nao tem violacao', async ({ page }) => {
    await page.goto('/login');

    const resultado = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(resultado.violations).toEqual([]);
  });

  for (const tela of TELAS) {
    test(`${tela} nao tem violacao`, async ({ page }) => {
      await entrar(page);
      await page.goto(tela);

      const resultado = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      expect(resultado.violations).toEqual([]);
    });
  }

  test('zoom de 200% nao corta conteudo -- §10 item 8', async ({ page }) => {
    await entrar(page);
    await page.goto('/students');
    // 1280 de largura logica a 200% = 640 CSS px.
    await page.setViewportSize({ width: 640, height: 720 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(overflow).toBe(false);
  });
});
```

- [ ] **Passo 3: rodar**

```bash
pnpm --filter @arenahub/admin-web test:e2e acessibilidade
```

Esperado: PASS. Violação aqui é bug real do CSS que acabou de entrar — corrigir o componente, nunca
afrouxar a regra do axe.

- [ ] **Passo 4: commitar**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add apps/admin-web
git commit -m "test(admin-web): axe-core nos fluxos essenciais e zoom de 200%"
```

---

## Task 12: documentação e entrega

**Arquivos:**
- Modificar: `packages/ui/README.md`
- Modificar: `docs/DEVELOPMENT.md` (§5 registro de entregas)
- Modificar: `reports/TESTS.md` (evidência por SPEC — guarda do CI)

- [ ] **Passo 1: atualizar `packages/ui/README.md`**

Acrescentar a seção de componentes: o que existe, o que é contrato sem tela, e a regra de que
rótulo pt-BR mora só em `state-labels.ts`.

- [ ] **Passo 2: atualizar `reports/TESTS.md`**

A guarda de evidência do CI compara o relatado com o executado. Registrar SPEC-042 com a contagem
real de testes — rodar antes de escrever o número.

- [ ] **Passo 3: atualizar `docs/DEVELOPMENT.md` §5**

```
| 16/08/2026 | **F42** | SPEC-042 | [#NN](...) | design system do painel: state-labels com as 8 razões do ADR-024, 13 componentes, contrato dos 5 de MVP futuro, telas de F6/F7/F11 estilizadas, axe-core nos fluxos essenciais |
```

- [ ] **Passo 4: gate completo**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build
```

- [ ] **Passo 5: abrir o PR**

Corpo com **`refs #81`** — nunca `closes`. Merge é do Code com CI verde; o aceite é do PI.

- [ ] **Passo 6: depois do merge**

Aplicar `proplan:done` na #81 e pôr o link do PR no corpo da issue. **Não fechar** — só o PI fecha
e aplica `proplan:finalizado`.

---

## Achado da Task 2: oito dicionários pt-BR sem casa no §7

Descoberto na conferência cruzada de 16/08/2026. O §7 do contrato define **11 máquinas de
estado**, e é isso que o `state-labels.ts` consolida. Mas a produção tem **mais oito dicionários
pt-BR** que não são máquina de estado e, portanto, **continuam duplicados depois desta fatia**:

| dicionário | onde | é máquina de estado? |
|---|---|---|
| `ROTULO_DE_SEVERIDADE` | `src/operations/formatar.ts` | não — severidade de alerta |
| `ROTULO_DE_ESTADO_DE_ALERTA` | `src/operations/formatar.ts` | **sim, de fato** — só não está no §7 |
| `ROTULO_DE_MODO` | `src/operations/formatar.ts` | não — modo da decisão |
| `ROTULO_DE_METODO` | `src/operations/formatar.ts` | não — método de autenticação |
| `ROTULO_DE_ORIGEM` | `src/students/formatar.ts` | não — origem do entitlement (ADR-009) |
| `ROTULO_DE_EVENTO` | `src/students/formatar.ts` | não — tipo de evento de timeline |
| `MOTIVO_EM_PORTUGUES` | `biometrics/page.tsx` | não — frase explicativa de bloqueio |
| `ROTULO_DE_OPERACAO` | `devices/page.tsx` | não — `UPSERT`/`DELETE` |

A Task 10 remove as duplicatas do que migrou; **estas não têm para onde migrar**. Se a intenção
do §7 é *"um único lugar com rótulo pt-BR"*, falta decidir o destino — e a decisão não é uniforme:
`ROTULO_DE_ESTADO_DE_ALERTA` é máquina de estado e provavelmente pertence ao §7; `ROTULO_DE_METODO`
e `ROTULO_DE_OPERACAO` não são estado e talvez devam ficar onde estão.

**Fora do escopo desta fatia** — é decisão de produto, portanto Cowork + PI. Registrado aqui para
não sumir.

## Pendências que ficam para o Cowork

Nenhuma bloqueia esta fatia, mas todas precisam existir antes do aceite do PI:

1. **SPEC-042 §5** — transcrever as três respostas do PI, hoje registradas no comentário da
   [#81](https://github.com/RodReis/arenahub/issues/81).
2. **`DS-PAINEL.md` §7** — acrescentar a máquina `accessReason` com as 8 linhas. A tabela do §7 tem
   11 máquinas e não inclui as razões; elas só aparecem no §8.5, como lista de códigos.
3. **`DS-PAINEL.md` §13** — fechar as pendências 2 (breakpoints), 3 (dicionário de `DENY`) e 5
   (exceção do *Disabled*).
