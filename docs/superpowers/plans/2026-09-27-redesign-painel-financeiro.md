# Redesign do painel financeiro — gráficos ricos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar o painel financeiro (`apps/admin-web/app/(protected)/billing/page.tsx`) com hierarquia de
hero KPIs + gráficos ricos (rosca de método de pagamento, barras verticais de aging, série de receita evoluída),
mantendo a stack `@arenahub/ui` (Recharts + tokens `--ah-*`) e zero mudança de backend.

**Architecture:** Dois componentes novos no design system (`GraficoDeRosca`, `BarrasVerticais`), evolução
in-place de `SerieFinanceira`, reescrita de `billing/page.tsx` + `summary.module.css` para a nova hierarquia
visual. Cada componente segue o padrão já estabelecido por `BarrasDeFaixa`: Recharts + `getComputedStyle` para
resolver token CSS em cor de runtime + tabela invisível para leitor de tela + `aria-hidden` no wrapper do SVG.

**Tech Stack:** React (Server Component na page), Recharts (já dependência de `@arenahub/ui`), CSS Modules com
tokens `--ah-*`, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-27-redesign-painel-financeiro-design.md`

## Global Constraints

- Sem shadcn/ui, sem Tailwind, sem Material Symbols, sem sombra em card — `DS-PAINEL.md` §2.6: "Card não tem
  sombra. Nunca."
- Cor só via token `--ah-*`, nunca hex literal (regra 1 de lint do repo).
- Todo gráfico publica tabela invisível equivalente no DOM para leitor de tela (regra do PRD), com `aria-hidden`
  no wrapper do SVG.
- Zero mudança de endpoint/backend — `Resumo` (interface em `page.tsx`) já contém todo dado necessário.
- `data-testid` existentes (`recebido-no-periodo`, `alunos-ativos`, `ticket-medio`, `faixas-da-divida`,
  `quebra-por-metodo`, `tendencia-do-recebido`, `grafico-de-competencia`, `serie-por-competencia`,
  `sem-divida`, `sem-pagamento`, etc.) continuam apontando para a mesma informação — mudam de posição/CSS, não
  de identidade. Nenhum teste existente em `page.test.tsx` deve precisar de novo seletor além dos que este plano
  adiciona explicitamente.
- Nomenclatura de componente em português, seguindo o padrão do repo (`BarrasDeFaixa`, `SerieFinanceira`,
  `Sparkline`).
- Nenhum valor de tendência (`↑ X%`) é inventado ou estimado sem dado real de mês anterior na série.

## Review Focus

- **`quebraPorMetodo` com todas as fatias zeradas** (nenhum pagamento no período): `GraficoDeRosca` não pode
  desenhar um círculo de `stroke-dasharray="0 0"` nem dividir por zero ao calcular proporção — a page já trata
  esse caso com `EmptyState` antes de renderizar o componente (como faz hoje com `BarrasDeFaixa`), mas o
  componente em si precisa recusar bem um array com soma zero caso seja chamado diretamente num teste.
- **`faixas` com um único valor não-zero** (aging concentrado numa faixa só): `BarrasVerticais` não pode
  desenhar as outras colunas com altura `NaN` ou negativa ao normalizar contra o maior valor.
- **Hero card de "Recebido" sem ponto anterior na série** (primeira competência do tenant): o badge de
  tendência (`↑ X% vs mês anterior`) precisa ficar ausente, não mostrar `↑ NaN%` ou `↑ Infinity%`.
- **`SerieFinanceira` com um ponto só**: o teste existente já cobre "publica a tabela mesmo com uma competência
  só" — a evolução (destaque do último ponto) não pode quebrar esse caminho já coberto.
- **Tema escuro**: nenhum dos três gráficos pode fixar cor por `getComputedStyle` uma única vez no mount e
  ignorar troca de tema em runtime — o hook `useCoresDosTokens` já resolve isso via `useEffect` com a `chave`
  (string) como dependência; os componentes novos devem reusar exatamente esse padrão, não uma variação que
  perca a reatividade.

---

## Arquivos afetados

```
packages/ui/src/components/
  GraficoDeRosca.tsx          (criar)
  GraficoDeRosca.module.css   (criar)
  GraficoDeRosca.spec.tsx     (criar)
  BarrasVerticais.tsx         (criar)
  BarrasVerticais.module.css  (criar)
  BarrasVerticais.spec.tsx    (criar)
  SerieFinanceira.tsx         (editar)
  SerieFinanceira.spec.tsx    (editar)
packages/ui/src/index.ts      (editar — barrel export)
apps/admin-web/app/(protected)/billing/
  page.tsx                    (editar)
  summary.module.css          (editar)
  page.test.tsx                (editar)
```

---

### Task 1: `GraficoDeRosca` — componente novo

**Files:**
- Create: `packages/ui/src/components/GraficoDeRosca.tsx`
- Create: `packages/ui/src/components/GraficoDeRosca.module.css`
- Test: `packages/ui/src/components/GraficoDeRosca.spec.tsx`

**Interfaces:**
- Consumes: nenhuma dependência de outro componente novo deste plano.
- Produces:
  ```ts
  export interface SegmentoDeRosca {
    readonly rotulo: string;
    readonly valor: number;
    readonly tokenDeCor: string;
    readonly valorLegivel: string;
  }
  interface Props {
    readonly segmentos: readonly SegmentoDeRosca[];
    readonly descricao: string;
    readonly testId?: string;
    readonly rotuloCentral?: string;
    readonly valorCentral?: string;
  }
  export function GraficoDeRosca(props: Props): JSX.Element
  ```

- [ ] **Step 1: Escrever os testes que falham**

```tsx
// packages/ui/src/components/GraficoDeRosca.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GraficoDeRosca } from './GraficoDeRosca.js';

const SEGMENTOS = [
  { rotulo: 'Cartão Recorrente', valor: 1_172_320, tokenDeCor: '--ah-state-info', valorLegivel: 'R$ 11.723,20 · 68%' },
  { rotulo: 'PIX Automático', valor: 379_280, tokenDeCor: '--ah-state-success', valorLegivel: 'R$ 3.792,80 · 22%' },
  { rotulo: 'Espécie', valor: 344_80, tokenDeCor: '--ah-text-secondary', valorLegivel: 'R$ 344,80 · 2%' },
];

