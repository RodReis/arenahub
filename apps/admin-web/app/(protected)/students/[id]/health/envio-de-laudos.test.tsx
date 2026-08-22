import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { EnvioDeLaudos } from './envio-de-laudos';

/**
 * A Server Action fala com `chamarApi`, que é `server-only`. Nenhum teste
 * aqui submete o formulário — o mock existe só para o módulo carregar em
 * `jsdom`.
 */
vi.mock('../../../../actions/assessment-imports', () => ({
  enviarArquivos: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function renderizar() {
  return render(
    <ToastProvider>
      <EnvioDeLaudos studentId="aluno-1" />
    </ToastProvider>,
  );
}

/**
 * UM CAMPO POR LAUDO — a correção que destravou a publicação automática.
 *
 * O OCR de imagem devolve `BIOIMPEDANCE` para toda foto, então balança e app
 * de análise chegavam à API indistinguíveis e a precedência do ADR-041 não
 * tinha em que se apoiar: a primeira medição real morreu com `mais de um
 * valor aceito para BODY_FAT_MASS`.
 *
 * Se estes testes voltarem a passar com um campo só, o bug voltou.
 */
describe('envio de laudos — um campo por tipo', () => {
  it('oferece os três campos, cada um com seu tipo declarado', () => {
    renderizar();

    expect(screen.getByTestId('seletor-laudo-balanca')).toHaveAttribute(
      'name',
      'arquivo-BIOIMPEDANCE',
    );
    expect(screen.getByTestId('seletor-laudo-analise')).toHaveAttribute(
      'name',
      'arquivo-BIOIMPEDANCE_ANALYSIS',
    );
    expect(screen.getByTestId('seletor-laudo-ecg')).toHaveAttribute('name', 'arquivo-ECG');
  });

  /**
   * A miniatura é o que faz a recepção acertar o campo sem ler rótulo. Sem
   * ela, "Relatório de medição" e "Análise de composição" são dois títulos
   * parecidos para dois papéis coloridos parecidos.
   */
  it('mostra a miniatura de exemplo de cada laudo', () => {
    const { container } = renderizar();

    const exemplos = container.querySelectorAll('img[src^="/exemplos-de-laudo/"]');
    expect(exemplos).toHaveLength(3);
  });

  /**
   * A miniatura é decorativa: o título e o aparelho ao lado já dizem o que
   * ela mostra. `alt` preenchido faria o leitor de tela repetir a mesma
   * informação três vezes por campo.
   */
  it('a miniatura não polui o leitor de tela', () => {
    renderizar();

    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('marca só a balança como obrigatória', () => {
    renderizar();

    // O selo vive DENTRO do título do laudo -- procurar "obrigatório" solto
    // acha também a mensagem do botão bloqueado, que fala a mesma palavra.
    expect(screen.getByTestId('campo-laudo-balanca')).toHaveTextContent(/·\s*obrigatório/i);
    expect(screen.getByTestId('campo-laudo-analise')).not.toHaveTextContent(/obrigatório/i);
    expect(screen.getByTestId('campo-laudo-ecg')).not.toHaveTextContent(/obrigatório/i);
  });

  /**
   * Botão desabilitado sem explicação é beco sem saída — e aqui o motivo
   * não é óbvio: quem escolheu o ECG e a análise acha que já mandou tudo.
   */
  it('bloqueia o envio sem a balança, dizendo o motivo', () => {
    renderizar();

    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
    expect(screen.getByTestId('motivo-envio-bloqueado')).toHaveTextContent(
      /balança é obrigatório/i,
    );
  });

  it('cada campo começa sem arquivo escolhido', () => {
    renderizar();

    for (const id of ['laudo-balanca', 'laudo-analise', 'laudo-ecg']) {
      expect(screen.getByTestId(`escolhido-${id}`)).toHaveTextContent('Nenhum arquivo');
    }
  });

  /**
   * O input nativo escreve "Choose File" em inglês e o HTML não deixa
   * traduzir — por isso ele fica escondido com um `<label>` estilizado por
   * cima. Escondê-lo com `display: none` o tiraria da navegação por teclado.
   */
  it('o seletor escondido continua alcançável pelo teclado', () => {
    renderizar();

    const seletor = screen.getByTestId('seletor-laudo-balanca');
    expect(seletor).not.toHaveAttribute('hidden');
    expect(seletor.tabIndex).not.toBe(-1);
  });
});
