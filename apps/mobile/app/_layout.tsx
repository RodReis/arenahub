import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { View } from 'react-native';
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
 *
 * AS FONTES CARREGAM ANTES DA PRIMEIRA TELA (App Mobile v2): pintar com a
 * fonte do sistema e trocar pela Inter um quadro depois faz o titulo de 800
 * "pular" de largura. Enquanto carregam, o fundo do tema segura a tela -- sao
 * arquivos locais do bundle, a espera e de milissegundos.
 */
function Pilha() {
  const t = useTema();
  const [fontesProntas] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    JetBrainsMono_400Regular,
  });

  if (!fontesProntas) return <View style={{ flex: 1, backgroundColor: t.cor.bg.app }} />;

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
