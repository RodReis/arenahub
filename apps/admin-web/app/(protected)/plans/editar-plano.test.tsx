import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { EditarPlano } from './editar-plano';

vi.mock('../../actions/membership', () => ({
  editarPlano: vi.fn(),
}));

/** `jsdom` nao implementa `showModal`/`close` do `<dialog>`. */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function abrir(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function fechar(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

const PLANO_ID = '11111111-1111-4111-8111-111111111111';
const MATRIZ = { id: 'un-matriz', name: 'Unidade Matriz' };
const ZONA_SUL = { id: 'un-zona-sul', name: 'Zona Sul' };

const PADRAO = {
  planId: PLANO_ID,
  nome: 'Plano Familia',
  descricao: 'Plano familiar com ate 3 membros.',
  unidadesDoPlano: [MATRIZ.id],
  janelas: [{ gymUnitId: MATRIZ.id, dayOfWeek: 1, startMinute: 360, endMinute: 1320 }],
  unidades: [MATRIZ, ZONA_SUL],
};

function renderizar(props: Partial<Parameters<typeof EditarPlano>[0]> = {}) {
  return render(
    <ToastProvider>
      <EditarPlano {...PADRAO} {...props} />
    </ToastProvider>,
  );
}

async function abrir(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByTestId(`abrir-edicao-do-plano-${PLANO_ID}`));
}

describe('EditarPlano', () => {
  it('abre preenchido com o que veio da API', async () => {
    const usuario = userEvent.setup();

    renderizar();
    await abrir(usuario);

    expect(screen.getByTestId('campo-edicao-nome-do-plano')).toHaveValue('Plano Familia');
    expect(screen.getByTestId('campo-edicao-descricao-do-plano')).toHaveValue(
      'Plano familiar com ate 3 membros.',
    );
  });

  /**
   * O MINUTO VIRA HORA: a API guarda `startMinute: 360`, o input `time`
   * espera `"06:00"`. Sem a conversao o campo abre VAZIO -- e salvar
   * apagaria a janela que a operadora nem tocou.
   */
  it('converte minuto da API para o formato do campo de hora', async () => {
    const usuario = userEvent.setup();

    renderizar();
    await abrir(usuario);

    expect(screen.getByLabelText('Hora de início')).toHaveValue('06:00');
    expect(screen.getByLabelText('Hora de fim')).toHaveValue('22:00');
  });

  /**
   * SÓ AS UNIDADES DO PLANO vêm marcadas. Marcar todas faria a edicao
   * ESPALHAR o plano para unidades onde ele nunca valeu, e ninguem
   * perceberia -- o formulario abriria "certo".
   */
  it('marca apenas as unidades onde o plano ja vale', async () => {
    const usuario = userEvent.setup();

    renderizar();
    await abrir(usuario);

    expect(screen.getByTestId(`edicao-unidade-${MATRIZ.id}`)).toBeChecked();
    expect(screen.getByTestId(`edicao-unidade-${ZONA_SUL.id}`)).not.toBeChecked();
  });

  /**
   * PLANO SEM JANELA ainda precisa de uma linha para editar: a API exige ao
   * menos uma, e abrir a tabela vazia deixaria a operadora sem por onde
   * comecar.
   */
  it('oferece uma linha padrao quando o plano nao tem janela', async () => {
    const usuario = userEvent.setup();

    renderizar({ janelas: [] });
    await abrir(usuario);

    expect(screen.getByLabelText('Hora de início')).toHaveValue('06:00');
  });

  /**
   * DOIS HORARIOS NO MESMO DIA sao caso real (manha e noite). A chave da
   * linha nao pode ser `dayOfWeek`, senao React reaproveita o elemento e as
   * duas faixas viram uma.
   */
  it('mostra duas janelas do mesmo dia como linhas distintas', async () => {
    const usuario = userEvent.setup();

    renderizar({
      janelas: [
        { gymUnitId: MATRIZ.id, dayOfWeek: 1, startMinute: 360, endMinute: 720 },
        { gymUnitId: MATRIZ.id, dayOfWeek: 1, startMinute: 1080, endMinute: 1320 },
      ],
    });
    await abrir(usuario);

    expect(screen.getAllByLabelText('Hora de início')).toHaveLength(2);
  });
});
