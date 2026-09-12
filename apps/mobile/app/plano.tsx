import { useCallback, useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessao } from '@/auth/sessao';
import { Plano, type DadosDoPlano } from '@/features/plano/plano';
import { useTema } from '@/ui/theme';

/**
 * Rota protegida do plano -- Slice 4.2.
 *
 * Falha de rede vira `UNAVAILABLE`, e nao tela de erro: o `M4-NFR-002` pede
 * shell util durante indisponibilidade. E aqui a regra pesa mais que na Home
 * -- um plano antigo exibido como atual faz o aluno sair de casa contando com
 * um direito que pode ter vencido.
 */
export default function TelaDoPlano() {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const { estado, cliente } = useSessao();

  const [dados, setDados] = useState<DadosDoPlano | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDados((await cliente.get('/api/v1/mobile/plano')) as DadosDoPlano);
    } catch {
      setDados({ asOf: new Date().toISOString(), status: 'UNAVAILABLE', plano: null });
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
      <Plano dados={dados} testID="plano" />
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
