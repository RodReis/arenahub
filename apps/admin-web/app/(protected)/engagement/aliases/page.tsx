import type { Metadata } from 'next';

import { ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { FilaDeModeracao, type ItemDaFila } from './fila-de-moderacao';

export const metadata: Metadata = {
  title: 'Moderação de apelido — ArenaHub',
};

/**
 * Sem cache: dois moderadores podem trabalhar a mesma fila ao mesmo tempo, e
 * uma lista de dois minutos atrás faria o segundo tentar decidir sobre um
 * perfil que o primeiro já moderou.
 */
export const dynamic = 'force-dynamic';

interface RespostaDaFila {
  itens: ItemDaFila[];
}

/**
 * Fila de moderação de apelido público -- F30, Task 9.
 *
 * Server Component: busca a fila pronta. A interação de aprovar/rejeitar
 * mora em `FilaDeModeracao`, o único pedaço cliente.
 */
export default async function PaginaDeModeracaoDeAlias() {
  const resposta = await chamarApi<RespostaDaFila>('/api/v1/engagement/aliases?status=PENDING');

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-moderacao">
        <h1 id="titulo-moderacao">Moderação de apelido</h1>
        <ProblemDetail
          testId="erro-de-moderacao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar a fila de moderação (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="titulo-moderacao">
      <h1 id="titulo-moderacao">Moderação de apelido</h1>

      <p>
        Apelidos que alunos pediram para usar no lugar do primeiro nome, aguardando decisão. O
        moderador só julga o que foi escrito — não há edição do texto aqui.
      </p>

      <FilaDeModeracao itens={resposta.dados.itens} />
    </section>
  );
}
