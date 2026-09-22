import type { Metadata } from 'next';

import { Button, EstadoSimples, PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import estilos from './cliente.module.css';
import { AbasDoCliente } from './abas-do-cliente';

export const metadata: Metadata = {
  title: 'Cliente — ArenaHub',
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
 * O que `GET /api/v1/platform/tenants/:id/admin` devolve — F79.
 *
 * Forma FIXA com `null` explícito: `desde` só existe no estado ATIVO e
 * `expiraEm` só nos dois de convite, mas a linha é sempre a mesma.
 */
interface AcessoDoAdminEmDetalhe {
  estado: 'ATIVO' | 'PENDENTE' | 'VENCIDO' | 'SEM_CONVITE';
  email: string | null;
  desde: string | null;
  expiraEm: string | null;
}

/** A situação do cliente, em três canais — o mesmo vocabulário da lista. */
function situacao(status: string) {
  if (status === 'ACTIVE') return <EstadoSimples label="Ativo" tom="positivo" />;
  if (status === 'SUSPENDED') return <EstadoSimples label="Suspenso" tom="atencao" />;

  return <EstadoSimples label="Inativo" tom="neutro" />;
}

/**
 * Detalhe do cliente — a tela onde o dono do SaaS edita, liga/desliga e entra
 * como suporte.
 *
 * Server Component: os dados chegam prontos do servidor, e cada uma das quatro
 * seções é um Client Component próprio com sua Server Action. Um formulário só
 * misturaria atos de peso muito diferente — corrigir um CNPJ, desligar um
 * cliente e entrar no tenant dele não podem compartilhar o mesmo botão
 * "Salvar".
 *
 * AS SEÇÕES VIRARAM ABAS na F68. Empilhadas, elas produziam uma página de
 * rolagem longa em que a ação destrutiva ficava no caminho de quem só queria
 * conferir um dado — e longe demais de quem realmente a procurava.
 */
export default async function PaginaDoCliente({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  /*
   * AS DUAS EM PARALELO, e não uma depois da outra: são independentes, e
   * encadeá-las somaria as latências para mostrar a mesma tela.
   */
  const [resposta, acesso] = await Promise.all([
    chamarApi<TenantEmDetalhe>(`/api/v1/platform/tenants/${encodeURIComponent(tenantId)}`),
    chamarApi<AcessoDoAdminEmDetalhe>(
      `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/admin`,
    ),
  ]);

  if (!resposta.ok || !resposta.dados) {
    /*
     * Negação explícita com o código estável visível. Tela vazia deixaria quem
     * abriu sem saber se o cliente sumiu ou se este perfil não administra a
     * plataforma — e são coisas que se resolvem de modos opostos.
     */
    return (
      <section aria-labelledby="titulo-da-academia">
        <PageHeader id="titulo-da-academia" title="Cliente" />
        <ProblemDetail
          testId="erro-da-academia"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível abrir este cliente (${resposta.erro?.code ?? 'erro'}).`,
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
        breadcrumb={
          <span>
            <a href="/platform">Plataforma · Clientes</a>
          </span>
        }
        actions={
          /*
            LINKS para contratos e faturas: são os dois atos mais pesados do
            cliente -- fechar um contrato é irreversível, e registrar um
            pagamento afirma que o dinheiro entrou --, e cada um merece uma tela
            onde seja o único assunto.

            AQUI E TAMBÉM NO MENU DA LISTA, e a duplicação é deliberada: da
            lista se alcança o contrato de qualquer cliente sem abrir nenhum;
            daqui se alcança o do cliente que já está aberto. Tirar um dos dois
            caminhos obrigaria a voltar para usar o outro.
          */
          <>
            <Button
              href={`/platform/${tenant.id}/contratos`}
              variant="outline"
              data-testid="ver-contratos"
            >
              Contratos
            </Button>
            <Button
              href={`/platform/${tenant.id}/faturas`}
              variant="outline"
              data-testid="ver-faturas"
            >
              Faturas
            </Button>
          </>
        }
      />

      {/*
        A IDENTIDADE DO CLIENTE fica acima das abas, e não dentro de uma delas:
        identificador e situação valem para as quatro seções, e repeti-los em
        cada uma seria pior do que tirá-los da aba onde estavam. Quem entra na
        aba de marca continua sabendo de qual cliente é o logo que vai subir.
      */}
      <p className={estilos['identidade']}>
        <span className={estilos['slug']} data-testid="slug-da-academia">
          {tenant.slug}
        </span>
        <span className={estilos['ponto']} aria-hidden="true">
          ·
        </span>
        <span>
          {tenant.unidades} {tenant.unidades === 1 ? 'unidade' : 'unidades'}
        </span>
        <span className={estilos['ponto']} aria-hidden="true">
          ·
        </span>
        <span data-testid="situacao-do-cliente">{situacao(tenant.status)}</span>
      </p>

      <AbasDoCliente
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
        temLogo={tenant.temLogo}
        temIcone={tenant.temIcone}
        status={tenant.status}
        /*
          A CONSULTA DO ACESSO PODE FALHAR SEM DERRUBAR A TELA: ela é a quinta
          aba, não o assunto da página. Cair aqui faria um cliente inteiro
          deixar de abrir por causa de uma aba — `SEM_CONVITE` é o estado que
          não promete nada e oferece o único ato que sempre vale.
        */
        acessoDoAdmin={
          acesso.ok && acesso.dados
            ? acesso.dados
            : { estado: 'SEM_CONVITE', email: null, desde: null, expiraEm: null }
        }
      />
    </section>
  );
}
