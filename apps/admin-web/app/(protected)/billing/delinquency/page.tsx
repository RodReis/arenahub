import type { Metadata } from 'next';

import {
  Button,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  ProblemDetail,
  StateBadge,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { linkDeCobranca, situacaoVisivel } from '../../../../src/billing/inadimplencia';
import estilos from './delinquency.module.css';

export const metadata: Metadata = {
  title: 'Inadimplência e cobrança — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Linha {
  invoiceId: string;
  invoiceNumber: number;
  studentId: string;
  studentName: string;
  amountMinor: number;
  currency: string;
  dueAt: string;
  diasEmAtraso: number;
  situacao: string;
  telefone: string | null;
  liberadoAte: string | null;
  fusoDaUnidade: string;
}

interface Painel {
  resumo: {
    emAtrasoMinor: number;
    faturasVencidas: number;
    bloqueados: number;
    taxaDeInadimplencia: number | null;
  };
  linhas: Linha[];
}

export default async function InadimplenciaPage() {
  const resposta = await chamarApi<Painel>('/api/v1/billing/delinquency');

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-inadimplencia">
        <PageHeader id="titulo-inadimplencia" title="Inadimplência e cobrança" />
        <ProblemDetail
          testId="erro-de-inadimplencia"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar a cobrança (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const { resumo, linhas } = resposta.dados;

  return (
    <section aria-labelledby="titulo-inadimplencia">
      <PageHeader
        id="titulo-inadimplencia"
        title="Inadimplência e cobrança"
        breadcrumb={<span>Receita</span>}
      />

      {/*
        Tres numeros que respondem "quao ruim esta?" antes de a pessoa ler uma
        linha da tabela. O de dinheiro vem primeiro porque e o que o dono da
        academia pergunta.
      */}
      <dl className={estilos['resumo']} data-testid="resumo-da-inadimplencia">
        <div className={estilos['cartao']}>
          <dt>Em atraso</dt>
          <dd className={estilos['destaque']}>
            <Money cents={resumo.emAtrasoMinor} currency="BRL" />
          </dd>
          <p className={estilos['apoio']}>
            {resumo.faturasVencidas === 1
              ? '1 fatura vencida'
              : `${String(resumo.faturasVencidas)} faturas vencidas`}
          </p>
        </div>

        <div className={estilos['cartao']}>
          <dt>Taxa de inadimplência</dt>
          <dd className={estilos['destaque']}>
            {/*
              `—` e nao `0%` quando nao ha assinatura pagante: academia sem
              aluno nao tem inadimplencia zero, tem uma taxa que nao existe --
              e "0%" seria uma meta batida em cima de nada.
            */}
            {/*
              `replace` e nao `toLocaleString`: a regra 5 do DS proibe
              formatacao por locale fora de `TenantDateTime`, e ela esta certa
              em ser conservadora -- `toLocaleString` num numero e inofensivo,
              mas a regra nao consegue distinguir de uma data, e afrouxa-la
              abriria a porta que ela existe para fechar.

              A taxa vem do backend com uma casa decimal; so a virgula muda.
            */}
            {resumo.taxaDeInadimplencia === null
              ? '—'
              : `${String(resumo.taxaDeInadimplencia).replace('.', ',')}%`}
          </dd>
          <p className={estilos['apoio']}>sobre assinaturas ativas e em atraso</p>
        </div>

        <div className={estilos['cartao']}>
          <dt>Bloqueados por cobrança</dt>
          <dd className={estilos['destaque']}>{resumo.bloqueados}</dd>
          <p className={estilos['apoio']}>desbloqueio automático no pagamento</p>
        </div>
      </dl>

      <DataTable
        testId="tabela-de-inadimplencia"
        rows={linhas}
        rowKey={(linha) => linha.invoiceId}
        rowTestId={(linha) => `fatura-${linha.invoiceId}`}
        caption="Faturas vencidas em aberto, da mais antiga para a mais recente"
        columns={[
          {
            key: 'aluno',
            header: 'Aluno',
            render: (linha) => linha.studentName,
          },
          {
            key: 'fatura',
            header: 'Fatura',
            numeric: true,
            render: (linha) => <span className={estilos['numero']}>{linha.invoiceNumber}</span>,
          },
          {
            key: 'valor',
            header: 'Valor',
            numeric: true,
            render: (linha) => <Money cents={linha.amountMinor} currency={linha.currency} />,
          },
          {
            key: 'vencimento',
            header: 'Vencimento',
            /*
              FUSO DA UNIDADE, nao fixo. As outras telas ainda carregam um
              `FUSO_PROVISORIO` hardcodado; aqui isso seria pior que divida
              tecnica: o backend decide o bloqueio no fuso da unidade, SEM
              fallback (ADR-019 §3), e mostrar a data noutro fuso faria a tela
              divergir em um dia da regra que ela esta exibindo.
            */
            render: (linha) => (
              <TenantDateTime iso={linha.dueAt} timeZone={linha.fusoDaUnidade} format="date" />
            ),
          },
          {
            key: 'atraso',
            header: 'Atraso',
            numeric: true,
            /*
              O atraso carrega cor de estado porque e ele que ORDENA a urgencia
              da fila de cobranca -- mesma correcao de hierarquia da lista de
              alunos (F45): contraste diz se da para ler, nao se da para achar.
            */
            render: (linha) => (
              <span className={estilos['atraso']}>
                {linha.diasEmAtraso === 1 ? '1 dia' : `${String(linha.diasEmAtraso)} dias`}
              </span>
            ),
          },
          {
            key: 'acesso',
            header: 'Acesso',
            render: (linha) => (
              <StateBadge machine="delinquencyAccess" state={situacaoVisivel(linha)} />
            ),
          },
          {
            key: 'acoes',
            header: 'Ações',
            render: (linha) => (
              <div className={estilos['acoes']}>
                {/*
                  LINK, nao integracao. O envio e do OPERADOR: `wa.me` abre o
                  WhatsApp dele com a mensagem pronta, e a pessoa revisa antes
                  de mandar. API oficial exigiria provedor, template homologado
                  e consentimento de contato -- fatia propria (decisao do PI,
                  19/08/2026).

                  SEM TELEFONE NAO HA BOTAO: um link morto na tabela faz a
                  recepcao clicar e nao entender por que nada acontece.
                */}
                {linha.telefone !== null && (
                  <Button
                    variant="outline"
                    href={linkDeCobranca(linha.telefone, linha.studentName, linha.invoiceNumber)}
                  >
                    Cobrar no WhatsApp
                  </Button>
                )}
                <Button variant="solid" href={`/students/${linha.studentId}`}>
                  Abrir ficha
                </Button>
              </div>
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="sem-inadimplencia"
            title="Ninguém em atraso"
            hint="Nenhuma fatura vencida em aberto neste momento."
          />
        }
      />
    </section>
  );
}
