import type { Metadata } from 'next';

import { PageHeader } from '@arenahub/ui';

import { chamarApi } from '../../../../../lib/api/server-client';
import { FormularioDeDispositivo } from './formulario-de-dispositivo';

export const metadata: Metadata = {
  title: 'Novo dispositivo — ArenaHub',
};

interface Unidade {
  id: string;
  name: string;
  status: string;
}

/**
 * Cadastro de dispositivo.
 *
 * Server Component: as unidades vêm daqui, não de um `useEffect`. A unidade
 * é obrigatória — todo leitor pertence a uma —, e carregá-la depois da
 * hidratação deixaria o formulário momentaneamente impossível de enviar sem
 * nada na tela explicando por quê.
 */
export default async function PaginaDeNovoDispositivo() {
  const unidades = await chamarApi<Unidade[]>('/api/v1/units');

  // Unidade inativa não recebe equipamento novo: a academia fechou aquela
  // porta. O que já está instalado nela continua onde está.
  const disponiveis = (unidades.dados ?? []).filter((unidade) => unidade.status === 'ACTIVE');

  return (
    <section aria-labelledby="titulo-novo-dispositivo">
      <PageHeader
        id="titulo-novo-dispositivo"
        title="Novo dispositivo"
        breadcrumb={<a href="/operations/devices">Administração · Dispositivos</a>}
      />

      <FormularioDeDispositivo unidades={disponiveis} />
    </section>
  );
}
