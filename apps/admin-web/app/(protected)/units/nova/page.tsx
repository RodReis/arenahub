import type { Metadata } from 'next';

import { PageHeader } from '@arenahub/ui';

import { FormularioDeUnidade } from './formulario-de-unidade';

export const metadata: Metadata = {
  title: 'Nova unidade — ArenaHub',
};

/**
 * Cadastro de unidade.
 *
 * Sem `chamarApi` aqui: diferente do cadastro de aluno, este formulário não
 * depende de nenhuma lista vinda do servidor -- código, nome e fuso são
 * entrada direta, e a lista de fusos é fechada no cliente.
 */
export default function PaginaDeNovaUnidade() {
  return (
    <section aria-labelledby="titulo-nova-unidade">
      <PageHeader
        id="titulo-nova-unidade"
        title="Nova unidade"
        breadcrumb={<a href="/units">Administração · Unidades</a>}
      />

      <FormularioDeUnidade />
    </section>
  );
}
