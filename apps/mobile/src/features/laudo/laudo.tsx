import { StyleSheet, Text, View } from 'react-native';

import { Ausente } from '../../ui/Ausente.js';
import { Card } from '../../ui/Card.js';
import { TituloDaTela, Voltar } from '../../ui/Tela.js';
import { rgba, useTema } from '../../ui/theme.js';
import { Traco } from '../../ui/traco.js';
import { NOME_DO_TIPO } from '../avaliacoes/avaliacoes.js';

/** A leitura contra a faixa -- decidida no SERVIDOR (`leitura-de-faixa.ts`). */
export type Leitura = 'BELOW' | 'WITHIN' | 'ABOVE' | 'AT_LIMIT' | 'UNKNOWN';

export type Regiao = 'ARM_LEFT' | 'ARM_RIGHT' | 'TRUNK' | 'LEG_LEFT' | 'LEG_RIGHT';

export interface MetricaDoLaudo {
  readonly tipo: string;
  readonly valor: number;
  readonly unidade: string | null;
  readonly leitura: Leitura;
  readonly faixaMin: number | null;
  readonly faixaMax: number | null;
}

export interface RegiaoDoLaudo {
  readonly gorduraKg: number | null;
  readonly musculoKg: number | null;
  readonly leituraGordura: string;
  readonly leituraMusculo: string;
}

/** Contrato de `GET /api/v1/mobile/avaliacoes/laudo`. */
export interface DadosDoLaudo {
  readonly asOf: string;
  readonly avaliacao: {
    /** `AAAA-MM-DD`, data local da unidade. */
    readonly data: string;
    readonly metricas: readonly MetricaDoLaudo[];
    readonly regioes: Readonly<Record<Regiao, RegiaoDoLaudo>>;
  } | null;
}

/**
 * O texto de cada leitura. NEUTRO de proposito: o servidor diz se o valor esta
 * abaixo, dentro ou acima da faixa do fabricante, e nao se isso e bom -- musculo
 * acima da faixa e outra historia que gordura acima da faixa. Chamar "acima" de
 * "excelente", como o prototipo faz, seria a tela interpretando dado de saude
 * (regra de arquitetura 8).
 */
const TEXTO_DA_LEITURA: Record<Leitura, string> = {
  BELOW: 'Abaixo da faixa',
  WITHIN: 'Na faixa',
  ABOVE: 'Acima da faixa',
  AT_LIMIT: 'No limite',
  UNKNOWN: 'Sem faixa',
};

const NOME_DA_REGIAO: Record<Regiao, string> = {
  ARM_LEFT: 'Braço esq.',
  ARM_RIGHT: 'Braço dir.',
  TRUNK: 'Tronco',
  LEG_LEFT: 'Perna esq.',
  LEG_RIGHT: 'Perna dir.',
};

const REGIOES: readonly Regiao[] = ['ARM_LEFT', 'ARM_RIGHT', 'TRUNK', 'LEG_LEFT', 'LEG_RIGHT'];

/** `kg` -> `kg`, `percent` -> `%`. A API manda a unidade canonica em minusculas. */
function simbolo(unidade: string | null): string {
  if (unidade === null) return '';
  const u = unidade.toLowerCase();
  return u === 'percent' ? '%' : u;
}

function numero(valor: number, casas = 1): string {
  const [inteira = '0', decimal] = valor.toFixed(casas).split('.');
  const comMilhar = inteira.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return decimal ? `${comMilhar},${decimal}` : comMilhar;
}

/**
 * Casas FIXAS por unidade: kg e % sempre com uma (`3,0 kg` ao lado de `3,8 kg`,
 * nunca `3 kg` -- a coluna desalinhava no emulador); kcal e nivel sem unidade,
 * inteiros.
 */
function casasDa(unidade: string | null): number {
  const u = unidade?.toLowerCase();
  return u === null || u === undefined || u === 'kcal' ? 0 : 1;
}

