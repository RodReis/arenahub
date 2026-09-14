import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useSessao } from '@/auth/sessao';
import { BarraDeAbas, type AbaPrincipal } from '@/ui/BarraDeAbas';
import { useTema } from '@/ui/theme';

/**
 * Shell de abas do App Mobile v2 -- Início · Eventos · Evolução · Planos · Perfil.
 *
 * A GUARDA DE SESSAO MORA AQUI, uma vez, em vez de em cada aba: as cinco sao
 * protegidas pelo mesmo motivo, e repetir o `Redirect` em cada arquivo era
 * como uma aba nova nasceria sem ele.
 *
 * `laudo` e aba ESCONDIDA (`href: null`): e o detalhe da Evolução, e o
 * prototipo mantem a barra visivel com a Evolução acesa enquanto o aluno le.
 */
export default function LayoutDasAbas() {
  const t = useTema();
  const { estado } = useSessao();

  if (estado.tipo === 'ANONIMO') return <Redirect href="/entrar" />;

  if (estado.tipo === 'CARREGANDO') {
    return (
      <View style={[estilos.centro, { backgroundColor: t.cor.bg.app }]}>
        <ActivityIndicator size="large" color={t.cor.accent.solid} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.cor.bg.app } }}
      tabBar={({ state, navigation }) => {
        const rota = state.routes[state.index]?.name ?? 'inicio';
        const ativa: AbaPrincipal = rota === 'laudo' ? 'evolucao' : (rota as AbaPrincipal);

        return <BarraDeAbas ativa={ativa} onIr={(aba) => navigation.navigate(aba)} />;
      }}
    >
      <Tabs.Screen name="inicio" />
      <Tabs.Screen name="eventos" />
      <Tabs.Screen name="evolucao" />
      <Tabs.Screen name="planos" />
      <Tabs.Screen name="perfil" />
      <Tabs.Screen name="laudo" options={{ href: null }} />
    </Tabs>
  );
}

const estilos = StyleSheet.create({
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
