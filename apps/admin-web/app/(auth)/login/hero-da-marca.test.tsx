import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HeroDaMarca } from './hero-da-marca';
import { MARCA_ARENAHUB, type MarcaDaAcademia } from '../../../src/marca/ler-marca';

function academia(extras: Partial<MarcaDaAcademia> = {}): MarcaDaAcademia {
  return {
    slug: 'arena-positiva',
    displayName: 'Arena Positiva',
    missionText: null,
    highlightsText: null,
    temLogo: false,
    temIcone: false,
    ...extras,
  };
}

/**
 * A coluna de identidade da tela de login — F62 (ADR-052 §9).
 *
 * O que estes testes protegem é a regra que o componente escreve em prosa: a
 * marca da academia SUBSTITUI o discurso do produto, e a ausência dela não
 * pode piorar a tela que já existia.
 */
describe('HeroDaMarca', () => {
  it('mostra o discurso do ArenaHub sem slug', () => {
    render(<HeroDaMarca marca={MARCA_ARENAHUB} />);

    expect(screen.getByText(/Da matrícula ao resultado físico/)).toBeInTheDocument();
    expect(screen.queryByTestId('nome-do-tenant')).not.toBeInTheDocument();
    expect(screen.queryByTestId('logo-do-tenant')).not.toBeInTheDocument();
  });

  it('mostra nome, missao e diferenciais da academia', () => {
    render(
      <HeroDaMarca
        marca={academia({
          missionText: 'Treinar todo mundo.',
          highlightsText: 'Quadra de areia.',
        })}
      />,
    );

    expect(screen.getByTestId('nome-do-tenant')).toHaveTextContent('Arena Positiva');
    expect(screen.getByTestId('missao-do-tenant')).toHaveTextContent('Treinar todo mundo.');
    expect(screen.getByTestId('diferenciais-do-tenant')).toHaveTextContent('Quadra de areia.');
  });

  /**
   * SUBSTITUI, NÃO SOMA. Sem esta asserção, uma refatoração que empilhasse os
   * dois blocos passaria verde — os testes acima continuariam achando o nome
   * da academia, com o pitch do ArenaHub logo abaixo dele.
   */
  it('nao mostra o discurso do produto junto com a marca da academia', () => {
    render(<HeroDaMarca marca={academia({ missionText: 'Treinar todo mundo.' })} />);

    expect(screen.queryByText(/Da matrícula ao resultado físico/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pagamento, reconhecimento facial/)).not.toBeInTheDocument();
  });

  /**
   * A F62 NÃO PODE PIORAR a tela de quem não usou os campos novos: academia
   * sem missão nem diferenciais mostra uma coluna com um nome e mais nada, que
   * é menos do que a coluna já entregava antes desta fatia.
   */
  it('volta ao texto de apoio do produto quando a academia nao escreveu nada', () => {
    render(<HeroDaMarca marca={academia()} />);

    expect(screen.getByTestId('nome-do-tenant')).toHaveTextContent('Arena Positiva');
    expect(screen.getByText(/Pagamento, reconhecimento facial/)).toBeInTheDocument();
  });

  it('aponta o logo para a rota da marca quando ha arquivo', () => {
    render(<HeroDaMarca marca={academia({ temLogo: true })} />);

    expect(screen.getByTestId('logo-do-tenant')).toHaveAttribute(
      'src',
      '/marca/arena-positiva/logo',
    );
  });

  /**
   * `temLogo: false` NÃO pode render um `<img>` que responde 404: o navegador
   * pintaria o ícone de imagem quebrada no lugar do wordmark.
   */
  it('cai no wordmark quando a academia nao enviou logo', () => {
    render(<HeroDaMarca marca={academia()} />);

    expect(screen.queryByTestId('logo-do-tenant')).not.toBeInTheDocument();
    expect(screen.getByText(/arenahub/)).toBeInTheDocument();
  });
});
