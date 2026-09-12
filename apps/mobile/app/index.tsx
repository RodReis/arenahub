import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Ausente,
  AvisoDeIA,
  Badge,
  Botao,
  Card,
  DivisorDeCard,
  EstadoDeEspera,
  OptInDeEngajamento,
  useTema,
} from '@/ui';
import { Alerta, Check } from '@/ui/icones';

/**
 * Vitrine da camada de UI -- a unica tela que a F43 entrega.
 *
 * Existe por causa do risco que o proprio ADR-025 registrou: componente sem
 * consumidor erra em silencio. So a tela revela que o alvo de toque nao cabe,
 * que o token ficou errado, que o estado que faltava era outro. Esta tela nao
 * e produto e nao vai para a loja -- e o consumidor minimo que torna o erro
 * visivel antes das telas de verdade chegarem na F23.
 *
 * As telas reais (Home, Pagar, Evolucao, Ranking) sao do MVP 4.
 */
export default function Vitrine() {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const [participando, setParticipando] = useState(false);
  const [esperando, setEsperando] = useState(false);

  return (
    <ScrollView
      style={{ backgroundColor: t.cor.bg.app }}
      contentContainerStyle={[
        estilos.conteudo,
        { paddingTop: Math.max(inset.top, t.size.safeAreaTop), paddingBottom: 32 },
      ]}
    >
      <Text
        style={{
          color: t.cor.text.primary,
          fontSize: t.type.screenTitle.size,
          lineHeight: t.type.screenTitle.lineHeight,
          fontWeight: '700',
        }}
      >
        Camada de UI
      </Text>
      <Text
        style={{
          color: t.cor.text.secondary,
          fontSize: t.type.body.size,
          lineHeight: t.type.body.lineHeight,
        }}
      >
        {`Tema ${t.nome === 'dark' ? 'escuro' : 'claro'}, seguindo o sistema.`}
      </Text>

      <Card
        titulo="Plano mensal"
        destaque
        acessorio={<Badge tom="ok" texto="Ativo" icone={<Check tom="ok" />} />}
      >
        <Text style={{ color: t.cor.text.secondary, fontSize: t.type.body.size }}>
          Acesso liberado em todas as unidades.
        </Text>
        <DivisorDeCard>
          <Text style={{ color: t.cor.text.muted, fontSize: t.type.meta.size }}>
            Próxima cobrança em 05/10
          </Text>
        </DivisorDeCard>
      </Card>

      <Card
        titulo="Fatura de setembro"
        acessorio={<Badge tom="warn" texto="Vencida" icone={<Alerta tom="warn" />} />}
      >
        <Botao titulo="Pagar agora" emCard onPress={() => setEsperando(true)} />
      </Card>

      {esperando ? (
        <EstadoDeEspera prazo="até 2 minutos" onVoltar={() => setEsperando(false)} />
      ) : null}

      <AvisoDeIA modelVersion="—" promptVersion="—" />

      <OptInDeEngajamento participando={participando} onMudar={setParticipando} />

      <Card titulo="Última avaliação">
        <View style={estilos.linha}>
          <Text style={{ color: t.cor.text.secondary, fontSize: t.type.body.size }}>
            Percentual de gordura
          </Text>
          <Ausente motivo="sem medição registrada" />
        </View>
      </Card>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: {
    paddingHorizontal: 20,
    gap: 14,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
