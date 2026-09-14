import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTema } from './theme.js';

/**
 * Folha inferior (bottom sheet) do App Mobile v2 -- login e confirmacoes.
 *
 * `Modal` nativo, e nao `View` absoluta: o `Modal` prende o foco do leitor de
 * tela dentro da folha e o botao voltar do Android fecha a folha em vez de
 * sair do app. Uma camada absoluta deixaria o conteudo de tras navegavel por
 * VoiceOver, que e o defeito classico de sheet feito a mao.
 *
 * Tocar no fundo fecha, como no prototipo; o `onFechar` e obrigatorio -- folha
 * sem saida e tela de espera sem saida (DS-APP §4.10).
 */
export function Folha({
  aberta,
  onFechar,
  children,
  testID,
}: {
  aberta: boolean;
  onFechar: () => void;
  children: ReactNode;
  testID?: string | undefined;
}) {
  const t = useTema();
  // O `Modal` desenha por cima da barra de gestos: sem o inset, o ultimo
  // botao da folha fica sob o indicador do Android (visto no emulador).
  const inset = useSafeAreaInsets();

  return (
    <Modal
      visible={aberta}
      transparent
      animationType="slide"
      onRequestClose={onFechar}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        // `padding` NOS DOIS SISTEMAS: com edge-to-edge (padrao do SDK 57) o
        // Android nao redimensiona a janela de um `Modal` translucido, e sem
        // comportamento aqui o teclado cobria os campos do login -- achado no
        // emulador, que nenhum teste de componente enxerga.
        behavior="padding"
        style={estilos.fundo}
      >
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: t.cor.scrim.default }]}
          onPress={onFechar}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        />
        <View
          testID={testID}
          style={[
            estilos.painel,
            {
              backgroundColor: t.cor.bg.surface,
              borderTopLeftRadius: t.radius.sheet + 2,
              borderTopRightRadius: t.radius.sheet + 2,
              paddingBottom: Math.max(inset.bottom + 16, 32),
            },
          ]}
        >
          <View
            accessibilityElementsHidden
            style={[estilos.alca, { backgroundColor: t.cor.border.hairline }]}
          />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  fundo: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  painel: {
    paddingTop: 14,
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 14,
  },
  alca: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
  },
});
