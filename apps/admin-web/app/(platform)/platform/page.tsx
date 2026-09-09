import type { Metadata } from 'next';

import {
  Button,
  DataTable,
  EmptyState,
  EstadoSimples,
  Identidade,
  PageHeader,
  ProblemDetail,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';

export const metadata: Metadata = {
  title: 'Academias — ArenaHub',
};

/** O que `GET /api/v1/platform/tenants` devolve — DTO de painel, não a tabela. */
interface TenantNaLista {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  unidades: number;
}

/**
 * Situação da academia em três canais (ponto, ícone, rótulo).
 *
 * `EstadoSimples` e não `StateBadge`: o §7 do DS-PAINEL define as máquinas de
 * estado canônicas e NENHUMA delas é de tenant. Inventar `machine="tenant"` no
 * dicionário seria decisão de produto, e ela não é minha.
 *
 * `SUSPENDED` é escrito pela inadimplência (F65), nunca por este CRUD, e por
 * isso tem tom próprio: quem olha a lista precisa distinguir "o dono desligou"
 * de "parou de pagar" -- a primeira se resolve aqui, a segunda não.
 */
function situacao(status: string) {
  if (status === 'ACTIVE') return <EstadoSimples label="Ativa" tom="positivo" />;
  if (status === 'SUSPENDED') return <EstadoSimples label="Suspensa" tom="atencao" />;

  return <EstadoSimples label="Inativa" tom="neutro" />;
}

/**
 * Lista de academias — a superfície do dono do SaaS.
 *
 * Server Component: a lista é buscada no servidor e chega pronta, sem token
 * exposto ao navegador.
 */
export default async function PaginaDePlataforma() {
  const resposta = await chamarApi<TenantNaLista[]>('/api/v1/platform/tenants');

  if (!resposta.ok) {
    /*
     * Negação explícita, com o código estável visível. Tela vazia deixaria
     * quem abriu sem saber se não há academia ou se este perfil não administra
     * a plataforma -- e são coisas que se resolvem de modos opostos.
     */
    return (
      <section aria-labelledby="titulo-plataforma">
        <PageHeader id="titulo-plataforma" title="Academias" />
        <ProblemDetail
          testId="erro-de-plataforma"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para administrar a plataforma (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const tenants = resposta.dados ?? [];

  return (
    <section aria-labelledby="titulo-plataforma">
      <PageHeader
        id="titulo-plataforma"
        title="Academias"
        breadcrumb={<span>Plataforma</span>}
        actions={
          <Button href="/platform/novo" data-testid="nova-academia">
            Nova academia
          </Button>
        }
      />

      <DataTable
        testId="tabela-de-academias"
        rows={tenants}
        rowKey={(tenant) => tenant.id}
        caption="Academias atendidas pela plataforma"
        columns={[
          {
            key: 'nome',
            header: 'Academia',
            role: 'identity',
            /*
             * `semAvatar`: academia é uma ORGANIZAÇÃO, não uma pessoa. A
             * inicial num círculo daria a cada linha um rosto que ela não tem.
             */
            render: (t) => <Identidade semAvatar nome={t.displayName} />,
          },
          /*
           * `code` e não `support`: o slug é identificador de URL, se lê
           * caractere a caractere e não é frase da API.
           */
          { key: 'slug', header: 'Identificador', role: 'code', render: (t) => t.slug },
          {
            key: 'unidades',
            header: 'Unidades',
            role: 'value',
            render: (t) => t.unidades,
          },
          { key: 'situacao', header: 'Situação', role: 'state', render: (t) => situacao(t.status) },
        ]}
        empty={
          <EmptyState
            testId="lista-vazia"
            title="Nenhuma academia cadastrada ainda."
            hint="Cadastre a primeira academia para o dono dela receber o convite de acesso."
            action={
              <Button href="/platform/novo" data-testid="nova-academia-vazio">
                Cadastrar academia
              </Button>
            }
          />
        }
      />
    </section>
  );
}
