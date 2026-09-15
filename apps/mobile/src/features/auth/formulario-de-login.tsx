import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Botao } from '../../ui/Botao.js';
import { Campo } from '../../ui/Campo.js';
import { useTema } from '../../ui/theme.js';
import { mascararCpf } from '../../lib/mascaras.js';

/**
 * Formulario de login.
 *
 * IDENTIFICADOR E CPF (ADR-057) -- o app trocou e-mail/telefone por CPF
 * porque a base real tem poucos e-mails cadastrados. O campo devolve o CPF
 * SEM MASCARA para `onEntrar`: a mascara e so exibicao, o `cpf` do DTO
 * confere so os 11 digitos.
 *
 * A MENSAGEM DE ERRO E SEMPRE A MESMA, e isso e requisito (`M4-FR-002`): a
 * API ja responde igual para CPF inexistente e senha errada, e traduzir o
 * codigo em "usuario nao encontrado" na tela desfaria no cliente a
 * antienumeracao que o servidor garante.
 *
 * O envio e bloqueado enquanto uma tentativa esta em voo. Toque duplo em
 * conexao lenta e o caso real, e sem a trava sao duas sessoes abertas.
 */
export function FormularioDeLogin({
  onEntrar,
  onEsqueciSenha,
  onPrimeiroAcesso,
  testID,
}: {
  onEntrar: (dados: { cpf: string; senha: string }) => Promise<void>;
  onEsqueciSenha: () => void;
  onPrimeiroAcesso: () => void;
  testID?: string | undefined;
}) {
  const t = useTema();
  const [cpfMascarado, setCpfMascarado] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = () => {
    if (enviando) return;

    setErro(null);
    setEnviando(true);

    void onEntrar({ cpf: cpfMascarado.replace(/\D/g, ''), senha })
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
        rotulo="CPF"
        value={cpfMascarado}
        onChangeText={(digitado) => setCpfMascarado(mascararCpf(digitado))}
        placeholder="000.000.000-00"
        keyboardType="number-pad"
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
            fontFamily: t.fonte(500),
            fontSize: t.type.body.size,
            lineHeight: t.type.body.lineHeight,
          }}
        >
          {erro}
        </Text>
      ) : null}

      <Botao titulo="Entrar" onPress={enviar} carregando={enviando} testID="botao-entrar" />

      {/*
        Links, e nao botao secundario -- App Mobile v2: recuperar senha e
        primeiro acesso sao saida lateral do login, nao uma segunda acao do
        mesmo peso que "Entrar". "Entrar com biometria" do prototipo NAO
        entra: o app nao tem login biometrico, e o link levaria a lugar
        nenhum.
      */}
      <View style={estilos.linksSecundarios}>
        <Pressable
          onPress={onEsqueciSenha}
          accessibilityRole="link"
          hitSlop={12}
          testID="botao-esqueci"
          style={estilos.link}
        >
          <Text style={{ color: t.cor.accent.text, fontSize: 13, fontFamily: t.fonte(600) }}>
            Esqueci minha senha
          </Text>
        </Pressable>

        <Pressable
          onPress={onPrimeiroAcesso}
          accessibilityRole="link"
          hitSlop={12}
          testID="botao-primeiro-acesso"
          style={estilos.link}
        >
          <Text style={{ color: t.cor.accent.text, fontSize: 13, fontFamily: t.fonte(600) }}>
            Primeiro acesso?
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  bloco: {
    gap: 14,
  },
  linksSecundarios: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  link: {
    alignSelf: 'flex-start',
  },
});
