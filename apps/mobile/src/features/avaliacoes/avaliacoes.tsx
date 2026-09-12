import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { Ausente } from '../../ui/Ausente.js';
import { AvisoDeIA } from '../../ui/AvisoDeIA.js';
import { Card } from '../../ui/Card.js';
import { useTema } from '../../ui/theme.js';

export const PERIODOS = ['30D', '90D', '6M', '1Y'] as const;

export type Periodo = (typeof PERIODOS)[number];

/** Rotulo de cada periodo -- DS-APP §3.5 fixa `30D · 90D · 6M · 1A`. */
const ROTULO_DO_PERIODO: Record<Periodo, string> = {
  '30D': '30D',
  '90D': '90D',
  '6M': '6M',
  '1Y': '1A',
};

/**
 * O que cada tipo de medida se chama para o aluno.
 *
 * O BACKEND MANDA O ENUM E A TELA TRADUZ, como em `plano.tsx`. Tipo que a
 * tela nao conhece aparece com o proprio codigo: e feio, e melhor que sumir
 * com uma medida que o aluno pagou para fazer.
 */
const NOME_DO_TIPO: Record<string, string> = {
  WEIGHT: 'Peso',
  BODY_FAT_PERCENT: 'Gordura corporal',
  MUSCLE_MASS: 'Massa muscular',
  BMI: 'IMC',
  WAIST: 'Cintura',
  HIP: 'Quadril',
  CHEST: 'Tórax',
  ARM: 'Braço',
  THIGH: 'Coxa',
};

/** Como a unidade aparece ao lado do numero. */
const SIMBOLO_DA_UNIDADE: Record<string, string> = {
  KG: 'kg',
  G: 'g',
  LB: 'lb',
  CM: 'cm',
  M: 'm',
  IN: 'in',
  PERCENT: '%',
  KCAL: 'kcal',
  L: 'L',
};

export interface PontoDoHistorico {
  readonly avaliacaoId: string;
  readonly medidaEm: string;
  readonly valor: number;
}

export interface SerieDoHistorico {
  readonly tipo: string;
  readonly unidade: string | null;
  readonly pontos: readonly PontoDoHistorico[];
  readonly meta: { readonly alvo: number; readonly prazo: string } | null;
}

/**
 * O que a tela usa da analise assistiva.
 *
 * SUBCONJUNTO do contrato do backend, de proposito: o app exibe a leitura em
 * prosa e os pontos, e o resto (`trends`, `suppressedFindings`,
 * `analysisBlocked`) e material do painel. Declarar o contrato inteiro aqui
 * obrigaria a mexer nesta tela a cada campo novo que o profissional usa.
 */
export interface AnaliseDoAluno {
  readonly summary: string;
  readonly positivePoints: readonly string[];
  readonly attentionPoints: readonly string[];
  readonly questionsForProfessional: readonly string[];
  readonly disclaimerCode: string;
}

export interface DadosDasAvaliacoes {
  readonly asOf: string;
  readonly periodo: string;
  readonly series: readonly SerieDoHistorico[];
  readonly analise: {
    readonly geradaEm: string;
    readonly analise: AnaliseDoAluno;
    readonly model: string;
    readonly promptVersion: string;
  } | null;
}

/** `2026-10-01T...` -> `01/10`, em UTC. Ano nao cabe no eixo. */
function diaEMes(iso: string): string {
  const data = new Date(iso);

  return `${data.getUTCDate().toString().padStart(2, '0')}/${(data.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}`;
}

/**
 * `78.2` -> `78,2 kg`. Uma casa decimal, virgula de pt-BR.
 *
 * FORMATADO A MAO, e nao com `toLocaleString`: a regra 5 da lint barra
 * `Intl`/`toLocale*` na superficie inteira, e ela esta certa -- o formatador
 * do dispositivo segue o idioma do CELULAR, e um aluno com o aparelho em
 * ingles veria `78.2` numa tela que escreve virgula em todo o resto.
 */
function formatarValor(valor: number, unidade: string | null): string {
  const numero = valor.toFixed(1).replace('.', ',');

  return unidade === null ? numero : `${numero} ${SIMBOLO_DA_UNIDADE[unidade] ?? unidade}`;
}

