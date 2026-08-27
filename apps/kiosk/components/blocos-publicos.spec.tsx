import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG_PADRAO_DO_TOTEM,
  ROTULO_PADRAO_DE_PATROCINIO,
  type BlocoDaTelaPublica,
  type KioskConfig,
} from '@arenahub/api-contracts';

import { BlocosPublicos, formatarData, haAlgoNaGradePublica, rotuloDoPeriodo } from './blocos-publicos.js';

const video: BlocoDaTelaPublica = {
  id: 'v',
  habilitado: true,
  tipo: 'VIDEO',
  titulo: 'Equipe',
  legenda: 'Conheça',
  midiaKey: 'tenants/t/kiosk-media/u/a.mp4',
  linkExterno: null,
  midiaUrl: 'https://cdn.example/a.mp4',
};

const instagram: BlocoDaTelaPublica = {
  id: 'i',
  habilitado: true,
  tipo: 'INSTAGRAM',
  perfil: '@arena',
  chamada: 'Siga a gente',
};

const material: BlocoDaTelaPublica = {
  id: 'm',
  habilitado: true,
  tipo: 'MATERIAL',
  titulo: 'Como treinar em casa',
  resumo: 'Cinco exercícios sem equipamento.',
  urlDoQr: 'https://arena.example/materia',
};

const informacoes: BlocoDaTelaPublica = {
  id: 'n',
  habilitado: true,
  tipo: 'INFORMACOES',
  titulo: 'A unidade agora',
  mostrarCheckinsDeHoje: true,
  mostrarTreinandoAgora: true,
};

function config(
  itens: readonly BlocoDaTelaPublica[],
  extras: Partial<KioskConfig> = {},
): KioskConfig {
  return {
    ...CONFIG_PADRAO_DO_TOTEM,
    blocos: { tempoPorBlocoSegundos: 12, itens: [...itens] },
    ...extras,
  };
}

const indicadoresComPlacar = {
  checkinsDeHoje: 0,
  treinandoAgora: 0,
  placar: [
    { position: 1, nomeExibido: 'Ana S.', points: 50 },
    { position: 2, nomeExibido: 'Bia', points: 40 },
    { position: 3, nomeExibido: 'Caio', points: 35 },
    { position: 4, nomeExibido: 'Duda', points: 30 },
    { position: 5, nomeExibido: 'Eva', points: 25 },
  ],
};

/**
 * As quatro composicoes da tabela do brief da task 14 (mais os dois estados
 * de borda: reel desligado, e tudo desligado). Cada teste confere a
 * COMPOSICAO -- nunca card vazio, nunca buraco -- e nao o pixel exato.
 */
