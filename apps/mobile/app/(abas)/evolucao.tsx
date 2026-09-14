import { useState } from 'react';
import { router } from 'expo-router';

import { usarRecurso } from '@/api/usar-recurso';
import { Evolucao, type DadosDasAvaliacoes, type Periodo } from '@/features/avaliacoes/avaliacoes';
import { Carregando, Indisponivel, Tela, TituloDaTela } from '@/ui/Tela';

/**
 * Aba Evolução -- App Mobile v2, sobre o historico corporal da Slice 4.4.
 *
 * Falha de rede vira ESTADO DE AUSENCIA, e nao serie antiga na tela: o
 * `M4-NFR-002` proibe exibir dado sensivel obsoleto como atual, e aqui o dado e
 * de saude.
 */
export default function TelaDaEvolucao() {
  const [periodo, setPeriodo] = useState<Periodo>('90D');
  const avaliacoes = usarRecurso<DadosDasAvaliacoes>(`/api/v1/mobile/avaliacoes?periodo=${periodo}`);

  return (
    <Tela onAtualizar={avaliacoes.recarregar} testID="tela-evolucao">
      {avaliacoes.estado.tipo === 'CARREGANDO' ? (
        <Carregando />
      ) : avaliacoes.estado.tipo === 'INDISPONIVEL' ? (
        <>
          <TituloDaTela>Evolução</TituloDaTela>
          <Indisponivel oQue="Sua evolução" testID="avaliacoes-indisponivel" />
        </>
      ) : (
        <Evolucao
          dados={avaliacoes.estado.dados}
          periodo={periodo}
          onPeriodo={setPeriodo}
          onVerLaudo={() => router.navigate('/laudo')}
        />
      )}
    </Tela>
  );
}
