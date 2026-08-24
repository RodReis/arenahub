import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FormularioDeCadastro } from './formulario-de-cadastro';

/**
 * A Server Action fala com `chamarApi`, que e `server-only`. Nenhum teste
 * aqui completa um envio de verdade -- o mock existe so para o modulo
 * carregar em `jsdom` (mesmo padrao de `envio-de-laudos.test.tsx`).
 */
vi.mock('../../../actions/students', () => ({
  cadastrarAluno: vi.fn(),
}));

const UNIDADES = [{ id: 'unidade-1', code: 'U1', name: 'Unidade Centro' }];

function renderizar() {
  return render(
    <ToastProvider>
      <FormularioDeCadastro unidades={UNIDADES} />
    </ToastProvider>,
  );
}

/**
 * O caminho de codigo-fonte deste teste, e nao do componente compilado: a
 * guarda estrutural le o `.tsx` como texto, entao ela testa exatamente o
 * arquivo que o navegador vai executar.
 */
const CAMINHO_DO_COMPONENTE = join(
  process.cwd(),
  'app/(protected)/students/novo/formulario-de-cadastro.tsx',
);

/**
 * Guarda estrutural: nenhum campo usa `required` nativo -- CLAUDE.md pede,
 * porque o campo obrigatorio dentro de um passo escondido com `hidden` faz o
 * navegador barrar o envio, tentar focar o campo, falhar porque ele esta
 * inacessivel, e desistir em silencio (ver comentario no proprio componente).
 *
 * O ARQUIVO FALA SOBRE `required` EM PROSA -- os comentarios explicam por que
 * o atributo NAO e usado, entao a palavra aparece varias vezes fora de JSX.
 * Por isso a guarda remove comentario de linha e de bloco antes de procurar,
 * e so entao busca o padrao de ATRIBUTO JSX: `required` colado a um espaco,
 * `=` ou fechamento de tag -- nunca dentro de crase de comentario, que ja foi
 * removido. `aria-required` sobrevive porque o `\b` exige fronteira de
 * palavra e o hifen nao conta como fronteira antes de `required`.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('formulario de cadastro -- guarda estrutural', () => {
  it('nenhum campo usa o atributo required nativo', () => {
    const fonte = semComentarios(readFileSync(CAMINHO_DO_COMPONENTE, 'utf-8'));

    const usaRequiredNativo = /(?<![\w-])required\b/.test(fonte);

    expect(usaRequiredNativo).toBe(false);
  });
});

/**
 * Validacao em JS + navegacao ate o passo do campo pendente -- o
 * comportamento que a regressao original quebrava. Nome, nascimento e CPF
 * moram no passo 1 (indice 0); unidade mora no passo 3 (indice 2).
 */
describe('formulario de cadastro -- validacao leva ao passo certo', () => {
  it('barra o envio com CPF vazio e volta ao passo 1, avisando', async () => {
    const user = userEvent.setup();
    renderizar();

    // Preenche nome e nascimento, mas NAO o CPF -- o obrigatorio sob teste.
    await user.type(screen.getByTestId('campo-fullName'), 'Aluno de Teste');
    await user.type(screen.getByTestId('campo-birthDate'), '2000-01-01');

    // Avanca ate o ultimo passo, onde fica o botao de envio.
    await user.click(screen.getByTestId('avancar-passo'));
    await user.click(screen.getByTestId('avancar-passo'));
    await user.click(screen.getByTestId('avancar-passo'));

    await user.click(screen.getByTestId('confirmar-cadastro'));

    // A tela VOLTOU ao passo 1, onde o CPF mora -- nao ficou parada no 4.
    expect(screen.getByTestId('ir-para-passo-1')).toHaveAttribute('aria-current', 'step');

    expect(await screen.findByText(/informe o cpf/i)).toBeInTheDocument();
  });

  it('barra o envio sem unidade e vai ao passo 3, avisando', async () => {
    const user = userEvent.setup();
    renderizar();

    await user.type(screen.getByTestId('campo-fullName'), 'Aluno de Teste');
    await user.type(screen.getByTestId('campo-birthDate'), '2000-01-01');
    await user.type(screen.getByTestId('campo-cpf'), '11144477735');

    await user.click(screen.getByTestId('avancar-passo'));
    await user.click(screen.getByTestId('avancar-passo'));
    await user.click(screen.getByTestId('avancar-passo'));

    await user.click(screen.getByTestId('confirmar-cadastro'));

    // A unidade mora no passo 3 (indice 2) -- a tela tem de ir ate la, nao
    // ficar no passo 4 onde o botao foi clicado.
    expect(screen.getByTestId('ir-para-passo-3')).toHaveAttribute('aria-current', 'step');

    expect(await screen.findByText(/informe a unidade/i)).toBeInTheDocument();
  });
});
