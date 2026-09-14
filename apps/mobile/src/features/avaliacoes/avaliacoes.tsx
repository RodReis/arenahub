import { useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { Ausente } from '../../ui/Ausente.js';
import { AvisoDeIA } from '../../ui/AvisoDeIA.js';
import { Botao } from '../../ui/Botao.js';
import { Card } from '../../ui/Card.js';
import { Pilulas } from '../../ui/Segmentado.js';
import { TituloDaTela } from '../../ui/Tela.js';
import { ARTES } from '../../ui/artes.js';
import { rgba, useTema } from '../../ui/theme.js';

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
 * O BACKEND MANDA O ENUM E A TELA TRADUZ. Tipo que a tela nao conhece aparece
 * com o proprio codigo: e feio, e melhor que sumir com uma medida que o aluno
 * pagou para fazer.
 */
export const NOME_DO_TIPO: Record<string, string> = {
  WEIGHT: 'Peso',
  BODY_FAT_PERCENT: 'Gordura corporal',
  BODY_FAT_MASS: 'Massa de gordura',
  MUSCLE_MASS: 'Massa muscular',
  SKELETAL_MUSCLE_MASS: 'Músculo esquelético',
  LEAN_BODY_MASS: 'Massa livre de gordura',
  TOTAL_BODY_WATER: 'Água corporal total',
  VISCERAL_FAT_LEVEL: 'Gordura visceral',
  BASAL_METABOLIC_RATE: 'Metabolismo basal',
  BMI: 'IMC',
  HEIGHT: 'Altura',
  WAIST: 'Cintura',
  WAIST_CIRCUMFERENCE: 'Cintura',
  HIP: 'Quadril',
  HIP_CIRCUMFERENCE: 'Quadril',
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

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

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
 * O que a tela usa da analise assistiva -- SUBCONJUNTO do contrato do backend,
 * de proposito: o resto e material do painel.
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
export function diaEMes(iso: string): string {
  const data = new Date(iso);

  return `${data.getUTCDate().toString().padStart(2, '0')}/${(data.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}`;
}

/**
 * `78.2` -> `78,2 kg`. Virgula de pt-BR, formatada a mao: a regra 5 da lint
 * barra `Intl`/`toLocale*`, e o formatador do dispositivo seguiria o idioma do
 * CELULAR.
 */
export function formatarValor(valor: number, unidade: string | null, casas = 1): string {
  const numero = valor.toFixed(casas).replace('.', ',');

  // A API manda a unidade canonica em MINUSCULAS (`kg`, `percent`); a busca
  // e sem caixa para `percent` nao sair escrito por extenso na tela.
  return unidade === null ? numero : `${numero} ${SIMBOLO_DA_UNIDADE[unidade.toUpperCase()] ?? unidade.toLowerCase()}`;
}

/**
 * A variacao vista como BOA ou de ATENCAO -- convencao de LEITURA, nao juizo
 * sobre a meta do aluno.
 *
 * Musculo que sobe e o unico caso invertido: nas demais series mais consultadas
 * (peso, gordura) cair e o que o aluno costuma buscar. Quem treina para ganhar
 * massa ve o proprio alvo no campo `meta`. O sinal esta sempre no texto.
 */
const SOBE_E_BOM = new Set(['MUSCLE_MASS', 'SKELETAL_MUSCLE_MASS', 'LEAN_BODY_MASS']);

function tomDoDelta(tipo: string, delta: number): 'ok' | 'warn' | null {
  if (delta === 0) return null;
  const subiu = delta > 0;
  return subiu === SOBE_E_BOM.has(tipo) ? 'ok' : 'warn';
}

function textoDoDelta(delta: number, unidade: string | null): string {
  const unidadeCurta = unidade?.toUpperCase() === 'PERCENT' ? 'pp' : null;
  const base = unidadeCurta ? `${Math.abs(delta).toFixed(1).replace('.', ',')} ${unidadeCurta}` : formatarValor(Math.abs(delta), unidade);
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${base}`;
}

/** As tres metricas do topo, na ordem do prototipo. A primeira serie que existir de cada grupo. */
const METRICAS_DO_TOPO: readonly { rotulo: string; tipos: readonly string[] }[] = [
  { rotulo: 'Peso', tipos: ['WEIGHT'] },
  { rotulo: 'Gordura', tipos: ['BODY_FAT_PERCENT', 'BODY_FAT_MASS'] },
  { rotulo: 'M. esquelética', tipos: ['SKELETAL_MUSCLE_MASS', 'MUSCLE_MASS'] },
];

/** As tres linhas de fase do cartao 3D, na ordem do prototipo. */
const FASES_DO_CARTAO: readonly { titulo: string; tipos: readonly string[] }[] = [
  { titulo: 'EVOLUÇÃO CORPORAL', tipos: ['WEIGHT'] },
  { titulo: 'EVOLUÇÃO MUSCULAR', tipos: ['SKELETAL_MUSCLE_MASS', 'MUSCLE_MASS'] },
  { titulo: 'EVOLUÇÃO GORDURA', tipos: ['BODY_FAT_PERCENT', 'BODY_FAT_MASS'] },
];

/** Peso, gordura e musculo antes das demais -- a ordem das metricas do topo. */
const ORDEM_DAS_SERIES = ['WEIGHT', 'BODY_FAT_PERCENT', 'SKELETAL_MUSCLE_MASS', 'MUSCLE_MASS', 'BODY_FAT_MASS', 'LEAN_BODY_MASS'];

function ordemDaSerie(tipo: string): number {
  const indice = ORDEM_DAS_SERIES.indexOf(tipo);
  return indice < 0 ? ORDEM_DAS_SERIES.length : indice;
}

function serieDe(series: readonly SerieDoHistorico[], tipos: readonly string[]): SerieDoHistorico | undefined {
  for (const tipo of tipos) {
    const serie = series.find((s) => s.tipo === tipo && s.pontos.length > 0);
    if (serie) return serie;
  }
  return undefined;
}

/**
 * Aba Evolução do App Mobile v2 -- `M4-FR-012`.
 *
 * NADA AQUI E NUMERO NOVO: todo valor exibido e um ponto que o servidor
 * mandou, e a unica aritmetica e a DIFERENCA entre dois pontos da mesma serie
 * -- a mesma que a tabela da F26 ja mostrava linha a linha. "Pontuação física"
 * e "tipo de corpo" do prototipo nao existem no dominio de saude e nao entram.
 *
 * O cartao 3D usa arte ILUSTRATIVA: a imagem nao e o corpo do aluno, e a tela
 * nao a apresenta como tal.
 */
export function Evolucao({
  dados,
  periodo,
  onPeriodo,
  onVerLaudo,
  testID = 'avaliacoes',
}: {
  dados: DadosDasAvaliacoes;
  periodo: Periodo;
  onPeriodo: (periodo: Periodo) => void;
  onVerLaudo: () => void;
  testID?: string;
}) {
  const t = useTema();
  const comPontos = dados.series.filter((serie) => serie.pontos.length > 0);
  const [tipoDoHistorico, setTipoDoHistorico] = useState<string | null>(null);
  const serieDoHistorico =
    comPontos.find((s) => s.tipo === tipoDoHistorico) ?? serieDe(comPontos, ['WEIGHT']) ?? comPontos[0];

  const pilulas = (
    <Pilulas
      opcoes={PERIODOS.map((p) => ({ valor: p, rotulo: ROTULO_DO_PERIODO[p], acessivel: `Período ${ROTULO_DO_PERIODO[p]}` }))}
      valor={periodo}
      onMudar={onPeriodo}
      testID={`${testID}-periodo`}
    />
  );

  return (
    <View style={estilos.pilha} testID={testID}>
      <TituloDaTela>Evolução</TituloDaTela>

      {comPontos.length === 0 ? (
        <>
          {pilulas}
          <Card>
            <Text testID={`${testID}-vazio`} style={{ color: t.cor.text.secondary, fontSize: 14, lineHeight: 20, fontFamily: t.fonte(400) }}>
              Nenhuma avaliação no período. Quando você fizer uma na recepção, ela aparece aqui.
            </Text>
          </Card>
        </>
      ) : (
        <>
          <View style={estilos.metricas}>
            {METRICAS_DO_TOPO.map(({ rotulo, tipos }) => {
              const serie = serieDe(comPontos, tipos);
              const ultimo = serie?.pontos[serie.pontos.length - 1];
              const primeiro = serie?.pontos[0];
              const delta = serie && ultimo && primeiro && serie.pontos.length > 1 ? ultimo.valor - primeiro.valor : null;
              const tom = serie && delta !== null ? tomDoDelta(serie.tipo, delta) : null;

              return (
                <View
                  key={rotulo}
                  style={[estilos.metrica, { backgroundColor: t.cor.bg.surface, borderColor: t.cor.border.hairline }]}
                  testID={`${testID}-metrica-${rotulo}`}
                >
                  <Text style={{ color: t.cor.text.muted, fontSize: 12, fontFamily: t.fonte(400) }}>{rotulo}</Text>
                  {serie && ultimo ? (
                    <Text
                      adjustsFontSizeToFit
                      numberOfLines={1}
                      style={{ color: t.cor.text.primary, fontSize: 19, marginVertical: 3, fontVariant: ['tabular-nums'], fontFamily: t.fonte(700) }}
                    >
                      {formatarValor(ultimo.valor, serie.unidade)}
                    </Text>
                  ) : (
                    <Ausente motivo={`${rotulo} não medido no período`} />
                  )}
                  <Text
                    style={{
                      color: tom === 'ok' ? t.cor.state.ok : tom === 'warn' ? t.cor.state.warn : t.cor.text.muted,
                      fontSize: 12,
                      fontVariant: ['tabular-nums'],
                      fontFamily: t.fonte(600),
                    }}
                  >
                    {serie && delta !== null ? textoDoDelta(delta, serie.unidade) : ' '}
                  </Text>
                </View>
              );
            })}
          </View>

          <CartaoDaAvaliacao series={comPontos} onVerLaudo={onVerLaudo} testID={testID} />

          {serieDoHistorico ? (
            <HistoricoDaSerie
              series={comPontos}
              serie={serieDoHistorico}
              onTipo={setTipoDoHistorico}
              pilulas={pilulas}
              testID={`${testID}-serie`}
            />
          ) : null}

          {serieDoHistorico && serieDoHistorico.pontos.length > 1 ? <Comparativo serie={serieDoHistorico} /> : null}
        </>
      )}

      {dados.analise !== null && (
        <AnaliseAssistiva
          analise={dados.analise.analise}
          geradaEm={dados.analise.geradaEm}
          model={dados.analise.model}
          promptVersion={dados.analise.promptVersion}
          testID={`${testID}-analise`}
        />
      )}
    </View>
  );
}

function CartaoDaAvaliacao({
  series,
  onVerLaudo,
  testID,
}: {
  series: readonly SerieDoHistorico[];
  onVerLaudo: () => void;
  testID: string;
}) {
  const t = useTema();

  const ultimaData = series
    .flatMap((serie) => serie.pontos.map((p) => p.medidaEm))
    .reduce((maior, atual) => (atual > maior ? atual : maior), '');
  const mes = ultimaData ? (MESES[new Date(ultimaData).getUTCMonth()] ?? '') : '';

  return (
    <View
      testID={`${testID}-cartao-3d`}
      style={[estilos.cartao3d, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card, borderColor: t.cor.border.hairline }]}
    >
      <View style={estilos.arte3d}>
        <Image
          // A arte do prototipo (`avaliacao-atual-3d`) traz peso e gordura ESCRITOS na
          // imagem -- numeros de outra pessoa na tela de saude do aluno. Fica a
          // arte sem numero nenhum.
          source={ARTES.bio3d}
          style={[StyleSheet.absoluteFill, estilos.imagem]}
          resizeMode="cover"
          accessibilityLabel="Ilustração de composição corporal"
        />
        <LinearGradient
          colors={[rgba(t.cor.bg.app, 0.35), rgba(t.cor.bg.app, 0), rgba(t.cor.bg.app, 0.72)]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={[estilos.seloDoCartao, { backgroundColor: rgba(t.cor.bg.app, 0.72) }]}>
          <Text style={{ color: t.cor.accent.text, fontSize: 11, letterSpacing: 0.9, fontFamily: t.fonte(700) }}>
            {`AVALIAÇÃO · ${mes.toUpperCase()}`}
          </Text>
        </View>
        <View style={estilos.legendaDoCartao}>
          <Text style={{ color: t.cor.text.onImage, fontSize: 16, fontFamily: t.fonte(700) }}>{`Avaliação de ${mes}`}</Text>
          <Text style={{ color: t.cor.text.onImageMuted, fontSize: 12, marginTop: 2, fontFamily: t.fonte(400) }}>
            {ultimaData ? `medida em ${diaEMes(ultimaData)}` : ''}
          </Text>
        </View>
      </View>

      <View style={estilos.fases}>
        {FASES_DO_CARTAO.map(({ titulo, tipos }) => {
          const serie = serieDe(series, tipos);
          if (!serie) return null;

          const pontos = serie.pontos;
          const primeiro = pontos[0];
          const ultimo = pontos[pontos.length - 1];
          if (!primeiro || !ultimo) return null;

          const meio = pontos.length > 2 ? pontos[Math.floor((pontos.length - 1) / 2)] : undefined;
          const fases = [
            { rotulo: 'Início', ponto: primeiro, atual: false },
            ...(meio ? [{ rotulo: 'Progresso', ponto: meio, atual: false }] : []),
            ...(pontos.length > 1 ? [{ rotulo: 'Atual', ponto: ultimo, atual: true }] : []),
          ];
          const maior = Math.max(...fases.map((f) => f.ponto.valor), 1);
          const delta = pontos.length > 1 ? ultimo.valor - primeiro.valor : null;
          const tom = delta === null ? null : tomDoDelta(serie.tipo, delta);
          const corAtual = serie.tipo === 'WEIGHT' ? t.cor.accent.solid : tom === 'warn' ? t.cor.state.warn : t.cor.state.ok;

          return (
            <View key={titulo} style={estilos.fase} testID={`${testID}-fase-${serie.tipo}`}>
              <View style={estilos.linhaBase}>
                <Text style={{ color: t.cor.accent.text, fontSize: 12, letterSpacing: 0.7, fontFamily: t.fonte(700) }}>{titulo}</Text>
                {delta !== null ? (
                  <Text
                    style={{
                      color: tom === 'ok' ? t.cor.state.ok : tom === 'warn' ? t.cor.state.warn : t.cor.text.muted,
                      fontSize: 15,
                      fontVariant: ['tabular-nums'],
                      fontFamily: t.fonte(700),
                    }}
                  >
                    {textoDoDelta(delta, serie.unidade)}
                  </Text>
                ) : null}
              </View>
              {fases.map((fase) => (
                <View key={fase.rotulo} style={estilos.linhaDeBarra}>
                  <Text style={{ width: 64, color: t.cor.text.muted, fontSize: 12, fontFamily: t.fonte(400) }}>{fase.rotulo}</Text>
                  <View style={[estilos.trilho, { backgroundColor: t.cor.bg.app }]}>
                    <View
                      style={[
                        estilos.preenchimento,
                        {
                          width: `${Math.max(4, (fase.ponto.valor / maior) * 100)}%`,
                          backgroundColor: fase.atual ? corAtual : t.cor.border.hairline,
                        },
                      ]}
                    />
                  </View>
                  <Text style={{ width: 64, textAlign: 'right', color: t.cor.text.primary, fontSize: 12, fontVariant: ['tabular-nums'], fontFamily: t.fonte(600) }}>
                    {formatarValor(fase.ponto.valor, serie.unidade)}
                  </Text>
                </View>
              ))}
            </View>
          );
        })}

        <Botao titulo="Ver avaliação completa" variante="secundario" emCard onPress={onVerLaudo} testID="botao-ver-laudo" />
      </View>
    </View>
  );
}

/**
 * Historico de UMA medida: grafico e tabela do MESMO dado.
 *
 * A tabela nao e um extra -- e o conteudo equivalente que o
 * `ChartWithTableProps` exige: leitor de tela nao le `Polyline`
 * (`M4-NFR-007`). Os chips de tipo so aparecem com mais de uma medida, para
 * nenhuma serie que o aluno ja via na F26 sumir no desenho novo.
 */
function HistoricoDaSerie({
  series,
  serie,
  onTipo,
  pilulas,
  testID,
}: {
  series: readonly SerieDoHistorico[];
  serie: SerieDoHistorico;
  onTipo: (tipo: string) => void;
  pilulas: ReactNode;
  testID: string;
}) {
  const t = useTema();
  const [mostrandoTabela, setMostrandoTabela] = useState(false);
  const nome = NOME_DO_TIPO[serie.tipo] ?? serie.tipo;

  return (
    <View
      testID={`${testID}-${serie.tipo}`}
      style={[estilos.cartao, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card, borderColor: t.cor.border.hairline }]}
    >
      <View style={estilos.linhaEntre}>
        <Text style={{ flex: 1, color: t.cor.text.primary, fontSize: 16, fontFamily: t.fonte(600) }}>
          {`Histórico · ${nome}`}
        </Text>
        <Pressable
          onPress={() => setMostrandoTabela((atual) => !atual)}
          accessibilityRole="button"
          accessibilityLabel={mostrandoTabela ? `Ver gráfico de ${nome}` : `Ver tabela de ${nome}`}
          testID={`${testID}-${serie.tipo}-alternar`}
          hitSlop={8}
          style={({ pressed }) => [estilos.alternar, { borderColor: pressed ? t.cor.accent.text : t.cor.border.hairline }]}
        >
          <Text style={{ color: t.cor.accent.text, fontSize: 12, fontFamily: t.fonte(600) }}>
            {mostrandoTabela ? 'Ver gráfico' : 'Ver tabela'}
          </Text>
        </Pressable>
      </View>

      {pilulas}

      {series.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Ate a borda do card: cortar seco no padding interno deixava "Ma" solto.
          style={estilos.tiposRolagem}
          contentContainerStyle={estilos.tipos}
        >
          {[...series].sort((a, b) => ordemDaSerie(a.tipo) - ordemDaSerie(b.tipo)).map((s) => {
            const ativo = s.tipo === serie.tipo;
            return (
              <Pressable
                key={s.tipo}
                onPress={() => onTipo(s.tipo)}
                accessibilityRole="tab"
                accessibilityState={{ selected: ativo }}
                testID={`${testID}-tipo-${s.tipo}`}
                style={[
                  estilos.tipo,
                  { borderColor: ativo ? t.cor.accent.solid : t.cor.border.hairline, backgroundColor: ativo ? t.cor.accent.tint : 'transparent' },
                ]}
              >
                <Text style={{ color: ativo ? t.cor.text.primary : t.cor.text.secondary, fontSize: 12, fontFamily: t.fonte(ativo ? 600 : 400) }}>
                  {NOME_DO_TIPO[s.tipo] ?? s.tipo}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {mostrandoTabela ? (
        <TabelaDaSerie serie={serie} testID={`${testID}-${serie.tipo}-tabela`} />
      ) : (
        <GraficoDaSerie serie={serie} testID={`${testID}-${serie.tipo}-grafico`} />
      )}
    </View>
  );
}

/** Area util do SVG -- DS-APP §4.11 fixa 300 × 130 (x: 8–292, y: 18–112). */
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
   * Eixo escalado ao MIN/MAX do periodo, e nao ao zero (DS-APP §4.11).
   * `maior === menor` (um ponto so, ou todos iguais) desenha no meio da area
   * util em vez de dividir por zero.
   */
  const amplitude = maior - menor;

  const emX = (indice: number): number =>
    serie.pontos.length === 1 ? (X_MIN + X_MAX) / 2 : X_MIN + (indice / (serie.pontos.length - 1)) * (X_MAX - X_MIN);

  const emY = (valor: number): number =>
    amplitude === 0 ? (Y_MIN + Y_MAX) / 2 : Y_MAX - ((valor - menor) / amplitude) * (Y_MAX - Y_MIN);

  const pontos = serie.pontos.map((p, i) => `${emX(i)},${emY(p.valor)}`).join(' ');
  const ultimo = serie.pontos[serie.pontos.length - 1];

  return (
    <View style={estilos.grafico} testID={testID}>
      {/* Fora da arvore de acessibilidade: os numeros chegam pela tabela. */}
      <Svg
        width="100%"
        height={ALTURA}
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        preserveAspectRatio="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {[32, 65, 98].map((y) => (
          <Line key={y} x1={0} y1={y} x2={LARGURA} y2={y} stroke={t.cor.border.hairline} strokeWidth={1} />
        ))}

        <Polyline points={pontos} fill="none" stroke={t.cor.accent.ink} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {ultimo !== undefined && <Circle cx={emX(serie.pontos.length - 1)} cy={emY(ultimo.valor)} r={4} fill={t.cor.accent.text} />}
      </Svg>

      <View style={estilos.linhaEntre}>
        <Text style={{ color: t.cor.text.muted, fontSize: 11, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }}>
          {serie.pontos[0] === undefined ? '' : diaEMes(serie.pontos[0].medidaEm)}
        </Text>
        <Text style={{ color: t.cor.text.muted, fontSize: 11, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }}>
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
      <View style={[estilos.linhaDaTabela, { borderBottomWidth: 1, borderBottomColor: t.cor.border.hairline }]}>
        {['Data', 'Valor', 'Variação'].map((cabecalho, i) => (
          <Text key={cabecalho} style={[estilos.celula, i > 0 && estilos.direita, { color: t.cor.text.muted, fontSize: 12, fontFamily: t.fonte(600) }]}>
            {cabecalho}
          </Text>
        ))}
      </View>
      {serie.pontos.map((ponto, indice) => {
        const anterior = serie.pontos[indice - 1];
        const delta = anterior === undefined ? null : ponto.valor - anterior.valor;

        /*
         * Cor do delta NUNCA e o unico canal: o sinal (`+`/`−`) esta no texto,
         * e o rotulo de acessibilidade diz "subiu"/"caiu" por extenso.
         */
        const tom = delta === null ? null : tomDoDelta(serie.tipo, delta);
        const cor = tom === 'ok' ? t.cor.state.ok : tom === 'warn' ? t.cor.state.warn : t.cor.text.muted;
        const texto = delta === null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatarValor(Math.abs(delta), serie.unidade)}`;

        return (
          <View
            key={ponto.avaliacaoId}
            style={[estilos.linhaDaTabela, { borderBottomWidth: 1, borderBottomColor: t.cor.border.hairline }]}
            accessibilityLabel={
              delta === null
                ? `${diaEMes(ponto.medidaEm)}: ${formatarValor(ponto.valor, serie.unidade)}, primeira medição`
                : `${diaEMes(ponto.medidaEm)}: ${formatarValor(ponto.valor, serie.unidade)}, ${
                    delta < 0 ? 'caiu' : delta > 0 ? 'subiu' : 'sem mudança'
                  } ${formatarValor(Math.abs(delta), serie.unidade)}`
            }
          >
            <Text style={[estilos.celula, { color: t.cor.text.secondary, fontSize: 13, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }]}>
              {diaEMes(ponto.medidaEm)}
            </Text>
            <Text style={[estilos.celula, estilos.direita, { color: t.cor.text.primary, fontSize: 13, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }]}>
              {formatarValor(ponto.valor, serie.unidade)}
            </Text>
            <Text style={[estilos.celula, estilos.direita, { color: cor, fontSize: 13, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }]}>
              {texto}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Primeira · Anterior · Atual da serie em destaque. */
function Comparativo({ serie }: { serie: SerieDoHistorico }) {
  const t = useTema();
  const pontos = serie.pontos;
  const linhas = [
    { rotulo: 'Primeira', ponto: pontos[0], atual: false },
    ...(pontos.length > 2 ? [{ rotulo: 'Anterior', ponto: pontos[pontos.length - 2], atual: false }] : []),
    { rotulo: 'Atual', ponto: pontos[pontos.length - 1], atual: true },
  ];
  const maior = Math.max(...pontos.map((p) => p.valor), 1);

  return (
    <View
      testID="comparativo"
      style={[estilos.cartao, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card, borderColor: t.cor.border.hairline }]}
    >
      <Text style={{ color: t.cor.text.primary, fontSize: 16, fontFamily: t.fonte(600) }}>Comparativo</Text>
      {linhas.map(({ rotulo, ponto, atual }) =>
        ponto ? (
          <View key={rotulo} style={estilos.linhaDeBarra}>
            <Text style={{ width: 64, color: t.cor.text.muted, fontSize: 12, fontFamily: t.fonte(400) }}>{rotulo}</Text>
            <View style={[estilos.trilho, { backgroundColor: t.cor.bg.app }]}>
              <View
                style={[
                  estilos.preenchimento,
                  { width: `${Math.max(4, (ponto.valor / maior) * 100)}%`, backgroundColor: atual ? t.cor.accent.solid : t.cor.border.hairline },
                ]}
              />
            </View>
            <Text style={{ width: 64, textAlign: 'right', color: t.cor.text.primary, fontSize: 13, fontVariant: ['tabular-nums'], fontFamily: t.fonte(600) }}>
              {formatarValor(ponto.valor, serie.unidade)}
            </Text>
          </View>
        ) : null,
      )}
    </View>
  );
}

/**
 * Leitura assistiva do periodo -- `M4-FR-012`.
 *
 * O AVISO NAO E DISPENSAVEL e vem PRIMEIRO, antes do texto (regra de
 * arquitetura no 8). So chega aqui analise ja ENDOSSADA por um profissional --
 * quem filtra e o backend (`ultimaPublicada`).
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
    <Card testID={testID} titulo="Leitura da sua evolução">
      <AvisoDeIA modelVersion={model} promptVersion={promptVersion} testID={`${testID}-aviso`} />

      <Text style={{ color: t.cor.text.primary, fontSize: 14, lineHeight: 20, fontFamily: t.fonte(400) }}>{analise.summary}</Text>

      {blocos
        .filter((bloco) => bloco.itens.length > 0)
        .map((bloco) => (
          <View key={bloco.titulo} style={estilos.blocoDaAnalise}>
            <Text style={{ color: t.cor.accent.text, fontSize: 12, fontFamily: t.fonte(700) }}>{bloco.titulo}</Text>
            {bloco.itens.map((item) => (
              <Text key={item} style={{ color: t.cor.text.secondary, fontSize: 14, lineHeight: 20, fontFamily: t.fonte(400) }}>
                {item}
              </Text>
            ))}
          </View>
        ))}

      <Text style={{ color: t.cor.text.muted, fontSize: 11, fontFamily: t.fonte(400) }}>
        Leitura gerada em {diaEMes(geradaEm)} e revisada por um profissional.
      </Text>
    </Card>
  );
}

const estilos = StyleSheet.create({
  pilha: {
    gap: 14,
  },
  metricas: {
    flexDirection: 'row',
    gap: 10,
  },
  metrica: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  cartao3d: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  arte3d: {
    height: 200,
  },
  imagem: {
    width: '100%',
    height: '100%',
  },
  seloDoCartao: {
    position: 'absolute',
    left: 14,
    top: 14,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 999,
    justifyContent: 'center',
  },
  legendaDoCartao: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
  },
  fases: {
    paddingTop: 14,
    paddingHorizontal: 20,
    paddingBottom: 18,
    gap: 14,
  },
  fase: {
    gap: 8,
  },
  linhaBase: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  linhaEntre: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  linhaDeBarra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  trilho: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  preenchimento: {
    height: 8,
    borderRadius: 4,
  },
  cartao: {
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 12,
  },
  alternar: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  tiposRolagem: {
    marginHorizontal: -20,
  },
  tipos: {
    gap: 6,
    paddingHorizontal: 20,
  },
  tipo: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  grafico: {
    gap: 6,
  },
  linhaDaTabela: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
  },
  celula: {
    flex: 1,
  },
  direita: {
    textAlign: 'right',
  },
  blocoDaAnalise: {
    gap: 4,
  },
});
