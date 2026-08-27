import type { Metadata } from 'next';

import { ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { PainelDoPlacar } from './painel-do-placar';

export const metadata: Metadata = {
  title: 'Placar mensal — ArenaHub',
};

/** Sem cache: o painel gera e publica na mesma sessao, e dado velho aqui
 * faria o operador escolher uma unidade que ja mudou de nome. */
export const dynamic = 'force-dynamic';

interface Unidade {
  id: string;
  name: string;
  /** Necessario para exibir `publishedAt` no fuso CORRETO -- regra 5 de
   * lint (DS-PAINEL.md §11): nunca `toLocaleString()` sem timezone. */
  timezone: string;
}

/**
 * Placar mensal e ajuste de XP -- F31, Task 11.
 *
 * Server Component: busca so a lista de unidades (`/api/v1/units`, ja
 * exigida por `unit.read`). Gerar/publicar/ajustar sao Server Actions
 * disparadas do lado cliente (`PainelDoPlacar`) -- nao ha endpoint de
 * LISTAGEM de snapshot nesta fatia (Task 11 entrega so gerar/publicar/
 * ajustar), entao a tela mostra o snapshot da ultima geracao da sessao, nao
 * um historico.
 */
export default async function PaginaDoPlacar() {
  const unidades = await chamarApi<Unidade[]>('/api/v1/units');

  if (!unidades.ok || !unidades.dados) {
    return (
      <section aria-labelledby="titulo-placar">
        <h1 id="titulo-placar">Placar mensal</h1>
        <ProblemDetail
          testId="erro-do-placar"
          problem={{
            ...(unidades.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar as unidades (${unidades.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="titulo-placar">
      <h1 id="titulo-placar">Placar mensal</h1>

      <p>
        Gere o placar de uma unidade e mês, publique quando estiver pronto e ajuste XP de um
        aluno quando algo precisar de correção. Não há edição: publicar é definitivo, e todo
        ajuste é um novo lançamento — o histórico nunca é reescrito.
      </p>

      <PainelDoPlacar unidades={unidades.dados} />
    </section>
  );
}
