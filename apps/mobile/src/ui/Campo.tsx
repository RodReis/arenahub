import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { useTema } from './theme.js';

/**
 * Campo de texto -- DS-APP.md §4.1.
 *
 * O ROTULO E OBRIGATORIO, e nao e detalhe de API: o §7 exige `<label>` em
 * todo campo, e e o rotulo que carrega a informacao quando o placeholder
 * some ao digitar. `text/placeholder` e isento do alvo de contraste
 * justamente porque nao pode ser o unico portador do sentido.
 *
 * A borda muda para `accent.text` no foco -- e o unico sinal visual de onde o
 * teclado esta escrevendo, num app usado com uma mao.
 */
export function Campo({
  rotulo,
  erro,
  testID,
  ...props
}: TextInputProps & {
  rotulo: string;
  /** Mensagem abaixo do campo. A cor vem de `state.err`, com texto junto. */
  erro?: string | undefined;
  testID?: string | undefined;
}) {
  const t = useTema();
  const [focado, setFocado] = useState(false);

  const corDaBorda = erro
    ? t.cor.state.err
    : focado
      ? t.cor.accent.text
      : t.cor.border.default;

  return (
    <View style={estilos.bloco}>
      <Text
        style={{
          color: t.cor.text.secondary,
          fontSize: t.type.fieldLabel.size,
          lineHeight: t.type.fieldLabel.lineHeight,
          fontFamily: t.fonte(600),
        }}
      >
        {rotulo}
      </Text>

      <TextInput
        testID={testID}
        accessibilityLabel={rotulo}
        placeholderTextColor={t.cor.text.placeholder}
        onFocus={() => setFocado(true)}
        onBlur={() => setFocado(false)}
        style={[
          estilos.campo,
          {
            height: t.size.control,
            borderRadius: t.radius.control,
            // `bg/app` -- o poco dentro do card e da folha (DS-APP §2.1, v2).
            backgroundColor: t.cor.bg.app,
            fontFamily: t.fonte(400),
            borderColor: corDaBorda,
            color: t.cor.text.primary,
          },
        ]}
        {...props}
      />

      {erro ? (
        <Text
          // `alert` faz o leitor de tela anunciar sem o aluno precisar voltar
          // ao campo para descobrir o que houve.
          accessibilityRole="alert"
          style={{
            color: t.cor.state.err,
            fontSize: t.type.meta.size, fontFamily: t.fonte(400),
            lineHeight: t.type.meta.lineHeight,
          }}
        >
          {erro}
        </Text>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  bloco: {
    gap: 6,
  },
  campo: {
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 16,
  },
});
