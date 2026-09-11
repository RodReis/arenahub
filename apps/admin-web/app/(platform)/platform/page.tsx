import type { Metadata } from 'next';

import {
  Button,
  DataTable,
  EmptyState,
  EstadoSimples,
  Identidade,
  Money,
  PageHeader,
  ProblemDetail,
  SummaryStrip,
  type CelulaDeResumo,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { AcoesDoCliente } from './acoes-do-cliente';

export const metadata: Metadata = {
  title: 'Clientes — ArenaHub',
};

/** O que `GET /api/v1/platform/tenants` devolve — DTO de painel, não a tabela. */
interface TenantNaLista {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  unidades: number;
  /*
   * A base da fatura da plataforma (F64, ADR-052 §6): ativo e `ACTIVE`,
   * inativo e todo o resto. Sao os dois numeros que o dono do SaaS multiplica
   * pelos precos do contrato -- e o inativo domina a conta na base real (66%
   * em 08/09), que e o risco que ele precisa ver da lista, sem abrir tela.
   */
  alunosAtivos: number;
  alunosInativos: number;
  /*
   * Contagem regressiva da plataforma (F65, Task 10) -- `null` explicito
   * quando o tenant nao tem fatura vencida nenhuma, nunca campo ausente: a
   * tabela tem formato de linha fixo.
   */
  cobranca: { diasRestantes: number | null; emAbertoMinor: number } | null;
}

/**
 * Situação do cliente em três canais (ponto, ícone, rótulo).
 *
 * `EstadoSimples` e não `StateBadge`: o §7 do DS-PAINEL define as máquinas de
 * estado canônicas e NENHUMA delas é de tenant. Inventar `machine="tenant"` no
 * dicionário seria decisão de produto, e ela não é minha.
 *
 * `SUSPENDED` é escrito pela inadimplência (F65), nunca por este CRUD, e por
 * isso tem tom próprio: quem olha a lista precisa distinguir "o dono desligou"
 * de "parou de pagar" -- a primeira se resolve aqui, a segunda não.
 *
 * TRÊS casos visuais (F65, Task 10) -- e não dois:
 * - `ACTIVE` sem cobrança vencida: "Ativo", como sempre foi.
 * - `ACTIVE` com cobrança vencida: contagem regressiva, tom de atenção --
 *   é o aviso que falta suspensão.
 * - `SUSPENDED`: sempre "Suspenso", NUNCA a contagem. Uma vez suspenso,
 *   `diasRestantes` fica negativo (carência esgotada há N dias) e mostrar
 *   "-3 dias" não informa nada que "Suspenso" já não diga -- e lê como um
 *   erro de sinal.
 */
function situacao(status: string, cobranca: TenantNaLista['cobranca']) {
  if (status === 'SUSPENDED') return <EstadoSimples label="Suspenso" tom="atencao" />;

  if (status === 'ACTIVE') {
    if (cobranca !== null && cobranca.diasRestantes !== null && cobranca.diasRestantes >= 0) {
      return <EstadoSimples label={`Vencida — ${cobranca.diasRestantes} dias`} tom="atencao" />;
    }

    return <EstadoSimples label="Ativo" tom="positivo" />;
  }

  return <EstadoSimples label="Inativo" tom="neutro" />;
}

/**
 * O que a carteira diz quando se olha de longe — F68.
 *
 * DERIVADO DA MESMA LISTA que a tabela mostra, sem chamada nova: os quatro
 * números já estão no DTO, e uma segunda rota para somá-los criaria duas
 * fontes que divergem no primeiro cliente cadastrado entre uma e outra.
 *
 * O TOM SÓ APARECE ONDE HÁ ESTADO. "Clientes" e "alunos na base" são fatos,
 * não notícias — pintá-los gastaria a cor que a inadimplência precisa. A
 * licença para tingir superfície vem da emenda de 01/09 do PRODUCT.md, e vale
 * aqui pelo mesmo motivo que vale no dashboard: esta é a tela de resumo do
 * dono do SaaS, a única da área que alguém olha de longe.
 */
function resumoDaCarteira(tenants: readonly TenantNaLista[]): CelulaDeResumo[] {
  const ativos = tenants.filter((t) => t.status === 'ACTIVE').length;
  const suspensos = tenants.filter((t) => t.status === 'SUSPENDED').length;
  const alunosAtivos = tenants.reduce((total, t) => total + t.alunosAtivos, 0);
  const alunosInativos = tenants.reduce((total, t) => total + t.alunosInativos, 0);
  const vencidos = tenants.filter((t) => t.cobranca !== null);
  const emAberto = vencidos.reduce((total, t) => total + (t.cobranca?.emAbertoMinor ?? 0), 0);

  return [
    {
      id: 'clientes',
      label: 'Clientes',
      icon: 'building',
      value: tenants.length,
      hint:
        suspensos > 0
          ? `${ativos} em operação · ${suspensos} suspenso${suspensos > 1 ? 's' : ''}`
          : `${ativos} em operação`,
    },
    {
      id: 'alunos',
      label: 'Alunos na base',
      icon: 'users',
      value: alunosAtivos + alunosInativos,
      /*
        A DECOMPOSIÇÃO É O PONTO, e é a mesma razão da prévia da fatura (F64):
        o inativo domina a conta — 66% na base real —, e um total sozinho
        esconde exatamente o risco que o dono do SaaS precisa enxergar.
      */
      hint: `${alunosAtivos} ativos · ${alunosInativos} inativos`,
    },
    {
      id: 'inadimplencia',
      label: 'Em aberto',
      icon: 'alert-triangle',
      value: <Money cents={emAberto} currency="BRL" />,
      hint:
        vencidos.length === 0
          ? 'Nenhuma fatura vencida'
          : `${vencidos.length} cliente${vencidos.length > 1 ? 's' : ''} com fatura vencida`,
      /*
        Sem fatura vencida a célula PERDE o tom, e não ganha verde: "nada
        vencido" é o estado normal, e pintá-lo de positivo faria o alerta e a
        rotina disputarem a mesma atenção.
      */
      ...(vencidos.length > 0 ? { tom: 'risco' as const } : {}),
    },
  ];
}

/**
 * Lista de clientes — a superfície do dono do SaaS.
 *
 * Server Component: a lista é buscada no servidor e chega pronta, sem token
 * exposto ao navegador.
 */
export default async function PaginaDePlataforma() {
  const resposta = await chamarApi<TenantNaLista[]>('/api/v1/platform/tenants');

  if (!resposta.ok) {
    /*
     * Negação explícita, com o código estável visível. Tela vazia deixaria
     * quem abriu sem saber se não há cliente ou se este perfil não administra
     * a plataforma -- e são coisas que se resolvem de modos opostos.
     */
    return (
      <section aria-labelledby="titulo-plataforma">
        <PageHeader id="titulo-plataforma" title="Clientes" />
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
        title="Clientes"
        breadcrumb={<span>Plataforma</span>}
        actions={
          <Button href="/platform/novo" data-testid="nova-academia">
            Novo cliente
          </Button>
        }
      />

      {/*
        A FAIXA SÓ EXISTE COM CARTEIRA. Com zero clientes ela mostraria três
        zeros e um "R$ 0,00" que afirmam sobre o mundo o que só é ausência de
        cadastro — e o `EmptyState` abaixo já diz a mesma coisa melhor.
      */}
      {tenants.length > 0 ? (
        <SummaryStrip
          label="Resumo da carteira"
          testId="resumo-da-carteira"
          celulas={resumoDaCarteira(tenants)}
        />
      ) : null}

      <DataTable
        testId="tabela-de-academias"
        rows={tenants}
        rowKey={(tenant) => tenant.id}
        caption="Clientes atendidos pela plataforma"
        columns={[
          {
            key: 'nome',
            header: 'Cliente',
            role: 'identity',
            /*
             * `semAvatar`: cliente é uma ORGANIZAÇÃO, não uma pessoa. A
             * inicial num círculo daria a cada linha um rosto que ela não tem.
             */
            render: (t) => (
              /*
                LINK e não botão: o detalhe é uma tela, e abrir em nova aba,
                copiar o endereço e o anúncio de "link" do leitor de tela não se
                recuperam com JavaScript.
              */
              <a href={`/platform/${t.id}`} data-testid="abrir-academia">
                <Identidade semAvatar nome={t.displayName} />
              </a>
            ),
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
          /*
           * ATIVOS E INATIVOS EM COLUNAS SEPARADAS, e nao "409 / 1583" numa
           * so: sao os dois fatores da fatura, e cada um multiplica um preco
           * diferente. Numa celula unica o olho nao compara a coluna inteira,
           * que e justamente o que mostra o cliente cujo inativo cresceu.
           */
          {
            key: 'alunosAtivos',
            header: 'Ativos',
            role: 'value',
            render: (t) => t.alunosAtivos,
          },
          {
            key: 'alunosInativos',
            header: 'Inativos',
            role: 'value',
            render: (t) => t.alunosInativos,
          },
          {
            key: 'situacao',
            header: 'Situação',
            role: 'state',
            render: (t) => situacao(t.status, t.cobranca),
          },
          {
            key: 'acoes',
            header: 'Ações',
            role: 'actions',
            render: (t) => (
              <AcoesDoCliente tenantId={t.id} displayName={t.displayName} status={t.status} />
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="lista-vazia"
            title="Nenhum cliente cadastrado ainda."
            hint="Cadastre o primeiro cliente para o responsável dele receber o convite de acesso."
            action={
              <Button href="/platform/novo" data-testid="nova-academia-vazio">
                Cadastrar cliente
              </Button>
            }
          />
        }
      />
    </section>
  );
}
