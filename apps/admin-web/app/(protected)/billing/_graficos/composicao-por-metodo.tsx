'use client';

import { formatarDinheiro } from '@arenahub/ui';
import { useEffect, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

/**
 * Rosca de composicao por metodo de pagamento -- local a tela `/billing`.
 *
 * Mesmo padrao dos graficos do design system (`SerieFinanceira`): `Cell`
 * dentro de `Pie`, `useCoresDosTokens` resolvendo token CSS, tabela sr-only
 * antes do SVG, wrapper visual e legenda `aria-hidden` (a tabela ja anuncia
 * cada segmento -- sem o `aria-hidden` na legenda, o leitor de tela leria
 * cada metodo duas vezes).
 */

interface SegmentoDeComposicao {
  readonly rotulo: string;
  readonly valorMinor: number;
  readonly percentual: number | null;
  readonly tokenDeCor: string;
}

interface Props {
  readonly segmentos: readonly SegmentoDeComposicao[];
  readonly testId?: string;
}

/**
 * Mesma implementacao de GraficoDeRosca -- a dependencia e a STRING, nao o array.
 *
 * ESTADO INICIAL SEMPRE VAZIO, nunca `lerCores(chave)` direto no `useState`:
 * o inicializador de `useState` roda tambem no PRIMEIRO render do cliente,
 * antes do `useEffect` -- e nesse momento `document` ja existe, entao
 * `lerCores` devolveria cor de verdade enquanto o HTML vindo do servidor
 * (onde `document` nao existe) saiu sem cor nenhuma. O React compara os dois
 * na hidratacao e acusa mismatch. Resolver a cor so dentro do `useEffect`
 * garante que o primeiro render do cliente reproduz exatamente o HTML do
 * servidor -- a cor real chega no re-render seguinte, de forma identica em
 * ambos os lados.
 */
function useCoresDosTokens(tokens: readonly string[]): readonly string[] {
  const chave = tokens.join('|');

  const [cores, setCores] = useState<readonly string[]>([]);

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

function valorLegivel(segmento: SegmentoDeComposicao): string {
  return segmento.percentual === null
    ? formatarDinheiro(segmento.valorMinor)
    : `${formatarDinheiro(segmento.valorMinor)} · ${String(segmento.percentual).replace('.', ',')}%`;
}

export function ComposicaoPorMetodo({ segmentos, testId }: Props) {
  const cores = useCoresDosTokens(segmentos.map((s) => s.tokenDeCor));

  const total = segmentos.reduce((soma, segmento) => soma + segmento.valorMinor, 0);

  /* SEM DADO NAO E GRAFICO VAZIO -- mesma regra de GraficoDeRosca. */
  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={testId}>
        Nenhum valor recebido no período.
      </p>
    );
  }

  /*
    SEGMENTO ZERADO SAI DO GRAFICO E DA LEGENDA -- mesma regra que
    `AgingDaDivida` aplica: uma fatia de comprimento zero na legenda parece
    dado que nao carregou, nao uma boa noticia.
  */
  const comValor = segmentos.filter((s) => s.valorMinor > 0);
  const dados = comValor.map((s) => ({ nome: s.rotulo, valor: s.valorMinor }));

  return (
    <div>
      <table className="sr-only">
        <caption>Valor recebido por forma de pagamento</caption>
        <tbody>
          {comValor.map((segmento) => (
            <tr key={segmento.rotulo}>
              <th scope="row">{segmento.rotulo}</th>
              <td>{valorLegivel(segmento)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div {...(testId ? { 'data-testid': testId } : {})} aria-hidden="true">
        <div className="relative size-40">
          {/* Total no miolo da rosca: a pergunta "quanto entrou" se responde sem ler a legenda. */}
          <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Recebido
            </span>
            <span className="text-sm font-semibold tabular-nums">{formatarDinheiro(total)}</span>
          </div>
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
              {dados.map((item) => (
                <Cell
                  key={item.nome}
                  fill={cores[segmentos.findIndex((s) => s.rotulo === item.nome)] ?? 'currentColor'}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        </div>

        {/* Legenda visual -- fora da arvore de acessibilidade, ver comentario do doc do componente. */}
        <ul className="mt-2 space-y-1 text-xs">
          {comValor.map((segmento) => (
            <li key={segmento.rotulo} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 shrink-0 rounded-full"
                style={{ background: cores[segmentos.findIndex((s) => s.rotulo === segmento.rotulo)] ?? 'currentColor' }}
              />
              <span>{segmento.rotulo}</span>
              <span className="text-muted-foreground">{valorLegivel(segmento)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
