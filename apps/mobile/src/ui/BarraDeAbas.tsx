import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTema } from './theme.js';
import { Traco, type NomeDoTraco } from './traco.js';

export type AbaPrincipal = 'inicio' | 'eventos' | 'evolucao' | 'planos' | 'perfil';

const ABAS: readonly { aba: AbaPrincipal; rotulo: string; traco: NomeDoTraco }[] = [
  { aba: 'inicio', rotulo: 'Início', traco: 'inicio' },
  { aba: 'eventos', rotulo: 'Eventos', traco: 'trofeu' },
  { aba: 'evolucao', rotulo: 'Evolução', traco: 'evolucaoAba' },
  { aba: 'planos', rotulo: 'Planos', traco: 'cartao' },
  { aba: 'perfil', rotulo: 'Perfil', traco: 'perfil' },
];

/**
 * Barra de abas do App Mobile v2.
 *
 * A EVOLUCAO FICA NO CENTRO E ELEVADA, num medalhao em gradiente: e a aba que
 * o prototipo elegeu como o motivo de abrir o app -- o corpo em 3D e o
 * historico. As outras quatro sao traco simples.
 *
 * Cor nunca e o unico canal da aba ativa: `accessibilityState.selected` diz
 * ao leitor de tela, e o rotulo esta sempre escrito.
 */
export function BarraDeAbas({
  ativa,
  onIr,
}: {
  ativa: AbaPrincipal;
  onIr: (aba: AbaPrincipal) => void;
}) {
  const t = useTema();
  const inset = useSafeAreaInsets();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        estilos.barra,
        {
          backgroundColor: t.cor.bg.app,
          borderTopColor: t.cor.border.hairline,
          paddingBottom: Math.max(inset.bottom, 12),
        },
      ]}
    >
      {ABAS.map(({ aba, rotulo, traco }) => {
        const selecionada = aba === ativa;
        const cor = selecionada ? t.cor.accent.text : t.cor.text.muted;
        const central = aba === 'evolucao';

        return (
          <Pressable
            key={aba}
            onPress={() => onIr(aba)}
            accessibilityRole="tab"
            accessibilityLabel={rotulo}
            accessibilityState={{ selected: selecionada }}
            testID={`aba-${aba}`}
            style={[estilos.botao, central && estilos.botaoCentral]}
          >
            {central ? (
              <View
                style={[
                  estilos.anel,
                  {
                    backgroundColor: t.cor.bg.app,
                    transform: [{ scale: selecionada ? 1.08 : 1 }],
                  },
                ]}
              >
                <LinearGradient
                  colors={[t.cor.accent.gradientFrom, t.cor.accent.gradientTo]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[estilos.medalhao, { shadowColor: t.cor.accent.solid }]}
                >
                  <Traco nome={traco} cor={t.cor.accent.onAccent} tamanho={24} espessura={2.2} />
                </LinearGradient>
              </View>
            ) : (
              <Traco nome={traco} cor={cor} tamanho={20} />
            )}
            <Text
              style={{
                color: cor,
                fontSize: 10,
                lineHeight: 13,
                fontFamily: t.fonte(central ? 700 : 600),
              }}
            >
              {rotulo}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 6,
  },
  botao: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  botaoCentral: {
    justifyContent: 'flex-end',
    paddingBottom: 2,
  },
  anel: {
    position: 'absolute',
    bottom: 17,
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalhao: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 10,
  },
});
