import type { Metadata } from 'next';

import { FormularioDeCadastro } from './formulario-de-cadastro';

export const metadata: Metadata = {
  title: 'Cadastrar aluno — ArenaHub',
};

export default function PaginaDeCadastro() {
  return (
    <section aria-labelledby="titulo-cadastro">
      <h1 id="titulo-cadastro">Cadastrar aluno</h1>

      <p>
        <a href="/students">Voltar para a lista de alunos</a>
      </p>

      <FormularioDeCadastro />
    </section>
  );
}
