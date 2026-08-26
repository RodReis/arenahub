import type { Metadata } from 'next';

import { Ausente, Button, DataTable, EmptyState, PageHeader, TenantDateTime } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';

export const metadata: Metadata = {
  title: 'Personalização do totem — ArenaHub',
};

interface Totem {
  id: string;
  code: string;
  gymUnitId: string;
  lastHeartbeat: string | null;
  bootConfigVersion: number | null;
}

/*
 * Fuso FIXO -- mesmo motivo do `operations/devices/page.tsx`: a rota devolve
 * `gymUnitId`, nao o fuso da unidade. Cruzar com `/units` e chamada nova, e
 * esta fatia so muda a personalizacao do totem.
 */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

/**
 * Lista de totens -- F50, painel do gerente.
 *
 * Server Component: a lista chega pronta, sem token no navegador. Cada linha
 * leva a tela de configuracao (`[id]/page.tsx`) do proprio totem.
 */
export default async function PaginaDeTotens() {
  const resposta = await chamarApi<Totem[]>('/api/v1/admin/kiosk-devices');

  const totens = resposta.dados ?? [];

  return (
    <section aria-labelledby="titulo-totens">
      <PageHeader id="titulo-totens" title="Personalização do totem" breadcrumb={<span>Administração</span>} />

      <DataTable
        testId="tabela-de-totens"
        rows={totens}
        rowKey={(totem) => totem.id}
        rowTestId={(totem) => `totem-${totem.id}`}
        caption="Totens cadastrados nesta academia"
        columns={[
          { key: 'codigo', header: 'Totem', role: 'identity', render: (t) => t.code },
          {
            key: 'contato',
            role: 'moment',
            header: 'Último contato',
            render: (t) => <TenantDateTime iso={t.lastHeartbeat} timeZone={FUSO_PROVISORIO} />,
          },
          {
            key: 'versao',
            role: 'value',
            header: 'Versão de boot',
            render: (t) => (t.bootConfigVersion === null ? <Ausente /> : t.bootConfigVersion),
          },
          {
            key: 'acao',
            role: 'actions',
            header: '',
            render: (t) => (
              <Button href={`/operations/kiosks/${t.id}`} data-testid={`configurar-${t.id}`}>
                Configurar
              </Button>
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="sem-totem"
            title="Nenhum totem cadastrado."
            hint="O totem precisa estar cadastrado como dispositivo para receber a personalização."
          />
        }
      />
    </section>
  );
}
