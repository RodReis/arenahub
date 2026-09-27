'use client';

import { formatarDinheiro } from '@arenahub/ui';
import { useEffect, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';

/**
 * Barras horizontais de aging da divida -- local a tela `/billing`
 * (task 9 monta esta tela; este componente e puro de apresentacao).
 *
 * Mesmo padrao de `packages/ui/src/components/BarrasVerticais.tsx`:
 * `Cell` dentro de `Bar` para cor por item, `useCoresDosTokens` resolvendo
 * token CSS via `getComputedStyle`, tabela sr-only para leitor de tela,
 * wrapper visual `aria-hidden`.
 */

interface FaixaDeAging {
  readonly rotulo: string;
  readonly valorMinor: number;
  readonly tokenDeCor: string;
}

interface Props {
  readonly faixas: readonly FaixaDeAging[];
  readonly testId?: string;
}

/** Mesma implementacao de BarrasVerticais -- a dependencia e a STRING, nao o array. */
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

export function AgingDaDivida({ faixas, testId }: Props) {
  const cores = useCoresDosTokens(faixas.map((f) => f.tokenDeCor));

  /*
    FAIXA ZERADA SAI DO GRAFICO E DA TABELA -- mesma regra de
    `BarrasVerticais.prepararColunas`. Uma barra de comprimento zero com "R$
    0,00" no rotulo parece dado que nao carregou, nao uma boa noticia.
  */
  const comValor = faixas.filter((f) => f.valorMinor > 0);

  if (comValor.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={testId}>
        Nenhuma dívida em aberto no período.
      </p>
    );
  }

  const dados = comValor.map((f) => ({ rotulo: f.rotulo, valor: f.valorMinor / 100 }));

  return (
    <div>
      <table className="sr-only">
        <caption>Valor vencido por faixa de tempo</caption>
        <tbody>
          {comValor.map((f) => (
            <tr key={f.rotulo}>
              <th scope="row">{f.rotulo}</th>
              <td>{formatarDinheiro(f.valorMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div aria-hidden="true" {...(testId ? { 'data-testid': testId } : {})} className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} layout="vertical" accessibilityLayer={false}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="rotulo"
              width={104}
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'currentColor', fontSize: 12 }}
            />
            <Bar dataKey="valor" radius={4} isAnimationActive={false}>
              {/*
                COR PELO ROTULO, nao pelo indice de `dados`: `dados` e
                FILTRADO (sem as faixas zeradas), entao o indice dele nao bate
                mais com o indice de `faixas`/`cores`, que inclui todas.
              */}
              {dados.map((item) => (
                <Cell
                  key={item.rotulo}
                  fill={cores[faixas.findIndex((f) => f.rotulo === item.rotulo)] ?? 'currentColor'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
