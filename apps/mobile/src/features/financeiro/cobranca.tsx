import { Image, StyleSheet, Text, View } from 'react-native';

import { Botao } from '../../ui/Botao.js';
import { Card } from '../../ui/Card.js';
import { useTema } from '../../ui/theme.js';

export interface DadosDaCobranca {
  readonly paymentAttemptId: string;
  readonly qrCodeDataUri: string;
  /** EMV do PIX; `null` no cartao. */
  readonly copiaECola: string | null;
  /** URL do checkout hospedado; `null` no PIX. */
  readonly checkoutUrl: string | null;
  readonly expiraEm: string;
  readonly valorEmCentavos: number;
  readonly moeda: string;
}

/**
 * QR e acao da cobranca -- Slice 4.3, `M4-FR-010`.
 *
 * `M4-BR-001`: este componente NAO decide se o pagamento foi confirmado. Ele
 * so mostra o QR e a acao (copiar EMV ou abrir o checkout do PROVEDOR, nunca
 * um formulario de cartao proprio -- INV-098). Quem confirma e o polling do
 * status, em outro componente.
 */
export function Cobranca({
  dados,
  onCopiar,
  onAbrirCheckout,
  testID,
}: {
  dados: DadosDaCobranca;
  onCopiar: (copiaECola: string) => void;
  onAbrirCheckout: (checkoutUrl: string) => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  return (
    <View testID={testID} style={estilos.bloco}>
      <Card titulo="Aponte a câmera ou use o código">
        <View
          style={[
            estilos.blocoDoQr,
            { borderRadius: t.radius.card, backgroundColor: t.cor.optico.qrBackground },
          ]}
        >
          <Image
            testID="cobranca-qr"
            source={{ uri: dados.qrCodeDataUri }}
            style={estilos.qr}
            accessibilityLabel="QR code de pagamento"
          />
        </View>

        {dados.copiaECola ? (
          <Botao
            titulo="Copiar código"
            variante="secundario"
            emCard
            testID="cobranca-copiar"
            onPress={() => onCopiar(dados.copiaECola!)}
          />
        ) : null}

        {dados.checkoutUrl ? (
          <Botao
            titulo="Pagar com cartão"
            variante="primario"
            emCard
            testID="cobranca-abrir-checkout"
            onPress={() => onAbrirCheckout(dados.checkoutUrl!)}
          />
        ) : null}

        <Text
          style={{
            color: t.cor.text.muted,
            fontSize: t.type.meta.size,
            lineHeight: t.type.meta.lineHeight,
            textAlign: 'center',
          }}
        >
          Aguardando confirmação do pagamento
        </Text>
      </Card>
    </View>
  );
}

const estilos = StyleSheet.create({
  bloco: {
    gap: 14,
  },
  blocoDoQr: {
    alignSelf: 'center',
    padding: 16,
  },
  qr: {
    width: 220,
    height: 220,
  },
});
