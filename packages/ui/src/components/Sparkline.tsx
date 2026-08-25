'use client';

import { useEffect, useState } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';

import estilos from './Sparkline.module.css';

/**
 * Linha minima ao lado de um numero -- para onde ele vem, sem ocupar espaco.
 *
 * ## O QUE ELE NAO E
 *
 * Nao e grafico. Sem eixo, sem grade, sem rotulo e sem valor legivel: quem
 * precisa do numero exato le o KPI gigante ao lado, e quem precisa da serie
 * inteira desce ate o grafico de competencia. O sparkline responde UMA
 * pergunta -- "este numero vinha subindo ou caindo?" -- e nada mais.
 *
 * Acrescentar eixo aqui o transformaria num grafico pequeno demais para ser
 * lido, que e o pior dos dois mundos.
 *
 * ## `aria-hidden` SEM ALTERNATIVA TEXTUAL, e e correto
 *
 * O padrao dos outros graficos do DS e tabela invisivel antes do SVG. Aqui
 * NAO: a serie que o sparkline desenha ja esta publicada na tabela do bloco de
 * competencia, na mesma pagina. Repeti-la faria o leitor de tela anunciar os
 * mesmos doze meses duas vezes -- ruido, nao acessibilidade.
 *
 * Ele e ilustracao de um numero que ja e lido. Por isso `aria-hidden` puro.
 */

interface Props {
  /** Valores em ordem cronologica. Menos de dois pontos nao desenha nada. */
  readonly valores: readonly number[];
  /** Token semantico do DS para a cor da linha. Sem hex literal (regra 1). */
  readonly tokenDeCor?: string;
  readonly testId?: string;
}

/**
 * Le a cor computada de um token CSS.
 *
 * A dependencia e a STRING e nao o array -- o `BarrasDeFaixa` ja pagou o
 * defeito do array novo a cada render ("Maximum update depth exceeded").
 */
function useCorDoToken(token: string): string {
  const [cor, setCor] = useState<string>(() => {
    if (typeof document === 'undefined') return '';

    return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  });

  useEffect(() => {
    setCor(getComputedStyle(document.documentElement).getPropertyValue(token).trim());
  }, [token]);

  return cor;
}

export function Sparkline({ valores, tokenDeCor = '--ah-state-success', testId }: Props) {
  const cor = useCorDoToken(tokenDeCor);

  /**
   * UM PONTO NAO E TENDENCIA, e desenhar um traco reto afirmaria estabilidade
   * que ninguem mediu. Abaixo de dois valores, nada e desenhado -- o KPI ao
   * lado continua inteiro, so sem a ilustracao.
   */
  if (valores.length < 2) return null;

  const dados = valores.map((valor, indice) => ({ indice, valor }));

  return (
    <div className={estilos['sparkline']} aria-hidden="true" data-testid={testId}>
      <ResponsiveContainer width="100%" height={32}>
        <LineChart data={dados} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <Line
            type="monotone"
            dataKey="valor"
            stroke={cor === '' ? 'currentColor' : cor}
            strokeWidth={1.5}
            /* Sem ponto: em 32px de altura os circulos viram uma linha grossa. */
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
