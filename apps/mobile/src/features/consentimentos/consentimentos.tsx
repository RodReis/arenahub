import { StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '../../ui/Card.js';
import { useTema } from '../../ui/theme.js';

export interface Consentimento {
  readonly tipo: string;
  readonly concedido: boolean;
  readonly motivo: string | null;
  readonly decididoEm: string | null;
  readonly finalidade: string | null;
  readonly versao: number | null;
  readonly editavel: boolean;
}

export interface DadosDosConsentimentos {
  readonly asOf: string;
  readonly consentimentos: readonly Consentimento[];
}

/**
 * Como cada permissao se chama para o aluno, e o que o desligado SIGNIFICA.
 *
 * O texto do estado desligado diz a CONSEQUENCIA, nao que esta desligado --
 * mesma regra do `OptInDeEngajamento`: privacidade que o titular nao
 * consegue verificar na tela nao e escolha informada.
 */
const TEXTO: Record<string, { titulo: string; ligado: string; desligado: string }> = {
  TERMS: {
    titulo: 'Termo de uso',
    ligado: 'Você aceitou o termo de uso do aplicativo.',
    desligado: 'Sem o aceite, algumas funções do aplicativo ficam indisponíveis.',
  },
  PRIVACY: {
    titulo: 'Política de privacidade',
    ligado: 'Você aceitou a política de privacidade da academia.',
    desligado: 'Sem o aceite, algumas funções do aplicativo ficam indisponíveis.',
  },
  HEALTH: {
    titulo: 'Dados de avaliação física',
    ligado: 'A academia registra suas medidas e você acompanha a evolução no aplicativo.',
    desligado: 'Suas medidas não são registradas em novas avaliações.',
  },
  AI_ANALYSIS: {
    titulo: 'Leitura assistida da evolução',
    ligado: 'Um resumo da sua evolução é gerado e revisado por um profissional.',
    desligado: 'Você vê os números das avaliações, sem o resumo.',
  },
  MARKETING: {
    titulo: 'Novidades e promoções',
    ligado: 'A academia pode enviar novidades e promoções para você.',
    desligado: 'Você não recebe novidades nem promoções. Avisos sobre seu plano continuam.',
  },
  RANKING: {
    titulo: 'Aparecer no ranking',
    ligado: 'Seu primeiro nome e sua frequência aparecem para os outros alunos da unidade.',
    desligado: 'Você não aparece na lista dos outros alunos. Seu treino continua registrado.',
  },
};

/** Por que a permissao nao vale, em português. */
const MOTIVO: Record<string, string> = {
  CONSENT_REVALIDATION_REQUIRED: 'Precisa ser confirmada de novo na recepção.',
  CONSENT_DOCUMENT_RETIRED: 'O texto mudou. Aceite a versão nova para continuar.',
  CONSENT_SUPERSEDED: 'Substituída por uma decisão mais recente.',
  CONSENT_REFUSED: 'Você recusou esta permissão.',
};

export function Consentimentos({
  dados,
  onMudar,
  salvando,
  testID,
}: {
  dados: DadosDosConsentimentos;
  onMudar: (tipo: string, conceder: boolean) => void;
  /** Tipo cuja decisao esta indo para o servidor -- trava so aquele switch. */
  salvando: string | null;
  testID?: string | undefined;
}) {
  const t = useTema();

  return (
    <View style={estilos.pilha} testID={testID}>
      {dados.consentimentos.map((consentimento) => {
        const texto = TEXTO[consentimento.tipo];

        // Tipo que a tela nao conhece ainda aparece, com o proprio codigo:
        // sumir com uma permissao que o aluno tem direito de revogar seria
        // pior que um rotulo feio.
        const titulo = texto?.titulo ?? consentimento.tipo;
        const descricao = consentimento.concedido
          ? (texto?.ligado ?? consentimento.finalidade ?? '')
          : (texto?.desligado ?? consentimento.finalidade ?? '');

        const impedimento =
          consentimento.motivo === null ? null : (MOTIVO[consentimento.motivo] ?? null);

        return (
          <Card key={consentimento.tipo} testID={`${testID ?? 'consentimentos'}-${consentimento.tipo}`}>
            <View style={estilos.linha}>
              <View style={estilos.texto}>
                <Text
                  style={{
                    color: t.cor.text.primary,
                    fontSize: t.type.cardTitle.size, fontFamily: t.fonte(600),
                    lineHeight: t.type.cardTitle.lineHeight,
                  }}
                >
                  {titulo}
                </Text>
                <Text
                  style={{
                    color: t.cor.text.secondary,
                    fontSize: t.type.body.size, fontFamily: t.fonte(400),
                    lineHeight: t.type.body.lineHeight,
                  }}
                >
                  {descricao}
                </Text>

                {impedimento !== null && (
                  <Text style={{ color: t.cor.state.warn, fontSize: 13 , fontFamily: t.fonte(400),}}>{impedimento}</Text>
                )}

                {!consentimento.editavel && (
                  <Text style={{ color: t.cor.text.muted, fontSize: 13 , fontFamily: t.fonte(400),}}>
                    Quem decide esta permissão é o responsável legal, na recepção.
                  </Text>
                )}
              </View>

              <Switch
                value={consentimento.concedido}
                onValueChange={(conceder) => onMudar(consentimento.tipo, conceder)}
                disabled={!consentimento.editavel || salvando !== null}
                accessibilityRole="switch"
                accessibilityLabel={titulo}
                accessibilityState={{
                  checked: consentimento.concedido,
                  disabled: !consentimento.editavel || salvando !== null,
                }}
                testID={`${testID ?? 'consentimentos'}-${consentimento.tipo}-switch`}
                trackColor={{ false: t.cor.bg.raised, true: t.cor.accent.solid }}
                thumbColor={t.cor.text.primary}
                ios_backgroundColor={t.cor.bg.raised}
              />
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  pilha: {
    gap: 12,
  },
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
