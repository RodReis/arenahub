import { useCallback, useEffect, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useSessao } from '@/auth/sessao';
import { Avisos, type AvisoDoAluno, type DadosDosAvisos } from '@/features/avisos/avisos';
import { Tela, TituloDaTela, Voltar } from '@/ui/Tela';
import { useTema } from '@/ui/theme';

/**
 * Rota protegida da caixa de avisos -- F29, Slice 4.7.
 *
 * Falha de rede vira `UNAVAILABLE`, e nao tela de erro: o `M4-NFR-002` pede
 * shell util durante indisponibilidade.
 */
export default function TelaDeAvisos() {
  const t = useTema();
  const { estado, cliente } = useSessao();

  const [dados, setDados] = useState<DadosDosAvisos | null>(null);

  const carregar = useCallback(async () => {
    try {
      const resposta = (await cliente.get('/api/v1/mobile/avisos')) as Omit<
        DadosDosAvisos,
        'status'
      >;
      setDados({ ...resposta, status: 'AVAILABLE' });
    } catch {
      setDados({
        asOf: new Date().toISOString(),
        status: 'UNAVAILABLE',
        avisos: [],
        naoLidos: 0,
      });
    }
  }, [cliente]);

  useEffect(() => {
    if (estado.tipo === 'AUTENTICADO') void carregar();
  }, [estado.tipo, carregar]);

  /**
   * Marca como lido e navega.
   *
   * A MARCACAO NAO BLOQUEIA A NAVEGACAO: o aluno tocou para ver o conteudo,
   * e fazer ele esperar um POST para abrir a tela troca a razao do toque por
   * um detalhe de bookkeeping. Se o POST falhar, o aviso continua nao lido e
   * a proxima abertura tenta de novo -- que e o comportamento certo.
   */
  const abrir = useCallback(
    (aviso: AvisoDoAluno) => {
      if (!aviso.lido) {
        // Otimista na TELA tambem: o ponto some na hora, sem esperar a volta.
        setDados((atual) =>
          atual === null
            ? atual
            : {
                ...atual,
                avisos: atual.avisos.map((a) => (a.id === aviso.id ? { ...a, lido: true } : a)),
                naoLidos: Math.max(0, atual.naoLidos - 1),
              },
        );

        void cliente.post(`/api/v1/mobile/avisos/${aviso.id}/lido`, {}).catch(() => {
          // Silencio proposital: o aluno nao precisa saber que a marcacao
          // falhou -- ele veio ler o aviso, e o aviso esta na frente dele.
        });
      }

      if (aviso.rota) router.push(aviso.rota);
    },
    [cliente],
  );

  if (estado.tipo === 'ANONIMO') return <Redirect href="/entrar" />;

  if (estado.tipo === 'CARREGANDO' || !dados) {
    return (
      <View style={[estilos.centro, { backgroundColor: t.cor.bg.app }]}>
        <ActivityIndicator size="large" color={t.cor.accent.solid} />
      </View>
    );
  }

  return (
    <Tela>
      <Voltar rotulo="Voltar" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/perfil'))} />
      <TituloDaTela>Avisos</TituloDaTela>
      <Avisos dados={dados} onAbrir={abrir} testID="avisos" />
    </Tela>
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
