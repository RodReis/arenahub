import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Botao } from '../../ui/Botao.js';
import { Campo } from '../../ui/Campo.js';
import { useTema } from '../../ui/theme.js';

/**
 * Formulario de login.
 *
 * A MENSAGEM DE ERRO E SEMPRE A MESMA, e isso e requisito (`M4-FR-002`): a
 * API ja responde igual para identificador inexistente e senha errada, e
 * traduzir o codigo em "usuario nao encontrado" na tela desfaria no cliente a
 * antienumeracao que o servidor garante.
 *
 * O envio e bloqueado enquanto uma tentativa esta em voo. Toque duplo em
 * conexao lenta e o caso real, e sem a trava sao duas sessoes abertas.
 */
export function FormularioDeLogin({
  onEntrar,
  onEsqueciSenha,
  testID,
}: {
  onEntrar: (dados: { identificador: string; senha: string }) => Promise<void>;
  onEsqueciSenha: () => void;
  testID?: string | undefined;
}) {
  const t = useTema();
  const [identificador, setIdentificador] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = () => {
    if (enviando) return;

    setErro(null);
    setEnviando(true);

    void onEntrar({ identificador, senha })
      .catch(() => {
        // UMA mensagem para toda falha de credencial -- ver o bloco acima.
        setErro('Não foi possível entrar. Confira os dados e tente de novo.');
      })
      .finally(() => setEnviando(false));
  };

  return (
    <View testID={testID} style={estilos.bloco}>
      <Campo
        testID="campo-identificador"
        rotulo="E-mail ou telefone"
        value={identificador}
        onChangeText={setIdentificador}
        placeholder="nome@email.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="username"
        textContentType="username"
        returnKeyType="next"
      />

      <Campo
        testID="campo-senha"
        rotulo="Senha"
        value={senha}
        onChangeText={setSenha}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={enviar}
      />

      {erro ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: t.cor.state.err,
            fontSize: t.type.body.size,
            lineHeight: t.type.body.lineHeight,
          }}
        >
          {erro}
        </Text>
      ) : null}

      <Botao titulo="Entrar" onPress={enviar} carregando={enviando} testID="botao-entrar" />

      <Botao
        titulo="Esqueci minha senha"
        variante="secundario"
        emCard
        onPress={onEsqueciSenha}
        testID="botao-esqueci"
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  bloco: {
    gap: 14,
  },
});
