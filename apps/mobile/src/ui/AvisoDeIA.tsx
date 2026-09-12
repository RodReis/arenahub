import { StyleSheet, Text, View } from 'react-native';
import { AI_DISCLAIMER_CODE, type AIDisclaimerProps } from '@arenahub/ui/domain';
import { useTema } from './theme.js';
import { Informacao } from './icones.js';

/**
 * Aviso de nao-diagnostico -- DS-APP.md §5.3, regra de arquitetura 8.
 *
 * PERSISTENTE E NAO DISPENSAVEL. O tipo vem de `AIDisclaimerProps`, que fixa
 * `dismissible: false` como literal: quem tentar passar `true` nao compila.
 * Um aviso de saude que o aluno fecha e um aviso que nao existe a partir do
 * segundo uso -- e aqui o leitor e o proprio titular do dado, nao o operador
 * treinado do painel.
 *
 * O contrato e COMPARTILHADO com o painel (`@arenahub/ui/domain`), nao
 * copiado: o codigo do disclaimer e um so em todo o produto, e a API o exige
 * em toda saida de IA (`M3-BR-010`).
 *
 * O tom e `info`, nunca `warn` nem `err`: o §2.4 reserva os dois para
 * pendencia e para alerta clinico de verdade. Um aviso permanente em
 * vermelho anestesia o aluno para o alerta que importa.
 */
export function AvisoDeIA({
  modelVersion,
  promptVersion,
  testID,
}: Pick<AIDisclaimerProps, 'modelVersion' | 'promptVersion'> & { testID?: string }) {
  const t = useTema();
  const { bg, border } = t.tint('info');

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLabel="Esta análise não é diagnóstico médico."
      style={[
        estilos.base,
        {
          backgroundColor: bg,
          borderColor: border,
          borderRadius: t.radius.card,
        },
      ]}
    >
      <View accessibilityElementsHidden style={estilos.glifo}>
        <Informacao tom="info" tamanho={16} />
      </View>

      <View style={estilos.texto}>
        <Text
          style={{
            color: t.cor.text.primary,
            fontSize: t.type.body.size,
            lineHeight: t.type.body.lineHeight,
            fontWeight: '600',
          }}
        >
          Não é diagnóstico médico
        </Text>
        <Text
          style={{
            color: t.cor.text.secondary,
            fontSize: t.type.body.size,
            lineHeight: t.type.body.lineHeight,
          }}
        >
          A leitura abaixo foi gerada automaticamente a partir das suas medições e
          serve para acompanhar a evolução. A interpretação clínica é do
          profissional que acompanha você.
        </Text>
        <Text
          style={{
            color: t.cor.text.muted,
            fontSize: t.type.meta.size,
            lineHeight: t.type.meta.lineHeight,
          }}
        >
          {`${AI_DISCLAIMER_CODE} · modelo ${modelVersion} · prompt ${promptVersion}`}
        </Text>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  glifo: {
    paddingTop: 2,
  },
  texto: {
    flex: 1,
    gap: 6,
  },
});
