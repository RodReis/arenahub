import { StyleSheet, Switch, Text, View } from 'react-native';
import { Card } from './Card.js';
import { useTema } from './theme.js';

/**
 * Opt-in de engajamento -- DS-APP.md §5.4, SPEC-043 §2 decisao 4.
 *
 * NASCE DESLIGADO. A prop chama `participando` e nao tem valor padrao: quem
 * renderiza precisa dizer o estado, e o estado vem do servidor. Um
 * `participando = true` como default seria opt-out disfarcado de opt-in --
 * e o §5.4 exige que o aluno **escolha** aparecer, nao que descubra depois
 * que ja aparecia.
 *
 * O texto do estado desligado diz o que o desligado SIGNIFICA ("você não
 * aparece para os outros"), nao apenas que esta desligado. Privacidade que o
 * titular nao consegue verificar na tela nao e escolha informada.
 *
 * Sair custa UM toque, e o §5.4 pede no maximo dois.
 */
export function OptInDeEngajamento({
  participando,
  onMudar,
  testID,
}: {
  /** Sem default: o estado vem do servidor, e o padrao do produto e `false`. */
  participando: boolean;
  onMudar: (participando: boolean) => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  return (
    <Card testID={testID}>
      <View style={estilos.linha}>
        <View style={estilos.texto}>
          <Text
            style={{
              color: t.cor.text.primary,
              fontSize: t.type.cardTitle.size,
              lineHeight: t.type.cardTitle.lineHeight,
              fontWeight: '600',
            }}
          >
            Participar do ranking
          </Text>
          <Text
            style={{
              color: t.cor.text.secondary,
              fontSize: t.type.body.size,
              lineHeight: t.type.body.lineHeight,
            }}
          >
            {participando
              ? 'Seu primeiro nome e sua frequência aparecem para os outros alunos da unidade. Você pode sair quando quiser.'
              : 'Você não aparece na lista dos outros alunos. Seu treino continua sendo registrado normalmente.'}
          </Text>
        </View>

        <Switch
          value={participando}
          onValueChange={onMudar}
          accessibilityRole="switch"
          accessibilityLabel="Participar do ranking"
          accessibilityState={{ checked: participando }}
          trackColor={{ false: t.cor.bg.raised, true: t.cor.accent.solid }}
          thumbColor={t.cor.text.primary}
          ios_backgroundColor={t.cor.bg.raised}
        />
      </View>
    </Card>
  );
}

const estilos = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  texto: {
    flex: 1,
    gap: 6,
  },
});
