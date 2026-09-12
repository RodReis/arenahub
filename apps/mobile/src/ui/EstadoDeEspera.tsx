import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Badge } from './Badge.js';
import { Botao } from './Botao.js';
import { Card } from './Card.js';
import { useTema } from './theme.js';
import { Relogio } from './icones.js';

/**
 * Estado de espera de pagamento -- DS-APP.md §4.10 e §5.2.
 *
 * ESTE COMPONENTE EXISTE PARA NUNCA DIZER "PAGO".
 *
 * O retorno do checkout nao confirma pagamento: so o webhook confirma
 * (SPEC-043 §2 decisao 2, e a mesma razao do ADR-006 -- o efeito so existe
 * quando o evento idempotente chega). O app que escreve "Pago" porque o
 * usuario tocou em "Ja paguei" inventa uma segunda autoridade sobre dinheiro.
 *
 * Por isso o componente nao aceita um titulo qualquer: o texto e dele, e a
 * unica coisa que o chamador escolhe e o SLO que a tela promete. Um `titulo`
 * livre aqui seria o buraco por onde "Pagamento confirmado" entraria numa
 * tela de espera.
 *
 * O §4.10 tambem exige SAIDA: "nunca prender o aluno numa tela de espera".
 * `onVoltar` e obrigatorio.
 */
export function EstadoDeEspera({
  prazo,
  onVoltar,
  testID,
}: {
  /** O SLO real, em texto curto -- ex.: "ate 2 minutos". */
  prazo: string;
  onVoltar: () => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  return (
    <Card testID={testID}>
      <View style={estilos.centro}>
        <ActivityIndicator size="large" color={t.cor.state.info} />

        <Text
          style={{
            color: t.cor.text.primary,
            fontSize: t.type.sheetTitle.size,
            lineHeight: t.type.sheetTitle.lineHeight,
            fontWeight: '700',
            textAlign: 'center',
          }}
        >
          Aguardando confirmação
        </Text>

        <Text
          style={{
            color: t.cor.text.secondary,
            fontSize: t.type.body.size,
            lineHeight: t.type.body.lineHeight,
            textAlign: 'center',
          }}
        >
          {`A confirmação costuma levar ${prazo}. Você pode fechar esta tela — avisaremos quando o pagamento for confirmado.`}
        </Text>

        <Badge tom="info" texto="Processando" icone={<Relogio tom="info" />} />

        <View style={estilos.saida}>
          <Botao titulo="Voltar" variante="secundario" emCard onPress={onVoltar} />
        </View>
      </View>
    </Card>
  );
}

const estilos = StyleSheet.create({
  centro: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  saida: {
    alignSelf: 'stretch',
    marginTop: 4,
  },
});
