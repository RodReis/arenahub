import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EventoDoFeed } from '../../actions/dashboard';
import { CartaoDePresenca } from './cartao-de-presenca';

const AGORA = Date.parse('2026-10-22T21:40:00.000Z');

const evento = (sobrescreve: Partial<EventoDoFeed>): EventoDoFeed => ({
  id: 'e-1',
  occurredAt: '2026-10-22T21:35:00.000Z',
  outcome: 'ALLOW',
  reason: 'MANUAL_OVERRIDE',
  method: 'MANUAL',
  student: null,
  externalUserId: null,
  ...sobrescreve,
});

const renderizar = (e: EventoDoFeed) =>
  render(
    <ul>
      <CartaoDePresenca evento={e} agora={AGORA} timeZone="America/Sao_Paulo" />
    </ul>,
  );

/** #676 -- liberação manual sem aluno não é "pessoa não identificada". */
describe('CartaoDePresenca -- nome sem aluno', () => {
  it('liberação manual sem aluno aparece como "Giro avulso"', () => {
    renderizar(evento({}));

    expect(screen.getByText('Giro avulso')).toBeInTheDocument();
    expect(screen.queryByText('Não identificado')).not.toBeInTheDocument();
  });

  it('outro motivo sem aluno continua "Não identificado"', () => {
    renderizar(evento({ reason: 'ACTIVE_ENTITLEMENT', method: 'FACIAL' }));

    expect(screen.getByText('Não identificado')).toBeInTheDocument();
  });
});
