import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { useTema } from './theme.js';

export type VarianteDeBotao = 'primario' | 'secundario' | 'neutro';

/**
 * Botao -- DS-APP.md v2.1 §4.2.
 *
 * Tres variantes, e a regra que as separa nao e estetica: **um botao primario
 * por tela** (§8). O primario e a unica acao principal; secundario e apoio;
 * neutro fecha e cancela.
 *
 * O PRIMARIO E GRADIENTE, nunca azul chapado -- §2.3: "gradiente e acao,
 * tinta e informacao", e o §8 repete no checklist. `accent.solid` existe para
 * barra, chip e medalhao; usa-lo como fundo de botao apaga a distincao entre
 * o que se toca e o que se le.
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
  const primario = variante === 'primario';

  const tinta = primario
    ? t.cor.accent.onAccent
    : variante === 'secundario'
      ? t.cor.accent.text
      : t.cor.text.primary;

  const papel = primario ? t.type.buttonPrimary : t.type.buttonSecondary;
  const altura = emCard ? t.size.controlInCard : t.size.control;

  const conteudo = carregando ? (
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
  );

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inativo}
      accessibilityRole="button"
      accessibilityLabel={titulo}
      accessibilityState={{ disabled: inativo, busy: carregando }}
      style={({ pressed }) => [
        estilos.envoltorio,
        {
          height: altura,
          borderRadius: t.radius.control,
          // Sem `hover` no aparelho: o feedback de toque e a opacidade. O
          // valor vive aqui e nao em token porque e comportamento de
          // plataforma, nao decisao de design (§2.10 so define hover na web).
          opacity: inativo ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {primario ? (
        <LinearGradient
          colors={[t.cor.accent.gradientFrom, t.cor.accent.gradientTo]}
          // 100deg do §2.3. No RN o gradiente vai por par de pontos, nao por
          // angulo: este par e a diagonal equivalente, quase horizontal.
          start={{ x: 0, y: 0.15 }}
          end={{ x: 1, y: 0.85 }}
          style={[estilos.miolo, { height: altura, borderRadius: t.radius.control }]}
        >
          {conteudo}
        </LinearGradient>
      ) : (
        <View
          style={[
            estilos.miolo,
            {
              height: altura,
              borderRadius: t.radius.control,
              borderWidth: 1,
              borderColor: t.cor.border.default,
            },
          ]}
        >
          {conteudo}
        </View>
      )}
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  envoltorio: {
    overflow: 'hidden',
  },
  miolo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
});