describe('GraficoDeRosca', () => {
  it('publica os segmentos numa tabela para leitor de tela', () => {
    render(<GraficoDeRosca segmentos={SEGMENTOS} descricao="Distribuição por forma de pagamento" />);

    expect(
      screen.getByRole('table', { name: 'Distribuição por forma de pagamento' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'PIX Automático' })).toBeInTheDocument();
  });

  it('mostra o valor legível de cada segmento na legenda', () => {
    render(<GraficoDeRosca segmentos={SEGMENTOS} descricao="Distribuição por forma de pagamento" />);

    expect(screen.getByText('R$ 11.723,20 · 68%')).toBeInTheDocument();
  });

  it('mostra rótulo e valor central quando fornecidos', () => {
    render(
      <GraficoDeRosca
        segmentos={SEGMENTOS}
        descricao="Distribuição por forma de pagamento"
        rotuloCentral="Recorrente"
        valorCentral="68%"
      />,
    );

    expect(screen.getByText('Recorrente')).toBeInTheDocument();
    expect(screen.getByText('68%')).toBeInTheDocument();
  });

  /**
   * SEM DADO NAO E GRAFICO VAZIO -- mesma regra de BarrasDeFaixa/SerieFinanceira.
   * Um anel com todos os segmentos zerados desenharia um circulo cinza sem
   * significado, parecendo dado que nao carregou.
   */
  it('mostra frase, nao anel vazio, quando todos os segmentos sao zero', () => {
    render(
      <GraficoDeRosca
        segmentos={SEGMENTOS.map((s) => ({ ...s, valor: 0 }))}
        descricao="Distribuição por forma de pagamento"
        testId="rosca"
      />,
    );

    expect(screen.getByTestId('rosca')).toHaveTextContent(/nenhum/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('esconde o grafico do leitor de tela, deixando so a tabela', () => {
    const { container } = render(
      <GraficoDeRosca segmentos={SEGMENTOS} descricao="Distribuição por forma de pagamento" />,
    );

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/ui test -- GraficoDeRosca`
Expected: FAIL — `Cannot find module './GraficoDeRosca.js'`

- [ ] **Step 3: Implementar o componente**

```tsx
// packages/ui/src/components/GraficoDeRosca.tsx
'use client';

import { useEffect, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

import estilos from './GraficoDeRosca.module.css';

/**
 * Rosca de composicao -- que fatia do total cada forma de pagamento ocupa.
 *
 * Mesmo padrao de acessibilidade que BarrasDeFaixa/SerieFinanceira: tabela
 * invisivel antes do SVG, wrapper com aria-hidden no grafico.
 */

export interface SegmentoDeRosca {
  readonly rotulo: string;
  readonly valor: number;
  /** Token semantico do DS. Sem hex literal -- regra 1 de lint. */
  readonly tokenDeCor: string;
  /** O que aparece na legenda. Ja formatado por quem chama. */
  readonly valorLegivel: string;
}

interface Props {
  readonly segmentos: readonly SegmentoDeRosca[];
  readonly descricao: string;
  readonly testId?: string;
  readonly rotuloCentral?: string;
  readonly valorCentral?: string;
}

/** Mesma implementacao de BarrasDeFaixa/SerieFinanceira -- a dependencia e a STRING, nao o array. */
function useCoresDosTokens(tokens: readonly string[]): readonly string[] {
  const chave = tokens.join('|');

  const [cores, setCores] = useState<readonly string[]>(() => lerCores(chave));

  useEffect(() => {
    setCores(lerCores(chave));
  }, [chave]);

  return cores;
}

function lerCores(chave: string): readonly string[] {
  if (typeof document === 'undefined') {
    return [];
  }

  const estilo = getComputedStyle(document.documentElement);

  return chave.split('|').map((token) => estilo.getPropertyValue(token).trim());
}

export function GraficoDeRosca({
  segmentos,
  descricao,
  testId,
  rotuloCentral,
  valorCentral,
}: Props) {
  const cores = useCoresDosTokens(segmentos.map((s) => s.tokenDeCor));

  const total = segmentos.reduce((soma, segmento) => soma + segmento.valor, 0);

  /** SEM DADO NAO E GRAFICO VAZIO -- mesma regra dos outros graficos do DS. */
  if (total === 0) {
    return (
      <p className={estilos['vazio']} data-testid={testId}>
        Nenhum valor recebido no período.
      </p>
    );
  }

  const dados = segmentos
    .filter((segmento) => segmento.valor > 0)
    .map((segmento) => ({ nome: segmento.rotulo, valor: segmento.valor }));

  return (
    <div className={estilos['area']} data-testid={testId}>
      <table className={estilos['somenteLeitorDeTela']}>
        <caption>{descricao}</caption>
        <tbody>
          {segmentos.map((segmento) => (
            <tr key={segmento.rotulo}>
              <th scope="row">{segmento.rotulo}</th>
              <td>{segmento.valorLegivel}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={estilos['linha']}>
        <div className={estilos['roscaContainer']} aria-hidden="true">
          <ResponsiveContainer width={160} height={160}>
            <PieChart>
              <Pie
                data={dados}
                dataKey="valor"
                nameKey="nome"
                innerRadius={56}
                outerRadius={76}
                startAngle={90}
                endAngle={-270}
                isAnimationActive={false}
                stroke="none"
              >
                {dados.map((item, indice) => (
                  <Cell
                    key={item.nome}
                    fill={cores[segmentos.findIndex((s) => s.rotulo === item.nome)] ?? 'currentColor'}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {rotuloCentral || valorCentral ? (
            <div className={estilos['centro']}>
              {rotuloCentral ? <span className={estilos['centroRotulo']}>{rotuloCentral}</span> : null}
              {valorCentral ? <span className={estilos['centroValor']}>{valorCentral}</span> : null}
            </div>
          ) : null}
        </div>

        <ul className={estilos['legenda']}>
          {segmentos.map((segmento, indice) => (
            <li key={segmento.rotulo} className={estilos['legendaItem']}>
              <span
                className={estilos['marcador']}
                style={{ background: cores[indice] ?? 'currentColor' }}
              />
              <span className={estilos['legendaRotulo']}>{segmento.rotulo}</span>
              <span className={estilos['legendaValor']}>{segmento.valorLegivel}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

```css
/* packages/ui/src/components/GraficoDeRosca.module.css */
.area {
  color: var(--ah-text-secondary);
  font-variant-numeric: tabular-nums;
}

.vazio {
  margin: 0;
  padding: 24px 0;
  color: var(--ah-text-secondary);
  font-size: var(--ah-type-body-size);
  line-height: var(--ah-type-body-lh);
}

.linha {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.roscaContainer {
  position: relative;
  width: 160px;
  height: 160px;
  flex-shrink: 0;
}

.centro {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  pointer-events: none;
}

.centroRotulo {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ah-text-secondary);
}

.centroValor {
  font-size: 20px;
  font-weight: 700;
  color: var(--ah-text-strong);
}

.legenda {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  flex: 1;
  min-width: 180px;
}

.legendaItem {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.marcador {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex-shrink: 0;
}

.legendaRotulo {
  color: var(--ah-text-default);
  flex: 1;
}

.legendaValor {
  color: var(--ah-text-secondary);
  white-space: nowrap;
}

.somenteLeitorDeTela {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @arenahub/ui test -- GraficoDeRosca`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/GraficoDeRosca.tsx packages/ui/src/components/GraficoDeRosca.module.css packages/ui/src/components/GraficoDeRosca.spec.tsx
git commit -m "feat: adiciona GraficoDeRosca ao design system"
```

---

### Task 2: `BarrasVerticais` — componente novo

**Files:**
- Create: `packages/ui/src/components/BarrasVerticais.tsx`
- Create: `packages/ui/src/components/BarrasVerticais.module.css`
- Test: `packages/ui/src/components/BarrasVerticais.spec.tsx`

**Interfaces:**
- Consumes: nenhuma.
- Produces:
  ```ts
  export interface FaixaVertical {
    readonly rotulo: string;
    readonly valor: number;
    readonly tokenDeCor: string;
    readonly valorLegivel: string;
  }
  interface Props {
    readonly faixas: readonly FaixaVertical[];
    readonly descricao: string;
    readonly testId?: string;
  }
  export function BarrasVerticais(props: Props): JSX.Element
  ```

- [ ] **Step 1: Escrever os testes que falham**

```tsx
// packages/ui/src/components/BarrasVerticais.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarrasVerticais } from './BarrasVerticais.js';

const FAIXAS = [
  { rotulo: 'Até 15 dias', valor: 630_000, tokenDeCor: '--ah-state-warning', valorLegivel: 'R$ 6.300,00' },
  { rotulo: '16 a 30 dias', valor: 675_000, tokenDeCor: '--ah-state-risk', valorLegivel: 'R$ 6.750,00' },
  { rotulo: 'Mais de 30 dias', valor: 330_000, tokenDeCor: '--ah-state-danger', valorLegivel: 'R$ 3.300,00' },
];

describe('BarrasVerticais', () => {
  it('publica as faixas numa tabela para leitor de tela', () => {
    render(<BarrasVerticais faixas={FAIXAS} descricao="Dívida por faixa de atraso" />);

    expect(screen.getByRole('table', { name: 'Dívida por faixa de atraso' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '16 a 30 dias' })).toBeInTheDocument();
  });

  it('mostra o valor legível no topo de cada coluna', () => {
    render(<BarrasVerticais faixas={FAIXAS} descricao="Dívida por faixa de atraso" />);

    expect(screen.getByText('R$ 6.750,00')).toBeInTheDocument();
  });

  /** Mesma regra de BarrasDeFaixa: sem dado e frase, nao eixo vazio. */
  it('mostra frase, nao eixo vazio, quando todas as faixas sao zero', () => {
    render(
      <BarrasVerticais
        faixas={FAIXAS.map((f) => ({ ...f, valor: 0 }))}
        descricao="Dívida por faixa de atraso"
        testId="aging"
      />,
    );

    expect(screen.getByTestId('aging')).toHaveTextContent(/nada em atraso/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  /**
   * UMA FAIXA CONCENTRADA nao pode fazer as outras (valor zero) produzirem
   * altura NaN ou negativa ao normalizar contra o maior valor.
   */
  it('nao quebra quando so uma faixa tem valor', () => {
    const faixas = [
      { rotulo: 'Até 15 dias', valor: 0, tokenDeCor: '--ah-state-warning', valorLegivel: 'R$ 0,00' },
      { rotulo: '16 a 30 dias', valor: 500_000, tokenDeCor: '--ah-state-risk', valorLegivel: 'R$ 5.000,00' },
    ];

    render(<BarrasVerticais faixas={faixas} descricao="Dívida por faixa de atraso" />);

    expect(screen.getByText('R$ 5.000,00')).toBeInTheDocument();
  });

  it('esconde o grafico do leitor de tela, deixando so a tabela', () => {
    const { container } = render(
      <BarrasVerticais faixas={FAIXAS} descricao="Dívida por faixa de atraso" />,
    );

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/ui test -- BarrasVerticais`
Expected: FAIL — `Cannot find module './BarrasVerticais.js'`

- [ ] **Step 3: Implementar o componente**

```tsx
// packages/ui/src/components/BarrasVerticais.tsx
'use client';

import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import estilos from './BarrasVerticais.module.css';

/**
 * Barras verticais de composicao, com eixo de valor -- o inverso de
 * BarrasDeFaixa (que e horizontal, sem eixo). Usado onde a pergunta e "como a
 * divida cresce por faixa de atraso" e nao so "qual e maior".
 */

export interface FaixaVertical {
  readonly rotulo: string;
  readonly valor: number;
  /** Token semantico do DS. Sem hex literal -- regra 1 de lint. */
  readonly tokenDeCor: string;
  readonly valorLegivel: string;
}

interface Props {
  readonly faixas: readonly FaixaVertical[];
  readonly descricao: string;
  readonly testId?: string;
}

/** Mesma implementacao de BarrasDeFaixa -- a dependencia e a STRING, nao o array. */
function useCoresDosTokens(tokens: readonly string[]): readonly string[] {
  const chave = tokens.join('|');

  const [cores, setCores] = useState<readonly string[]>(() => lerCores(chave));

  useEffect(() => {
    setCores(lerCores(chave));
  }, [chave]);

  return cores;
}

function lerCores(chave: string): readonly string[] {
  if (typeof document === 'undefined') {
    return [];
  }

  const estilo = getComputedStyle(document.documentElement);

  return chave.split('|').map((token) => estilo.getPropertyValue(token).trim());
}

export function BarrasVerticais({ faixas, descricao, testId }: Props) {
  const cores = useCoresDosTokens(faixas.map((f) => f.tokenDeCor));

  const total = faixas.reduce((soma, faixa) => soma + faixa.valor, 0);

  if (total === 0) {
    return (
      <p className={estilos['vazio']} data-testid={testId}>
        Nada em atraso agora.
      </p>
    );
  }

  const dados = faixas.map((faixa) => ({
    rotulo: faixa.rotulo,
    valor: faixa.valor,
    valorLegivel: faixa.valorLegivel,
  }));

  return (
    <div className={estilos['area']} data-testid={testId}>
      <table className={estilos['somenteLeitorDeTela']}>
        <caption>{descricao}</caption>
        <tbody>
          {faixas.map((faixa) => (
            <tr key={faixa.rotulo}>
              <th scope="row">{faixa.rotulo}</th>
              <td>{faixa.valorLegivel}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dados} margin={{ top: 24, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} vertical={false} />
            <XAxis
              dataKey="rotulo"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'currentColor', fontSize: 12 }}
            />
            <YAxis hide domain={[0, 'auto']} />
            <Bar dataKey="valor" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {dados.map((item, indice) => (
                <Cell key={item.rotulo} fill={cores[indice] ?? 'currentColor'} />
              ))}
              <LabelList dataKey="valorLegivel" position="top" fill="currentColor" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

```css
/* packages/ui/src/components/BarrasVerticais.module.css */
.area {
  color: var(--ah-text-secondary);
  font-variant-numeric: tabular-nums;
}

.vazio {
  margin: 0;
  padding: 24px 0;
  color: var(--ah-text-secondary);
  font-size: var(--ah-type-body-size);
  line-height: var(--ah-type-body-lh);
}

.somenteLeitorDeTela {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @arenahub/ui test -- BarrasVerticais`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/BarrasVerticais.tsx packages/ui/src/components/BarrasVerticais.module.css packages/ui/src/components/BarrasVerticais.spec.tsx
git commit -m "feat: adiciona BarrasVerticais ao design system"
```

---

### Task 3: Evoluir `SerieFinanceira` — destaque no último ponto

**Files:**
- Modify: `packages/ui/src/components/SerieFinanceira.tsx:279-287`
- Modify: `packages/ui/src/components/SerieFinanceira.spec.tsx`

**Interfaces:**
- Consumes: nenhuma mudança de prop pública — `PontoFinanceiro { rotulo, faturadoMinor, recebidoMinor }`,
  `descricao`, `testId` continuam idênticos.
- Produces: comportamento visual aditivo, sem quebrar nenhum teste existente do arquivo (já lido em
  `packages/ui/src/components/SerieFinanceira.spec.tsx` — os 6 testes atuais continuam válidos).

O componente já tem grid pontilhado, linha tracejada de faturado e `dot` na linha de recebido (ver leitura de
`SerieFinanceira.tsx:183-287` feita durante o design). O que falta: destacar visualmente o **último ponto**
(competência mais recente) com raio maior que os demais — o mockup de referência faz isso para guiar o olho até
o dado mais atual.

**Nota sobre testabilidade:** como o arquivo de teste existente documenta (linhas 6-14), Recharts não renderiza
SVG em jsdom (`ResponsiveContainer` mede o pai, que tem largura zero ali). Isso significa que não dá para
afirmar "o círculo do último ponto tem `r=6`" via DOM — não existe círculo no DOM de teste. O que É testável e
pina o comportamento: a função `dot` customizada é pura (recebe `props.index`, devolve JSX), então ela pode ser
testada isoladamente, fora da árvore do Recharts, chamando-a como função comum.

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// adicionar a packages/ui/src/components/SerieFinanceira.spec.tsx, dentro do describe existente
// (import adicional no topo do arquivo: import { render } from '@testing-library/react';  -- ja existe)

  /**
   * O ULTIMO PONTO (competencia mais recente) ganha destaque -- e para onde o
   * olho deve ir primeiro, porque e o numero que ainda pode mudar.
   *
   * TESTADO CHAMANDO A FUNCAO `dot` DIRETO, nao via DOM: Recharts nao
   * desenha SVG em jsdom (ver nota no topo deste arquivo), entao nao existe
   * circulo para inspecionar na arvore renderizada. A funcao que decide o
   * raio e pura -- recebe indice, devolve elemento -- e pode ser testada
   * isolada. Ela e exportada so para teste (ver `export` marcado como
   * "visivel para teste" no componente).
   */
  it('desenha o ultimo ponto com raio maior que os demais', () => {
    const pontoComum = renderPontoDaSerie({ cx: 10, cy: 20, index: 0 }, 3, '#006c49');
    const ultimoPonto = renderPontoDaSerie({ cx: 10, cy: 20, index: 2 }, 3, '#006c49');

    expect(pontoComum.props.r).toBe(4);
    expect(ultimoPonto.props.r).toBe(6);
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/ui test -- SerieFinanceira`
Expected: FAIL — `renderPontoDaSerie is not defined` (a função ainda não existe)

- [ ] **Step 3: Implementar o destaque do último ponto**

Em `SerieFinanceira.tsx`, extrair uma função de módulo `renderPontoDaSerie` — pura, testável fora do Recharts —
que decide o raio pelo índice, e usá-la no `dot` da linha de recebido:

```tsx
// packages/ui/src/components/SerieFinanceira.tsx
// Adicionar antes de `export function SerieFinanceira`:

/**
 * Desenha o ponto da linha de recebido. Funcao de MODULO, nao inline no JSX,
 * para ser testavel isolada -- Recharts nao renderiza SVG em jsdom (ver topo
 * do arquivo de teste), entao nao ha como inspecionar o circulo via DOM.
 *
 * ULTIMO PONTO (competencia mais recente) ganha raio maior: e onde o olho
 * deve ir primeiro, porque e o numero que ainda pode mudar.
 */
export function renderPontoDaSerie(
  props: { cx?: number; cy?: number; index?: number },
  totalDePontos: number,
  cor: string,
): JSX.Element {
  const ehUltimo = props.index === totalDePontos - 1;
  const raio = ehUltimo ? 6 : 4;

  return (
    <circle
      key={`ponto-${String(props.index)}`}
      cx={props.cx}
      cy={props.cy}
      r={raio}
      fill={cor}
      stroke="var(--ah-surface-raised)"
      strokeWidth={ehUltimo ? 2 : 0}
    />
  );
}

// Substituir o bloco do <Line dataKey="recebidoMinor" ...> (linhas 279-287 na leitura original):
            <Line
              type="monotone"
              dataKey="recebidoMinor"
              name="Recebido"
              stroke={corRecebido}
              strokeWidth={2.5}
              dot={(props: { cx?: number; cy?: number; index?: number }) =>
                renderPontoDaSerie(props, dados.length, corRecebido)
              }
              isAnimationActive={false}
            />
```

Import necessário no topo do teste: `import { renderPontoDaSerie, SerieFinanceira } from './SerieFinanceira.js';`

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @arenahub/ui test -- SerieFinanceira`
Expected: PASS (7 testes — os 6 originais + o novo)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/SerieFinanceira.tsx packages/ui/src/components/SerieFinanceira.spec.tsx
git commit -m "feat: destaca ultimo ponto da serie financeira"
```

---

### Task 4: Exportar componentes novos no barrel

**Files:**
- Modify: `packages/ui/src/index.ts:20-22`

**Interfaces:**
- Consumes: `GraficoDeRosca`/`SegmentoDeRosca` de `./components/GraficoDeRosca.js`,
  `BarrasVerticais`/`FaixaVertical` de `./components/BarrasVerticais.js` (Tasks 1 e 2).
- Produces: `import { GraficoDeRosca, BarrasVerticais } from '@arenahub/ui'` disponível para `apps/admin-web`.

- [ ] **Step 1: Editar o barrel**

```ts
// packages/ui/src/index.ts — adicionar junto às linhas 20-22 existentes
export { BarrasDeFaixa, type FaixaDeBarra } from './components/BarrasDeFaixa.js';
export { BarrasVerticais, type FaixaVertical } from './components/BarrasVerticais.js';
export { GraficoDeRosca, type SegmentoDeRosca } from './components/GraficoDeRosca.js';
export { SerieFinanceira, type PontoFinanceiro } from './components/SerieFinanceira.js';
export { Sparkline } from './components/Sparkline.js';
```

- [ ] **Step 2: Rodar o build do pacote para confirmar que os tipos exportam sem erro**

Run: `pnpm --filter @arenahub/ui build`
Expected: sucesso, sem erro de TypeScript

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/index.ts
git commit -m "feat: exporta GraficoDeRosca e BarrasVerticais do design system"
```

---

### Task 5: Reescrever `billing/page.tsx` e `summary.module.css`

**Files:**
- Modify: `apps/admin-web/app/(protected)/billing/page.tsx`
- Modify: `apps/admin-web/app/(protected)/billing/summary.module.css`

**Interfaces:**
- Consumes: `GraficoDeRosca`, `BarrasVerticais` de `@arenahub/ui` (Task 4); `SerieFinanceira` evoluído
  (Task 3); todos os componentes já existentes usados hoje (`Ausente`, `DataTable`, `EmptyState`,
  `formatarDinheiro`, `Money`, `PageHeader`, `percentualDoTotal`, `ProblemDetail`, `Sparkline`).
- Produces: mesma função default `PainelFinanceiroPage`, mesma export nomeada `periodosDisponiveis` (consumida
  por `page.test.tsx` — Task 6). Todos os `data-testid` já existentes preservados (listados em Global
  Constraints).

**Mudanças na page, em ordem:**

1. Import de `GraficoDeRosca` e `BarrasVerticais` de `@arenahub/ui`.
2. Bloco de KPI (`estilos['faixaDeKpi']`) perde os três KPIs promovidos (Recebido, Assinaturas vigentes →
   `alunosAtivos`, Ticket médio) e ganha um novo bloco **antes** dele: `estilos['heroKpis']`, com esses três
   em cards maiores.

   No hero de Recebido: mesmo `Sparkline` que já existe hoje (`tendencia-do-recebido`), mais um badge de
   tendência — **só quando há pelo menos 2 pontos na série** (reusa a mesma condição de
   `resumo.serie.suficienteParaLinha` combinada com pelo menos 2 pontos, calculando a variação percentual entre
   o penúltimo e o último ponto de `resumo.serie.pontos`). Fórmula:

   ```tsx
   const pontosDaSerie = resumo.serie.pontos;
   const penultimo = pontosDaSerie.at(-2);
   const ultimo = pontosDaSerie.at(-1);
   const variacaoRecebido =
     penultimo && ultimo && penultimo.recebidoMinor > 0
       ? Math.round(((ultimo.recebidoMinor - penultimo.recebidoMinor) / penultimo.recebidoMinor) * 1000) / 10
       : null;
   ```

   `variacaoRecebido === null` → não renderiza o badge (nunca `↑ NaN%`).

3. O bloco `estilos['duasColunas']` de "Onde o dinheiro parou" / "Por onde o dinheiro entrou" é substituído por
   dois blocos de duas colunas novos:
   - `SerieFinanceira` + `GraficoDeRosca` (troca `BarrasDeFaixa` por `GraficoDeRosca` no bloco de método de
     pagamento, mapeando `resumo.quebraPorMetodo` para `SegmentoDeRosca[]`).
   - `BarrasVerticais` (troca `BarrasDeFaixa` por `BarrasVerticais` no bloco de dívida, mapeando
     `resumo.faixas` para `FaixaVertical[]`) + um novo card de "Saúde do negócio & retenção" com sub-cards para
     Novos alunos / Cancelamentos / Taxa de churn / LTV — os mesmos 4 KPIs que saem da faixa compacta (Task 5,
     ponto 2), preservando os `data-testid` `novos-alunos`, `cancelamentos`, `taxa-de-churn`, `ltv`.
4. `estilos['grafico']` (bloco "Faturado e recebido por competência") passa a usar o `SerieFinanceira`
   evoluído — nenhuma mudança estrutural além da já feita na Task 3 dentro do componente. Mantém-se este bloco
   com a tabela recolhida em `<details>`, OU se decide mover o `SerieFinanceira` só para o bloco novo da linha 4
   do layout (ver nota abaixo).

   **Nota de decisão de implementação:** o spec descreve `SerieFinanceira` aparecendo na "linha 4" (lado a lado
   com `GraficoDeRosca`) — isso substitui o bloco "Faturado e recebido por competência" que hoje é uma seção
   cheia embaixo (`estilos['secao']`), não fica duplicado. Mover esse bloco inteiro (gráfico + aviso de série
   curta + `<details>` com `DataTable`) para dentro da coluna esquerda da nova grade de duas colunas, mantendo
   `data-testid="grafico-de-competencia"`, `data-testid="serie-insuficiente"`, `data-testid="serie-por-
   competencia"` intactos.

**Trecho completo da nova função (substituindo de `resumo.competenciasDisponiveis` em diante até o fim do
JSX)** — usar como referência de estrutura, ajustando imports no topo do arquivo:

```tsx
import type { Metadata } from 'next';

import {
  Ausente,
  BarrasVerticais,
  DataTable,
  EmptyState,
  formatarDinheiro,
  GraficoDeRosca,
  Money,
  PageHeader,
  percentualDoTotal,
  ProblemDetail,
  SerieFinanceira,
  Sparkline,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import estilos from './summary.module.css';

// ... (Metadata, dynamic, interfaces Faixa/Metodo/Ponto/Resumo, COR_DA_FAIXA, COR_DO_METODO,
//      NOME_DO_METODO, MESES, competenciaLegivel, diaLegivel, periodosDisponiveis, OpcaoDePeriodo
//      permanecem IDÊNTICOS ao arquivo atual — nenhuma mudança nessas partes)

export default async function PainelFinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const { de, ate } = await searchParams;

  const consulta = new URLSearchParams();
  if (de) consulta.set('de', de);
  if (ate) consulta.set('ate', ate);

  const resposta = await chamarApi<Resumo>(
    `/api/v1/billing/summary${consulta.size > 0 ? `?${consulta}` : ''}`,
  );

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-financeiro">
        <PageHeader id="titulo-financeiro" title="Painel financeiro" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar o painel financeiro (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const resumo = resposta.dados;

  const periodos = periodosDisponiveis(resumo.competenciasDisponiveis, {
    de: resumo.de,
    ate: resumo.ate,
  });

  const temDivida = resumo.vencidoMinor > 0;
  const periodoParcial = periodos.find((periodo) => periodo.atual)?.parcial ?? false;

  /*
    VARIACAO DO RECEBIDO -- so existe com pelo menos dois pontos na serie.
    Sem dado de mes anterior, o badge nao aparece (nunca inventar percentual).
  */
  const pontosDaSerie = resumo.serie.pontos;
  const penultimo = pontosDaSerie.at(-2);
  const ultimoPonto = pontosDaSerie.at(-1);
  const variacaoRecebido =
    penultimo && ultimoPonto && penultimo.recebidoMinor > 0
      ? Math.round(((ultimoPonto.recebidoMinor - penultimo.recebidoMinor) / penultimo.recebidoMinor) * 1000) / 10
      : null;

  return (
    <section aria-labelledby="titulo-financeiro">
      <PageHeader
        id="titulo-financeiro"
        title="Painel financeiro"
        breadcrumb={<span>Receita</span>}
      />

      <div className={estilos['barraDoPeriodo']}>
        {periodos.length > 0 ? (
          <nav className={estilos['chips']} aria-label="Período apurado">
            {periodos.map((periodo) => (
              <a
                key={periodo.rotulo}
                className={estilos['chip']}
                href={`/billing?de=${encodeURIComponent(periodo.de)}&ate=${encodeURIComponent(periodo.ate)}`}
                {...(periodo.atual ? { 'aria-current': 'page' as const } : {})}
                data-testid={`periodo-${periodo.rotulo}`}
              >
                {periodo.rotulo}
                {periodo.parcial ? ' (parcial)' : ''}
              </a>
            ))}
          </nav>
        ) : null}

        <p className={estilos['periodoApurado']} data-testid="periodo-do-resumo">
          <strong>
            {diaLegivel(resumo.de)} a {diaLegivel(resumo.ate)}
          </strong>{' '}
          · {periodoParcial ? 'mês em andamento, número ainda muda' : 'fim exclusivo, período fechado'}
        </p>
      </div>

      {/* HERO KPIS -- os tres indicadores que o gestor abre a tela para ver. */}
      <section className={estilos['heroKpis']} aria-label="Indicadores principais do período">
        <div className={estilos['heroCard']} data-tom="success">
          <div className={estilos['heroCabecalho']}>
            <p className={estilos['heroRotulo']}>Recebido</p>
            {variacaoRecebido !== null ? (
              <span className={estilos['heroBadge']} data-tom={variacaoRecebido >= 0 ? 'success' : 'danger'}>
                {variacaoRecebido >= 0 ? '↑' : '↓'} {String(Math.abs(variacaoRecebido)).replace('.', ',')}%
              </span>
            ) : null}
          </div>
          <p className={estilos['heroValor']} data-testid="recebido-no-periodo">
            <Money cents={resumo.recebidoMinor} currency="BRL" />
          </p>
          <div className={estilos['heroTendencia']}>
            <Sparkline
              testId="tendencia-do-recebido"
              valores={resumo.serie.pontos.map((ponto) => ponto.recebidoMinor)}
              tokenDeCor="--ah-state-success"
            />
          </div>
        </div>

        <div className={estilos['heroCard']}>
          <p className={estilos['heroRotulo']}>Assinaturas vigentes</p>
          <p className={estilos['heroValor']} data-testid="alunos-ativos">
            {resumo.alunosAtivos}
          </p>
          <p className={estilos['heroApoio']}>agora, independente do período</p>
        </div>

        <div className={estilos['heroCard']}>
          <p className={estilos['heroRotulo']}>Ticket médio</p>
          <p className={estilos['heroValor']} data-testid="ticket-medio">
            {resumo.ticketMedioMinor === null ? (
              <Ausente />
            ) : (
              <Money cents={resumo.ticketMedioMinor} currency="BRL" />
            )}
          </p>
          <p className={estilos['heroApoio']}>
            {resumo.pagamentosConfirmados === 0
              ? 'sem pagamento no período'
              : `${resumo.pagamentosConfirmados} pagamento(s) confirmado(s)`}
          </p>
        </div>
      </section>

      {/* FAIXA COMPACTA -- os KPIs restantes, menos os tres promovidos a hero. */}
      <section className={estilos['faixaDeKpi']} aria-label="Indicadores do período">
        <div className={estilos['kpi']}>
          <p className={estilos['kpiRotulo']}>Esperado por mês</p>
          <p className={estilos['kpiValor']} data-testid="receita-esperada">
            <Money cents={resumo.receitaEsperadaMinor} currency="BRL" />
          </p>
          <p className={estilos['kpiApoio']}>
            {resumo.base.alunosPagantes} assinatura(s), pelo plano
          </p>
        </div>

        <div className={estilos['kpi']}>
          <p className={estilos['kpiRotulo']}>A receber</p>
          <p className={estilos['kpiValor']} data-testid="a-receber">
            <Money cents={resumo.aReceberMinor} currency="BRL" />
          </p>
          <p className={estilos['kpiApoio']}>
            {resumo.faturasAReceber} fatura(s) vencendo no período
          </p>
        </div>

        <div className={estilos['kpi']} {...(temDivida ? { 'data-tom': 'danger' } : {})}>
          <p className={estilos['kpiRotulo']}>Vencido</p>
          <p className={estilos['kpiValor']} data-testid="vencido">
            <Money cents={resumo.vencidoMinor} currency="BRL" />
          </p>
          <p className={estilos['kpiApoio']}>
            {resumo.faturasVencidas} fatura(s), toda a dívida em aberto
          </p>
        </div>

        <div className={estilos['kpi']} {...(temDivida ? { 'data-tom': 'risk' } : {})}>
          <p className={estilos['kpiRotulo']}>Inadimplência</p>
          <p className={estilos['kpiValor']} data-testid="taxa-de-inadimplencia">
            {resumo.taxaDeInadimplencia === null ? (
              <Ausente />
            ) : (
              `${String(resumo.taxaDeInadimplencia).replace('.', ',')}%`
            )}
          </p>
          <p className={estilos['kpiApoio']}>
            {resumo.base.alunosInadimplentes} de {resumo.base.alunosPagantes} aluno(s)
          </p>
        </div>

        {resumo.estornadoMinor > 0 ? (
          <div className={estilos['kpi']} data-tom="warning">
            <p className={estilos['kpiRotulo']}>Estornado</p>
            <p className={estilos['kpiValor']} data-testid="estornado">
              <Money cents={resumo.estornadoMinor} currency="BRL" />
            </p>
            <p className={estilos['kpiApoio']}>já descontado do recebido</p>
          </div>
        ) : null}
      </section>

      {/* LINHA 1 DE GRAFICOS: evolucao de receita + composicao de pagamento. */}
      <div className={estilos['duasColunasGraficos']}>
        <div className={estilos['cartao']}>
          <h2 className={estilos['tituloDoCartao']}>
            Faturado e recebido por competência
          </h2>
          <p className={estilos['apoioDoTitulo']}>
            pelo mês de referência da fatura, não pela data do pagamento
          </p>

          {resumo.serie.pontos.length === 0 ? (
            <EmptyState
              testId="sem-competencia"
              title="Nenhuma competência no período"
              hint="Não há faturas emitidas nem pagamentos confirmados para o período apurado."
            />
          ) : (
            <div className={estilos['grafico']}>
              {!resumo.serie.suficienteParaLinha ? (
                <p className={estilos['avisoDaSerie']} data-testid="serie-insuficiente">
                  Dado insuficiente para comparar períodos:{' '}
                  {resumo.serie.pontos.length === 1
                    ? 'há uma competência apurada'
                    : `há ${resumo.serie.pontos.length} competências apuradas`}
                  , e a comparação de tendência exige pelo menos três.
                </p>
              ) : null}

              <SerieFinanceira
                testId="grafico-de-competencia"
                descricao="Valor faturado e recebido por mês de competência"
                pontos={resumo.serie.pontos.map((ponto) => ({
                  rotulo: competenciaLegivel(ponto.competencia),
                  faturadoMinor: ponto.faturadoMinor,
                  recebidoMinor: ponto.recebidoMinor,
                }))}
              />

              <details className={estilos['detalhe']}>
                <summary className={estilos['detalheGatilho']}>Ver valores exatos</summary>

                <div className={estilos['detalheConteudo']}>
                  <DataTable
                    testId="serie-por-competencia"
                    empty={<EmptyState title="Nenhuma competência no período" />}
                    rows={resumo.serie.pontos}
                    rowKey={(ponto) => ponto.competencia}
                    caption="Valor faturado e recebido por mês de competência"
                    columns={[
                      {
                        key: 'competencia',
                        header: 'Competência',
                        role: 'identity',
                        render: (ponto) => competenciaLegivel(ponto.competencia),
                      },
                      {
                        key: 'faturado',
                        header: 'Faturado',
                        role: 'value',
                        render: (ponto) => <Money cents={ponto.faturadoMinor} currency="BRL" />,
                      },
                      {
                        key: 'recebido',
                        header: 'Recebido',
                        role: 'value',
                        render: (ponto) => <Money cents={ponto.recebidoMinor} currency="BRL" />,
                      },
                      {
                        key: 'naoEntrou',
                        header: 'Não entrou',
                        role: 'value',
                        render: (ponto) => (
                          <Money
                            cents={Math.max(ponto.faturadoMinor - ponto.recebidoMinor, 0)}
                            currency="BRL"
                          />
                        ),
                      },
                    ]}
                  />
                </div>
              </details>
            </div>
          )}
        </div>

        <div className={estilos['cartao']}>
          <h2 className={estilos['tituloDoCartao']}>Por onde o dinheiro entrou</h2>
          {resumo.recebidoMinor === 0 ? (
            <EmptyState
              testId="sem-pagamento"
              title="Nenhum pagamento no período"
              hint="Nenhuma forma de pagamento registrou entrada no período apurado."
            />
          ) : (
            <GraficoDeRosca
              testId="quebra-por-metodo"
              descricao="Valor recebido por forma de pagamento no período apurado"
              rotuloCentral={NOME_DO_METODO[
                resumo.quebraPorMetodo.reduce((maior, atual) =>
                  atual.minorTotal > maior.minorTotal ? atual : maior,
                )['metodo']
              ]}
              valorCentral={(() => {
                const maiorMetodo = resumo.quebraPorMetodo.reduce((maior, atual) =>
                  atual.minorTotal > maior.minorTotal ? atual : maior,
                );
                const proporcao = percentualDoTotal(maiorMetodo.minorTotal, resumo.recebidoMinor);
                return proporcao === null ? undefined : `${String(proporcao).replace('.', ',')}%`;
              })()}
              segmentos={resumo.quebraPorMetodo.map((metodo) => {
                const proporcao = percentualDoTotal(metodo.minorTotal, resumo.recebidoMinor);

                return {
                  rotulo: NOME_DO_METODO[metodo.metodo] ?? metodo.metodo,
                  valor: metodo.minorTotal,
                  tokenDeCor: COR_DO_METODO[metodo.metodo] ?? '--ah-text-muted',
                  valorLegivel:
                    proporcao === null
                      ? formatarDinheiro(metodo.minorTotal)
                      : `${formatarDinheiro(metodo.minorTotal)} · ${String(proporcao).replace('.', ',')}%`,
                };
              })}
            />
          )}
        </div>
      </div>

      {/* LINHA 2 DE GRAFICOS: aging da divida + saude do negocio. */}
      <div className={estilos['duasColunasGraficos']}>
        <div className={estilos['cartao']}>
          <h2 className={estilos['tituloDoCartao']}>Onde o dinheiro parou</h2>
          {resumo.faturasVencidas === 0 ? (
            <EmptyState
              testId="sem-divida"
              title="Nenhuma fatura vencida"
              hint="Não há dinheiro parado no momento."
            />
          ) : (
            <BarrasVerticais
              testId="faixas-da-divida"
              descricao="Valor vencido por faixa de tempo, considerando toda a dívida em aberto"
              faixas={resumo.faixas.map((faixa) => ({
                rotulo: faixa.rotulo,
                valor: faixa.minorTotal,
                tokenDeCor: COR_DA_FAIXA[faixa.rotulo] ?? '--ah-text-muted',
                valorLegivel: formatarDinheiro(faixa.minorTotal),
              }))}
            />
          )}
        </div>

        <div className={estilos['cartao']}>
          <h2 className={estilos['tituloDoCartao']}>Saúde do negócio &amp; retenção</h2>
          <div className={estilos['subKpis']}>
            <div className={estilos['subKpi']}>
              <p className={estilos['kpiRotulo']}>Novos alunos</p>
              <p className={estilos['kpiValor']} data-testid="novos-alunos">
                {resumo.novosAlunos}
              </p>
              <p className={estilos['kpiApoio']}>no período</p>
            </div>

            <div className={estilos['subKpi']} {...(resumo.cancelamentos > 0 ? { 'data-tom': 'risk' } : {})}>
              <p className={estilos['kpiRotulo']}>Cancelamentos</p>
              <p className={estilos['kpiValor']} data-testid="cancelamentos">
                {resumo.cancelamentos}
              </p>
              <p className={estilos['kpiApoio']}>no período</p>
            </div>

            <div className={estilos['subKpi']} {...(resumo.cancelamentos > 0 ? { 'data-tom': 'risk' } : {})}>
              <p className={estilos['kpiRotulo']}>Taxa de churn</p>
              <p className={estilos['kpiValor']} data-testid="taxa-de-churn">
                {resumo.taxaDeChurn === null ? (
                  <Ausente />
                ) : (
                  `${String(resumo.taxaDeChurn).replace('.', ',')}%`
                )}
              </p>
              <p className={estilos['kpiApoio']}>sobre a base pagante do início do período</p>
            </div>

            <div className={estilos['subKpi']}>
              <p className={estilos['kpiRotulo']}>LTV</p>
              <p className={estilos['kpiValor']} data-testid="ltv">
                {resumo.ltv === null ? <Ausente /> : <Money cents={resumo.ltv} currency="BRL" />}
              </p>
              <p className={estilos['kpiApoio']}>ticket médio × vida média observada</p>
            </div>
          </div>
        </div>
      </div>

      <dl className={estilos['base']} data-testid="base-de-calculo">
        <div>
          <dt>Base de cálculo:</dt>
          <dd>{resumo.base.alunosPagantes} aluno(s) com assinatura ativa ou em atraso</dd>
        </div>
        <div>
          <dt>Com fatura vencida:</dt>
          <dd>{resumo.base.alunosInadimplentes}</dd>
        </div>
        <div>
          <dt>Assinaturas ativas:</dt>
          <dd>{resumo.base.assinaturasAtivas}</dd>
        </div>
      </dl>
    </section>
  );
}
```

**Nota:** o cálculo de `rotuloCentral`/`valorCentral` do `GraficoDeRosca` acima usa `.reduce()` duas vezes — ao
implementar de fato, extrair para uma variável única antes do JSX (`const maiorMetodo = ...`) para não duplicar
a chamada. Corrigir isso na implementação real, o bloco acima é ilustrativo da lógica, não código para colar
literalmente sem essa limpeza.

**CSS novo em `summary.module.css`** (adicionar ao arquivo existente, mantendo todo o CSS atual que ainda se
aplica — `barraDoPeriodo`, `chips`, `chip`, `kpi`, `kpiRotulo`, `kpiValor`, `kpiApoio`, `tituloDaSecao`,
`cartao`, `tituloDoCartao`, `avisoDaSerie`, `detalhe*`, `base*` continuam usados):

```css
/* Hero KPIs -- os tres indicadores que abrem a tela. */
.heroKpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 0 0 16px;
}

@media (max-width: 900px) {
  .heroKpis {
    grid-template-columns: 1fr;
  }
}

.heroCard {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px;
  border: 1px solid var(--ah-border-subtle);
  border-radius: var(--ah-radius-card);
  background: var(--ah-surface-raised);
}

.heroCard[data-tom] {
  background: color-mix(in srgb, currentColor 6%, var(--ah-surface-raised));
}

.heroCard[data-tom='success'] {
  color: var(--ah-state-success);
}

.heroCabecalho {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.heroRotulo {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ah-text-secondary);
}

.heroBadge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.heroBadge[data-tom='success'] {
  color: var(--ah-state-success);
  background: color-mix(in srgb, var(--ah-state-success) 12%, transparent);
}

.heroBadge[data-tom='danger'] {
  color: var(--ah-state-danger);
  background: color-mix(in srgb, var(--ah-state-danger) 12%, transparent);
}

.heroValor {
  margin: 0;
  font-size: 30px;
  line-height: 36px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ah-text-strong);
  font-variant-numeric: tabular-nums;
}

.heroCard[data-tom] .heroValor {
  color: currentColor;
}

.heroApoio {
  margin: 0;
  font-size: 12px;
  color: var(--ah-text-secondary);
}

.heroTendencia {
  margin-top: 4px;
}

/* Duas colunas de grafico -- mesmo breakpoint que duasColunas ja usava. */
.duasColunasGraficos {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 16px;
  margin: 0 0 24px;
}

@media (max-width: 1024px) {
  .duasColunasGraficos {
    grid-template-columns: 1fr;
  }
}

/* Sub-KPIs do bloco de saude do negocio. */
.subKpis {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.subKpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  border-radius: calc(var(--ah-radius-card) - 2px);
  background: var(--ah-surface-sunken);
}

.subKpi[data-tom='risk'] {
  color: var(--ah-state-risk);
}

.subKpi[data-tom] .kpiValor {
  color: currentColor;
}
```

Remover do CSS o que fica órfão: `.faixaDeKpi` reduz o número de filhos (perde os 3 promovidos), sem mudança de
regra necessária — `grid-template-columns: repeat(auto-fit, minmax(155px, 1fr))` continua válido com menos
itens. `.duasColunas` (a antiga, de `BarrasDeFaixa`) fica sem uso — remover a regra do CSS junto com a troca,
já que nenhum JSX mais referencia `estilos['duasColunas']`.

- [ ] **Step 1: Implementar as mudanças acima em `page.tsx` e `summary.module.css`**

- [ ] **Step 2: Rodar o typecheck**

Run: `pnpm --filter admin-web typecheck`
Expected: sem erro

- [ ] **Step 3: Commit**

```bash
git add "apps/admin-web/app/(protected)/billing/page.tsx" "apps/admin-web/app/(protected)/billing/summary.module.css"
git commit -m "feat: redesenha o painel financeiro com hero KPIs e graficos ricos"
```

---

### Task 6: Atualizar `page.test.tsx`

**Files:**
- Modify: `apps/admin-web/app/(protected)/billing/page.test.tsx`

**Interfaces:**
- Consumes: `PainelFinanceiroPage`, `periodosDisponiveis` de `./page` (inalterados, Task 5).

Os `data-testid` que o arquivo já usa (`recebido-no-periodo`, `alunos-ativos`, `ticket-medio`,
`faixas-da-divida`, `quebra-por-metodo`, `sem-divida`, `sem-pagamento`, `tendencia-do-recebido`,
`grafico-de-competencia`, `serie-por-competencia`, `serie-insuficiente`, `base-de-calculo`,
`novos-alunos`, `cancelamentos`, `taxa-de-churn`, `ltv`, `estornado`, `a-receber`, `vencido`,
`taxa-de-inadimplencia`, `periodo-*`) continuam válidos — nenhuma alteração é necessária nesses testes, já que
Task 5 preserva todos.

**Único ajuste necessário:** o teste "formata o rótulo do gráfico de dívidas com separador de milhar"
(linha 299-315 do arquivo original) afirma `screen.getByText('R$ 12.000,00')` dentro do elemento
`faixas-da-divida` — isso continua funcionando porque `BarrasVerticais` também publica o valor formatado na
tabela invisível E no `LabelList` (que em jsdom não renderiza, mas a tabela sim). Verificar que o texto aparece
na tabela invisível (ele aparece, porque `valorLegivel` é o mesmo texto passado).

- [ ] **Step 1: Rodar a suíte completa e conferir se algo quebrou**

Run: `pnpm --filter admin-web test -- billing/page.test`
Expected: todos os testes já existentes continuam passando sem edição, porque nenhum `data-testid` mudou de
identidade (só de posição/CSS).

Se algum teste falhar por causa da troca de `BarrasDeFaixa` → `GraficoDeRosca`/`BarrasVerticais` (ex.: um
`getByRole('table', ...)` que dependia de estrutura específica do componente antigo), ajustar o teste
correspondente para a nova asserção equivalente — mas manter o `data-testid` do wrapper (`faixas-da-divida`,
`quebra-por-metodo`) exatamente como está, porque a Task 5 já preserva esses nomes nos componentes novos.

- [ ] **Step 2: Se necessário, ajustar as asserções que dependiam de detalhe de `BarrasDeFaixa`**

Nenhuma edição de código prevista aqui a priori — este step só é executado se o Step 1 revelar quebra real.

- [ ] **Step 3: Rodar a suíte completa do admin-web**

Run: `pnpm --filter admin-web test`
Expected: PASS

- [ ] **Step 4: Rodar lint e build**

Run: `pnpm lint && pnpm typecheck && pnpm build`
Expected: sem erro

- [ ] **Step 5: Commit** (só se o Step 2 exigiu mudança de arquivo; caso contrário, pular — nada para commitar)

```bash
git add "apps/admin-web/app/(protected)/billing/page.test.tsx"
git commit -m "test: ajusta testes do painel financeiro para os graficos novos"
```

---

### Task 7: Verificar E2E e rodar gate local completo

**Files:**
- Read-only: `apps/admin-web/tests/e2e/` (grep por seletor de billing)

- [ ] **Step 1: Buscar referência à tela de billing nos testes E2E**

Run: `grep -rn "billing\|financeiro" apps/admin-web/tests/e2e --include="*.ts"`

- [ ] **Step 2: Se houver teste E2E que dependa de estrutura visual do painel (ex.: seletor CSS de
  `BarrasDeFaixa`, posição de elemento), ajustar para os `data-testid` novos/preservados.** Sem mudança
  prevista a priori — os `data-testid` centrais (`recebido-no-periodo`, `faixas-da-divida`, `quebra-por-
  metodo`) são os mesmos.

- [ ] **Step 3: Rodar o gate local completo (5 comandos raiz), per regra do projeto**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: todos verdes antes de qualquer push.

- [ ] **Step 4: Se algum E2E precisou de ajuste, commit**

```bash
git add apps/admin-web/tests/e2e
git commit -m "test: ajusta E2E do painel financeiro para os graficos novos"
```

---

## Fora de escopo (registrado, não implementar aqui)

- Modal de "fila de cobrança" (aging list detalhada, ações em massa do mockup): não pedido.
- Migração de outras telas do admin-web para `GraficoDeRosca`/`BarrasVerticais`.
- Extrair `useCoresDosTokens` para um hook compartilhado (hoje duplicado em `BarrasDeFaixa`, `SerieFinanceira`,
  `Sparkline`, e agora também `GraficoDeRosca`/`BarrasVerticais`) — YAGNI até um quarto ponto de dor real pedir.
