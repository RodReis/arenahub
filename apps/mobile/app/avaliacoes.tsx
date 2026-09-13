import { useCallback, useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessao } from '@/auth/sessao';
import {
  Avaliacoes,
  type DadosDasAvaliacoes,
  type Periodo,
} from '@/features/avaliacoes/avaliacoes';
import { Ausente } from '@/ui/Ausente';
import { useTema } from '@/ui/theme';

/**
 * Rota protegida do historico corporal -- Slice 4.4, `M4-FR-012`.
 *
 * Falha de rede vira ESTADO VAZIO EXPLICITO, e nao serie antiga na tela: o
 * `M4-NFR-002` proibe exibir dado sensivel obsoleto como atual, e aqui o dado
 * e de saude -- um peso de tres meses atras apresentado como "atual" e pior
 * que tela vazia.
 */
export default function TelaDasAvaliacoes() {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const { estado, cliente } = useSessao();

  const [dados, setDados] = useState<DadosDasAvaliacoes | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>('90D');
  const [indisponivel, setIndisponivel] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setDados(
        (await cliente.get(`/api/v1/mobile/avaliacoes?periodo=${periodo}`)) as DadosDasAvaliacoes,
      );
      setIndisponivel(false);
    } catch {
      setDados(null);
      setIndisponivel(true);
    }
  }, [cliente, periodo]);

  useEffect(() => {
    if (estado.tipo === 'AUTENTICADO') void carregar();
  }, [estado.tipo, carregar]);

  if (estado.tipo === 'ANONIMO') return <Redirect href="/entrar" />;

  if (estado.tipo === 'CARREGANDO' || (!dados && !indisponivel)) {
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
      {dados === null ? (
        <Ausente
          motivo="Não foi possível carregar suas avaliações agora. Tente de novo em instantes."
          testID="avaliacoes-indisponivel"
        />
      ) : (
        <Avaliacoes
          dados={dados}
          periodo={periodo}
          onPeriodo={setPeriodo}
          testID="avaliacoes"
        />
      )}
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
