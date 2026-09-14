import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessao } from '@/auth/sessao';
import { Botao } from '@/ui/Botao';
import { Campo } from '@/ui/Campo';
import { useTema } from '@/ui/theme';

/**
 * Ativacao de conta -- `M4-FR-001`, `M4-AC-001`.
 *
 * O ALUNO ESCOLHE A PROPRIA SENHA, e ninguem mais a conhece: a recepcao
 * emite o convite, e o token que chega por e-mail so serve uma vez. E o que
 * o `M4-AC-001` pede ("ativa conta sem intervencao administrativa sobre
 * senha").
 *
 * O token vem pela rota (`/ativar?token=...`), ja interpretado pelo
 * `link-de-ativacao.ts` quando a origem e deep link.
 */
export default function Ativar() {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const { cliente } = useSessao();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const ativar = () => {
    if (enviando) return;

    if (senha.length < 10) {
      setErro('A senha precisa de pelo menos 10 caracteres.');
      return;
    }

    if (senha !== confirmacao) {
      setErro('As senhas não são iguais.');
      return;
    }

    setErro(null);
    setEnviando(true);

    void cliente
      .post('/api/v1/mobile/auth/activate', { token, senha })
      .then(() => {
        // Volta para o login em vez de entrar sozinho: o aluno acabou de
        // escolher a senha, e digita-la uma vez confirma que ele a guardou.
        router.replace('/entrar');
      })
      .catch(() => {
        setErro('Não foi possível ativar. O link pode ter expirado ou já ter sido usado.');
      })
      .finally(() => setEnviando(false));
  };

  if (!token) {
    return (
      <View style={[estilos.centro, { backgroundColor: t.cor.bg.app }]}>
        <Text
          style={{
            color: t.cor.text.secondary,
            fontSize: t.type.body.size, fontFamily: t.fonte(400),
            textAlign: 'center',
          }}
        >
          Abra o link que enviamos por e-mail para ativar sua conta.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: t.cor.bg.app }}
      contentContainerStyle={[
        estilos.conteudo,
        { paddingTop: Math.max(inset.top, t.size.safeAreaTop) + 40 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={estilos.cabecalho}>
        <Text
          style={{
            color: t.cor.text.primary,
            fontSize: t.type.loginTitle.size, fontFamily: t.fonte(700),
            lineHeight: t.type.loginTitle.lineHeight,
          }}
        >
          Criar sua senha
        </Text>
        <Text
          style={{
            color: t.cor.text.secondary,
            fontSize: t.type.body.size, fontFamily: t.fonte(400),
            lineHeight: t.type.body.lineHeight,
          }}
        >
          Só você vai saber esta senha. A recepção não tem acesso a ela.
        </Text>
      </View>

      <Campo
        testID="campo-senha"
        rotulo="Senha"
        value={senha}
        onChangeText={setSenha}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />

      <Campo
        testID="campo-confirmacao"
        rotulo="Repita a senha"
        value={confirmacao}
        onChangeText={setConfirmacao}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        {...(erro ? { erro } : {})}
      />

      <Botao titulo="Ativar conta" onPress={ativar} carregando={enviando} testID="botao-ativar" />
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 18,
  },
  cabecalho: {
    gap: 6,
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
});
