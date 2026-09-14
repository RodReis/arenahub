import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTema } from './theme.js';

/**
 * Controle segmentado do App Mobile v2 -- PIX | Cartão.
 *
 * `tablist`/`tab` e nao botao solto: leitor de tela anuncia "1 de 2,
 * selecionado", que e a informacao que a cor da aba ativa carrega para quem ve.
 */
export function Segmentado<T extends string>({
  opcoes,
  valor,
  onMudar,
  testID,
}: {
  opcoes: readonly { valor: T; rotulo: string }[];
  valor: T;
  onMudar: (valor: T) => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  return (
    <View
      accessibilityRole="tablist"
      testID={testID}
      style={[estilos.trilho, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.control }]}
    >
      {opcoes.map((opcao) => {
        const ativa = opcao.valor === valor;

        return (
          <Pressable
            key={opcao.valor}
            onPress={() => onMudar(opcao.valor)}
            accessibilityRole="tab"
            accessibilityState={{ selected: ativa }}
            testID={testID ? `${testID}-${opcao.valor}` : undefined}
            style={[
              estilos.aba,
              {
                height: t.size.segment,
                borderRadius: t.radius.segment,
                backgroundColor: ativa ? t.cor.accent.solid : 'transparent',
              },
            ]}
          >
            <Text
              style={{
                color: ativa ? t.cor.accent.onAccent : t.cor.text.secondary,
                fontSize: 14,
                fontFamily: t.fonte(600),
              }}
            >
              {opcao.rotulo}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pilulas de periodo -- 30D · 90D · 6M · 1A (DS-APP §3.5). */
export function Pilulas<T extends string>({
  opcoes,
  valor,
  onMudar,
  testID,
}: {
  opcoes: readonly { valor: T; rotulo: string; acessivel?: string }[];
  valor: T;
  onMudar: (valor: T) => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  return (
    <View style={estilos.pilulas} accessibilityRole="tablist">
      {opcoes.map((opcao) => {
        const ativa = opcao.valor === valor;

        return (
          <Pressable
            key={opcao.valor}
            onPress={() => onMudar(opcao.valor)}
            accessibilityRole="tab"
            accessibilityState={{ selected: ativa }}
            accessibilityLabel={opcao.acessivel ?? opcao.rotulo}
            testID={testID ? `${testID}-${opcao.valor}` : undefined}
            // O desenho tem 30 px; o alvo tocavel chega a 44 pelo `hitSlop`,
            // sem engordar a pilula que o prototipo desenhou fina.
            hitSlop={{ top: 7, bottom: 7, left: 2, right: 2 }}
            style={[
              estilos.pilula,
              {
                height: t.size.chip,
                borderRadius: t.radius.pill,
                backgroundColor: ativa ? t.cor.accent.solid : t.cor.bg.app,
              },
            ]}
          >
            <Text
              style={{
                color: ativa ? t.cor.accent.onAccent : t.cor.text.secondary,
                fontSize: 12,
                fontFamily: t.fonte(600),
              }}
            >
              {opcao.rotulo}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  trilho: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
  },
  aba: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pilulas: {
    flexDirection: 'row',
    gap: 6,
  },
  pilula: {
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
