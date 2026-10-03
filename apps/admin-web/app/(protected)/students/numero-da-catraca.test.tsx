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
const controle: { estado: EstadoDoNumero; despachar: ReturnType<typeof vi.fn> } = vi.hoisted(() => ({
  estado: {},
  despachar: vi.fn(),
}));

vi.mock('react', async (original) => {
  const real = await original<typeof import('react')>();
  return {
    ...real,
    useActionState: () => [controle.estado, controle.despachar, false],
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

const DOIS = [
  { externalId: '100000000123', readerName: 'MARIA S', deviceSerial: 'AYTI1' },
  { externalId: '100000000124', readerName: null, deviceSerial: 'AYTI1' },
];

async function abrirAbaDoLeitor(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByRole('button', { name: 'Número da catraca' }));
  await usuario.click(screen.getByRole('tab', { name: 'Do leitor' }));
}

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
    controle.despachar = vi.fn();
    vi.mocked(listarNumerosDoLeitorSemAluno).mockReset();
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue({ ok: true, itens: [] });
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
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue({ ok: true, itens: DOIS });
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
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue({
      ok: true,
      itens: [
        { externalId: '100000000123', readerName: 'MARIA S', deviceSerial: 'AYTI1' },
        { externalId: '100000000124', readerName: 'JOAO', deviceSerial: 'AYTI1' },
      ],
    });
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: 'Número da catraca' }));
    await usuario.click(screen.getByRole('tab', { name: 'Do leitor' }));
    await screen.findByTestId('numeros-do-leitor');
    await usuario.type(screen.getByTestId('busca-numero-leitor'), 'maria');

    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });
});

describe('NumeroDaCatraca -- aba Do leitor nunca gera numero novo', () => {
  beforeEach(() => {
    controle.estado = {};
    controle.despachar = vi.fn();
    vi.mocked(listarNumerosDoLeitorSemAluno).mockReset();
  });

  it('nao busca a lista antes de abrir o dialogo', () => {
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue({ ok: true, itens: DOIS });
    renderizar();
    expect(listarNumerosDoLeitorSemAluno).not.toHaveBeenCalled();
  });

  it('lista vazia: mensagem de vazio e envio desabilitado', async () => {
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue({ ok: true, itens: [] });
    const usuario = userEvent.setup();
    renderizar();
    await abrirAbaDoLeitor(usuario);

    expect(await screen.findByTestId('sem-numeros-do-leitor')).toHaveTextContent('Nenhum número do leitor está livre');
    expect(screen.getByTestId('usar-numero-do-leitor')).toBeDisabled();
  });

  it('sem escolha fica desabilitado; escolher habilita; busca que esconde a escolha desfaz', async () => {
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue({ ok: true, itens: DOIS });
    const usuario = userEvent.setup();
    renderizar();
    await abrirAbaDoLeitor(usuario);
    await screen.findByTestId('numeros-do-leitor');

    const enviar = screen.getByTestId('usar-numero-do-leitor');
    expect(enviar).toBeDisabled();

    await usuario.click(screen.getByRole('radio', { name: '100000000123 — MARIA S' }));
    expect(enviar).toBeEnabled();

    await usuario.type(screen.getByTestId('busca-numero-leitor'), '124');
    expect(enviar).toBeDisabled();

    await usuario.clear(screen.getByTestId('busca-numero-leitor'));
    expect(screen.getByRole('radio', { name: '100000000123 — MARIA S' })).not.toBeChecked();
    expect(enviar).toBeDisabled();
  });

  it('Enter na busca sem escolha nao chama a action', async () => {
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue({ ok: true, itens: DOIS });
    const usuario = userEvent.setup();
    renderizar();
    await abrirAbaDoLeitor(usuario);
    await screen.findByTestId('numeros-do-leitor');

    await usuario.type(screen.getByTestId('busca-numero-leitor'), 'zzz{Enter}');
    await usuario.clear(screen.getByTestId('busca-numero-leitor'));
    await usuario.type(screen.getByTestId('busca-numero-leitor'), '{Enter}');

    expect(controle.despachar).not.toHaveBeenCalled();
  });

  it('o formulario do leitor leva origem=leitor', async () => {
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue({ ok: true, itens: DOIS });
    const usuario = userEvent.setup();
    renderizar();
    await abrirAbaDoLeitor(usuario);

    const painel = screen.getByTestId('painel-leitor');
    expect(painel.querySelector('input[name="origem"]')).toHaveValue('leitor');
    expect(screen.getByTestId('painel-gerar').querySelector('input[name="origem"]')).toBeNull();
  });

  it('falha ao carregar: aviso proprio, toast, sem estourar a pagina; tentar de novo recarrega', async () => {
    vi.mocked(listarNumerosDoLeitorSemAluno)
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValueOnce({ ok: true, itens: DOIS });
    const usuario = userEvent.setup();
    renderizar();
    await abrirAbaDoLeitor(usuario);

    expect(await screen.findByTestId('falha-lista-do-leitor')).toBeInTheDocument();
    expect(screen.getByTestId('erro-lista-do-leitor')).toHaveTextContent(
      'Não foi possível carregar os números do leitor.',
    );
    expect(screen.queryByTestId('sem-numeros-do-leitor')).not.toBeInTheDocument();
    expect(screen.getByTestId('usar-numero-do-leitor')).toBeDisabled();

    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByTestId('numeros-do-leitor')).toBeInTheDocument();
    expect(screen.queryByTestId('falha-lista-do-leitor')).not.toBeInTheDocument();
  });

  it('API respondendo erro (ok: false) tambem e falha, nao lista vazia', async () => {
    vi.mocked(listarNumerosDoLeitorSemAluno).mockResolvedValue({ ok: false });
    const usuario = userEvent.setup();
    renderizar();
    await abrirAbaDoLeitor(usuario);

    expect(await screen.findByTestId('falha-lista-do-leitor')).toBeInTheDocument();
    expect(screen.queryByTestId('sem-numeros-do-leitor')).not.toBeInTheDocument();
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
