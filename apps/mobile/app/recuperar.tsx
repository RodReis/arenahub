import { useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessao } from '@/auth/sessao';
import { Botao } from '@/ui/Botao';
import { Campo } from '@/ui/Campo';
import { Card } from '@/ui/Card';
import { useTema } from '@/ui/theme';
import { TENANT_SLUG } from '@/config';

/**
 * Recuperacao de senha -- `M4-FR-002` tambem vale aqui.
 *
 * A TELA DIZ A MESMA COISA SEMPRE, tenha o identificador conta ou nao. A API
 * responde `{ aceito: true }` nos dois casos; mostrar "enviamos" so quando
 * existe conta desfaria no cliente a antienumeracao do servidor, e
 * transformaria esta tela num oraculo de quem e aluno da academia.
 */
export default function Recuperar() {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const { cliente } = useSessao();

  const [identificador, setIdentificador] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [pedido, setPedido] = useState(false);

  const pedir = () => {
    if (enviando) return;
    setEnviando(true);

    void cliente
      .post('/api/v1/mobile/auth/recovery/request', {
        tenantSlug: TENANT_SLUG,
        identificador,
      })
      .catch(() => {
        // Mesmo em falha de rede a tela confirma: distinguir os casos aqui
        // revelaria o que a API se esforca para esconder. O aluno que nao
        // receber o e-mail pede de novo.
      })
      .finally(() => {
        setEnviando(false);
        setPedido(true);
      });
  };

  if (pedido) {
    return (
      <View style={[estilos.conteudoCentral, { backgroundColor: t.cor.bg.app }]}>
        <Card titulo="Verifique seu e-mail">
          <Text
            style={{
              color: t.cor.text.secondary,
              fontSize: t.type.body.size, fontFamily: t.fonte(400),
              lineHeight: t.type.body.lineHeight,
            }}
          >
            Se houver uma conta com esse contato, enviamos um link para criar uma senha
            nova. O link vale por 30 minutos.
          </Text>
          <Botao
            titulo="Voltar para o login"
            variante="secundario"
            emCard
            onPress={() => router.replace('/entrar')}
            testID="botao-voltar"
          />
        </Card>
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
          Recuperar senha
        </Text>
        <Text
          style={{
            color: t.cor.text.secondary,
            fontSize: t.type.body.size, fontFamily: t.fonte(400),
            lineHeight: t.type.body.lineHeight,
          }}
        >
          Informe o e-mail ou telefone cadastrado na academia.
        </Text>
      </View>

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
      />

      <Botao
        titulo="Enviar link"
        onPress={pedir}
        carregando={enviando}
        testID="botao-enviar"
      />

      <Botao
        titulo="Voltar"
        variante="neutro"
        emCard
        onPress={() => router.back()}
        testID="botao-voltar"
      />
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 18,
  },
  conteudoCentral: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  cabecalho: {
    gap: 6,
  },
});
