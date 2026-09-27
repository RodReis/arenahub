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
