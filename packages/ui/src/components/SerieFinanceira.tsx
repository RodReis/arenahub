'use client';

import { useEffect, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import { formatarDinheiro } from '../dinheiro.js';
import estilos from './SerieFinanceira.module.css';

/**
 * Duas series de dinheiro no tempo -- faturado e recebido por competencia.
 *
 * ## A AREA ENTRE AS LINHAS E A INFORMACAO
 *
 * O que o gestor pergunta nao e "quanto faturei" nem "quanto recebi", e sim
 * **quanto do que cobrei nao entrou** -- e essa e a distancia vertical entre
 * as duas curvas. Duas linhas soltas obrigariam a subtrair de cabeca a cada
 * mes; o preenchimento entre elas mostra o buraco crescendo ou fechando sem
 * nenhuma conta.
 *
 * ## Por que nao estende o `SerieDeMedidas`
 *
 * Aquele componente plota UMA medida e serve a evolucao corporal (F18).
 * Aceitar duas series mudaria a API de um componente que outra tela consome,
 * e as duas telas discordam no eixo Y -- ver abaixo.
 *
 * ## O EIXO Y COMECA EM ZERO, ao contrario do `SerieDeMedidas`
 *
 * La o zero e desperdicio: a variacao util de composicao corporal e de poucos
 * por cento, e um eixo de 0 a 90 kg achataria seis meses de trabalho.
 *
 * Aqui e o oposto. Dinheiro tem zero absoluto e a AREA comunica: cortar o eixo
 * em R$ 30.000 faria uma queda de 7% parecer despencar pela metade. Grafico de
 * receita com base cortada e a forma classica de exagerar tendencia, e o
 * painel existe para o dono decidir -- nao para impressiona-lo.
 *
 * ## Cor por PAPEL, nao por variedade
 *
 * Faturado e a expectativa (neutro-informativo); recebido e o que de fato
 * entrou (sucesso). Nao sao duas categorias equivalentes que pediriam cores
 * quaisquer -- uma e a promessa, a outra e o cumprimento.
 */

export interface PontoFinanceiro {
  /** Rotulo do eixo X. Ja formatado por quem chama (`ago/2026`). */
  readonly rotulo: string;
  readonly faturadoMinor: number;
  readonly recebidoMinor: number;
}

interface Props {
  readonly pontos: readonly PontoFinanceiro[];
  /** Descreve o grafico para quem usa leitor de tela. Obrigatorio. */
  readonly descricao: string;
  readonly testId?: string;
}

/**
 * Le a cor computada de tokens CSS.
 *
 * A DEPENDENCIA E A STRING, nao o array -- o `BarrasDeFaixa` pagou este
 * defeito antes ("Maximum update depth exceeded", grafico sem barras): o array
 * chega novo a cada render do pai, `useEffect` compara por identidade, e o
 * ciclo nunca fecha. `join()` compara o CONTEUDO.
 */
function useCoresDosTokens(tokens: readonly string[]): readonly string[] {
  const chave = tokens.join('|');

  /**
   * Estado inicial lazy: numa navegacao dentro do app o `document` ja existe,
   * entao da para resolver antes do primeiro paint e evitar o flash de cor.
   * No SSR puro o fallback e `currentColor`, visivel nos dois temas.
   */
  const [cores, setCores] = useState<readonly string[]>(() => {
    if (typeof document === 'undefined') return [];

    const estilo = getComputedStyle(document.documentElement);

    return chave.split('|').map((token) => estilo.getPropertyValue(token).trim());
  });

  useEffect(() => {
    const estilo = getComputedStyle(document.documentElement);

    setCores(chave.split('|').map((token) => estilo.getPropertyValue(token).trim()));
  }, [chave]);

  return cores;
}

export function SerieFinanceira({ pontos, descricao, testId }: Props) {
  const cores = useCoresDosTokens(['--ah-state-info', '--ah-state-success']);

  /* `currentColor` e nao hex literal -- regra 1 de lint. */
  const corFaturado = cores[0] ?? 'currentColor';
  const corRecebido = cores[1] ?? 'currentColor';

  /**
   * SEM PONTO NAO E GRAFICO VAZIO -- e uma frase.
   *
   * Eixos desenhados sem nenhuma linha parecem dado que nao carregou, e a
   * pessoa fica esperando algo que nunca vem.
   */
  if (pontos.length === 0) {
    return (
      <p className={estilos['vazio']} data-testid={testId}>
        Nenhuma competência apurada neste período.
      </p>
    );
  }

  /**
   * A DIFERENCA VAI CALCULADA NO DADO, e nao desenhada como terceira linha.
   *
   * O `Area` do Recharts precisa de um par de valores para preencher entre
   * curvas; `recebidoMinor` como base e a diferenca como altura produz
   * exatamente a faixa entre as duas linhas.
   */
  const dados = pontos.map((ponto) => ({
    rotulo: ponto.rotulo,
    faturadoMinor: ponto.faturadoMinor,
    recebidoMinor: ponto.recebidoMinor,
    /*
      Piso em zero: recebido MAIOR que faturado na competencia e possivel --
      quem paga tres meses atrasados de uma vez quita invoices de competencias
      anteriores. Sem o piso, o `Area` desenharia altura negativa e a faixa
      apareceria espelhada, sugerindo um buraco que nao existe.
    */
    naoEntrouMinor: Math.max(ponto.faturadoMinor - ponto.recebidoMinor, 0),
  }));

  return (
    <div className={estilos['area']} data-testid={testId}>
      {/*
        A TABELA INVISIVEL E A FONTE PARA LEITOR DE TELA -- `<table>` de
        verdade no DOM, nao `aria-label` no canvas. Vem ANTES do SVG de
        proposito: quem le por audio recebe os numeros em sequencia antes de
        topar com o grafico.
      */}
      <table className={estilos['somenteLeitorDeTela']}>
        <caption>{descricao}</caption>
        <thead>
          <tr>
            <th scope="col">Competência</th>
            <th scope="col">Faturado</th>
            <th scope="col">Recebido</th>
            <th scope="col">Não entrou</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((ponto) => (
            <tr key={ponto.rotulo}>
              <th scope="row">{ponto.rotulo}</th>
              <td>{formatarDinheiro(ponto.faturadoMinor)}</td>
              <td>{formatarDinheiro(ponto.recebidoMinor)}</td>
              <td>{formatarDinheiro(ponto.naoEntrouMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        `aria-hidden` NO WRAPPER e o que de fato tira o SVG da arvore de
        acessibilidade -- `accessibilityLayer={false}` apenas zera `role` e
        `tabIndex`, e sem o wrapper os `<text>` dos eixos seriam lidos, cada
        competencia anunciada duas vezes.
      */}
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart
            data={dados}
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
              `domain` COMECANDO EM ZERO -- ver o cabecalho. Base cortada num
              grafico de receita exagera tendencia.

              O eixo mostra milhares (`12k`) e nao o valor cheio: `R$ 42.950,00`
              repetido em cada tick empurraria o grafico para a direita e
              obrigaria a ler seis caracteres para comparar duas alturas. O
              valor exato mora na tabela abaixo.
            */}
            <YAxis
              domain={[0, 'auto']}
              axisLine={false}
              tickLine={false}
              width={52}
              tick={{ fill: 'currentColor', fontSize: 12 }}
              /*
                MILHARES COM UMA CASA, e a casa nao e enfeite: `Math.round`
                em `44.400` produzia `45k`, e o eixo afirmava R$ 45 mil onde ha
                R$ 44,4 mil. Num grafico de dinheiro, tick que arredonda para
                cima e o que faz alguem conferir e desconfiar da tela inteira.

                `replace` para virgula: o eixo e leitura em pt-BR, e `44.4k`
                seria lido como quarenta e quatro mil e quatrocentos... ou como
                44 mil e 4. A virgula desfaz a duvida.
              */
              tickFormatter={(valor: number) =>
                `${(valor / 100_000).toFixed(1).replace('.', ',').replace(',0', '')}k`
              }
            />
            <Legend
              verticalAlign="top"
              height={28}
              wrapperStyle={{ fontSize: 12, color: 'currentColor' }}
            />
            {/*
              A FAIXA DO QUE NAO ENTROU, empilhada sobre o recebido. Opacidade
              baixa porque ela e o CONTEXTO das duas linhas, nao um terceiro
              dado que competiria com elas.
            */}
            <Area
              type="monotone"
              dataKey="recebidoMinor"
              stackId="composicao"
              stroke="none"
              fill="none"
              legendType="none"
              isAnimationActive={false}
            />
            {/*
              A FAIXA FICA FORA DA LEGENDA (`legendType="none"`).

              Ela nao e uma terceira serie: e o ESPACO entre as duas que ja
              estao listadas. Na legenda ela aparecia com marcador de linha,
              prometendo uma curva que nao existe -- e o leitor procurava a
              terceira linha no grafico. O que a faixa significa esta dito no
              titulo do bloco e na coluna "Nao entrou" da tabela.
            */}
            <Area
              type="monotone"
              dataKey="naoEntrouMinor"
              stackId="composicao"
              stroke="none"
              fill={corFaturado}
              fillOpacity={0.12}
              legendType="none"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="faturadoMinor"
              name="Faturado"
              stroke={corFaturado}
              /*
                MAIS FINO E SEM PONTO: o faturado costuma ser constante (mesmo
                plano, mesma base), entao ele e a REGUA contra a qual se le o
                recebido -- nao um dado que disputa atencao. Com peso igual, a
                reta chapada competia com a curva que de fato conta a historia.
              */
              strokeWidth={1.5}
              strokeDasharray="6 4"
              dot={false}
              opacity={0.75}
              isAnimationActive={false}
            />
            {/*
              O RECEBIDO E SOLIDO e o faturado tracejado: um e fato consumado,
              o outro e expectativa. A textura carrega a diferenca sem depender
              de cor -- quem nao distingue as duas cores ainda le qual e qual.
            */}
            <Line
              type="monotone"
              dataKey="recebidoMinor"
              name="Recebido"
              stroke={corRecebido}
              strokeWidth={2.5}
              dot={{ r: 4, fill: corRecebido }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
