import type { Metadata } from 'next';

import { PageHeader } from '@arenahub/ui';

import { chamarApi } from '../../../../../lib/api/server-client';
import { FormularioDeEdgeNode } from './formulario-de-edge-node';

export const metadata: Metadata = {
  title: 'Novo Edge — ArenaHub',
};

interface Unidade {
  id: string;
  name: string;
  status: string;
  /**
   * O fuso vem da UNIDADE, nunca do navegador (DS §11, regra 5) — é ele que
   * o formulário usa para mostrar a validade do código de pareamento.
   */
  timezone: string;
}

/**
 * Cadastro de Edge (issue #404).
 *
 * Server Component pelo mesmo motivo do cadastro de dispositivo: a unidade é
 * obrigatória e carregá-la depois da hidratação deixaria o formulário
 * momentaneamente impossível de enviar, sem nada na tela explicando por quê.
 */
export default async function PaginaDeNovoEdgeNode() {
  const unidades = await chamarApi<Unidade[]>('/api/v1/units');

  // Unidade inativa não recebe Edge novo — mesma regra do dispositivo.
  const disponiveis = (unidades.dados ?? []).filter((unidade) => unidade.status === 'ACTIVE');

  return (
    <section aria-labelledby="titulo-novo-edge-node">
      <PageHeader
        id="titulo-novo-edge-node"
        title="Novo Edge"
        breadcrumb={<a href="/operations">Administração · Operação</a>}
      />

      <FormularioDeEdgeNode unidades={disponiveis} />
    </section>
  );
}
