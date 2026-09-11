import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Tabs } from './Tabs.js';

const ABAS = [
  { id: 'dados', label: 'Dados do cliente', content: <input aria-label="CNPJ" /> },
  { id: 'layout', label: 'Layout', contador: 1, content: <p>Logotipo</p> },
  { id: 'situacao', label: 'Situação', content: <p>Ativo</p> },
] as const;

function abas() {
  return <Tabs abas={ABAS} label="Seções do cliente" testId="abas" />;
}

describe('Tabs', () => {
  it('mostra a primeira aba e esconde as outras', () => {
    render(abas());

    expect(screen.getByTestId('painel-dados')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('painel-layout')).toHaveAttribute('hidden');
  });

  it('TODOS os paineis ficam montados -- o formulario nao perde o que foi digitado', async () => {
    /*
     * O defeito que este teste existe para impedir: desmontar o painel inativo
     * e o desenho obvio, e faz o formulario esvaziar quando alguem troca de
     * aba para conferir outra coisa e volta. O §10 item 3 proibe formulario
     * que perde dado.
     */
    const usuario = userEvent.setup();

    render(abas());

    await usuario.type(screen.getByLabelText('CNPJ'), '12345678000195');
    await usuario.click(screen.getByTestId('aba-situacao'));
    await usuario.click(screen.getByTestId('aba-dados'));

    expect(screen.getByLabelText('CNPJ')).toHaveValue('12345678000195');
  });

  it('o painel inativo sai da arvore de acessibilidade, nao so da tela', () => {
    /*
     * `hidden` e nao `display: none` por CSS: sem ele o Tab cairia num campo
     * invisivel, e o leitor de tela leria as tres abas de uma vez.
     */
    render(abas());

    expect(screen.getByTestId('painel-layout')).toHaveAttribute('hidden');
    expect(screen.queryByText('Logotipo')).not.toBeVisible();
  });

  it('as setas navegam e levam o foco junto', async () => {
    const usuario = userEvent.setup();

    render(abas());

    screen.getByTestId('aba-dados').focus();
    await usuario.keyboard('{ArrowRight}');

    expect(screen.getByTestId('aba-layout')).toHaveFocus();
    expect(screen.getByTestId('aba-layout')).toHaveAttribute('aria-selected', 'true');
  });

  it('a seta circula do fim para o comeco', async () => {
    // Sem o modulo, a seta na ultima aba nao faria nada -- e quem navega por
    // teclado teria de voltar tres vezes para chegar na primeira.
    const usuario = userEvent.setup();

    render(abas());

    screen.getByTestId('aba-situacao').focus();
    await usuario.click(screen.getByTestId('aba-situacao'));
    await usuario.keyboard('{ArrowRight}');

    expect(screen.getByTestId('aba-dados')).toHaveFocus();
  });

  it('Home e End vao aos extremos', async () => {
    const usuario = userEvent.setup();

    render(abas());

    screen.getByTestId('aba-dados').focus();
    await usuario.keyboard('{End}');

    expect(screen.getByTestId('aba-situacao')).toHaveFocus();

    await usuario.keyboard('{Home}');

    expect(screen.getByTestId('aba-dados')).toHaveFocus();
  });

  it('so a aba ativa entra na ordem de tabulacao', () => {
    /*
     * Com as tres tabulaveis, alcancar o conteudo custaria tres Tabs. O padrao
     * WAI-ARIA poe uma so na ordem e deixa as setas fazerem o resto.
     */
    render(abas());

    expect(screen.getByTestId('aba-dados')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('aba-layout')).toHaveAttribute('tabindex', '-1');
  });

  it('o contador aparece ao lado do rotulo', () => {
    render(abas());

    expect(screen.getByTestId('aba-layout')).toHaveTextContent('1');
  });

  it('cada painel e anunciado pela propria aba', () => {
    render(abas());

    const painel = screen.getByTestId('painel-dados');
    const aba = screen.getByTestId('aba-dados');

    expect(painel).toHaveAttribute('aria-labelledby', aba.id);
    expect(aba).toHaveAttribute('aria-controls', painel.id);
  });
});
