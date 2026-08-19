import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Telefone, formatarTelefone } from './Telefone.js';

/**
 * Telefone com atalho de WhatsApp.
 *
 * Os testes de `formatarTelefone` VIERAM de
 * `apps/admin-web/src/billing/inadimplencia.test.ts` junto com a função. Eles
 * provam um defeito real, achado na F15: `+1 415 555 0000` saía formatado como
 * `(14) 15555-0000`, um telefone brasileiro que não existe. Perder este teste
 * na migração seria perder a única coisa que impede o defeito de voltar.
 */
describe('formatarTelefone', () => {
  it('formata celular de 11 dígitos', () => {
    expect(formatarTelefone('41998765432')).toBe('(41) 99876-5432');
  });

  it('formata fixo de 10 dígitos', () => {
    expect(formatarTelefone('4133334444')).toBe('(41) 3333-4444');
  });

  it('tira o DDI antes de formatar', () => {
    expect(formatarTelefone('5541998765432')).toBe('(41) 99876-5432');
  });

  it('NÚMERO ESTRANGEIRO volta como veio', () => {
    /**
     * Contar dígitos não distingue origem: `+1 415 555 0000` tem onze, como um
     * celular brasileiro. O `+` distingue, e é o único sinal confiável que o
     * cadastro guarda. Inventar formato produziria um telefone com aparência
     * de certo e dígitos no lugar errado — pior que o valor cru, que ao menos
     * denuncia o cadastro ruim.
     */
    expect(formatarTelefone('+1 415 555 0000')).toBe('+1 415 555 0000');
  });
});

describe('Telefone', () => {
  it('abre a conversa no número, sem mensagem quando não há', () => {
    render(<Telefone numero="41998765432" />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://wa.me/41998765432');
    expect(link).toHaveTextContent('(41) 99876-5432');
  });

  it('leva a mensagem da tela, codificada', () => {
    render(<Telefone numero="41998765432" mensagem="Olá, Ana! Sua fatura venceu." />);

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      `https://wa.me/41998765432?text=${encodeURIComponent('Olá, Ana! Sua fatura venceu.')}`,
    );
  });

  it('SEM DÍGITO NÃO VIRA LINK', () => {
    /**
     * `wa.me/?text=...` abre o WhatsApp sem destinatário: a recepção clica, o
     * aplicativo abre vazio, e ela não entende o que aconteceu. Melhor o texto,
     * que ao menos é discável.
     */
    render(<Telefone numero="sem numero" />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('sem numero')).toBeInTheDocument();
  });

  it('nulo vira ausência com rótulo, não campo vazio', () => {
    const { container } = render(<Telefone numero={null} />);

    expect(container.textContent).toContain('—');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('o número continua visível, não só o botão', () => {
    // A academia também liga do fixo. Um atalho que escondesse o número
    // deixaria quem precisa discá-lo sem o dado.
    render(<Telefone numero="4133334444" />);

    expect(screen.getByText('(41) 3333-4444')).toBeInTheDocument();
  });
});
