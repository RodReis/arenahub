import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Redirect } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessao } from '@/auth/sessao';
import { Financeiro, type DadosDoFinanceiro } from '@/features/financeiro/financeiro';
import { useTema } from '@/ui/theme';

/**
 * Rota do financeiro -- Slice 4.3, `M4-FR-009`.
 *
 * Falha de rede vira `UNAVAILABLE`, mesma regra do plano e da frequencia
 * (`M4-NFR-002`): dado financeiro obsoleto exibido como atual e o pior caso
 * desta tela em particular.
 */
export default function TelaDoFinanceiro() {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const { estado, cliente } = useSessao();
  const router = useRouter();

  const [dados, setDados] = useState<DadosDoFinanceiro | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDados((await cliente.get('/api/v1/mobile/invoices')) as DadosDoFinanceiro);
    } catch {
      setDados({ asOf: new Date().toISOString(), status: 'UNAVAILABLE', invoices: [] });
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
      <Financeiro
        dados={dados}
        testID="financeiro"
        onPagar={(invoiceId) =>
          router.push({ pathname: '/pagamento', params: { invoiceId } })
        }
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