describe('BlocosPublicos -- grade densa (§4 v2.1)', () => {
  it('reel + carrossel + ranking -- duas colunas, direita dividida em duas linhas', () => {
    render(
      <BlocosPublicos config={config([video, instagram])} indicadores={indicadoresComPlacar} />,
    );

    const grade = screen.getByTestId('grade-da-tela-publica');
    expect(grade).toHaveClass('gradeCompleta');
    expect(screen.getByTestId('slot-reel')).toHaveAttribute('data-tipo', 'VIDEO');
    expect(screen.getByTestId('slot-carrossel')).toHaveAttribute('data-tipo', 'INSTAGRAM');
    expect(screen.getByTestId('placar-publico')).toBeInTheDocument();
  });

  it('reel + carrossel, sem ranking -- carrossel ocupa a direita inteira', () => {
    render(<BlocosPublicos config={config([video, instagram])} indicadores={null} />);

    const grade = screen.getByTestId('grade-da-tela-publica');
    expect(grade).toHaveClass('gradeSemRanking');
    expect(screen.getByTestId('slot-reel')).toBeInTheDocument();
    expect(screen.getByTestId('slot-carrossel')).toBeInTheDocument();
    expect(screen.queryByTestId('placar-publico')).toBeNull();
  });

  it('reel + ranking, sem carrossel -- ranking ocupa a direita inteira', () => {
    render(<BlocosPublicos config={config([video])} indicadores={indicadoresComPlacar} />);

    const grade = screen.getByTestId('grade-da-tela-publica');
    expect(grade).toHaveClass('gradeSemCarrossel');
    expect(screen.getByTestId('slot-reel')).toBeInTheDocument();
    expect(screen.queryByTestId('slot-carrossel')).toBeNull();
    expect(screen.getByTestId('placar-publico')).toBeInTheDocument();
  });

  it('so reel -- uma coluna, largura total', () => {
    render(<BlocosPublicos config={config([video])} indicadores={null} />);

    const grade = screen.getByTestId('grade-da-tela-publica');
    expect(grade).toHaveClass('gradeSoReel');
    expect(screen.getByTestId('slot-reel')).toBeInTheDocument();
    expect(screen.queryByTestId('slot-carrossel')).toBeNull();
    expect(screen.queryByTestId('placar-publico')).toBeNull();
  });

  it('reel desligado -- a coluna direita ocupa a largura total', () => {
    // Com UM bloco so configurado ele viraria o reel por definicao (e o
    // reel e "o primeiro item visivel") -- o teste que prova "reel
    // desligado de verdade" precisa de ZERO blocos configuraveis, com o
    // ranking sozinho ocupando a largura inteira.
    render(<BlocosPublicos config={config([])} indicadores={indicadoresComPlacar} />);

    const grade = screen.getByTestId('grade-da-tela-publica');
    expect(grade).toHaveClass('gradeSemReel');
    expect(screen.queryByTestId('slot-reel')).toBeNull();
    expect(screen.getByTestId('placar-publico')).toBeInTheDocument();
  });

  it('todos desligados -- a grade nao renderiza nada', () => {
    render(<BlocosPublicos config={CONFIG_PADRAO_DO_TOTEM} indicadores={null} />);

    expect(screen.queryByTestId('grade-da-tela-publica')).toBeNull();
  });
});

describe('BlocosPublicos -- rodizio interno do carrossel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('o reel NUNCA entra na rotacao -- so os blocos atras dele giram', () => {
    render(<BlocosPublicos config={config([video, instagram, material])} indicadores={null} />);

    // Reel fixo em VIDEO durante toda a janela de rotacao.
    expect(screen.getByTestId('slot-reel')).toHaveAttribute('data-tipo', 'VIDEO');

    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    expect(screen.getByTestId('slot-reel')).toHaveAttribute('data-tipo', 'VIDEO');
    expect(screen.getByTestId('slot-carrossel')).toHaveAttribute('data-tipo', 'MATERIAL');

    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    expect(screen.getByTestId('slot-reel')).toHaveAttribute('data-tipo', 'VIDEO');
    expect(screen.getByTestId('slot-carrossel')).toHaveAttribute('data-tipo', 'INSTAGRAM');
  });

  it('carrossel com um unico bloco nao gira, e nao mostra pontos', () => {
    render(<BlocosPublicos config={config([video, instagram])} indicadores={null} />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByTestId('slot-carrossel')).toHaveAttribute('data-tipo', 'INSTAGRAM');
  });

  it('video SEM url resolvida nao entra em nenhum slot', () => {
    const videoSemUrl: BlocoDaTelaPublica = { ...video, midiaUrl: null };

    render(<BlocosPublicos config={config([videoSemUrl, instagram])} indicadores={null} />);

    // Sem o filtro de `blocosVisiveis`, o instagram viraria reel por
    // acidente -- confirma que o video invisivel nao ocupa posicao nenhuma.
    expect(screen.getByTestId('slot-reel')).toHaveAttribute('data-tipo', 'INSTAGRAM');
    expect(screen.queryByTestId('slot-carrossel')).toBeNull();
    expect(screen.queryByTestId('video-do-bloco')).toBeNull();
  });

  it('respeita o tempo configurado -- 8 s troca antes de 12', () => {
    render(
      <BlocosPublicos
        config={{
          ...config([video, instagram, material]),
          blocos: { tempoPorBlocoSegundos: 8, itens: [video, instagram, material] },
        }}
        indicadores={null}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(8_000);
    });

    expect(screen.getByTestId('slot-carrossel')).toHaveAttribute('data-tipo', 'MATERIAL');
  });
});

