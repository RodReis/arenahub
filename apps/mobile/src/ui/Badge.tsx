import { StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { useTema, type Tom } from './theme.js';

/**
 * Badge de estado -- DS-APP.md §4.4.
 *
 * O `icone` NAO e opcional por capricho de API: o §7 diz que estado nunca e
 * so por cor, e o §8 repete no checklist. Um badge verde sem glifo e
 * indistinguivel de um laranja para quem nao separa as duas cores, e o unico
 * canal que sobra e justamente o que falta. O tipo obriga; a revisao nao
 * precisa lembrar.
 *
 * Fundo e borda saem da receita do tema (16% e 34% no escuro, 10% e 32% no
 * claro) e nao de hex fixo -- o mesmo par que o gate de contraste mede.
 */
export function Badge({
  tom,
  texto,
  icone,
  testID,
}: {
  tom: Tom;
  texto: string;
  /** Obrigatorio: cor nunca e o unico canal (§7). */
  icone: ReactNode;
  testID?: string | undefined;
}) {
  const t = useTema();
  const { bg, border } = t.tint(tom);

  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={texto}
      style={[
        estilos.base,
        {
          height: t.size.badge,
          borderRadius: t.radius.pill,
          backgroundColor: bg,
          borderColor: border,
        },
      ]}
    >
      <View accessibilityElementsHidden>{icone}</View>
      <Text
        numberOfLines={1}
        style={{
          color: t.cor.state[tom],
          fontSize: t.type.tileLabel.size,
          lineHeight: t.type.tileLabel.lineHeight,
          fontFamily: t.fonte(600),
        }}
      >
        {texto}
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
});
