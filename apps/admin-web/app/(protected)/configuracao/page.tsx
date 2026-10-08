import type { Metadata } from 'next';

import { Breadcrumb, PageHeader, ProblemDetail } from '@arenahub/ui';

import { Abas } from '../../../src/components/abas';
import { chamarApi } from '../../../lib/api/server-client';
import type { ConfiguracaoDePagamento } from '../../actions/configuracao-de-pagamento';
import { PainelDePagamento } from './pagamento/painel-de-pagamento';

export const metadata: Metadata = {
  title: 'Configuração — ArenaHub',
};

/** Sem cache: o que o operador salvou tem de aparecer no próximo carregamento. */
export const dynamic = 'force-dynamic';

/** Quem altera os dias de gerar, vencer e bloquear -- a API também exige. */
const PERMISSAO_DE_EDITAR = 'billing.settings.manage';

/** O exemplo mostra a PRÓXIMA parcela: o mês seguinte ao de hoje (`Date`, sem `Intl`). */
function mesDeReferencia(agora: Date): { ano: number; mes: number } {
  const proximo = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 1));

  return { ano: proximo.getUTCFullYear(), mes: proximo.getUTCMonth() + 1 };
}

/**
 * Configuração do tenant -- F89. Hoje só tem a aba Pagamento; o menu e as abas
 * já existem para o que vier depois não pedir outro item de menu.
 *
 * `permissions` vem do mesmo `/auth/me` que o layout usa para filtrar o menu.
 * Ler basta (`billing.read`); só `billing.settings.manage` edita.
 */
export default async function PaginaDeConfiguracao() {
  const [configuracao, perfil] = await Promise.all([
    chamarApi<ConfiguracaoDePagamento>('/api/v1/billing/settings'),
    chamarApi<{ permissions?: string[] }>('/api/v1/auth/me'),
  ]);

  const podeEditar = perfil.dados?.permissions?.includes(PERMISSAO_DE_EDITAR) ?? false;

  return (
    <section aria-labelledby="titulo-configuracao">
      <PageHeader
        id="titulo-configuracao"
        title="Configuração"
        breadcrumb={<Breadcrumb trilha={[{ rotulo: 'Administração' }, { rotulo: 'Configuração' }]} />}
      />

      <Abas
        rotulo="Seções da configuração"
        abas={[
          {
            id: 'pagamento',
            rotulo: 'Pagamento',
            conteudo:
              configuracao.ok && configuracao.dados ? (
                <PainelDePagamento
                  inicial={configuracao.dados}
                  referencia={mesDeReferencia(new Date())}
                  podeEditar={podeEditar}
                />
              ) : (
                <ProblemDetail
                  testId="erro-da-config-de-pagamento"
                  problem={{
                    ...(configuracao.erro ?? {
                      type: 'about:blank',
                      status: 0,
                      code: 'erro',
                      correlationId: '',
                    }),
                    title: `Não foi possível carregar a configuração de pagamento (${configuracao.erro?.code ?? 'erro'}).`,
                  }}
                />
              ),
          },
        ]}
      />
    </section>
  );
}
