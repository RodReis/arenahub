import { StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { useTema } from './theme.js';

/**
 * Card -- DS-APP.md §4.3.
 *
 * `destaque` troca a superficie de `bg/surface` para `bg/raised`: e o card
 * principal da tela (plano, fatura). Nao ha sombra em lugar nenhum (§2.7) --
 * a hierarquia vem dos tres niveis de superficie, e so deles. Um `elevation`
 * ou `shadowOpacity` aqui contraria o §8 e some com a unica pista de
 * profundidade que o design quis.
 *
 * A borda so aparece quando o card esta sobre superficie do MESMO nivel; com
 * contraste de superficie ela e ruido.
 */
export function Card({
  children,
  titulo,
  acessorio,
  destaque = false,
  comBorda = false,
  testID,
}: {
  children?: ReactNode;
  titulo?: string;
  /** Badge ou metrica a direita do titulo (§4.3). */
  acessorio?: ReactNode;
  destaque?: boolean;
  comBorda?: boolean;
  testID?: string | undefined;
}) {
  const t = useTema();

  return (
    <View
      testID={testID}
      style={[
        estilos.base,
        {
          backgroundColor: destaque ? t.cor.bg.raised : t.cor.bg.surface,
          borderRadius: t.radius.card,
          borderWidth: comBorda ? 1 : 0,
          borderColor: t.cor.border.default,
        },
      ]}
    >
      {titulo ? (
        <View style={estilos.cabecalho}>
          <Text
            style={{
              color: t.cor.text.primary,
              fontSize: t.type.cardTitle.size,
              lineHeight: t.type.cardTitle.lineHeight,
              fontWeight: '600',
            }}
          >
            {titulo}
          </Text>
          {acessorio}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Divisor interno do card -- §4.3: linha em `border/default` e 12 px acima. */
export function DivisorDeCard({ children }: { children: ReactNode }) {
  const t = useTema();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: t.cor.border.default,
        paddingTop: 12,
        gap: 8,
      }}
    >
      {children}
    </View>
  );
}

const estilos = StyleSheet.create({
  base: {
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 10,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});
