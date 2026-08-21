'use client';

import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import estilos from './SerieDeMedidas.module.css';

/**
 * Serie temporal de UMA medida corporal (F18, Slice 3.2).
 *
 * ## Por que linha, e nao barras
 *
 * A pergunta aqui e "para onde isto esta indo", nao "qual pedaco e maior".
 * Peso ao longo de seis meses e uma trajetoria: a inclinacao entre dois
 * pontos E a informacao, e barras a escondem atras de alturas absolutas.
 *
 * ## O eixo Y NAO comeca em zero
 *
 * Deliberado, e o contrario do que se ensina para barras. A variacao util de
 * composicao corporal e de poucos por cento: um eixo de 0 a 90 kg achataria
 * seis meses de trabalho numa linha reta. Barra exige base zero porque a AREA
 * comunica; linha comunica INCLINACAO, e o zero so gasta altura.
 *
 * ## AUSENCIA E LACUNA, NUNCA ZERO (INV-104, `M3-AC-004`)
 *
 * Uma avaliacao que nao mediu este tipo simplesmente NAO tem ponto. O
 * componente recebe apenas os pontos que existem -- quem chama ja filtrou --
 * e `connectNulls` fica FALSO para que um buraco de tres meses apareca como
 * buraco. Ligar os pontos por cima da lacuna desenharia uma evolucao que
 * ninguem mediu.
 */

export interface PontoDaSerie {
  /** Instante da MEDICAO, ja formatado por quem chama. */
  readonly rotulo: string;
  readonly valor: number;
  /** Valor com unidade, para a tabela do leitor de tela. */
  readonly valorLegivel: string;
}

interface Props {
  readonly pontos: readonly PontoDaSerie[];
  /** Descreve o grafico para quem usa leitor de tela. Obrigatorio. */
  readonly descricao: string;
  /** Alvo da meta ativa, quando existe. Vira linha de referencia. */
  readonly meta?: { readonly valor: number; readonly rotulo: string } | undefined;
  readonly testId?: string;
}

/**
 * Le a cor computada de tokens CSS.
 *
 * O SVG do Recharts nao aceita `var(--token)` em `stroke` de forma confiavel
 * entre navegadores, entao resolvemos o valor uma vez, no cliente. Fica em
 * efeito porque `getComputedStyle` nao existe no servidor -- e esta arvore
 * renderiza no servidor primeiro.
 *
 * A dependencia e a STRING, nao o array: com `[tokens]`, o array novo de cada
 * `.map()` do pai dispararia o efeito a cada render, e o `BarrasDeFaixa` ja
 * pagou esse defeito ("Maximum update depth exceeded", grafico sem barras).
 */
function useCoresDosTokens(tokens: readonly string[]): readonly string[] {
  const chave = tokens.join('|');
  const [cores, setCores] = useState<readonly string[]>([]);

  useEffect(() => {
    const estilo = getComputedStyle(document.documentElement);

    setCores(chave.split('|').map((token) => estilo.getPropertyValue(token).trim()));
  }, [chave]);

  return cores;
}

export function SerieDeMedidas({ pontos, descricao, meta, testId }: Props) {
  const cores = useCoresDosTokens(['--ah-state-info', '--ah-state-success']);

  /*
    `currentColor` como fallback e nao um hex literal (regra 1 de lint): no
    primeiro render o efeito ainda nao rodou, e a linha herda a cor do texto
    -- visivel nos dois temas -- ate o token resolver.
  */
  const corDaLinha = cores[0] ?? 'currentColor';
  const corDaMeta = cores[1] ?? 'currentColor';

  /**
   * SEM PONTO NAO E GRAFICO VAZIO -- e uma frase.
   *
   * Eixos desenhados sem nenhuma linha parecem dado que nao carregou, e a
   * pessoa fica esperando algo que nunca vem.
   */
  if (pontos.length === 0) {
    return (
      <p className={estilos['vazio']} data-testid={testId}>
        Nenhuma medição publicada neste período.
      </p>
    );
  }

  /**
   * UM PONTO NAO E LINHA, mas continua sendo informacao.
   *
   * A primeira avaliacao do aluno nao tem tendencia -- e dizer "sem dados"
   * seria mentira, o dado existe. O grafico desenha o ponto isolado, e a
   * tabela abaixo carrega o numero.
   */
  return (
    <div className={estilos['area']} data-testid={testId}>
      {/*
        A TABELA INVISIVEL E A FONTE PARA LEITOR DE TELA -- `<table>` de
        verdade no DOM, nao `aria-label` no canvas (contrato
        `ChartWithTableProps`, MVP-03 secao 10).

        Ela vem ANTES do SVG de proposito: quem le por audio recebe os numeros
        em sequencia antes de topar com o grafico.
      */}
      <table className={estilos['somenteLeitorDeTela']}>
        <caption>{descricao}</caption>
        <tbody>
          {pontos.map((ponto) => (
            <tr key={ponto.rotulo}>
              <th scope="row">{ponto.rotulo}</th>
              <td>{ponto.valorLegivel}</td>
            </tr>
          ))}
          {meta !== undefined ? (
            <tr>
              <th scope="row">Meta</th>
              <td>{meta.rotulo}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/*
        `aria-hidden` NO WRAPPER e o que de fato tira o SVG da arvore de
        acessibilidade. `accessibilityLayer={false}` apenas zera `role` e
        `tabIndex` (verificado na fonte do recharts 3.10.1) -- sem o wrapper,
        os `<text>` dos eixos continuariam sendo lidos, e cada medicao seria
        anunciada DUAS vezes.
      */}
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={[...pontos]}
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
            <XAxis
              dataKey="rotulo"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'currentColor', fontSize: 12 }}
            />
            {/*
              `domain` automatico com folga: a variacao util e de poucos por
              cento, e forcar o zero achataria a trajetoria (ver cabecalho).
            */}
            <YAxis
              domain={['auto', 'auto']}
              axisLine={false}
              tickLine={false}
              width={48}
              tick={{ fill: 'currentColor', fontSize: 12 }}
            />
            {meta !== undefined ? (
              <ReferenceLine
                y={meta.valor}
                stroke={corDaMeta}
                strokeDasharray="6 4"
                strokeWidth={2}
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="valor"
              stroke={corDaLinha}
              strokeWidth={2}
              dot={{ r: 4, fill: corDaLinha }}
              /* LACUNA CONTINUA LACUNA: ver o cabecalho (INV-104). */
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
