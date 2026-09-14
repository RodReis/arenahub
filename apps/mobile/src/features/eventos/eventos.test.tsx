import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { Eventos, type DadosDoEngajamento } from './eventos.js';

const base: DadosDoEngajamento = {
  asOf: '2026-09-12T12:00:00.000Z',
  status: 'AVAILABLE',
  mes: '2026-09',
  unidade: { nome: 'Unidade Centro' },
  xp: {
    saldoDoMes: 1240,
    conquistas: [
      { titulo: '10 treinos no mês', desbloqueadaEm: '2026-09-10T12:00:00.000Z', revertida: false },
      { titulo: 'Conquista estornada', desbloqueadaEm: '2026-09-01T12:00:00.000Z', revertida: true },
    ],
  },
  consistencia: { atual: 6, recorde: 8, diasPorSemana: 3 },
  ranking: {
    participa: true,
    nomeExibido: 'Rodrigo',
    minhaPosicao: { posicao: 4, pontos: 900 },
    placar: [
      { posicao: 1, nome: 'Fê', pontos: 2200, souEu: false },
      { posicao: 4, nome: 'Rodrigo', pontos: 900, souEu: true },
    ],
  },
  desafios: [{ id: 'd1', titulo: 'Desafio 4 treinos', meta: 4, progresso: 2, inscrito: true, inicio: '2026-09-08', fim: '2026-09-14' }],
};

const renderizar = (dados: Partial<DadosDoEngajamento> = {}, onMudarRanking = jest.fn()) => {
  render(
    <ProvedorDeTema forcarTema="dark">
      <Eventos dados={{ ...base, ...dados }} salvandoRanking={false} onMudarRanking={onMudarRanking} />
    </ProvedorDeTema>,
  );
  return onMudarRanking;
};

describe('Eventos', () => {
  it('mostra o XP do mes com milhar de pt-BR e sem inventar nivel', () => {
    renderizar();
    expect(screen.getByTestId('xp-saldo')).toHaveTextContent('1.240 XP');
    expect(screen.getByText('XP DE SETEMBRO')).toBeTruthy();
    // O dominio nao tem nivel -- a tela nao cria um.
    expect(screen.queryByText(/nível/i)).toBeNull();
  });

  it('destaca a linha do proprio aluno no placar', () => {
    renderizar();
    expect(screen.getByTestId('placar-eu')).toHaveTextContent(/Você \(Rodrigo\)/);
  });

  it('aluno fora do top do placar ainda ve a propria posicao', () => {
    renderizar({
      ranking: { ...base.ranking!, placar: [{ posicao: 1, nome: 'Fê', pontos: 2200, souEu: false }] },
    });
    expect(screen.getByTestId('placar-eu')).toHaveTextContent(/^4Você/);
  });

  it('fora do ranking: convite, e o XP continua aparecendo (M5-BR-002)', () => {
    const onMudar = renderizar({ ranking: { ...base.ranking!, participa: false, placar: [], minhaPosicao: null } });

    expect(screen.getByTestId('ranking-fora')).toBeTruthy();
    expect(screen.queryByTestId('placar')).toBeNull();
    expect(screen.getByTestId('xp-saldo')).toHaveTextContent(/1.240/);

    fireEvent.press(screen.getByTestId('botao-participar-ranking'));
    expect(onMudar).toHaveBeenCalledWith(true);
  });

  it('sair do ranking custa dois toques -- toca e confirma', () => {
    const onMudar = renderizar();

    fireEvent.press(screen.getByTestId('botao-sair-ranking'));
    expect(onMudar).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('botao-confirmar-sair-ranking'));
    expect(onMudar).toHaveBeenCalledWith(false);
  });

  it('conquista revertida nao aparece como conquistada', () => {
    renderizar();
    expect(screen.getByText('10 treinos no mês')).toBeTruthy();
    expect(screen.queryByText('Conquista estornada')).toBeNull();
  });

  it('secao desligada pela academia some inteira', () => {
    renderizar({ ranking: null, desafios: null, xp: { saldoDoMes: 10, conquistas: null } });

    expect(screen.queryByText('Ranked do mês')).toBeNull();
    expect(screen.queryByTestId('lista-desafios')).toBeNull();
    expect(screen.queryByText('Suas conquistas')).toBeNull();
  });

  it('desafio inscrito mostra o progresso que o servidor calculou', () => {
    renderizar();
    expect(screen.getByTestId('desafio-d1')).toHaveTextContent(/2 de 4 treinos/);
  });
});
