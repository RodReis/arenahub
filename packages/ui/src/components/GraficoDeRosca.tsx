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
                {dados.map((item) => (
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

        {/*
          A LEGENDA FICA FORA DA ARVORE DE ACESSIBILIDADE -- a tabela
          invisivel acima ja anuncia cada segmento. Sem este `aria-hidden`,
          o leitor de tela ouviria "PIX Automatico" duas vezes: uma pela
          tabela, outra por aqui. Mesmo defeito que `BarrasDeFaixa` ja pagou
          e documentou antes deste componente existir.
        */}
        <ul className={estilos['legenda']} aria-hidden="true">
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
