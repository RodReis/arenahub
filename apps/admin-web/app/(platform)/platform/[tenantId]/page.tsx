import type { Metadata } from 'next';

import { Button, PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { ArquivosDaMarca } from './arquivos-da-marca';
import { ElevarTenant } from './elevar-tenant';
import { FormularioDeEdicao } from './formulario-de-edicao';
import { SituacaoDoTenant } from './situacao-do-tenant';

export const metadata: Metadata = {
  title: 'Academia — ArenaHub',
};

/**
 * O que `GET /api/v1/platform/tenants/:id` devolve.
 *
 * Carrega o que a LISTA omite — `cnpj`, `timezone` e o responsável —, porque é
 * ele que alimenta o formulário de edição. Alimentá-lo pela lista faria os
 * campos nascerem em branco, e salvar apagaria dado que ninguém pediu para
 * apagar.
 */
interface TenantEmDetalhe {
  id: string;
  slug: string;
  displayName: string;
  legalName: string;
  cnpj: string | null;
  timezone: string | null;
  responsavelNome: string | null;
  responsavelEmail: string | null;
  status: string;
  unidades: number;
  /*
   * Identidade visual (F62). Os textos vêm inteiros porque alimentam campos de
   * edição; dos ARQUIVOS vem só o booleano -- a chave do objeto é caminho
   * interno do bucket, e a pré-visualização usa a rota pública.
   */
  missionText: string | null;
  highlightsText: string | null;
  temLogo: boolean;
  temIcone: boolean;
}

/**
 * Detalhe da academia — a tela onde o dono do SaaS edita, liga/desliga e entra
 * como suporte.
 *
 * Server Component: os dados chegam prontos do servidor, e cada um dos três
 * blocos é um Client Component próprio com sua Server Action. Um formulário só
 * misturaria três atos de peso muito diferente — corrigir um CNPJ, desligar
 * uma academia e entrar no tenant do cliente não podem compartilhar o mesmo
 * botão "Salvar".
 */
export default async function PaginaDaAcademia({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const resposta = await chamarApi<TenantEmDetalhe>(
    `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}`,
  );

  if (!resposta.ok || !resposta.dados) {
    /*
     * Negação explícita com o código estável visível. Tela vazia deixaria quem
     * abriu sem saber se a academia sumiu ou se este perfil não administra a
     * plataforma — e são coisas que se resolvem de modos opostos.
     */
    return (
      <section aria-labelledby="titulo-da-academia">
        <PageHeader id="titulo-da-academia" title="Academia" />
        <ProblemDetail
          testId="erro-da-academia"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível abrir esta academia (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const tenant = resposta.dados;

  return (
    <section aria-labelledby="titulo-da-academia">
      <PageHeader
        id="titulo-da-academia"
        title={tenant.displayName}
        breadcrumb={<a href="/platform">Plataforma · Academias</a>}
        actions={
          /*
            LINKS para contratos e faturas, e não mais dois blocos nesta tela:
            são os dois atos mais pesados da academia -- fechar um contrato é
            irreversível, e registrar um pagamento afirma que o dinheiro
            entrou --, e cada um merece uma tela onde seja o único assunto.
            Esta já tem quatro blocos.
          */
          <>
            <Button href={`/platform/${tenant.id}/contratos`} data-testid="ver-contratos">
              Contratos
            </Button>
            <Button href={`/platform/${tenant.id}/faturas`} data-testid="ver-faturas">
              Faturas
            </Button>
          </>
        }
      />

      <FormularioDeEdicao
        tenantId={tenant.id}
        slug={tenant.slug}
        displayName={tenant.displayName}
        legalName={tenant.legalName}
        cnpj={tenant.cnpj ?? ''}
        timezone={tenant.timezone ?? 'America/Sao_Paulo'}
        responsavelNome={tenant.responsavelNome ?? ''}
        responsavelEmail={tenant.responsavelEmail ?? ''}
        missionText={tenant.missionText ?? ''}
        highlightsText={tenant.highlightsText ?? ''}
      />

      <ArquivosDaMarca
        tenantId={tenant.id}
        slug={tenant.slug}
        temLogo={tenant.temLogo}
        temIcone={tenant.temIcone}
      />

      <SituacaoDoTenant tenantId={tenant.id} status={tenant.status} />

      <ElevarTenant tenantId={tenant.id} displayName={tenant.displayName} />
    </section>
  );
}
