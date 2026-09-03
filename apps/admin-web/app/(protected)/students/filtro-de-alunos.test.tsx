import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();

let parametros = new URLSearchParams();

vi.mock('next/navigation', () => ({
  usePathname: () => '/students',
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => parametros,
}));

import { FiltroDeAlunos } from './filtro-de-alunos';

const PROPS = {
  unidades: [],
  termoInicial: '',
  situacaoInicial: '',
  unidadeInicial: '',
};

describe('FiltroDeAlunos', () => {
  beforeEach(() => {
    replace.mockClear();
    parametros = new URLSearchParams();
  });

  /**
   * O DEFEITO QUE ESTE TESTE EXISTE PARA PEGAR (issue #263).
   *
   * A busca automatica dispara com um `useEffect` que depende de `termo`, e
   * efeito roda TAMBEM NA MONTAGEM. Chegando na pagina 2 pelo link
   * "Proximos", o componente montava com o campo vazio, o efeito disparava
   * 300 ms depois, `navegar` apagava o `cursor` da URL e `router.replace`
   * devolvia a pessoa para a PAGINA 1 -- sozinho, sem ninguem tocar em nada.
   *
   * A recepcao via a lista "voltar" enquanto lia. Nao havia como paginar.
   */
  it('NAO reescreve a URL sozinho ao montar -- o cursor da pagina 2 sobrevive', async () => {
    parametros = new URLSearchParams('status=ACTIVE&cursor=abc-123');

    render(<FiltroDeAlunos {...PROPS} situacaoInicial="ACTIVE" />);

    // ESPERA DE VERDADE, e mais que o atraso da busca (300 ms): provar que
    // algo NAO acontece exige dar tempo de acontecer. Adiantar relogio falso
    // aqui esconderia o defeito, porque o `setTimeout` do debounce e agendado
    // dentro de um efeito que o React ainda nao rodou no instante zero.
    await new Promise((resolver) => setTimeout(resolver, 600));

    expect(replace).not.toHaveBeenCalled();
  });

  it('digitar 3+ caracteres busca e ZERA o cursor -- a pagina 2 do filtro antigo nao serve', async () => {
    const usuario = userEvent.setup();

    parametros = new URLSearchParams('cursor=abc-123');

    render(<FiltroDeAlunos {...PROPS} />);

    await usuario.type(screen.getByTestId('busca-de-alunos'), 'maria');

    // `waitFor` com relogio de verdade, e nao `advanceTimersByTime`: com
    // `userEvent` os temporizadores falsos precisam do `advanceTimers` na
    // configuracao e ainda assim se enroscam no `setTimeout` do debounce.
    // Esperar 300 ms de verdade custa 300 ms e nao tem armadilha.
    await waitFor(() => {
      expect(replace).toHaveBeenCalled();
    });

    const url = String(replace.mock.calls.at(-1)?.[0]);

    expect(url).toContain('q=maria');
    // O cursor SAI: ele aponta para uma posicao da lista ANTERIOR ao filtro,
    // e mante-lo mostraria a segunda pagina de uma busca que nao aconteceu.
    expect(url).not.toContain('cursor');
  });

  it('trocar a situacao busca na hora, sem esperar o atraso do texto', async () => {
    const usuario = userEvent.setup();

    render(<FiltroDeAlunos {...PROPS} />);

    await usuario.selectOptions(screen.getByLabelText('Situação'), 'BLOCKED');

    await waitFor(() => {
      expect(replace).toHaveBeenCalled();
    });

    expect(String(replace.mock.calls[0]?.[0])).toContain('status=BLOCKED');
  });

  it('apagar o texto limpa o filtro -- volta a lista inteira', async () => {
    const usuario = userEvent.setup();

    parametros = new URLSearchParams('q=maria');

    render(<FiltroDeAlunos {...PROPS} termoInicial="maria" />);

    await usuario.clear(screen.getByTestId('busca-de-alunos'));

    await waitFor(() => {
      expect(replace).toHaveBeenCalled();
    });

    expect(String(replace.mock.calls.at(-1)?.[0])).not.toContain('q=');
  });
});
