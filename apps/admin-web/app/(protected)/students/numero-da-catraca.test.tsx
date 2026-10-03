import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import type { EstadoDoNumero } from '../../actions/numero-da-catraca';

/*
 * jsdom nao executa Server Action (memoria "jsdom nao roda Server Action"):
 * a action vira mock e o ESTADO que ela devolveria entra pelo
 * `useActionState`, que e o unico ponto onde o resultado chega a tela. O
 * envio de verdade e do E2E (Task 7).
 */
const controle: { estado: EstadoDoNumero } = vi.hoisted(() => ({ estado: {} }));

vi.mock('react', async (original) => {
  const real = await original<typeof import('react')>();
  return {
    ...real,
    useActionState: () => [controle.estado, vi.fn(), false],
  };
});

vi.mock('../../actions/numero-da-catraca', () => ({
  gerarNumeroDaCatraca: vi.fn(),
  listarNumerosDoLeitorSemAluno: vi.fn(),
}));

import { listarNumerosDoLeitorSemAluno } from '../../actions/numero-da-catraca';
import { NumeroDaCatraca, opcoesDoLeitor } from './numero-da-catraca';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function abrir(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function fechar(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

const ALUNO = '11111111-1111-4111-8111-111111111111';

function renderizar() {
  return render(
    <ToastProvider>
      <NumeroDaCatraca studentId={ALUNO} />
    </ToastProvider>,
  );
}

describe('NumeroDaCatraca', () => {
  beforeEach(() => {
    controle.estado = {};
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue([]);
  });

  it('abre o dialogo ao clicar no icone', async () => {
    const usuario = userEvent.setup();
    renderizar();

    const dialogo = screen.getByTestId<HTMLDialogElement>('dialogo-numero-catraca');
    expect(dialogo.open).toBe(false);

    await usuario.click(screen.getByRole('button', { name: 'Número da catraca' }));

    expect(dialogo.open).toBe(true);
    expect(screen.getByRole('tab', { name: 'Gerar novo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mostrar ou gerar número' })).toBeInTheDocument();
  });

  it('estado com numero mostra o visor', () => {
    controle.estado = { numero: '100000000007', vinculado: true };
    renderizar();

    expect(screen.getByTestId('numero-em-destaque-valor').textContent?.replace(/\s/g, '')).toBe(
      '100000000007',
    );
    expect(screen.getByText('Este número já está vinculado ao leitor.')).toBeInTheDocument();
  });

  it('aba "Do leitor" lista numero com nome e numero sem nome, valor so com digitos', async () => {
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue([
      { externalId: '100000000123', readerName: 'MARIA S', deviceSerial: 'AYTI1' },
      { externalId: '100000000124', readerName: null, deviceSerial: 'AYTI1' },
    ]);
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: 'Número da catraca' }));
    await usuario.click(screen.getByRole('tab', { name: 'Do leitor' }));

    const lista = await screen.findByTestId('numeros-do-leitor');
    const maria = within(lista).getByRole('radio', { name: '100000000123 — MARIA S' });
    expect(maria).toHaveAttribute('value', '100000000123');
    expect(within(lista).getByRole('radio', { name: '100000000124' })).toHaveAttribute(
      'value',
      '100000000124',
    );
  });

  it('a busca filtra por nome', async () => {
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue([
      { externalId: '100000000123', readerName: 'MARIA S', deviceSerial: 'AYTI1' },
      { externalId: '100000000124', readerName: 'JOAO', deviceSerial: 'AYTI1' },
    ]);
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: 'Número da catraca' }));
    await usuario.click(screen.getByRole('tab', { name: 'Do leitor' }));
    await screen.findByTestId('numeros-do-leitor');
    await usuario.type(screen.getByTestId('busca-numero-leitor'), 'maria');

    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });
});

describe('opcoesDoLeitor', () => {
  it('descarta numero fora de 1-12 digitos', () => {
    const opcoes = opcoesDoLeitor([
      { externalId: '100000000123', readerName: null, deviceSerial: 'A' },
      { externalId: '1234567890123', readerName: null, deviceSerial: 'A' },
      { externalId: '12a4', readerName: null, deviceSerial: 'A' },
      { externalId: '', readerName: null, deviceSerial: 'A' },
    ]);

    expect(opcoes.map((o) => o.numero)).toEqual(['100000000123']);
  });

  it('mesmo numero em dois leitores aparece uma vez, com o primeiro nome achado', () => {
    const opcoes = opcoesDoLeitor([
      { externalId: '100000000123', readerName: null, deviceSerial: 'A' },
      { externalId: '100000000123', readerName: 'MARIA S', deviceSerial: 'B' },
      { externalId: '100000000123', readerName: 'OUTRA', deviceSerial: 'C' },
    ]);

    expect(opcoes).toEqual([{ chave: '100000000123:A', numero: '100000000123', nome: 'MARIA S' }]);
  });

  it('nome com quebra de linha e espacos repetidos vira uma linha', () => {
    const [opcao] = opcoesDoLeitor([
      { externalId: '1', readerName: '  MARIA\n\n  S\tSILVA ', deviceSerial: 'A' },
      { externalId: '2', readerName: ' \n ', deviceSerial: 'A' },
    ]);

    expect(opcao?.nome).toBe('MARIA S SILVA');
    expect(opcoesDoLeitor([{ externalId: '2', readerName: ' \n ', deviceSerial: 'A' }])[0]?.nome).toBeNull();
  });
});
