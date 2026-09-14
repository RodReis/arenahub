import { useCallback, useState } from 'react';

import { usarRecurso } from '@/api/usar-recurso';
import { useSessao } from '@/auth/sessao';
import { Eventos, type DadosDoEngajamento } from '@/features/eventos/eventos';
import { Carregando, Indisponivel, Tela, TituloDaTela } from '@/ui/Tela';

/**
 * Aba Eventos -- App Mobile v2.
 *
 * A PREFERENCIA DE RANKING NAO E OTIMISTA: a lista so muda depois que o
 * servidor confirma e a leitura volta. Mesma regra dos consentimentos (F26) --
 * dizer "voce saiu" antes da confirmacao afirmaria uma privacidade que pode
 * nao ter acontecido.
 */
export default function TelaDeEventos() {
  const { cliente } = useSessao();
  const engajamento = usarRecurso<DadosDoEngajamento>('/api/v1/mobile/engajamento');
  const [salvando, setSalvando] = useState(false);

  const mudarRanking = useCallback(
    (participa: boolean) => {
      setSalvando(true);
      void (async () => {
        try {
          await cliente.post('/api/v1/mobile/engajamento/ranking', { participa });
        } finally {
          // Recarrega nos dois casos: no erro, a tela volta ao que a academia
          // de fato registrou em vez de adivinhar.
          await engajamento.recarregar();
          setSalvando(false);
        }
      })().catch(() => undefined);
    },
    [cliente, engajamento],
  );

  return (
    <Tela onAtualizar={engajamento.recarregar} testID="tela-eventos">
      {engajamento.estado.tipo === 'CARREGANDO' ? (
        <Carregando />
      ) : engajamento.estado.tipo === 'INDISPONIVEL' ? (
        <>
          <TituloDaTela>Eventos</TituloDaTela>
          <Indisponivel oQue="Seu XP" testID="eventos-indisponivel" />
        </>
      ) : (
        <Eventos
          dados={engajamento.estado.dados}
          salvandoRanking={salvando}
          onMudarRanking={mudarRanking}
          testID="eventos"
        />
      )}
    </Tela>
  );
}
