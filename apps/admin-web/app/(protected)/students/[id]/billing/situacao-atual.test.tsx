import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SituacaoAtual } from './situacao-atual';

const TZ = 'America/Sao_Paulo';
const AGORA = new Date('2026-10-05T15:00:00Z');

const invoice = (dueAt: string) => ({
  id: 'inv-411',
  number: 411,
  status: 'OPEN',
  currency: 'BRL',
  totalMinor: 15000,
  dueAt,
});

describe('SituacaoAtual', () => {
  /*
   * Caso da Iris (05/10/2026): pagou set e out, a cobranca de nov/26 vence
   * em 04/11. Ela nao deve nada -- o painel nao pode dizer "Em aberto".
   */
  it('cobranca ainda no prazo: "Em dia" e a proxima cobranca como apoio', () => {
    render(<SituacaoAtual invoice={invoice('2026-11-04T00:00:00.000Z')} timezone={TZ} agora={AGORA} />);

    const painel = screen.getByTestId('proxima-cobranca');
    expect(painel).toHaveTextContent('Em dia');
    expect(painel).toHaveTextContent(/Próxima cobrança nº 411/);
    expect(painel).not.toHaveTextContent('Em aberto');
  });

  it('cobranca que vence hoje segue em destaque como "Em aberto"', () => {
    render(<SituacaoAtual invoice={invoice('2026-10-05T00:00:00.000Z')} timezone={TZ} agora={AGORA} />);

    expect(screen.getByTestId('invoice-em-destaque')).toHaveTextContent('Em aberto');
  });

  it('cobranca vencida mostra os dias de atraso', () => {
    render(<SituacaoAtual invoice={invoice('2026-10-01T00:00:00.000Z')} timezone={TZ} agora={AGORA} />);

    expect(screen.getByTestId('dias-de-atraso')).toHaveTextContent('4 dias de atraso');
  });
});
