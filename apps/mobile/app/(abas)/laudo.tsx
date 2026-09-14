import { router } from 'expo-router';

import { usarRecurso } from '@/api/usar-recurso';
import { Laudo, type DadosDoLaudo } from '@/features/laudo/laudo';
import { Carregando, Indisponivel, Tela, TituloDaTela, Voltar } from '@/ui/Tela';

/**
 * Laudo da ultima avaliacao -- detalhe da aba Evolução (App Mobile v2).
 *
 * Aba ESCONDIDA no grupo `(abas)`: o prototipo mantem a barra visivel com a
 * Evolução acesa enquanto o aluno le o laudo.
 */
export default function TelaDoLaudo() {
  const laudo = usarRecurso<DadosDoLaudo>('/api/v1/mobile/avaliacoes/laudo');
  const voltar = () => router.navigate('/evolucao');

  return (
    <Tela onAtualizar={laudo.recarregar} testID="tela-laudo">
      {laudo.estado.tipo === 'CARREGANDO' ? (
        <Carregando />
      ) : laudo.estado.tipo === 'INDISPONIVEL' ? (
        <>
          <Voltar rotulo="Evolução" onPress={voltar} />
          <TituloDaTela>Avaliação</TituloDaTela>
          <Indisponivel oQue="Seu laudo" testID="laudo-indisponivel" />
        </>
      ) : (
        <Laudo dados={laudo.estado.dados} onVoltar={voltar} testID="laudo" />
      )}
    </Tela>
  );
}