describe('BlocosPublicos -- indicadores (M3.5-BR-001)', () => {
  it('sem numero ainda, mostra o titulo e NAO um zero', () => {
    render(<BlocosPublicos config={config([informacoes])} indicadores={null} />);

    expect(screen.getByText('A unidade agora')).toBeInTheDocument();
    expect(screen.queryByTestId('indicadores')).toBeNull();
  });

  it('exibe os dois numeros quando o heartbeat os traz', () => {
    render(
      <BlocosPublicos
        config={config([informacoes])}
        indicadores={{ checkinsDeHoje: 312, treinandoAgora: 47, placar: [] }}
      />,
    );

    expect(screen.getByText('312')).toBeInTheDocument();
    expect(screen.getByText('47')).toBeInTheDocument();
  });

  it('indicador desligado nao aparece, mesmo com numero disponivel', () => {
    render(
      <BlocosPublicos
        config={config([{ ...informacoes, mostrarTreinandoAgora: false }])}
        indicadores={{ checkinsDeHoje: 312, treinandoAgora: 47, placar: [] }}
      />,
    );

    expect(screen.getByText('312')).toBeInTheDocument();
    expect(screen.queryByText('47')).toBeNull();
  });
});

describe('BlocosPublicos -- faixa de patrocinadores (ADR-042, Decisao 4)', () => {
  const patrocinio = {
    habilitado: true,
    rotulo: '',
    marcas: [{ nome: 'Suplementos XYZ', logotipoUrl: null }],
  };

  it('fica FORA da grade -- continua na tela mesmo com o carrossel girando', () => {
    vi.useFakeTimers();

    render(
      <BlocosPublicos config={config([video, instagram], { patrocinio })} indicadores={null} />,
    );

    expect(screen.getByTestId('faixa-de-patrocinio')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    expect(screen.getByTestId('faixa-de-patrocinio')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('rotulo vazio cai no padrao -- nunca faixa sem rotulo (CDC art. 36)', () => {
    render(<BlocosPublicos config={config([], { patrocinio })} indicadores={null} />);

    expect(screen.getByText(ROTULO_PADRAO_DE_PATROCINIO)).toBeInTheDocument();
  });

  it('NAO ha link nem area clicavel na faixa -- vitrine, nao midia', () => {
    const { container } = render(
      <BlocosPublicos config={config([], { patrocinio })} indicadores={null} />,
    );

    const faixa = screen.getByTestId('faixa-de-patrocinio');

    expect(faixa.querySelectorAll('a')).toHaveLength(0);
    expect(faixa.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('[href]')).toBeNull();
  });

  it('desligada, nao aparece', () => {
    render(
      <BlocosPublicos
        config={config([], { patrocinio: { ...patrocinio, habilitado: false } })}
        indicadores={null}
      />,
    );

    expect(screen.queryByTestId('faixa-de-patrocinio')).toBeNull();
  });

  it('ligada sem marca nenhuma nao deixa faixa vazia na tela', () => {
    render(
      <BlocosPublicos
        config={config([], { patrocinio: { ...patrocinio, marcas: [] } })}
        indicadores={null}
      />,
    );

    expect(screen.queryByTestId('faixa-de-patrocinio')).toBeNull();
  });
});

describe('BlocosPublicos -- placar publico (§3.4c)', () => {
  it('mostra os nomes que o heartbeat entregou, ja abreviados pelo servidor', () => {
    render(<BlocosPublicos config={config([])} indicadores={indicadoresComPlacar} />);

    expect(screen.getByText('Ana S.')).toBeInTheDocument();
  });

  it('placar vazio tira o bloco da grade -- a coluna se recompoe', () => {
    render(
      <BlocosPublicos
        config={config([video])}
        indicadores={{ ...indicadoresComPlacar, placar: [] }}
      />,
    );

    expect(screen.queryByTestId('placar-publico')).toBeNull();
    expect(screen.getByTestId('grade-da-tela-publica')).toHaveClass('gradeSoReel');
  });

  it('sem heartbeat ainda (indicadores nulo), o bloco tambem nao aparece', () => {
    render(<BlocosPublicos config={config([])} indicadores={null} />);

    expect(screen.queryByTestId('lista-de-placar')).toBeNull();
  });

  it('mostra no maximo cinco linhas', () => {
    const seisEntradas = {
      ...indicadoresComPlacar,
      placar: [
        ...indicadoresComPlacar.placar,
        { position: 6, nomeExibido: 'Fabio', points: 20 },
      ],
    };

    render(<BlocosPublicos config={config([])} indicadores={seisEntradas} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByText('Fabio')).toBeNull();
  });

  it('medalhao do 1o difere do 4o -- tratamento por posicao (§3.4c)', () => {
    render(<BlocosPublicos config={config([])} indicadores={indicadoresComPlacar} />);

    const linhas = screen.getAllByRole('listitem');
    const medalhaoPrimeiro = linhas[0]?.querySelector('.medalhao');
    const medalhaoQuarto = linhas[3]?.querySelector('.medalhao');

    expect(medalhaoPrimeiro).toHaveAttribute('data-posicao', 'ouro');
    expect(medalhaoQuarto).toHaveAttribute('data-posicao', 'bronze');
  });

  it('chip de periodo e rodape de participacao aparecem', () => {
    render(<BlocosPublicos config={config([])} indicadores={indicadoresComPlacar} />);

    expect(screen.getByTestId('chip-periodo-placar')).toBeInTheDocument();
    expect(screen.getByText('Participação opcional · nomes abreviados')).toBeInTheDocument();
  });

  it('nenhum studentId em lugar nenhum do que e renderizado', () => {
    const { container } = render(
      <BlocosPublicos config={config([])} indicadores={indicadoresComPlacar} />,
    );

    expect(container.innerHTML).not.toMatch(/studentId/iu);
  });

  it('entra na coluna direita junto com os blocos configuraveis, sem afetar o reel', () => {
    vi.useFakeTimers();

    render(<BlocosPublicos config={config([video])} indicadores={indicadoresComPlacar} />);

    expect(screen.getByTestId('slot-reel')).toHaveAttribute('data-tipo', 'VIDEO');
    expect(screen.getByTestId('placar-publico')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    // O ranking nao gira -- fica fixo na linha de baixo da coluna direita.
    expect(screen.getByTestId('slot-reel')).toHaveAttribute('data-tipo', 'VIDEO');
    expect(screen.getByTestId('placar-publico')).toBeInTheDocument();

    vi.useRealTimers();
  });
});

describe('haAlgoNaGradePublica', () => {
  it('falso sem bloco configurado e sem placar', () => {
    expect(haAlgoNaGradePublica(CONFIG_PADRAO_DO_TOTEM, null)).toBe(false);
  });

  it('verdadeiro so com placar, mesmo sem bloco configurado', () => {
    expect(haAlgoNaGradePublica(config([]), indicadoresComPlacar)).toBe(true);
  });

  it('verdadeiro so com bloco configurado, mesmo sem placar', () => {
    expect(haAlgoNaGradePublica(config([video]), null)).toBe(true);
  });
});

describe('rotuloDoPeriodo', () => {
  it('formata mes e metrica fixa', () => {
    expect(rotuloDoPeriodo(new Date('2026-08-15T12:00:00.000Z'))).toBe('AGOSTO · TREINOS');
  });

  it('primeiro e ultimo mes do ano', () => {
    expect(rotuloDoPeriodo(new Date('2026-01-15T12:00:00.000Z'))).toBe('JANEIRO · TREINOS');
    expect(rotuloDoPeriodo(new Date('2026-12-15T12:00:00.000Z'))).toBe('DEZEMBRO · TREINOS');
  });
});

describe('formatarData', () => {
  it('a data digitada nao anda um dia para tras', () => {
    // `new Date('2026-08-30')` seria UTC: num fuso negativo, dia 30 vira 29.
    expect(formatarData('2026-08-30')).toBe('30 AGO');
  });

  it('primeiro e ultimo mes', () => {
    expect(formatarData('2026-01-05')).toBe('05 JAN');
    expect(formatarData('2026-12-31')).toBe('31 DEZ');
  });

  it('string fora do formato volta como veio, sem quebrar a tela', () => {
    expect(formatarData('')).toBe('');
    expect(formatarData('30/08/2026')).toBe('30/08/2026');
  });
});
