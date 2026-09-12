import { useCallback, useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessao } from '@/auth/sessao';
import {
  Frequencia,
  type DadosDaFrequencia,
  type PeriodoDaFrequencia,
} from '@/features/frequencia/frequencia';
import { useTema } from '@/ui/theme';

/** O mesmo padrao do backend -- ausente vira `30D` la e aqui. */
const PERIODO_INICIAL: PeriodoDaFrequencia = '30D';

/**
 * Rota protegida da frequencia -- Slice 4.2.
 *
 * O PERIODO E ESTADO DA TELA e volta ao servidor a cada troca, em vez de
 * filtrar a serie ja carregada no cliente: `30D` e `1Y` sao agregacoes
 * diferentes do mesmo dado, e recortar baldes semanais para montar meses
 * produziria um numero que o painel nao confirma (`M4-FR-008`).
 */
export default function TelaDaFrequencia() {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const { estado, cliente } = useSessao();

  const [periodo, setPeriodo] = useState<PeriodoDaFrequencia>(PERIODO_INICIAL);
  const [dados, setDados] = useState<DadosDaFrequencia | null>(null);

  const carregar = useCallback(
    async (alvo: PeriodoDaFrequencia) => {
      /*
       * A granularidade acompanha o periodo: semanas num ano dariam 52 linhas
       * numa tela de celular, e meses em 30 dias dariam uma. O backend aceita
       * qualquer combinacao -- a escolha do que faz sentido LER e da tela.
       */
      const granularidade = alvo === '30D' || alvo === '90D' ? 'SEMANAL' : 'MENSAL';

      try {
        setDados(
          (await cliente.get(
            `/api/v1/mobile/frequencia?periodo=${alvo}&granularidade=${granularidade}`,
          )) as DadosDaFrequencia,
        );
      } catch {
        setDados({
          asOf: new Date().toISOString(),
          status: 'UNAVAILABLE',
          periodo: alvo,
          granularidade,
          totalDeSessoes: 0,
          totalDePassagens: 0,
          baldes: [],
          consistencia: { semanasComSessao: 0, semanasElegiveis: 0, proporcao: null },
        });
      }
    },
    [cliente],
  );

  useEffect(() => {
    if (estado.tipo === 'AUTENTICADO') void carregar(periodo);
  }, [estado.tipo, periodo, carregar]);

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
      <Frequencia dados={dados} onTrocarPeriodo={setPeriodo} testID="frequencia" />
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
