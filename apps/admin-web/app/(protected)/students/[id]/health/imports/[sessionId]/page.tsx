import type { Metadata } from 'next';

import { AvaliacaoCompleta } from './avaliacao-completa';

export const metadata: Metadata = {
  title: 'Avaliação publicada — ArenaHub',
};

export const dynamic = 'force-dynamic';

/**
 * Link DIRETO para uma medição específica.
 *
 * A tela em si é a `AvaliacaoCompleta` -- a mesma que `/students/:id/health`
 * mostra. Esta rota existe para o link compartilhável e para o retorno do
 * envio de laudos (`envio-de-laudos.tsx` navega para cá após criar a sessão),
 * mas não é uma segunda tela: é a mesma, chegada por outro caminho.
 */
export default async function PaginaDaRevisao({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;

  return (
    <AvaliacaoCompleta
      studentId={id}
      sessionId={sessionId}
      rodape={
        <p>
          <a href={`/students/${id}/health`} data-testid="link-evolucao">
            Voltar para a evolução corporal
          </a>
        </p>
      }
    />
  );
}
