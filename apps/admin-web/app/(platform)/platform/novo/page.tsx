import type { Metadata } from 'next';

import { PageHeader } from '@arenahub/ui';

import { FormularioDeTenant } from './formulario-de-tenant';

export const metadata: Metadata = {
  title: 'Novo cliente — ArenaHub',
};

/**
 * Cadastro de cliente.
 *
 * Sem `chamarApi` aqui: o formulário não depende de nenhuma lista vinda do
 * servidor -- a lista de fusos é fechada no cliente e o resto é entrada direta.
 */
export default function PaginaDeNovoCliente() {
  return (
    <section aria-labelledby="titulo-nova-academia">
      <PageHeader
        id="titulo-nova-academia"
        title="Novo cliente"
        breadcrumb={<a href="/platform">Plataforma · Clientes</a>}
      />

      <FormularioDeTenant />
    </section>
  );
}
