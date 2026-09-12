import { useCallback, useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessao } from '@/auth/sessao';
import { Home, type DadosDaHome } from '@/features/inicio/home';
import { useTema } from '@/ui/theme';

/**
 * Rota protegida da Home.
 *
 * Falha de rede vira `UNAVAILABLE`, e nao tela de erro: o `M4-NFR-002` pede
 * shell util durante indisponibilidade. O aluno que abriu o app na catraca
 * precisa de alguma tela, nao de um alerta.
 */
export default function Inicio() {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const { estado, cliente, sair } = useSessao();

  const [dados, setDados] = useState<DadosDaHome | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDados((await cliente.get('/api/v1/mobile/home')) as DadosDaHome);
    } catch {
      // Sem conteudo, mas COM shell. A ausencia de dado aparece como
      // ausencia -- nunca como dado antigo apresentado como atual.
      setDados({
        asOf: new Date().toISOString(),
        status: 'UNAVAILABLE',
        saudacao: '',
        versionPolicy: { state: 'SUPPORTED', updateUrl: null },
      });
    }
  }, [cliente]);

  useEffect(() => {
    if (estado.tipo === 'AUTENTICADO') void carregar();
  }, [estado.tipo, carregar]);

  if (estado.tipo === 'ANONIMO') return <Redirect href="/entrar" />;

  if (estado.tipo === 'CARREGANDO' || !dados) {
    return (
      <View style={[estilos.centro, { backgroundColor: t.cor.bg.app }]}>
        <ActivityIndicator size="large" color={t.cor.accent.solid} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: t.cor.bg.app }}
      contentContainerStyle={[
        estilos.conteudo,
        { paddingTop: Math.max(inset.top, t.size.safeAreaTop) },
      ]}
    >
      <Home
        dados={dados}
        onSair={() => void sair()}
        onAtualizarApp={() => {
          const url = dados.versionPolicy.updateUrl;
          if (url) void Linking.openURL(url);
        }}
        testID="home"
      />
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
