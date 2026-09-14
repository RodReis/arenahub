import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { rgba, useTema } from '../../ui/theme.js';

/**
 * Movimento da abertura: linha de escaneamento, dois aneis em orbita e um
 * brilho que respira -- o "corpo sendo medido" do prototipo v2.
 *
 * `prefers-reduced-motion` do SO DESLIGA TUDO (PRODUCT.md, acessibilidade):
 * com o movimento reduzido a arte continua la, parada, e nenhuma informacao se
 * perde -- os efeitos sao atmosfera, nao conteudo.
 *
 * Tudo em `transform`/`opacity` com `useNativeDriver`: nada recalcula layout
 * por quadro, e a animacao roda na thread de UI mesmo com o JS ocupado no
 * login.
 */
export function EfeitosDoHero() {
  const t = useTema();
  const [reduzido, setReduzido] = useState<boolean | null>(null);

  const scan = useRef(new Animated.Value(0)).current;
  const orbita = useRef(new Animated.Value(0)).current;
  const brilho = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let vivo = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((valor) => {
      if (vivo) setReduzido(valor);
    });
    const assinatura = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduzido);

    return () => {
      vivo = false;
      assinatura.remove();
    };
  }, []);

  useEffect(() => {
    if (reduzido !== false) return;

    const laco = (valor: Animated.Value, duracao: number, easing: (x: number) => number) =>
      Animated.loop(
        Animated.timing(valor, { toValue: 1, duration: duracao, easing, useNativeDriver: true }),
      );

    const animacoes = [
      laco(scan, 4500, Easing.inOut(Easing.ease)),
      laco(orbita, 14000, Easing.linear),
      Animated.loop(
        Animated.sequence([
          Animated.timing(brilho, { toValue: 1, duration: 2500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(brilho, { toValue: 0, duration: 2500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ),
    ];

    animacoes.forEach((a) => a.start());
    return () => animacoes.forEach((a) => a.stop());
  }, [reduzido, scan, orbita, brilho]);

  if (reduzido !== false) return null;

  const giro = orbita.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const giroInverso = orbita.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-180deg'] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
      <Animated.View style={[estilos.brilho, { opacity: brilho.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) }]}>
        {/* Radial, e nao disco chapado: RN nao tem gradiente radial, o SVG tem. */}
        <Svg width={300} height={300}>
          <Defs>
            <RadialGradient id="brilho" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={t.cor.accent.gradientFrom} stopOpacity={0.28} />
              <Stop offset="0.65" stopColor={t.cor.accent.gradientFrom} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={150} cy={150} r={150} fill="url(#brilho)" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[
          estilos.anel,
          estilos.anelMenor,
          {
            borderColor: rgba(t.cor.accent.text, 0.28),
            borderTopColor: rgba(t.cor.accent.soft, 0.9),
            transform: [{ rotate: giro }],
          },
        ]}
      />
      <Animated.View
        style={[
          estilos.anel,
          estilos.anelMaior,
          { borderColor: rgba(t.cor.accent.text, 0.18), transform: [{ rotate: giroInverso }] },
        ]}
      />
      <Animated.View
        style={[
          estilos.scan,
          {
            shadowColor: t.cor.accent.gradientFrom,
            opacity: scan.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 0.9, 0.9, 0] }),
            transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [-40, 300] }) }],
          },
        ]}
      >
        <LinearGradient
          colors={[rgba(t.cor.accent.ink, 0), t.cor.accent.ink, t.cor.accent.soft, t.cor.accent.ink, rgba(t.cor.accent.ink, 0)]}
          locations={[0, 0.3, 0.5, 0.7, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const estilos = StyleSheet.create({
  scan: {
    position: 'absolute',
    left: '10%',
    right: '10%',
    top: '22%',
    height: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 6,
  },
  anel: {
    position: 'absolute',
    left: '50%',
    top: '48%',
    borderWidth: 1,
    borderRadius: 999,
  },
  anelMenor: {
    width: 260,
    height: 260,
    marginLeft: -130,
    marginTop: -130,
  },
  anelMaior: {
    width: 320,
    height: 320,
    marginLeft: -160,
    marginTop: -160,
    borderStyle: 'dashed',
  },
  brilho: {
    position: 'absolute',
    left: '50%',
    top: '40%',
    width: 300,
    height: 300,
    marginLeft: -150,
    marginTop: -150,
  },
});
