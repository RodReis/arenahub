import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { Botao } from '../../ui/Botao.js';
import { CardDeLista, LinhaDeLista } from '../../ui/CardDeLista.js';
import { TituloDaTela } from '../../ui/Tela.js';
import { ARTES } from '../../ui/artes.js';
import { rgba, useTema } from '../../ui/theme.js';
import { nomeParaExibir } from '../../ui/nome.js';
import { Traco } from '../../ui/traco.js';

export interface PosicaoNoPlacar {
  readonly posicao: number;
  readonly nome: string;
  readonly pontos: number;
  readonly souEu: boolean;
}

export interface DesafioDoAluno {
  readonly id: string;
  readonly titulo: string;
  readonly meta: number;
  readonly progresso: number;
  readonly inscrito: boolean;
  /** `AAAA-MM-DD` */
  readonly inicio: string;
  readonly fim: string;
}

/** Contrato de `GET /api/v1/mobile/engajamento`. */
export interface DadosDoEngajamento {
  readonly asOf: string;
  readonly status: 'AVAILABLE';
  /** `AAAA-MM` no fuso da unidade do aluno. */
  readonly mes: string;
  readonly unidade: { readonly nome: string };
  readonly xp: {
    readonly saldoDoMes: number;
    /** `null` = a academia desligou conquistas. */
    readonly conquistas: readonly { titulo: string; desbloqueadaEm: string; revertida: boolean }[] | null;
  };
  readonly consistencia: { readonly atual: number; readonly recorde: number; readonly diasPorSemana: number };
  /** `null` = a academia desligou o ranking. */
  readonly ranking: {
    readonly participa: boolean;
    readonly nomeExibido: string;
    readonly minhaPosicao: { readonly posicao: number; readonly pontos: number } | null;
    readonly placar: readonly PosicaoNoPlacar[];
  } | null;
  /** `null` = a academia desligou desafios. */
  readonly desafios: readonly DesafioDoAluno[] | null;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTOS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/** `2026-09` -> `setembro`. Sem `Intl`: a lint barra, e o celular em ingles erraria o idioma. */
function nomeDoMes(mes: string): string {
  return MESES[Number(mes.slice(5, 7)) - 1] ?? mes;
}

/** `1240` -> `1.240`. XP e inteiro; o separador de milhar e o de pt-BR. */
function milhar(valor: number): string {
  return Math.trunc(valor).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
}

/** `2026-09-27` -> `{ dia: '27', mes: 'SET' }`. Data civil, sem fuso. */
function diaEMes(dataCivil: string): { dia: string; mes: string } {
  return { dia: dataCivil.slice(8, 10), mes: MESES_CURTOS[Number(dataCivil.slice(5, 7)) - 1] ?? '' };
}

/**
 * Aba Eventos do App Mobile v2 -- XP do mes, ranking opcional, conquistas e
 * desafios.
 *
 * NADA DE NIVEL. O prototipo desenha "NÍVEL 3 · ATLETA" e uma barra ate o
 * nivel 4, mas o dominio de engajamento (F31) nao tem nivel: inventar faixas
 * de XP aqui seria criar regra de produto dentro da tela. O card mostra o que
 * existe -- saldo do mes e a sequencia de semanas.
 *
 * RANKING E OPT-IN (`M5-BR-002`, DS-APP §5.4): fora dele o aluno ve o convite,
 * e sair custa um toque. Recusar o ranking NAO zera XP -- o saldo aparece do
 * mesmo jeito.
 */
export function Eventos({
  dados,
  salvandoRanking,
  onMudarRanking,
  testID,
}: {
  dados: DadosDoEngajamento;
  salvandoRanking: boolean;
  onMudarRanking: (participa: boolean) => void;
  testID?: string | undefined;
}) {
  const t = useTema();
  const conquistas = dados.xp.conquistas?.filter((c) => !c.revertida) ?? null;

  return (
    <View testID={testID} style={estilos.pilha}>
      <TituloDaTela>Eventos</TituloDaTela>

      <CartaoDeXp dados={dados} />

      {dados.ranking ? (
        <>
          <View style={estilos.linhaEntre}>
            <Text accessibilityRole="header" style={{ color: t.cor.text.primary, fontSize: 16, fontFamily: t.fonte(700) }}>
              Ranked do mês
            </Text>
            <Text style={{ color: t.cor.text.muted, fontSize: 12, fontFamily: t.fonte(400) }}>
              {`${nomeDoMes(dados.mes).replace(/^./u, (l) => l.toUpperCase())} · ${dados.unidade.nome}`}
            </Text>
          </View>

          {dados.ranking.participa ? (
            <Placar ranking={dados.ranking} salvando={salvandoRanking} onSair={() => onMudarRanking(false)} />
          ) : (
            <View
              testID="ranking-fora"
              style={[estilos.convite, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card, borderColor: t.cor.border.hairline }]}
            >
              <Text style={{ color: t.cor.text.primary, fontSize: 18, fontFamily: t.fonte(700), textAlign: 'center' }}>
                Você está fora do ranking
              </Text>
              <Text style={{ color: t.cor.text.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center', fontFamily: t.fonte(400) }}>
                A participação é opcional. Fora dele você não aparece na lista dos outros alunos, e seu XP continua contando.
              </Text>
              <Botao
                titulo="Participar do ranking"
                onPress={() => onMudarRanking(true)}
                carregando={salvandoRanking}
                testID="botao-participar-ranking"
              />
            </View>
          )}
        </>
      ) : null}

      {conquistas !== null ? (
        <View style={[estilos.cartao, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card, borderColor: t.cor.border.hairline }]}>
          <Text style={{ color: t.cor.text.primary, fontSize: 15, fontFamily: t.fonte(600) }}>Suas conquistas</Text>
          {conquistas.length === 0 ? (
            <Text style={{ color: t.cor.text.muted, fontSize: 13, lineHeight: 18, fontFamily: t.fonte(400) }}>
              As conquistas aparecem aqui conforme você treina.
            </Text>
          ) : (
            <View style={estilos.chips}>
              {conquistas.map((conquista) => (
                <View
                  key={`${conquista.titulo}-${conquista.desbloqueadaEm}`}
                  style={[estilos.chip, { backgroundColor: t.cor.bg.app, borderColor: t.cor.border.hairline }]}
                >
                  <Traco nome="trofeu" cor={t.cor.state.warn} tamanho={13} />
                  <Text style={{ color: t.cor.text.secondary, fontSize: 12, fontFamily: t.fonte(600) }}>{conquista.titulo}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {dados.desafios !== null ? (
        <>
          <Text accessibilityRole="header" style={{ color: t.cor.text.primary, fontSize: 16, fontFamily: t.fonte(700) }}>
            Desafios da academia
          </Text>
          <CardDeLista testID="lista-desafios">
            {dados.desafios.length === 0 ? (
              <LinhaDeLista primeira>
                <Text style={{ color: t.cor.text.muted, fontSize: 13, fontFamily: t.fonte(400) }}>
                  Nenhum desafio aberto agora.
                </Text>
              </LinhaDeLista>
            ) : (
              dados.desafios.map((desafio, indice) => {
                const { dia, mes } = diaEMes(desafio.fim);

                return (
                  <LinhaDeLista key={desafio.id} primeira={indice === 0} testID={`desafio-${desafio.id}`}>
                    <View style={[estilos.data, { backgroundColor: t.cor.bg.raised }]}>
                      <Text style={{ color: t.cor.text.primary, fontSize: 15, lineHeight: 16, fontVariant: ['tabular-nums'], fontFamily: t.fonte(800) }}>
                        {dia}
                      </Text>
                      <Text style={{ color: t.cor.accent.text, fontSize: 9, letterSpacing: 0.7, fontFamily: t.fonte(700) }}>{mes}</Text>
                    </View>
                    <View style={estilos.flex}>
                      <Text style={{ color: t.cor.text.primary, fontSize: 14, fontFamily: t.fonte(600) }}>{desafio.titulo}</Text>
                      <Text style={{ color: t.cor.text.muted, fontSize: 12, fontFamily: t.fonte(400) }}>
                        {desafio.inscrito
                          ? `${desafio.progresso} de ${desafio.meta} ${desafio.meta === 1 ? 'treino' : 'treinos'} · termina em ${dia}/${desafio.fim.slice(5, 7)}`
                          : `Meta de ${desafio.meta} ${desafio.meta === 1 ? 'treino' : 'treinos'} · inscrição no totem`}
                      </Text>
                    </View>
                    <View
                      style={[
                        estilos.selo,
                        desafio.inscrito
                          ? { backgroundColor: t.tint('ok').bg, borderColor: t.tint('ok').border }
                          : { backgroundColor: rgba(t.cor.accent.gradientFrom, 0.16), borderColor: rgba(t.cor.accent.text, 0.32) },
                      ]}
                    >
                      <Text style={{ color: desafio.inscrito ? t.cor.state.ok : t.cor.accent.text, fontSize: 11, fontFamily: t.fonte(700) }}>
                        {desafio.inscrito ? 'Inscrito' : 'Aberto'}
                      </Text>
                    </View>
                  </LinhaDeLista>
                );
              })
            )}
          </CardDeLista>
        </>
      ) : null}
    </View>
  );
}

function CartaoDeXp({ dados }: { dados: DadosDoEngajamento }) {
  const t = useTema();
  const flutuar = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let laco: Animated.CompositeAnimation | null = null;
    let vivo = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((reduzido) => {
      if (!vivo || reduzido) return;
      laco = Animated.loop(
        Animated.sequence([
          Animated.timing(flutuar, { toValue: 1, duration: 2500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(flutuar, { toValue: 0, duration: 2500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      laco.start();
    });

    return () => {
      vivo = false;
      laco?.stop();
    };
  }, [flutuar]);

  const { atual, recorde } = dados.consistencia;

  return (
    <View
      testID="cartao-xp"
      style={[estilos.xp, { backgroundColor: t.cor.bg.raised, borderRadius: t.radius.card + 2 }]}
    >
      <View pointerEvents="none" style={estilos.halo}>
        <Svg width={160} height={160}>
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={t.cor.accent.gradientFrom} stopOpacity={0.35} />
              <Stop offset="0.7" stopColor={t.cor.accent.gradientFrom} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={80} cy={80} r={80} fill="url(#halo)" />
        </Svg>
      </View>

      <Animated.Image
        source={ARTES.trofeu3d}
        style={[
          estilos.trofeu,
          { transform: [{ translateY: flutuar.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }] },
        ]}
        accessibilityIgnoresInvertColors
      />

      <View style={estilos.xpTexto}>
        <Text style={{ color: t.cor.accent.text, fontSize: 11, letterSpacing: 1.1, fontFamily: t.fonte(700) }}>
          {`XP DE ${nomeDoMes(dados.mes).toUpperCase()}`}
        </Text>
        <Text
          testID="xp-saldo"
          accessibilityLabel={`${dados.xp.saldoDoMes} pontos de experiência neste mês`}
          style={{ color: t.cor.text.primary, fontSize: 24, lineHeight: 28, fontVariant: ['tabular-nums'], fontFamily: t.fonte(800) }}
        >
          {milhar(dados.xp.saldoDoMes)} <Text style={{ color: t.cor.text.secondary, fontSize: 13, fontFamily: t.fonte(600) }}>XP</Text>
        </Text>
        <Text style={{ color: t.cor.text.secondary, fontSize: 11, lineHeight: 15, fontFamily: t.fonte(400) }}>
          {atual > 0
            ? `${atual} ${atual === 1 ? 'semana seguida' : 'semanas seguidas'} · recorde de ${recorde}`
            : `Treine ${dados.consistencia.diasPorSemana} dias numa semana para começar uma sequência`}
        </Text>
      </View>
    </View>
  );
}

function Placar({
  ranking,
  salvando,
  onSair,
}: {
  ranking: NonNullable<DadosDoEngajamento['ranking']>;
  salvando: boolean;
  onSair: () => void;
}) {
  const t = useTema();
  const [confirmando, setConfirmando] = useState(false);
  const euNaLista = ranking.placar.some((linha) => linha.souEu);

  const linhas: PosicaoNoPlacar[] = [...ranking.placar];
  if (!euNaLista && ranking.minhaPosicao) {
    linhas.push({ posicao: ranking.minhaPosicao.posicao, nome: ranking.nomeExibido, pontos: ranking.minhaPosicao.pontos, souEu: true });
  }

  return (
    <>
      <CardDeLista testID="placar">
        {linhas.length === 0 ? (
          <LinhaDeLista primeira>
            <Text style={{ color: t.cor.text.muted, fontSize: 13, lineHeight: 18, fontFamily: t.fonte(400) }}>
              O placar aparece quando a unidade tiver participantes suficientes neste mês.
            </Text>
          </LinhaDeLista>
        ) : (
          linhas.map((linha, indice) => (
            <LinhaDeLista
              key={`${linha.posicao}-${linha.nome}-${linha.souEu ? 'eu' : 'outro'}`}
              primeira={indice === 0}
              destaque={linha.souEu}
              accessibilityLabel={`${linha.posicao}º lugar, ${linha.souEu ? `você, ${linha.nome}` : linha.nome}, ${linha.pontos} XP`}
              testID={linha.souEu ? 'placar-eu' : undefined}
            >
              <View
                style={[
                  estilos.posicao,
                  { backgroundColor: linha.souEu ? t.cor.accent.solid : t.cor.bg.raised },
                ]}
              >
                <Text
                  style={{
                    color: linha.souEu ? t.cor.accent.onAccent : t.cor.text.secondary,
                    fontSize: 13,
                    fontVariant: ['tabular-nums'],
                    fontFamily: t.fonte(700),
                  }}
                >
                  {linha.posicao}
                </Text>
              </View>
              <Text style={[estilos.flex, { color: t.cor.text.primary, fontSize: 15, fontFamily: t.fonte(linha.souEu ? 700 : 500) }]}>
                {linha.souEu ? `Você (${nomeParaExibir(linha.nome)})` : nomeParaExibir(linha.nome)}
              </Text>
              <Text style={{ color: t.cor.text.secondary, fontSize: 14, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }}>
                {`${milhar(linha.pontos)} XP`}
              </Text>
            </LinhaDeLista>
          ))
        )}
      </CardDeLista>

      <View style={estilos.rodapeDoPlacar}>
        {ranking.nomeExibido ? (
          <Text style={{ color: t.cor.text.muted, fontSize: 12, fontFamily: t.fonte(400) }}>
            Você aparece como <Text style={{ color: t.cor.text.secondary, fontFamily: t.fonte(700) }}>{nomeParaExibir(ranking.nomeExibido)}</Text> ·{' '}
          </Text>
        ) : null}
        {confirmando ? (
          <Pressable onPress={onSair} disabled={salvando} accessibilityRole="button" testID="botao-confirmar-sair-ranking" hitSlop={10}>
            <Text style={{ color: t.cor.state.err, fontSize: 12, fontFamily: t.fonte(700) }}>
              {salvando ? 'Saindo…' : 'Confirmar saída'}
            </Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => setConfirmando(true)} accessibilityRole="button" testID="botao-sair-ranking" hitSlop={10}>
            <Text style={{ color: t.cor.accent.text, fontSize: 12, fontFamily: t.fonte(600) }}>Sair do ranking</Text>
          </Pressable>
        )}
      </View>
    </>
  );
}

const estilos = StyleSheet.create({
  pilha: {
    gap: 14,
  },
  flex: {
    flex: 1,
  },
  linhaEntre: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  xp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 18,
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  halo: {
    position: 'absolute',
    right: -30,
    top: -30,
  },
  trofeu: {
    width: 84,
    height: 84,
    borderRadius: 16,
  },
  xpTexto: {
    flex: 1,
    gap: 6,
  },
  convite: {
    borderWidth: 1,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'stretch',
    gap: 12,
  },
  cartao: {
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 10,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  posicao: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rodapeDoPlacar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  data: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selo: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
});

