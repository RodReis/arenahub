import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProvedorDeSessao } from '@/auth/sessao';
import { ProvedorDeTema, useTema } from '@/ui/theme';

/**
 * Shell do app.
 *
 * A ORDEM DOS PROVEDORES IMPORTA: o tema por fora, a sessao por dentro. A
 * sessao nao precisa de tema, mas a tela de carregamento que aparece enquanto
 * ela resolve PRECISA -- e sem o tema por fora ela pintaria com a cor padrao
 * do sistema por um quadro.
 */
function Pilha() {
  const t = useTema();

  return (
    <>
      <StatusBar style={t.nome === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.cor.bg.app },
        }}
      />
    </>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <ProvedorDeTema>
        <ProvedorDeSessao>
          <Pilha />
        </ProvedorDeSessao>
      </ProvedorDeTema>
    </SafeAreaProvider>
  );
}
