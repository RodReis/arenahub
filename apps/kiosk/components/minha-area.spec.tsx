import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG_PADRAO_DO_TOTEM, type KioskConfig } from '@arenahub/api-contracts';

import type { SessaoDoAluno } from '../lib/kiosk-client.js';

import { MinhaArea } from './minha-area.js';

/*
 * As telas internas buscam dado ao montar. Aqui so importa a NAVEGACAO --
 * o conteudo delas tem suite propria -- entao os carregadores devolvem
 * nulo e a tela cai no estado de falha, que ja e um estado valido.
 */
vi.mock('../lib/kiosk-client', async (original) => ({
  ...(await original<typeof import('../lib/kiosk-client')>()),
  carregarAvaliacao: vi.fn().mockResolvedValue(null),
  carregarAvaliacoes: vi.fn().mockResolvedValue(null),
  carregarEvolucao: vi.fn().mockResolvedValue(null),
  carregarPagamentos: vi.fn().mockResolvedValue(null),
}));


function sessao(pendenciaEmCentavos: number | null): SessaoDoAluno {
  return {
    sessionId: 's1',
    token: 't1',
    nome: 'Marina Duarte Alves',
    plano: { ativo: pendenciaEmCentavos === null, pendenciaEmCentavos },
    expiraEm: '2026-08-26T12:00:60.000Z',
  };
}

function config(modulos: Partial<KioskConfig['modulos']> = {}): KioskConfig {
  return {
    ...CONFIG_PADRAO_DO_TOTEM,
    modulos: { ...CONFIG_PADRAO_DO_TOTEM.modulos, ...modulos },
  };
}

describe('MinhaArea', () => {
  it('saúda pelo primeiro nome, nunca pelo nome inteiro', () => {
    render(<MinhaArea sessao={sessao(null)} config={config()} />);

    expect(screen.getByTestId('saudacao')).toHaveTextContent('Olá, Marina');
    expect(screen.queryByText(/Duarte Alves/)).not.toBeInTheDocument();
  });

  it('NÃO mostra o valor da pendência nesta tela', () => {
    // `DS-TOTEM.md` §9.1 e a issue da F52: a etapa diz QUE ha pendencia e o
    // que fazer. Valor e detalhe da fatura so na etapa de pagamento, depois
    // de acao deliberada -- a recepcao tem fila atras, e quem esta na fila
    // le a tela de quem esta na frente.
    render(<MinhaArea sessao={sessao(18_990)} config={config({ pagamento: true })} />);

    expect(screen.getByTestId('faixa-de-plano')).toHaveTextContent('fatura em aberto');
    expect(screen.queryByText(/189,90/)).not.toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
  });

  it('manda para a recepção quando há pendência e o pagamento está desligado', () => {
    render(<MinhaArea sessao={sessao(18_990)} config={config({ pagamento: false })} />);

    expect(screen.getByTestId('faixa-de-plano')).toHaveTextContent(/procure a recepção/i);
  });

  it('mostra plano ativo sem pendência', () => {
    render(<MinhaArea sessao={sessao(null)} config={config()} />);

    expect(screen.getByTestId('faixa-de-plano')).toHaveTextContent('Plano ativo');
  });

  it('não desenha grade quando nenhum módulo está ligado', () => {
    render(<MinhaArea sessao={sessao(null)} config={config()} />);

    expect(screen.queryByTestId('grade-de-modulos')).not.toBeInTheDocument();
    expect(screen.getByText(/procure a recepção/i)).toBeInTheDocument();
  });

  it('desenha só os cards dos módulos ligados', () => {
    render(
      <MinhaArea sessao={sessao(null)} config={config({ pagamento: true, avaliacao: true })} />,
    );

    expect(screen.getByTestId('grade-de-modulos')).toBeInTheDocument();
    expect(screen.getByTestId('modulo-pagamento')).toBeInTheDocument();
    expect(screen.getByTestId('modulo-avaliacao')).toBeInTheDocument();
    expect(screen.queryByTestId('modulo-evolucao')).not.toBeInTheDocument();
  });

  it('não acende a grade só porque ranking está ligado', () => {
    // `ranking: true` numa config publicada nao pode produzir grade VAZIA:
    // a F33 nao entregou, entao nao ha card -- e sem card a tela volta a
    // dizer "procure a recepcao", que e a verdade.
    render(<MinhaArea sessao={sessao(null)} config={config({ ranking: true })} />);

    expect(screen.queryByTestId('grade-de-modulos')).not.toBeInTheDocument();
    expect(screen.getByText(/procure a recepção/i)).toBeInTheDocument();
  });

  it('usa botão nativo nos cards — teclado e leitor de tela sem reimplementação', () => {
    render(<MinhaArea sessao={sessao(null)} config={config({ pagamento: true })} />);

    expect(screen.getByTestId('modulo-pagamento').tagName).toBe('BUTTON');
  });

  it('abre a tela do módulo ao tocar no card', async () => {
    const usuario = userEvent.setup();

    render(<MinhaArea sessao={sessao(null)} config={config({ avaliacao: true })} />);
    await usuario.click(screen.getByTestId('modulo-avaliacao'));

    expect(await screen.findByRole('heading', { name: 'Avaliação do mês' })).toBeInTheDocument();
  });

  it('volta para a grade sem deixar rastro da tela anterior', async () => {
    const usuario = userEvent.setup();

    render(<MinhaArea sessao={sessao(null)} config={config({ avaliacao: true })} />);
    await usuario.click(screen.getByTestId('modulo-avaliacao'));
    await usuario.click(await screen.findByRole('button', { name: 'Voltar' }));

    expect(screen.getByTestId('grade-de-modulos')).toBeInTheDocument();
  });

  it('navega por estado, não por rota — o histórico do quiosque vazaria o aluno anterior', async () => {
    // Com rota, o botao "voltar" do navegador reabriria a tela do aluno da
    // sessao ANTERIOR: o historico sobrevive ao encerramento da sessao.
    const usuario = userEvent.setup();
    const antes = window.location.href;

    render(<MinhaArea sessao={sessao(null)} config={config({ avaliacao: true })} />);
    await usuario.click(screen.getByTestId('modulo-avaliacao'));
    await screen.findByRole('heading', { name: 'Avaliação do mês' });

    expect(window.location.href).toBe(antes);
  });
});
