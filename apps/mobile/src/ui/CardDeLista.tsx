import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';

import { useTema } from './theme.js';

/**
 * Card de lista do App Mobile v2 -- "Avisos da academia", "Meus dados",
 * "Histórico de pagamentos".
 *
 * Cabecalho com fio embaixo e linhas separadas por fio `hairline`, sem padding
 * lateral no conteiner: e a linha que tem o respiro, para o fio atravessar o
 * card de ponta a ponta como no prototipo.
 */
export function CardDeLista({
  titulo,
  acao,
  children,
  testID,
}: {
  titulo?: string;
  /** Texto de acao a direita do titulo ("Ver todos"). */
  acao?: { rotulo: string; onPress: () => void; testID?: string } | undefined;
  children: ReactNode;
  testID?: string | undefined;
}) {
  const t = useTema();

  return (
    <View
      testID={testID}
      style={[
        estilos.card,
        {
          backgroundColor: t.cor.bg.surface,
          borderRadius: t.radius.card,
          borderColor: t.cor.border.hairline,
        },
      ]}
    >
      {titulo ? (
        <View style={[estilos.cabecalho, { borderBottomColor: t.cor.border.hairline }]}>
          <Text
            style={{ color: t.cor.text.primary, fontSize: 15, lineHeight: 20, fontFamily: t.fonte(600) }}
            accessibilityRole="header"
          >
            {titulo}
          </Text>
          {acao ? (
            <Pressable
              onPress={acao.onPress}
              accessibilityRole="button"
              testID={acao.testID}
              hitSlop={12}
            >
              <Text style={{ color: t.cor.accent.text, fontSize: 13, fontFamily: t.fonte(600) }}>
                {acao.rotulo}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Uma linha do card de lista: fio em cima, altura minima de alvo tocavel. */
export function LinhaDeLista({
  children,
  onPress,
  primeira = false,
  destaque = false,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  onPress?: (() => void) | undefined;
  /** Sem fio em cima -- quando o card nao tem cabecalho. */
  primeira?: boolean;
  /** Fundo tonal -- a linha do proprio aluno no ranking. */
  destaque?: boolean;
  accessibilityLabel?: string | undefined;
  testID?: string | undefined;
}) {
  const t = useTema();

  const estilo = [
    estilos.linha,
    {
      borderTopWidth: primeira ? 0 : 1,
      borderTopColor: t.cor.border.hairline,
      backgroundColor: destaque ? t.cor.accent.tint : 'transparent',
    },
  ];

  if (!onPress) {
    return (
      <View style={estilo} testID={testID} accessibilityLabel={accessibilityLabel}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [...estilo, pressed && { backgroundColor: t.cor.bg.raised }]}
    >
      {children}
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderWidth: 1,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
});
