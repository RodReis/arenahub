import { Text } from 'react-native';
import { useTema } from './theme.js';

/**
 * Ausencia de dado -- DS-APP.md §10 regra 5 (e §4.14 no estado vazio).
 *
 * AUSENCIA NAO E ZERO. Um peso que ninguem mediu nao e "0,0 kg", e uma
 * frequencia sem registro nao e "0 treinos": os dois afirmam sobre o aluno
 * um fato que o sistema nao tem. O travessao diz "nao sei", que e a verdade.
 *
 * Existe como componente, e nao como string solta, para que o valor ausente
 * tenha SEMPRE a mesma cor (muted, §7: metadado) e o mesmo rotulo para leitor
 * de tela -- um `—` cru e lido como travessao, ou ignorado.
 */
export function Ausente({ motivo, testID }: { motivo?: string; testID?: string }) {
  const t = useTema();

  return (
    <Text
      testID={testID}
      accessibilityLabel={motivo ?? 'sem informação'}
      style={{
        color: t.cor.text.muted,
        fontSize: t.type.body.size, fontFamily: t.fonte(400),
        lineHeight: t.type.body.lineHeight,
      }}
    >
      —
    </Text>
  );
}
