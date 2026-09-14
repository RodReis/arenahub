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
 * A BORDA VEM LIGADA, e isso contraria a letra do §4.3 ("sem borda quando o
 * contraste de superficie ja separa"). A razao e medida, nao estetica: a
 * separacao entre as tres superficies fica entre 1.07 e 1.22 nos DOIS temas,
 * e nesse patamar ela nao separa nada. Sem borda o card desaparece no fundo
 * -- visivel na primeira vez que a vitrine abriu no tema claro, com o card de
 * plano indistinguivel da pagina.
 *
 * `semBorda` existe para o caso em que o §4.3 esta certo: card sobre uma
 * superficie de nivel diferente o bastante, onde o contorno vira ruido.
 */
export function Card({
  children,
  titulo,
  acessorio,
  destaque = false,
  semBorda = false,
  testID,
}: {
  children?: ReactNode;
  titulo?: string;
  /** Badge ou metrica a direita do titulo (§4.3). */
  acessorio?: ReactNode;
  destaque?: boolean;
  /** Desliga o contorno. Ver o porque no cabecalho -- o padrao e COM borda. */
  semBorda?: boolean | undefined;
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
          borderWidth: semBorda ? 0 : 1,
          /*
           * `hairline`, e nao `default` -- App Mobile v2. O prototipo v2 pinta
           * card sem contorno visivel no escuro; o fio `hairline` mantem a
           * separacao medida acima sem o traco claro de `default`, que e a
           * borda de CONTROLE tocavel (WCAG 1.4.11 vale para campo e botao,
           * nao para card). No claro, `hairline` e exatamente o `#E5E9EE` que
           * o DS-APP §2.1 pede em todo card branco.
           */
          borderColor: t.cor.border.hairline,
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
              fontFamily: t.fonte(600),
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
        borderTopColor: t.cor.border.hairline,
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
