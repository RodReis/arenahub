import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SeletorDeMedicao, type MedicaoDisponivel } from './seletor-de-medicao';

/**
 * Testes do seletor de medição.
 *
 * O caso que motivou este arquivo apareceu ao vivo, não em teste: quatro
 * medições do mesmo aluno renderizaram o rótulo `21/08/2026` quatro vezes,
 * indistinguíveis. Escolher no seletor virava chute.
 */

const FUSO = 'America/Sao_Paulo';

function medicao(
  sessionId: string,
  assessedAt: string,
  published = true,
): MedicaoDisponivel {
  return { sessionId, assessedAt, published };
}

describe('seletor de medição', () => {
  it('lista uma entrada por medição, com a ativa marcada', () => {
    render(
      <SeletorDeMedicao
        studentId="aluno-1"
        medicoes={[
          medicao('s1', '2026-08-03T10:47:00.000Z'),
          medicao('s2', '2026-04-30T08:24:00.000Z'),
        ]}
        atual="s1"
        timeZone={FUSO}
      />,
    );

    expect(screen.getByTestId('medicao-s1')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('medicao-s2')).not.toHaveAttribute('aria-current');
    // Link de verdade, com a medição na query -- compartilhável e com voltar
    // funcionando, como o filtro de período ao lado.
    expect(screen.getByTestId('medicao-s2')).toHaveAttribute(
      'href',
      '/students/aluno-1/health?medicao=s2',
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  /**
   * O BUG QUE ESTE ARQUIVO EXISTE PARA IMPEDIR.
   *
   * Importar oito medições históricas no mesmo dia produz oito entradas com
   * a mesma data. Sem desempate, o seletor lista opções idênticas.
   */
  it('desempata datas repetidas com a hora', () => {
    render(
      <SeletorDeMedicao
        studentId="aluno-1"
        medicoes={[
          medicao('s1', '2026-08-21T23:47:13.000Z'),
          medicao('s2', '2026-08-21T23:21:48.000Z'),
        ]}
        atual="s1"
        timeZone="UTC"
      />,
    );

    const primeira = screen.getByTestId('medicao-s1').textContent ?? '';
    const segunda = screen.getByTestId('medicao-s2').textContent ?? '';

    expect(primeira).not.toEqual(segunda);
    // A hora entra JUSTAMENTE porque o dia empata.
    expect(primeira).toMatch(/23:47/);
    expect(segunda).toMatch(/23:21/);
  });

  /** Data única não ganha hora -- é o que se reconhece de relance. */
  it('data sem empate fica limpa, sem hora', () => {
    render(
      <SeletorDeMedicao
        studentId="aluno-1"
        medicoes={[
          medicao('s1', '2026-08-03T10:47:00.000Z'),
          medicao('s2', '2026-04-30T08:24:00.000Z'),
        ]}
        atual="s1"
        timeZone="UTC"
      />,
    );

    expect(screen.getByTestId('medicao-s1').textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  /**
   * Sessão não publicada traz a data do UPLOAD, não a da medição. Exibi-la
   * sem marca a faria passar por data de medição na mesma fila.
   */
  it('marca a sessão que ainda não virou avaliação', () => {
    render(
      <SeletorDeMedicao
        studentId="aluno-1"
        medicoes={[
          medicao('s1', '2026-08-03T10:47:00.000Z', true),
          medicao('s2', '2026-04-30T08:24:00.000Z', false),
        ]}
        atual="s1"
        timeZone={FUSO}
      />,
    );

    expect(screen.getByTestId('medicao-s2')).toHaveTextContent(/envio/);
    expect(screen.getByTestId('medicao-s1')).not.toHaveTextContent(/envio/);
    expect(screen.getByTestId('medicao-s2').getAttribute('title')).toMatch(
      /ainda não publicada/,
    );
  });

  /**
   * Uma medição só não é ESCOLHA -- mas o atalho de envio continua valendo.
   *
   * Antes o componente sumia inteiro, e com ele o único caminho visível para
   * anexar a próxima medição: quem tinha uma avaliação só precisava rolar a
   * página toda até o formulário no rodapé.
   */
  it('com uma medição só, esconde a lista mas mantém o atalho de envio', () => {
    render(
      <SeletorDeMedicao
        studentId="aluno-1"
        medicoes={[medicao('s1', '2026-08-03T10:47:00.000Z')]}
        atual="s1"
        timeZone={FUSO}
      />,
    );

    expect(screen.getByTestId('ir-para-envio')).toBeInTheDocument();
    // A fila de datas não aparece: uma data sozinha não é escolha.
    expect(screen.queryByTestId('medicao-s1')).not.toBeInTheDocument();
  });

  /**
   * O atalho é ÂNCORA, não botão de ação: o formulário existe uma vez só, no
   * rodapé. Se isto virar `<button>`, a tela passou a exigir JavaScript para
   * uma navegação que o `<a>` faz de graça.
   */
  it('o atalho de envio é uma âncora para o formulário', () => {
    render(
      <SeletorDeMedicao
        studentId="aluno-1"
        medicoes={[
          medicao('s1', '2026-08-03T10:47:00.000Z'),
          medicao('s2', '2026-04-30T08:24:00.000Z'),
        ]}
        atual="s1"
        timeZone={FUSO}
      />,
    );

    expect(screen.getByTestId('ir-para-envio')).toHaveAttribute('href', '#enviar-laudos');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
