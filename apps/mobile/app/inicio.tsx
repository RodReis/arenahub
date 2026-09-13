import { useCallback, useEffect, useState } from 'react';
import { Redirect, router } from 'expo-router';
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
      const home = (await cliente.get('/api/v1/mobile/home')) as DadosDaHome;

      /*
       * A contagem vem DEPOIS e nao derruba a Home -- F29.
       *
       * Duas chamadas em vez de engordar a resposta da Home: a caixa de
       * avisos e da Slice 4.7 e a Home e da 4.1, e juntar as duas faria toda
       * abertura do app pagar por uma consulta que so alimenta um numero
       * entre parenteses.
       *
       * O `catch` proprio e o ponto: falha aqui deixa `naoLidos` indefinido
       * (o botao aparece sem numero) em vez de mandar a Home inteira para
       * `UNAVAILABLE` por causa de um contador.
       */
      setDados(home);

      const avisos = (await cliente
        .get('/api/v1/mobile/avisos')
        .catch(() => null)) as { naoLidos: number } | null;

      if (avisos) setDados({ ...home, naoLidos: avisos.naoLidos });
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
        onVerPlano={() => router.push('/plano')}
        onVerFrequencia={() => router.push('/frequencia')}
        onVerAvisos={() => router.push('/avisos')}
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
