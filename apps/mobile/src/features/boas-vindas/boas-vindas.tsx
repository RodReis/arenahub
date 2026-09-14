import { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Botao } from '../../ui/Botao.js';
import { Marca } from '../../ui/Marca.js';
import { ARTES } from '../../ui/artes.js';
import { rgba, useTema } from '../../ui/theme.js';
import { Traco, type NomeDoTraco } from '../../ui/traco.js';
import { EfeitosDoHero } from './efeitos-do-hero.js';

/**
 * O que o app entrega, em quatro tiles -- os quatro pilares que o aluno usa.
 *
 * Nenhum tile promete funcao que o app nao tem: avaliacao com medida e faixa,
 * evolucao mes a mes, XP e ranking mensal, e plano com PIX. A carteirinha
 * digital do prototipo SAIU do texto do tile de planos: foi cortada pelo PI na
 * F24 e o app nao a oferece.
 */
const TILES: readonly { traco: NomeDoTraco; titulo: string; texto: string }[] = [
  { traco: 'corpo', titulo: 'Bioimpedância', texto: 'Faixas e leitura por região do corpo' },
  { traco: 'evolucao', titulo: 'Evolução', texto: 'Peso, gordura e músculo mês a mês' },
  { traco: 'trofeu', titulo: 'Ranked & XP', texto: 'Pontos a cada treino e ranking mensal' },
  { traco: 'cartao', titulo: 'Planos', texto: 'Mensalidade, PIX e cartão' },
];

/**
 * Abertura do app para quem ainda nao entrou -- App Mobile v2.
 *
 * A ARTE E ESCURA NOS DOIS TEMAS: a foto do corpo em 3D e escura, e o texto
 * por cima usa a rampa do tema escuro. Quem renderiza envolve esta tela em
 * `ProvedorDeTema forcarTema="dark"` -- sem isso, no tema claro, o titulo
 * sairia em carvao sobre a foto preta.
 *
 * Sem link "Fale com a academia": o app nao tem contato da academia a
 * oferecer, e um link que nao leva a lugar nenhum e pior que texto.
 */
export function BoasVindas({ onEntrar, testID }: { onEntrar: () => void; testID?: string }) {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const subida = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(subida, { toValue: 1, duration: 700, useNativeDriver: true }).start();
  }, [subida]);

  const entrada = (atraso: number) => ({
    opacity: subida.interpolate({ inputRange: [atraso, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [
      { translateY: subida.interpolate({ inputRange: [atraso, 1], outputRange: [14, 0], extrapolate: 'clamp' }) },
    ],
  });

  return (
    <View testID={testID} style={[estilos.raiz, { backgroundColor: t.cor.bg.app }]}>
      <Image
        source={ARTES.bio3d}
        style={[StyleSheet.absoluteFill, estilos.arte]}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
      <LinearGradient
        colors={[
          rgba(t.cor.bg.app, 0.6),
          rgba(t.cor.bg.app, 0.05),
          rgba(t.cor.bg.app, 0),
          rgba(t.cor.bg.app, 0.55),
          rgba(t.cor.bg.app, 0.94),
          t.cor.bg.app,
        ]}
        locations={[0, 0.18, 0.4, 0.56, 0.7, 0.82]}
        style={StyleSheet.absoluteFill}
      />
      <EfeitosDoHero />

      <View
        style={[
          estilos.conteudo,
          { paddingTop: Math.max(inset.top + 4, 62), paddingBottom: Math.max(inset.bottom + 12, 26) },
        ]}
      >
        <View style={estilos.topo}>
          <View style={estilos.marca}>
            <Marca />
            <View>
              <Text style={{ color: t.cor.text.primary, fontSize: 13, fontFamily: t.fonte(700) }}>
                Clínica de Musculação
              </Text>
              <Text style={{ color: t.cor.accent.text, fontSize: 10, letterSpacing: 1, fontFamily: t.fonte(600) }}>
                APP DO ALUNO
              </Text>
            </View>
          </View>
          <Pressable
            onPress={onEntrar}
            accessibilityRole="button"
            testID="botao-ja-sou-aluno"
            style={({ pressed }) => [
              estilos.jaSouAluno,
              {
                borderColor: pressed ? t.cor.accent.text : rgba(t.cor.accent.text, 0.35),
                backgroundColor: rgba(t.cor.bg.app, 0.45),
              },
            ]}
          >
            <Text style={{ color: t.cor.accent.soft, fontSize: 12, fontFamily: t.fonte(600) }}>Já sou aluno</Text>
          </Pressable>
        </View>

        <View style={estilos.respiro} />

        <Animated.View style={[estilos.chamada, entrada(0)]}>
          <Text style={{ color: t.cor.accent.text, fontSize: 11, letterSpacing: 1.5, fontFamily: t.fonte(700) }}>
            MUSCULAÇÃO · SAÚDE · PERFORMANCE
          </Text>
          <Text
            accessibilityRole="header"
            style={{ color: t.cor.text.primary, fontSize: 32, lineHeight: 36, letterSpacing: -0.8, fontFamily: t.fonte(800) }}
          >
            Disciplina hoje. <Text style={{ color: t.cor.accent.ink }}>Resultados sempre.</Text>
          </Text>
          <Text style={{ color: t.cor.text.onImageMuted, fontSize: 14, lineHeight: 20, maxWidth: 300, fontFamily: t.fonte(400) }}>
            Sua avaliação, sua evolução e sua academia em um só lugar.
          </Text>
        </Animated.View>

        <Animated.View style={[estilos.tiles, entrada(0.15)]}>
          {TILES.map((tile) => (
            <View
              key={tile.titulo}
              style={[
                estilos.tile,
                { backgroundColor: rgba(t.cor.bg.surface, 0.62), borderColor: rgba(t.cor.accent.text, 0.18) },
              ]}
            >
              <Traco nome={tile.traco} cor={t.cor.accent.ink} tamanho={20} espessura={1.9} />
              <View>
                <Text style={{ color: t.cor.text.primary, fontSize: 13, fontFamily: t.fonte(700) }}>{tile.titulo}</Text>
                <Text style={{ color: t.cor.text.secondary, fontSize: 11, lineHeight: 15, fontFamily: t.fonte(400) }}>
                  {tile.texto}
                </Text>
              </View>
            </View>
          ))}
        </Animated.View>

        <Animated.View style={[estilos.acoes, entrada(0.3)]}>
          <View style={[estilos.sombraDoCta, { shadowColor: t.cor.accent.gradientFrom }]}>
            <Botao titulo="Entrar" onPress={onEntrar} testID="botao-abrir-login" />
          </View>
          <Text style={{ color: t.cor.text.muted, fontSize: 12, textAlign: 'center', fontFamily: t.fonte(400) }}>
            Ainda não é aluno? Procure a recepção da academia.
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  raiz: {
    flex: 1,
  },
  arte: {
    width: '100%',
    height: '100%',
  },
  conteudo: {
    flex: 1,
    paddingHorizontal: 22,
  },
  topo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  marca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  jaSouAluno: {
    height: 34,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 999,
    justifyContent: 'center',
  },
  respiro: {
    flex: 1,
  },
  chamada: {
    gap: 6,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
  },
  tile: {
    // Duas colunas com 8 px de calha: (100% - 8) / 2, sem medir a tela.
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  acoes: {
    gap: 10,
    marginTop: 16,
  },
  sombraDoCta: {
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 15,
    elevation: 8,
    borderRadius: 14,
  },
});
