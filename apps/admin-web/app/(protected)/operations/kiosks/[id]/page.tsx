import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../../lib/api/server-client';
import { FormularioDeConfiguracao, type EstadoDaConfiguracao } from './formulario-de-configuracao';

export const metadata: Metadata = {
  title: 'Personalização do totem — ArenaHub',
};

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Configuração de um totem -- F50.
 *
 * Server Component: o estado (publicada/rascunho/efetiva) chega pronto do
 * servidor a cada carga -- as Server Actions revalidam esta rota depois de
 * salvar, publicar ou descartar.
 */
export default async function PaginaDeConfiguracaoDoTotem({ params }: Props) {
  const { id } = await params;

  const resposta = await chamarApi<EstadoDaConfiguracao>(
    `/api/v1/admin/kiosk-devices/${id}/config`,
  );

  if (!resposta.ok) {
    if (resposta.erro?.status === 404) notFound();

    return (
      <section aria-labelledby="titulo-configuracao-totem">
        <PageHeader
          id="titulo-configuracao-totem"
          title="Personalização do totem"
          breadcrumb={<a href="/operations/kiosks">Administração · Totens</a>}
        />
        <ProblemDetail
          testId="erro-de-configuracao-do-totem"
          problem={
            resposta.erro ?? {
              type: 'about:blank',
              title: 'Erro inesperado',
              status: 0,
              code: 'erro',
              correlationId: '',
            }
          }
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="titulo-configuracao-totem">
      <PageHeader
        id="titulo-configuracao-totem"
        title="Personalização do totem"
        breadcrumb={<a href="/operations/kiosks">Administração · Totens</a>}
      />

      <FormularioDeConfiguracao estado={resposta.dados as EstadoDaConfiguracao} kioskDeviceId={id} />
    </section>
  );
}
