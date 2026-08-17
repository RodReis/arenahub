import type { Metadata } from 'next';

import { PageHeader } from '@arenahub/ui';

import { FormularioDeCadastro } from './formulario-de-cadastro';

export const metadata: Metadata = {
  title: 'Cadastrar aluno — ArenaHub',
};

export default function PaginaDeCadastro() {
  return (
    <section aria-labelledby="titulo-cadastro">
      <PageHeader
        id="titulo-cadastro"
        title="Cadastrar aluno"
        breadcrumb={<a href="/students">Voltar para a lista de alunos</a>}
      />

      <FormularioDeCadastro />
    </section>
  );
}
