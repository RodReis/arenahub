'use client';

import { useEffect, useState } from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import estilos from './BarrasDeFaixa.module.css';

/**
 * Barras horizontais de composicao -- quanto de um total cabe em cada faixa.
 *
 * ## Por que horizontal, e nao vertical
 *
 * O rotulo de cada faixa e uma frase ("16 a 30 dias"), nao um numero. Em
 * barras verticais essas frases giram 45 graus ou somem em reticencias --
 * ambos obrigam a pessoa a decodificar antes de ler. Deitadas, o rotulo fica
 * na horizontal, onde se le.
 *
 * ## Por que nao ha eixo de valor
 *
 * A pergunta desta forma e "qual pedaco e maior", nao "quanto exatamente" --
 * o valor exato vai escrito na propria linha, que responde melhor que uma
 * regua embaixo. Grade e ticks aqui seriam tinta sem informacao.
 *
 * ## Cor por SEVERIDADE, nao por variedade
 *
 * Cada faixa carrega um token de estado (`--ah-state-*`), e a escala vai de
 * atencao a perigo conforme o atraso cresce. Uma paleta categorica -- azul,
 * roxo, verde -- diria que as faixas sao apenas diferentes, quando na verdade
 * sao piores.
 */

export interface FaixaDeBarra {
  readonly rotulo: string;
  readonly valor: number;
  /** Token semantico do DS. Sem hex literal -- regra 1 de lint. */
  readonly tokenDeCor: string;
  /** O que aparece na ponta da barra. Ja formatado por quem chama. */
  readonly valorLegivel: string;
}

interface Props {
  readonly faixas: readonly FaixaDeBarra[];
  /** Descreve o grafico para quem usa leitor de tela. Obrigatorio. */
  readonly descricao: string;
  readonly testId?: string;
}

/**
 * Le a cor computada de uma lista de tokens CSS.
 *
 * O SVG do Recharts nao aceita `var(--token)` em `fill` de forma confiavel
 * entre navegadores, entao resolvemos o valor uma vez, no cliente. Fica em
 * efeito e nao no corpo do componente porque `getComputedStyle` nao existe no
 * servidor -- e esta arvore renderiza no servidor primeiro.
 *
 * ## A dependencia e a STRING, nao o array
 *
 * DEFEITO REAL, visto no navegador antes de existir teste: com `[tokens]` na
 * lista de dependencias, o efeito disparava a cada render. O array chega novo
 * de um `.map()` no componente pai, e `useEffect` compara por identidade --
 * entao `setCores` agendava outro render, que recriava o array, que disparava
 * o efeito. O React cortou em "Maximum update depth exceeded" e o grafico
 * ficou SEM BARRAS, so com os rotulos.
 *
 * `tokens.join()` compara o CONTEUDO. Trocar `--ah-state-danger` por outro
 * token muda a string e o efeito roda; um array novo com os mesmos tokens
 * nao muda nada, que e o comportamento correto.
 */
function useCoresDosTokens(tokens: readonly string[]): readonly string[] {
  const [cores, setCores] = useState<readonly string[]>([]);
  const chave = tokens.join('|');

  useEffect(() => {
    const estilo = getComputedStyle(document.documentElement);

    setCores(chave.split('|').map((token) => estilo.getPropertyValue(token).trim()));
  }, [chave]);

  return cores;
}

export function BarrasDeFaixa({ faixas, descricao, testId }: Props) {
  const cores = useCoresDosTokens(faixas.map((f) => f.tokenDeCor));

  const total = faixas.reduce((soma, faixa) => soma + faixa.valor, 0);

  /**
   * FAIXA ZERADA SAI DO GRAFICO, mas continua na tabela do leitor de tela.
   *
   * Visto na tela: com duas faixas em zero, o grafico reservava a altura das
   * quatro e sobravam dois rotulos flutuando sem barra -- pareciam dado que
   * nao carregou. "Nao ha divida de mais de 30 dias" e uma boa noticia, e boa
   * noticia nao precisa de linha propria num grafico de risco.
   *
   * Quem le por audio continua recebendo as quatro, com os zeros: ali a
   * ausencia E informacao, porque a pessoa nao ve o conjunto de uma vez.
   */
  const comValor = faixas.filter((faixa) => faixa.valor > 0);

  /**
   * SEM DADO NAO E GRAFICO VAZIO -- e uma frase. Um eixo com barras de largura
   * zero parece defeito de carregamento, e a pessoa fica esperando.
   */
  if (total === 0) {
    return (
      <p className={estilos['vazio']} data-testid={testId}>
        Nada em atraso agora.
      </p>
    );
  }

  return (
    <div className={estilos['area']} data-testid={testId}>
      {/*
        A TABELA INVISIVEL E A FONTE PARA LEITOR DE TELA. O `accessibilityLayer`
        do Recharts navega por teclado, mas quem le por audio precisa dos
        numeros em sequencia -- e uma tabela diz "faixa X: valor Y" muito
        melhor que um SVG anunciando pontos.
      */}
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

      <ResponsiveContainer width="100%" height={comValor.length * 48}>
        <BarChart
          data={comValor}
          layout="vertical"
          margin={{ top: 0, right: 96, bottom: 0, left: 0 }}
          /* O SVG some para o leitor de tela: a tabela acima ja o descreve. */
          accessibilityLayer={false}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="rotulo"
            axisLine={false}
            tickLine={false}
            width={104}
            tick={{ fontSize: 12, fill: 'currentColor' }}
          />
          <Bar
            dataKey="valor"
            radius={[0, 4, 4, 0]}
            /*
              `'auto'` respeita `prefers-reduced-motion` sozinho, sem media
              query nossa -- comportamento do Recharts 3.
            */
            isAnimationActive="auto"
            animationDuration={520}
          >
            {comValor.map((faixa) => (
              <Cell
                key={faixa.rotulo}
                fill={cores[faixas.indexOf(faixa)] ?? 'currentColor'}
              />
            ))}
            {/*
              `dataKey` aponta para o texto JA FORMATADO por quem chama -- o
              componente nao sabe se o numero e dinheiro, contagem ou
              percentual, e adivinhar aqui produziria "12990" onde se espera
              "R$ 129,90".
            */}
            <LabelList
              dataKey="valorLegivel"
              position="right"
              fill="currentColor"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
