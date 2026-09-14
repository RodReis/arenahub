import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useSessao } from '@/auth/sessao';
import { useTema } from '@/ui/theme';

/**
 * Porta de entrada: decide para onde o app abre.
 *
 * Enquanto o estado e `CARREGANDO`, mostra o SHELL -- fundo do tema e um
 * indicador -- e nao a tela de login. Redirecionar cedo demais faria o login
 * piscar para quem ja tem sessao valida, que e a maioria dos casos depois da
 * primeira vez.
 */
export default function Entrada() {
  const { estado } = useSessao();
  const t = useTema();

  if (estado.tipo === 'CARREGANDO') {
    return (
      <View
        testID="carregando"
        style={[estilos.centro, { backgroundColor: t.cor.bg.app }]}
      >
        <ActivityIndicator size="large" color={t.cor.accent.solid} />
      </View>
    );
  }

  // `/inicio` e a primeira aba do grupo `(abas)` -- o grupo nao entra na URL.
  return <Redirect href={estado.tipo === 'AUTENTICADO' ? '/inicio' : '/entrar'} />;
}

const estilos = StyleSheet.create({
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
