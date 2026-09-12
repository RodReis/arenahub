import { useCallback, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessao } from '@/auth/sessao';
import { Botao } from '@/ui/Botao';
import { Card } from '@/ui/Card';
import { useTema } from '@/ui/theme';
import { Cobranca, type DadosDaCobranca } from '@/features/financeiro/cobranca';
import {
  usarStatusDaTentativa,
  type StatusDaTentativa,
} from '@/features/financeiro/usar-status-da-tentativa';

const INTERVALO_DO_POLLING_MS = 5_000;

/**
 * Escolha de metodo, QR e acompanhamento -- Slice 4.3, `M4-FR-010`/`M4-FR-011`.
 *
 * `M4-BR-001`/INV-081: esta tela NUNCA marca a fatura como paga sozinha,
 * nem ao voltar do checkout hospedado. `usarStatusDaTentativa` e a UNICA
 * fonte de confirmacao, e ela so repete o que o backend (webhook) ja
 * escreveu.
 */
export default function TelaDePagamento() {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const { estado, cliente } = useSessao();
  const router = useRouter();
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();

  const [cobranca, setCobranca] = useState<DadosDaCobranca | null>(null);
  const [erro, setErro] = useState(false);

  const iniciar = useCallback(
    async (metodo: 'pix' | 'checkout') => {
      setErro(false);
      try {
        const resposta = (await cliente.post(
          `/api/v1/mobile/invoices/${invoiceId}/${metodo}`,
        )) as DadosDaCobranca;
        setCobranca(resposta);
      } catch {
        setErro(true);
      }
    },
    [cliente, invoiceId],
  );

  const consultarStatus = useCallback(
    (paymentAttemptId: string) =>
      cliente.get(`/api/v1/mobile/payment-attempts/${paymentAttemptId}`) as Promise<StatusDaTentativa>,
    [cliente],
  );

  const status = usarStatusDaTentativa(
    cobranca?.paymentAttemptId ?? '',
    consultarStatus,
    INTERVALO_DO_POLLING_MS,
  );

  if (estado.tipo === 'ANONIMO') return <Redirect href="/entrar" />;
  if (!invoiceId) return <Redirect href="/financeiro" />;

  const corpo = {
    color: t.cor.text.secondary,
    fontSize: t.type.body.size,
    lineHeight: t.type.body.lineHeight,
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.cor.bg.app }}
      contentContainerStyle={[
        estilos.conteudo,
        { paddingTop: Math.max(inset.top, t.size.safeAreaTop) },
      ]}
    >
      {status?.status === 'SUCCEEDED' ? (
        <Card titulo="Pagamento confirmado">
          <Text style={corpo}>Sua fatura foi paga.</Text>
          <Botao titulo="Voltar" variante="primario" emCard onPress={() => router.replace('/financeiro')} />
        </Card>
      ) : status?.status === 'FAILED' ? (
        <Card titulo="Pagamento não concluído">
          <Text style={corpo}>Tente novamente ou escolha outra forma de pagamento.</Text>
          <Botao titulo="Tentar de novo" variante="primario" emCard onPress={() => setCobranca(null)} />
        </Card>
      ) : cobranca ? (
        <Cobranca
          dados={cobranca}
          testID="pagamento-cobranca"
          onCopiar={(copiaECola) => void Clipboard.setStringAsync(copiaECola)}
          onAbrirCheckout={(checkoutUrl) => void Linking.openURL(checkoutUrl)}
        />
      ) : (
        <Card titulo="Como você quer pagar?">
          {erro ? (
            <Text testID="pagamento-erro" style={corpo}>
              Não foi possível iniciar o pagamento agora. Tente novamente.
            </Text>
          ) : null}
          <Botao titulo="PIX" variante="primario" emCard testID="pagamento-pix" onPress={() => void iniciar('pix')} />
          <Botao
            titulo="Cartão"
            variante="secundario"
            emCard
            testID="pagamento-checkout"
            onPress={() => void iniciar('checkout')}
          />
        </Card>
      )}

      {cobranca && !status ? (
        <View style={estilos.centro}>
          <ActivityIndicator size="small" color={t.cor.accent.solid} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 14,
  },
  centro: {
    alignItems: 'center',
    paddingVertical: 12,
  },
});