function comUnidade(valor: number, unidade: string | null): string {
  const s = simbolo(unidade);
  const texto = numero(valor, casasDa(unidade));
  return s ? `${texto} ${s}` : texto;
}

/**
 * Posicao do valor e da faixa numa escala que da folga dos dois lados.
 *
 * GEOMETRIA DE DESENHO, nao leitura: quem diz se o valor esta dentro e o
 * servidor. A folga de 60% da largura da faixa em cada lado so existe para a
 * faixa nao encostar nas bordas e o marcador fora dela continuar visivel.
 */
export function escalaDaFaixa(valor: number, min: number, max: number) {
  const largura = max - min || Math.abs(min) * 0.2 || 1;
  const inicio = min - largura * 0.6;
  const fim = max + largura * 0.6;
  const total = fim - inicio;
  const limitar = (x: number) => Math.min(1, Math.max(0, x));

  return {
    zonaInicio: limitar((min - inicio) / total),
    zonaLargura: limitar((max - min) / total),
    marcador: limitar((valor - inicio) / total),
  };
}

/**
 * Laudo da ultima avaliacao publicada -- App Mobile v2.
 *
 * O APP NAO CALCULA LEITURA. Cor e texto de cada faixa saem do campo `leitura`
 * que o servidor resolveu -- o topo de `leitura-de-faixa.ts` diz por que: se
 * cada superficie decidisse, o braco sairia verde no celular e amarelo no
 * totem no dia em que uma faixa mudasse.
 *
 * "Pontuação física", "tipo de corpo" e o nome da avaliadora do prototipo nao
 * existem no contrato e nao entram.
 */