export function Avaliacoes({
  dados,
  periodo,
  onPeriodo,
  testID,
}: {
  dados: DadosDasAvaliacoes;
  periodo: Periodo;
  onPeriodo: (periodo: Periodo) => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  return (
    <View style={estilos.pilha} testID={testID}>
      <View style={estilos.chips} accessibilityRole="tablist">
        {PERIODOS.map((opcao) => {
          const ativo = opcao === periodo;

          return (
            <Pressable
              key={opcao}
              onPress={() => onPeriodo(opcao)}
              accessibilityRole="tab"
              accessibilityState={{ selected: ativo }}
              accessibilityLabel={`Período ${ROTULO_DO_PERIODO[opcao]}`}
              testID={`${testID ?? 'avaliacoes'}-periodo-${opcao}`}
              style={[
                estilos.chip,
                {
                  backgroundColor: ativo ? t.cor.accent.solid : t.cor.bg.app,
                  borderColor: ativo ? t.cor.accent.solid : t.cor.border.hairline,
                },
              ]}
            >
              <Text
                style={{
                  color: ativo ? t.cor.accent.onAccent : t.cor.text.secondary,
                  fontSize: 12,
                  fontWeight: '600',
                }}
              >
                {ROTULO_DO_PERIODO[opcao]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {dados.series.length === 0 ? (
        <Ausente
          motivo="Nenhuma avaliação no período. Quando você fizer uma na recepção, ela aparece aqui."
          testID={`${testID ?? 'avaliacoes'}-vazio`}
        />
      ) : (
        dados.series.map((serie) => (
          <SerieMedida key={serie.tipo} serie={serie} testID={`${testID ?? 'avaliacoes'}-serie`} />
        ))
      )}

      {dados.analise !== null && (
        <AnaliseAssistiva
          analise={dados.analise.analise}
          geradaEm={dados.analise.geradaEm}
          model={dados.analise.model}
          promptVersion={dados.analise.promptVersion}
          testID={`${testID ?? 'avaliacoes'}-analise`}
        />
      )}
    </View>
  );
}

/**
 * Leitura assistiva do periodo -- `M4-FR-012`.
 *
 * O AVISO NAO E DISPENSAVEL e vem PRIMEIRO, antes do texto: o `AvisoDeIA` tem
 * `dismissible: false` no contrato (`packages/ui`), e a regra de arquitetura
 * no 8 exige que toda saida de IA carregue o `NOT_MEDICAL_DIAGNOSIS`. Aviso
 * embaixo de tres paragrafos e aviso que o aluno le depois de ja ter
 * interpretado o texto como laudo.
 *
 * So chega aqui analise ja ENDOSSADA por um profissional -- quem filtra e o
 * backend (`ultimaPublicada`), nao esta tela.
 */
function AnaliseAssistiva({
  analise,
  geradaEm,
  model,
  promptVersion,
  testID,
}: {
  analise: AnaliseDoAluno;
  geradaEm: string;
  model: string;
  promptVersion: string;
  testID: string;
}) {
  const t = useTema();

  const blocos: { titulo: string; itens: readonly string[] }[] = [
    { titulo: 'Pontos positivos', itens: analise.positivePoints },
    { titulo: 'Pontos de atenção', itens: analise.attentionPoints },
    { titulo: 'Para perguntar na próxima avaliação', itens: analise.questionsForProfessional },
  ];

  return (
    <Card testID={testID}>
      <AvisoDeIA modelVersion={model} promptVersion={promptVersion} testID={`${testID}-aviso`} />

      <Text
        style={{
          color: t.cor.text.primary,
          fontSize: t.type.body.size,
          lineHeight: t.type.body.lineHeight,
          marginTop: 12,
        }}
      >
        {analise.summary}
      </Text>

      {blocos
        .filter((bloco) => bloco.itens.length > 0)
        .map((bloco) => (
          <View key={bloco.titulo} style={estilos.bloco}>
            <Text style={{ color: t.cor.accent.text, fontSize: 12, fontWeight: '700' }}>
              {bloco.titulo}
            </Text>
            {bloco.itens.map((item) => (
              <Text
                key={item}
                style={{
                  color: t.cor.text.secondary,
                  fontSize: t.type.body.size,
                  lineHeight: t.type.body.lineHeight,
                }}
              >
                {item}
              </Text>
            ))}
          </View>
        ))}

      <Text style={{ color: t.cor.text.muted, fontSize: 11, marginTop: 12 }}>
        Leitura gerada em {diaEMes(geradaEm)} e revisada por um profissional.
      </Text>
    </Card>
  );
}

/**
 * Uma medida: grafico e tabela do MESMO dado.
 *
 * A tabela nao e um extra de acessibilidade -- e o conteudo equivalente que o
 * `ChartWithTableProps` exige (`packages/ui`): leitor de tela nao le
 * `Polyline`, e o `M4-NFR-007` pede pratica equivalente a WCAG. Quem nao
 * enxerga o grafico le os mesmos numeros, nao um resumo deles.
 */
function SerieMedida({ serie, testID }: { serie: SerieDoHistorico; testID: string }) {
  const t = useTema();
  const [mostrandoTabela, setMostrandoTabela] = useState(false);

  const nome = NOME_DO_TIPO[serie.tipo] ?? serie.tipo;

  return (
    <Card testID={`${testID}-${serie.tipo}`}>
      <View style={estilos.cabecalho}>
        <Text
          style={{
            color: t.cor.text.primary,
            fontSize: t.type.cardTitle.size,
            lineHeight: t.type.cardTitle.lineHeight,
            fontWeight: '600',
          }}
        >
          {nome}
        </Text>

        <Pressable
          onPress={() => setMostrandoTabela((atual) => !atual)}
          accessibilityRole="button"
          accessibilityLabel={
            mostrandoTabela ? `Ver gráfico de ${nome}` : `Ver tabela de ${nome}`
          }
          testID={`${testID}-${serie.tipo}-alternar`}
        >
          <Text style={{ color: t.cor.accent.text, fontSize: 13, fontWeight: '600' }}>
            {mostrandoTabela ? 'Ver gráfico' : 'Ver tabela'}
          </Text>
        </Pressable>
      </View>

      {mostrandoTabela ? (
        <TabelaDaSerie serie={serie} testID={`${testID}-${serie.tipo}-tabela`} />
      ) : (
        <GraficoDaSerie serie={serie} testID={`${testID}-${serie.tipo}-grafico`} />
      )}
    </Card>
  );
}

/** Largura util do SVG -- DS-APP §4.11 fixa 300 × 130 (x: 8–292, y: 18–112). */
const LARGURA = 300;
const ALTURA = 130;
const X_MIN = 8;
const X_MAX = 292;
const Y_MIN = 18;
const Y_MAX = 112;

function GraficoDaSerie({ serie, testID }: { serie: SerieDoHistorico; testID: string }) {
  const t = useTema();

  const valores = serie.pontos.map((p) => p.valor);
  const menor = Math.min(...valores);
  const maior = Math.max(...valores);

  /*
   * Eixo escalado ao MIN/MAX do periodo, e nao ao zero (DS-APP §4.11): a
   * variacao de peso de um aluno e pequena perto do valor absoluto, e comecar
   * no zero achataria a curva ate ela nao dizer nada.
   *
   * `maior === menor` (um ponto so, ou todos iguais) daria divisao por zero e
   * a linha sumiria: nesse caso a serie desenha no meio da area util.
   */
  const amplitude = maior - menor;

  const emX = (indice: number): number =>
    serie.pontos.length === 1
      ? (X_MIN + X_MAX) / 2
      : X_MIN + (indice / (serie.pontos.length - 1)) * (X_MAX - X_MIN);

  const emY = (valor: number): number =>
    amplitude === 0 ? (Y_MIN + Y_MAX) / 2 : Y_MAX - ((valor - menor) / amplitude) * (Y_MAX - Y_MIN);

  const pontos = serie.pontos.map((p, i) => `${emX(i)},${emY(p.valor)}`).join(' ');
  const ultimo = serie.pontos[serie.pontos.length - 1];

  return (
    <View style={estilos.grafico} testID={testID}>
      {/*
       * O SVG inteiro fica FORA da arvore de acessibilidade: quem usa leitor
       * de tela recebe os numeros pela tabela, e um `Polyline` anunciado como
       * "imagem" so atrapalharia. O botao de alternar e que da o caminho.
       */}
      <Svg width={LARGURA} height={ALTURA} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[Y_MIN, (Y_MIN + Y_MAX) / 2, Y_MAX].map((y) => (
          <Line
            key={y}
            x1={X_MIN}
            y1={y}
            x2={X_MAX}
            y2={y}
            stroke={t.cor.border.default}
            strokeWidth={1}
            opacity={0.35}
          />
        ))}

        <Polyline
          points={pontos}
          fill="none"
          stroke={t.cor.accent.text}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {ultimo !== undefined && (
          <Circle
            cx={emX(serie.pontos.length - 1)}
            cy={emY(ultimo.valor)}
            r={4}
            fill={t.cor.accent.text}
          />
        )}
      </Svg>

      <View style={estilos.extremos}>
        <Text style={{ color: t.cor.text.muted, fontSize: 12 }}>
          {serie.pontos[0] === undefined ? '' : diaEMes(serie.pontos[0].medidaEm)}
        </Text>
        <Text style={{ color: t.cor.text.muted, fontSize: 12 }}>
          {ultimo === undefined ? '' : diaEMes(ultimo.medidaEm)}
        </Text>
      </View>
    </View>
  );
}

/** Tabela de evolucao -- DS-APP §4.12: data, valor e delta por linha. */
function TabelaDaSerie({ serie, testID }: { serie: SerieDoHistorico; testID: string }) {
  const t = useTema();

  return (
    <View testID={testID}>
      {serie.pontos.map((ponto, indice) => {
        const anterior = serie.pontos[indice - 1];
        const delta = anterior === undefined ? null : ponto.valor - anterior.valor;

        /*
         * Cor do delta NUNCA e o unico canal: o sinal (`+`/`−`) esta no texto,
         * e o rotulo de acessibilidade diz "subiu"/"caiu" por extenso. Quem
         * nao separa verde de laranja continua lendo a direcao.
         *
         * Cair e `ok` e subir e `warn` porque a serie mais consultada e peso e
         * gordura -- mas isso e uma convencao de LEITURA, nao um juizo sobre a
         * meta do aluno: quem treina para ganhar massa ve o proprio alvo no
         * campo `meta`.
         */
        const tom =
          delta === null || delta === 0
            ? t.cor.text.muted
            : delta < 0
              ? t.cor.state.ok
              : t.cor.state.warn;

        const textoDoDelta =
          delta === null
            ? '—'
            : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatarValor(Math.abs(delta), serie.unidade)}`;

        return (
          <View
            key={ponto.avaliacaoId}
            style={[
              estilos.linhaDaTabela,
              indice > 0 && { borderTopWidth: 1, borderTopColor: t.cor.border.default },
            ]}
            accessibilityLabel={
              delta === null
                ? `${diaEMes(ponto.medidaEm)}: ${formatarValor(ponto.valor, serie.unidade)}, primeira medição`
                : `${diaEMes(ponto.medidaEm)}: ${formatarValor(ponto.valor, serie.unidade)}, ${
                    delta < 0 ? 'caiu' : delta > 0 ? 'subiu' : 'sem mudança'
                  } ${formatarValor(Math.abs(delta), serie.unidade)}`
            }
          >
            <Text style={{ color: t.cor.text.secondary, fontSize: 13 }}>
              {diaEMes(ponto.medidaEm)}
            </Text>
            <Text
              style={{
                color: t.cor.text.primary,
                fontSize: 14,
                fontWeight: '600',
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatarValor(ponto.valor, serie.unidade)}
            </Text>
            <Text style={{ color: tom, fontSize: 13, fontWeight: '600' }}>{textoDoDelta}</Text>
          </View>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  pilha: {
    gap: 16,
  },
  chips: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  grafico: {
    gap: 6,
  },
  bloco: {
    marginTop: 12,
    gap: 4,
  },
  extremos: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  linhaDaTabela: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});
