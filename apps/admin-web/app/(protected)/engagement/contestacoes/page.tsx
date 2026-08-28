import type { Metadata } from 'next';

import { ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import type { ContestacaoDaFila } from '../../../actions/engagement';
import { FilaDeContestacoes } from './fila-de-contestacoes';

export const metadata: Metadata = {
  title: 'Contestações — ArenaHub',
};

/**
 * Sem cache, mesma razão da fila de apelidos: duas pessoas podem trabalhar a
 * mesma fila, e uma lista de dois minutos atrás faria a segunda decidir sobre
 * algo que a primeira já resolveu.
 */
export const dynamic = 'force-dynamic';

interface RespostaDaFila {
  itens: ContestacaoDaFila[];
}

/**
 * Fila de contestações de engajamento -- F35, Slice 5.6.
 *
 * Server Component: busca as abertas prontas. A interação de resolver mora em
 * `FilaDeContestacoes`, o único pedaço cliente.
 */
export default async function PaginaDeContestacoes() {
  const resposta = await chamarApi<RespostaDaFila>(
    '/api/v1/engagement/contestacoes?status=ABERTA',
  );

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-contestacoes">
        <h1 id="titulo-contestacoes">Contestações</h1>
        <ProblemDetail
          testId="erro-de-contestacoes"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar as contestações (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="titulo-contestacoes">
      <h1 id="titulo-contestacoes">Contestações</h1>

      <p>
        Alunos que discordam do XP, de uma conquista, do streak, do placar ou de um desafio.
        Resolver grava quem decidiu e quando — a contestação vira histórico e não reabre.
      </p>

      <FilaDeContestacoes itens={resposta.dados.itens} />
    </section>
  );
}