export function Laudo({
  dados,
  onVoltar,
  testID,
}: {
  dados: DadosDoLaudo;
  onVoltar: () => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  if (!dados.avaliacao) {
    return (
      <View testID={testID} style={estilos.pilha}>
        <Voltar rotulo="Evolução" onPress={onVoltar} />
        <TituloDaTela>Avaliação</TituloDaTela>
        <Card>
          <Text testID="laudo-vazio" style={{ color: t.cor.text.secondary, fontSize: 14, lineHeight: 20, fontFamily: t.fonte(400) }}>
            Você ainda não tem avaliação publicada. Quando a recepção publicar a sua, o laudo aparece aqui.
          </Text>
        </Card>
      </View>
    );
  }

  const { data, metricas, regioes } = dados.avaliacao;
  const [ano, mes, dia] = data.split('-');
  const peso = metricas.find((m) => m.tipo === 'WEIGHT');
  const gordura = metricas.find((m) => m.tipo === 'BODY_FAT_PERCENT');

  const corDaLeitura = (leitura: string) =>
    leitura === 'WITHIN' ? t.cor.state.ok : leitura === 'UNKNOWN' ? t.cor.text.muted : t.cor.state.warn;

  const maiorMusculo = Math.max(1, ...REGIOES.map((r) => regioes[r].musculoKg ?? 0));
  const maiorGordura = Math.max(1, ...REGIOES.map((r) => regioes[r].gorduraKg ?? 0));
  const temRegiao = REGIOES.some((r) => regioes[r].musculoKg !== null || regioes[r].gorduraKg !== null);

  return (
    <View testID={testID} style={estilos.pilha}>
      <Voltar rotulo="Evolução" onPress={onVoltar} />

      <View>
        <TituloDaTela>{`Avaliação de ${dia ?? ''}/${mes ?? ''}`}</TituloDaTela>
        <Text style={{ color: t.cor.text.muted, fontSize: 13, marginTop: 2, fontFamily: t.fonte(400) }}>
          {`Bioimpedância · ${dia ?? ''}/${mes ?? ''}/${ano ?? ''} · faixas do fabricante do aparelho`}
        </Text>
      </View>

      {peso || gordura ? (
        <View style={[estilos.destaque, { backgroundColor: t.cor.bg.raised, borderRadius: t.radius.card }]}>
          {[peso, gordura].map((metrica, indice) =>
            metrica ? (
              <View key={metrica.tipo} style={[estilos.flex, indice === 1 && estilos.direita]}>
                <Text style={{ color: t.cor.text.secondary, fontSize: 13, fontFamily: t.fonte(400) }}>
                  {NOME_DO_TIPO[metrica.tipo] ?? metrica.tipo}
                </Text>
                <Text style={{ color: t.cor.text.primary, fontSize: 30, lineHeight: 38, fontVariant: ['tabular-nums'], fontFamily: t.fonte(800) }}>
                  {comUnidade(metrica.valor, metrica.unidade)}
                </Text>
                <Text style={{ color: corDaLeitura(metrica.leitura), fontSize: 13, fontFamily: t.fonte(600) }}>
                  {TEXTO_DA_LEITURA[metrica.leitura]}
                </Text>
              </View>
            ) : (
              <View key={indice} style={estilos.flex} />
            ),
          )}
        </View>
      ) : null}

      <View style={[estilos.cartao, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card, borderColor: t.cor.border.hairline }]}>
        <Text accessibilityRole="header" style={{ color: t.cor.text.primary, fontSize: 16, fontFamily: t.fonte(600) }}>
          Como estão suas faixas
        </Text>
        {metricas.length === 0 ? (
          <Ausente motivo="nenhuma medida nesta avaliação" />
        ) : (
          metricas.map((metrica) => {
            const nome = NOME_DO_TIPO[metrica.tipo] ?? metrica.tipo;
            const cor = corDaLeitura(metrica.leitura);
            const temFaixa = metrica.faixaMin !== null && metrica.faixaMax !== null;
            const escala = temFaixa ? escalaDaFaixa(metrica.valor, metrica.faixaMin ?? 0, metrica.faixaMax ?? 0) : null;

            return (
              <View
                key={metrica.tipo}
                style={estilos.faixa}
                testID={`laudo-faixa-${metrica.tipo}`}
                accessibilityLabel={`${nome}: ${comUnidade(metrica.valor, metrica.unidade)}, ${TEXTO_DA_LEITURA[metrica.leitura]}${
                  temFaixa ? `, faixa de ${comUnidade(metrica.faixaMin ?? 0, metrica.unidade)} a ${comUnidade(metrica.faixaMax ?? 0, metrica.unidade)}` : ''
                }`}
              >
                <View style={estilos.linhaBase}>
                  <Text style={{ flex: 1, color: t.cor.text.primary, fontSize: 14, fontFamily: t.fonte(400) }}>{nome}</Text>
                  <Text style={{ color: t.cor.text.primary, fontSize: 15, fontVariant: ['tabular-nums'], fontFamily: t.fonte(700) }}>
                    {comUnidade(metrica.valor, metrica.unidade)}
                  </Text>
                  <Text style={{ color: cor, fontSize: 12, fontFamily: t.fonte(600) }}>{TEXTO_DA_LEITURA[metrica.leitura]}</Text>
                </View>
                {escala ? (
                  <>
                    <View style={[estilos.trilho, { backgroundColor: t.cor.bg.app }]}>
                      <View
                        style={[
                          estilos.zona,
                          { left: `${escala.zonaInicio * 100}%`, width: `${escala.zonaLargura * 100}%`, backgroundColor: rgba(t.cor.state.ok, 0.22) },
                        ]}
                      />
                      <View style={[estilos.marcador, { left: `${escala.marcador * 100}%`, backgroundColor: cor }]} />
                    </View>
                    <Text style={{ color: t.cor.text.muted, fontSize: 11, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }}>
                      {`faixa de referência ${numero(metrica.faixaMin ?? 0, casasDa(metrica.unidade))} – ${comUnidade(metrica.faixaMax ?? 0, metrica.unidade)}`}
                    </Text>
                  </>
                ) : (
                  <Text style={{ color: t.cor.text.muted, fontSize: 11, fontFamily: t.fonte(400) }}>sem faixa de referência nesta medida</Text>
                )}
              </View>
            );
          })
        )}
      </View>

      {temRegiao ? (
        <View style={[estilos.cartao, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card, borderColor: t.cor.border.hairline }]}>
          <Text accessibilityRole="header" style={{ color: t.cor.text.primary, fontSize: 16, fontFamily: t.fonte(600) }}>
            Por região do corpo
          </Text>
          {REGIOES.map((regiao) => {
            const { musculoKg, gorduraKg } = regioes[regiao];

            return (
              <View key={regiao} style={estilos.regiao} testID={`laudo-regiao-${regiao}`}>
                <Text style={{ width: 92, color: t.cor.text.secondary, fontSize: 13, fontFamily: t.fonte(400) }}>{NOME_DA_REGIAO[regiao]}</Text>
                <View style={estilos.barrasDaRegiao}>
                  {[
                    { valor: musculoKg, maior: maiorMusculo, cor: t.cor.state.ok },
                    { valor: gorduraKg, maior: maiorGordura, cor: t.cor.state.warn },
                  ].map((barra, i) => (
                    <View key={i} style={[estilos.trilhoFino, { backgroundColor: t.cor.bg.app }]}>
                      {barra.valor !== null ? (
                        <View style={[estilos.preenchimentoFino, { width: `${(barra.valor / barra.maior) * 100}%`, backgroundColor: barra.cor }]} />
                      ) : null}
                    </View>
                  ))}
                </View>
                <View style={estilos.valoresDaRegiao}>
                  <Text style={{ color: t.cor.state.ok, fontSize: 12, fontVariant: ['tabular-nums'], textAlign: 'right', fontFamily: t.fonte(400) }}>
                    {musculoKg === null ? '—' : `${numero(musculoKg)} kg`}
                  </Text>
                  <Text style={{ color: t.cor.state.warn, fontSize: 12, fontVariant: ['tabular-nums'], textAlign: 'right', fontFamily: t.fonte(400) }}>
                    {gorduraKg === null ? '—' : `${numero(gorduraKg)} kg`}
                  </Text>
                </View>
              </View>
            );
          })}
          <View style={[estilos.legenda, { borderTopColor: t.cor.border.hairline }]}>
            {[
              { rotulo: 'músculo', cor: t.cor.state.ok },
              { rotulo: 'gordura', cor: t.cor.state.warn },
            ].map((item) => (
              <View key={item.rotulo} style={estilos.itemDaLegenda}>
                <View style={[estilos.amostra, { backgroundColor: item.cor }]} />
                <Text style={{ color: t.cor.text.secondary, fontSize: 12, fontFamily: t.fonte(400) }}>{item.rotulo}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={[estilos.aviso, { backgroundColor: t.cor.bg.surface, borderColor: t.cor.border.hairline }]}>
        <View style={estilos.iconeDoAviso}>
          <Traco nome="info" cor={t.cor.state.info} tamanho={13} />
        </View>
        <Text style={{ flex: 1, color: t.cor.text.muted, fontSize: 12, lineHeight: 17, fontFamily: t.fonte(400) }}>
          Esta leitura acompanha sua evolução e não é diagnóstico médico. A interpretação é do profissional que acompanha você.
        </Text>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  pilha: {
    gap: 14,
  },
  flex: {
    flex: 1,
  },
  direita: {
    alignItems: 'flex-end',
  },
  destaque: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  cartao: {
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 14,
  },
  faixa: {
    gap: 6,
  },
  linhaBase: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  trilho: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  zona: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  marcador: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 3,
    marginLeft: -1.5,
    borderRadius: 2,
  },
  regiao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  barrasDaRegiao: {
    flex: 1,
    gap: 4,
  },
  trilhoFino: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  preenchimentoFino: {
    height: 6,
    borderRadius: 3,
  },
  valoresDaRegiao: {
    width: 72,
  },
  legenda: {
    flexDirection: 'row',
    gap: 16,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  itemDaLegenda: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  amostra: {
    width: 10,
    height: 6,
    borderRadius: 3,
  },
  aviso: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  iconeDoAviso: {
    marginTop: 2,
  },
});
