import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProvedorDeTema, useTema } from '@/ui/theme';

/**
 * Shell do app.
 *
 * A F43 entrega a CAMADA DE UI, nao o produto: aqui so existe o provedor de
 * tema e a pilha vazia que o `expo-router` exige para montar. As telas, a
 * navegacao por abas do §3 e a autenticacao sao da F23 e seguintes -- este
 * arquivo e o ponto onde elas se penduram.
 *
 * A barra de status acompanha o tema pelo mesmo motivo do `backgroundColor`
 * do `app.config.ts`: texto escuro sobre fundo escuro e invisivel, e o
 * padrao do sistema nao sabe qual dos dois o app esta usando.
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
        <Pilha />
      </ProvedorDeTema>
    </SafeAreaProvider>
  );
}
