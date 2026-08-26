import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG_PADRAO_DO_TOTEM,
  ROTULO_PADRAO_DE_PATROCINIO,
  type BlocoDaTelaPublica,
  type KioskConfig,
} from '@arenahub/api-contracts';

import { BlocosPublicos, formatarData } from './blocos-publicos.js';

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

describe('BlocosPublicos -- rodizio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sem bloco ligado nao renderiza cartao nenhum -- a tela nao quebra (§4)', () => {
    render(<BlocosPublicos config={CONFIG_PADRAO_DO_TOTEM} indicadores={null} />);

    expect(screen.queryByTestId('bloco-em-exibicao')).toBeNull();
  });

  it('exibe UM bloco por vez, e troca no tempo configurado', () => {
    render(<BlocosPublicos config={config([instagram, material])} indicadores={null} />);

    expect(screen.getByTestId('bloco-em-exibicao')).toHaveAttribute('data-tipo', 'INSTAGRAM');

    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    expect(screen.getByTestId('bloco-em-exibicao')).toHaveAttribute('data-tipo', 'MATERIAL');
  });

  it('gira em circulo e volta ao primeiro', () => {
    render(<BlocosPublicos config={config([instagram, material])} indicadores={null} />);

    act(() => {
      vi.advanceTimersByTime(24_000);
    });

    expect(screen.getByTestId('bloco-em-exibicao')).toHaveAttribute('data-tipo', 'INSTAGRAM');
  });

  it('respeita o tempo configurado -- 8 s troca antes de 12', () => {
    render(
      <BlocosPublicos
        config={{
          ...config([instagram, material]),
          blocos: { tempoPorBlocoSegundos: 8, itens: [instagram, material] },
        }}
        indicadores={null}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(8_000);
    });

    expect(screen.getByTestId('bloco-em-exibicao')).toHaveAttribute('data-tipo', 'MATERIAL');
  });

  it('bloco unico nao gira -- e nao mostra pontos de rodizio', () => {
    render(<BlocosPublicos config={config([instagram])} indicadores={null} />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByTestId('bloco-em-exibicao')).toHaveAttribute('data-tipo', 'INSTAGRAM');
  });

  it('video SEM url resolvida nao entra no rodizio', () => {
    const video: BlocoDaTelaPublica = {
      id: 'v',
      habilitado: true,
      tipo: 'VIDEO',
      titulo: 'Equipe',
      legenda: 'Conheça',
      midiaKey: 'tenants/t/kiosk-media/u/a.mp4',
      linkExterno: null,
      midiaUrl: null,
    };

    render(<BlocosPublicos config={config([video, instagram])} indicadores={null} />);

    // Sem o filtro, a recepcao veria 12 segundos de quadrado preto.
    expect(screen.getByTestId('bloco-em-exibicao')).toHaveAttribute('data-tipo', 'INSTAGRAM');
    expect(screen.queryByTestId('video-do-bloco')).toBeNull();
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
        indicadores={{ checkinsDeHoje: 312, treinandoAgora: 47 }}
      />,
    );

    expect(screen.getByText('312')).toBeInTheDocument();
    expect(screen.getByText('47')).toBeInTheDocument();
  });

  it('indicador desligado nao aparece, mesmo com numero disponivel', () => {
    render(
      <BlocosPublicos
        config={config([{ ...informacoes, mostrarTreinandoAgora: false }])}
        indicadores={{ checkinsDeHoje: 312, treinandoAgora: 47 }}
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

  it('fica FORA do rodizio -- continua na tela depois de o bloco trocar', () => {
    vi.useFakeTimers();

    render(
      <BlocosPublicos config={config([instagram, material], { patrocinio })} indicadores={null} />,
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
