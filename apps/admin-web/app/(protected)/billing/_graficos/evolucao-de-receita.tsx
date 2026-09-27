'use client';

import { formatarDinheiro } from '@arenahub/ui';
import { useEffect, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Evolucao de receita (faturado x recebido) por competencia -- local a tela
 * `/billing`.
 *
 * Mesmo padrao de `packages/ui/src/components/SerieFinanceira.tsx`:
 * `useCoresDosTokens` via `getComputedStyle`, eixo Y comecando em zero
 * (dinheiro nao corta base), tabela sr-only antes do SVG, wrapper
 * `aria-hidden`. O gradiente da area de recebido usa `<defs><linearGradient>`
 * do Recharts -- o `SerieFinanceira` usa linha solida sem gradiente; aqui o
 * brief pede a versao com area preenchida em degrade.
 */

interface PontoDeReceita {
  readonly rotulo: string;
  readonly faturadoMinor: number;
  readonly recebidoMinor: number;
}

interface Props {
  readonly pontos: readonly PontoDeReceita[];
  readonly testId?: string;
}

const MINIMO_DE_PONTOS_PARA_TENDENCIA = 3;

/** Mesma implementacao de SerieFinanceira -- a dependencia e a STRING, nao o array. */
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

export function EvolucaoDeReceita({ pontos, testId }: Props) {
  const cores = useCoresDosTokens(['--ah-state-info', '--ah-state-success']);
  const corFaturado = cores[0] ?? 'currentColor';
  const corRecebido = cores[1] ?? 'currentColor';

  /* SEM PONTO NAO E GRAFICO VAZIO -- mesma regra de SerieFinanceira. */
  if (pontos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={testId}>
        Nenhuma competência apurada neste período.
      </p>
    );
  }

  /*
    SERIE CURTA NAO VIRA GRAFICO DE TENDENCIA (mesma regra ja aplicada na
    tela atual, `SPEC-054` §5.1): com 1 ou 2 pontos a reta sempre parece
    tendencia. O aviso textual substitui o grafico em vez de acompanha-lo --
    um eixo desenhado com uma linha sem historico e tao enganoso quanto a
    propria linha.
  */
  if (pontos.length < MINIMO_DE_PONTOS_PARA_TENDENCIA) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={testId}>
        Dado insuficiente para comparar períodos:{' '}
        {pontos.length === 1 ? 'há uma competência apurada' : `há ${pontos.length} competências apuradas`}, e a
        comparação de tendência exige pelo menos três.
      </p>
    );
  }

  const dados = pontos.map((ponto) => ({
    rotulo: ponto.rotulo,
    faturadoMinor: ponto.faturadoMinor,
    recebidoMinor: ponto.recebidoMinor,
  }));

  return (
    <div>
      <table className="sr-only">
        <caption>Valor faturado e recebido por mês de competência</caption>
        <thead>
          <tr>
            <th scope="col">Competência</th>
            <th scope="col">Faturado</th>
            <th scope="col">Recebido</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((ponto) => (
            <tr key={ponto.rotulo}>
              <th scope="row">{ponto.rotulo}</th>
              <td>{formatarDinheiro(ponto.faturadoMinor)}</td>
              <td>{formatarDinheiro(ponto.recebidoMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div aria-hidden="true" {...(testId ? { 'data-testid': testId } : {})} className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dados} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} accessibilityLayer={false}>
            <defs>
              {/* Gradiente SO na area de recebido -- faturado fica so como linha de referencia. */}
              <linearGradient id="gradienteRecebido" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={corRecebido} stopOpacity={0.35} />
                <stop offset="100%" stopColor={corRecebido} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
            <XAxis
              dataKey="rotulo"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'currentColor', fontSize: 12 }}
            />
            {/* Eixo comeca em zero -- dinheiro tem zero absoluto, base cortada exagera tendencia. */}
            <YAxis
              domain={[0, 'auto']}
              axisLine={false}
              tickLine={false}
              width={52}
              tick={{ fill: 'currentColor', fontSize: 12 }}
              tickFormatter={(valor: number) =>
                `${(valor / 100_000).toFixed(1).replace('.', ',').replace(',0', '')}k`
              }
            />
            <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12, color: 'currentColor' }} />
            <Area
              type="monotone"
              dataKey="recebidoMinor"
              name="Recebido"
              stroke={corRecebido}
              strokeWidth={2.5}
              fill="url(#gradienteRecebido)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="faturadoMinor"
              name="Faturado"
              stroke={corFaturado}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              fill="none"
              opacity={0.75}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
