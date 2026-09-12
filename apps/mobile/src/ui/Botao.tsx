import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { useTema } from './theme.js';

export type VarianteDeBotao = 'primario' | 'secundario' | 'neutro';

/**
 * Botao -- DS-APP.md §4.2.
 *
 * Tres variantes, e a regra que as separa nao e estetica: **um botao primario
 * por tela** (§8). O primario e a unica acao principal; secundario e apoio;
 * neutro fecha e cancela.
 *
 * A altura padrao e 48 px, e 44 dentro de card e sheet -- os dois valores sao
 * tokens, e o gate recusa qualquer um abaixo de 44 (§2.8/§7).
 */
export function Botao({
  titulo,
  onPress,
  variante = 'primario',
  emCard = false,
  carregando = false,
  desabilitado = false,
  icone,
  testID,
}: {
  titulo: string;
  onPress: () => void;
  variante?: VarianteDeBotao;
  /** Dentro de card ou sheet o botao tem 44 px, nao 48 (§2.8). */
  emCard?: boolean;
  carregando?: boolean;
  desabilitado?: boolean;
  icone?: ReactNode;
  testID?: string | undefined;
}) {
  const t = useTema();
  const inativo = desabilitado || carregando;

  const fundo =
    variante === 'primario' ? t.cor.accent.solid : 'transparent';
  const borda =
    variante === 'primario' ? 'transparent' : t.cor.border.default;
  const tinta =
    variante === 'primario'
      ? t.cor.accent.onAccent
      : variante === 'secundario'
        ? t.cor.accent.hover
        : t.cor.text.primary;

  const papel =
    variante === 'primario' ? t.type.buttonPrimary : t.type.buttonSecondary;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inativo}
      accessibilityRole="button"
      accessibilityLabel={titulo}
      accessibilityState={{ disabled: inativo, busy: carregando }}
      style={({ pressed }) => [
        estilos.base,
        {
          height: emCard ? t.size.controlInCard : t.size.control,
          borderRadius: t.radius.control,
          backgroundColor: fundo,
          borderColor: borda,
          gap: 8,
          // Sem `hover` no aparelho: o feedback de toque e a opacidade. O
          // valor vive aqui e nao em token porque e comportamento de
          // plataforma, nao decisao de design (§2.10 so define hover na web).
          opacity: inativo ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {carregando ? (
        <ActivityIndicator size="small" color={tinta} />
      ) : (
        <>
          {icone ? <View accessibilityElementsHidden>{icone}</View> : null}
          <Text
            style={{
              color: tinta,
              fontSize: papel.size,
              lineHeight: papel.lineHeight,
              fontWeight: String(papel.weight) as '600' | '700',
            }}
          >
            {titulo}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 16,
  },
});
