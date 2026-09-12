import type { Metadata } from 'next';

import {
  DataTable,
  EmptyState,
  EstadoSimples,
  Money,
  PageHeader,
  ProblemDetail,
} from '@arenahub/ui';

import { chamarApi } from '../../../../../lib/api/server-client';
import { AcoesDoContrato } from './acoes-do-contrato';
import estilos from './contratos.module.css';
import { FormularioDeContrato } from './formulario-de-contrato';

export const metadata: Metadata = {
  title: 'Contratos do cliente — ArenaHub',
};

interface ContratoNaLista {
  id: string;
  tenantId: string;
  planId: string;
  model: 'PER_STUDENT' | 'FIXED_MONTHLY';
  activeStudentPriceMinor: number | null;
  inactiveStudentPriceMinor: number | null;
  fixedPriceMinor: number | null;
  currency: string;
  indexCode: string;
  anniversaryDay: number;
  anniversaryMonth: number;
  graceDays: number;
  issueDay: number;
  startsAt: string;
  endsAt: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'TERMINATED';
  supersedesId: string | null;
  mobileEnabled: boolean;
  kioskEnabled: boolean;
  temDocumento: boolean;
}

interface PlanoNaLista {
  id: string;
  name: string;
  model: 'PER_STUDENT' | 'FIXED_MONTHLY';
  status: 'ACTIVE' | 'ARCHIVED';
  /** Padrão de superfície que o formulário de contrato herda. */
  mobileEnabled: boolean;
  kioskEnabled: boolean;
}

interface TenantEmDetalhe {
  id: string;
  displayName: string;
}

/**
 * A prévia da fatura corrente — é ela que dá o VALOR do contrato em reais.
 *
 * No modelo por aluno o contrato não tem um valor: tem preços unitários. O
 * número que a academia paga só existe multiplicado pela contagem do mês, e é
 * a prévia quem faz essa conta (`calculo-da-fatura.ts`, F64). Repetir a
 * multiplicação aqui criaria uma segunda aritmética de dinheiro fora do lugar
 * onde ela é testada.
 */
interface PreviaDaFatura {
  competencia: string;
  model: string;
  activeCount: number;
  inactiveCount: number;
  activeStudentPriceMinor: number | null;
  inactiveStudentPriceMinor: number | null;
  totalMinor: number;
  currency: string;
}

interface ValorDeIndice {
  id: string;
  code: string;
  competencia: string;
  variationBasisPoints: number;
}

/** `2026-03-01T00:00:00.000Z` -> `01/03/2026`. Data é `@db.Date`: lê-se em UTC. */
function dia(iso: string): string {
  const data = new Date(iso);
  const d = data.getUTCDate().toString().padStart(2, '0');
  const m = (data.getUTCMonth() + 1).toString().padStart(2, '0');

  return `${d}/${m}/${data.getUTCFullYear()}`;
}

/** `2026-03` -> `03/2026`. Competência é MÊS, e o olho lê mês/ano. */
function mes(competencia: string): string {
  const [ano, numero] = competencia.split('-');

  return `${numero}/${ano}`;
}

/** `440` -> `0,44%`. O banco guarda milésimos de ponto; o olho lê porcento. */
function porcentoDoIndice(basisPoints: number): string {
  return `${(basisPoints / 1000).toFixed(2).replace('.', ',')}%`;
}

/**
 * O preço unitário do contrato.
 *
 * O RÓTULO VAI DEPOIS DO NÚMERO, em elemento próprio: com "R$ 3,00 por ativo"
 * numa string só, o `R$ 3,00` e o `R$ 1,00` da linha de baixo terminavam em
 * pontos diferentes, e a coluna de dinheiro perdia o alinhamento que é a razão
 * de ela existir. Separados, os dois valores encostam na mesma borda e os
 * rótulos ficam numa coluna própria à direita.
 */
function valor(contrato: ContratoNaLista) {
  if (contrato.model === 'FIXED_MONTHLY') {
    return <Money cents={contrato.fixedPriceMinor} currency={contrato.currency} />;
  }

  return (
    <div className={estilos['precos']}>
      <Money cents={contrato.activeStudentPriceMinor} currency={contrato.currency} />
      <span>por ativo</span>
      <Money cents={contrato.inactiveStudentPriceMinor} currency={contrato.currency} />
      <span>por inativo</span>
    </div>
  );
}

function situacao(status: ContratoNaLista['status']) {
  if (status === 'ACTIVE') return <EstadoSimples label="Vigente" tom="positivo" />;
  if (status === 'DRAFT') return <EstadoSimples label="Rascunho" tom="neutro" />;

  return <EstadoSimples label="Encerrado" tom="neutro" />;
}

/**
 * Contratos da academia — F63, ADR-052 §8.
 *
 * TELA PRÓPRIA, e não um bloco na página do tenant: aquela já carrega cadastro,
 * situação, marca e elevação, e contrato é o assunto mais pesado dos cinco --
 * fechar um é irreversível, e o ato merece uma tela em que ele seja o único
 * assunto.
 *
 * OS VALORES DA TABELA SÃO OS DO CONTRATO, não os do plano atual. É o aceite
 * da fatia, e a tela seria o lugar mais fácil de quebrá-lo: bastaria juntar o
 * preço do plano ao nome dele para a coluna passar a mentir sobre o que a
 * academia paga.
 */
export default async function PaginaDeContratos({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const [respostaDeContratos, respostaDePlanos, respostaDoTenant, respostaDaPrevia] =
    await Promise.all([
      chamarApi<ContratoNaLista[]>(
        `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/contracts`,
      ),
      chamarApi<PlanoNaLista[]>('/api/v1/platform/plans'),
      chamarApi<TenantEmDetalhe>(`/api/v1/platform/tenants/${encodeURIComponent(tenantId)}`),
      /*
       * A PRÉVIA PODE FALHAR sem levar a tela junto: ela exige contrato
       * vigente, e esta página existe justamente para o caso de não haver um.
       * A coluna de valor cai em "—" e o resto da tela continua servindo.
       */
      chamarApi<PreviaDaFatura>(
        `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/invoices/preview`,
      ),
    ]);

  if (!respostaDeContratos.ok) {
    return (
      <section aria-labelledby="titulo-contratos">
        <PageHeader id="titulo-contratos" title="Contratos" />
        <ProblemDetail
          testId="erro-de-contratos"
          problem={{
            ...(respostaDeContratos.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar os contratos (${respostaDeContratos.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const contratos = respostaDeContratos.dados ?? [];
  /*
   * SÓ PLANO ATIVO entra na lista de escolha: plano arquivado não fecha
   * contrato novo (ADR-052 §8), e oferecê-lo produziria uma recusa da API
   * depois de a pessoa ter preenchido a tela inteira.
   */
  const planos = (respostaDePlanos.dados ?? []).filter((plano) => plano.status === 'ACTIVE');
  const nomeDaAcademia = respostaDoTenant.dados?.displayName ?? 'Academia';
  const previa = respostaDaPrevia.ok ? respostaDaPrevia.dados : undefined;

  /*
   * A VARIAÇÃO CORRENTE do índice de cada contrato — a última competência
   * cadastrada. Busca depois dos contratos porque depende do `indexCode`
   * deles; `Set` porque dois contratos costumam usar o mesmo índice e pedir a
   * mesma lista duas vezes seria desperdício.
   */
  const codigos = [...new Set(contratos.map((contrato) => contrato.indexCode))];
  const historicos = await Promise.all(
    codigos.map(async (codigo) => {
      const resposta = await chamarApi<ValorDeIndice[]>(
        `/api/v1/platform/index-values?code=${encodeURIComponent(codigo)}`,
      );

      return [codigo, resposta.dados ?? []] as const;
    }),
  );
  /** `IPCA` -> a competência mais recente cadastrada. A API já devolve em ordem decrescente. */
  const correnteDoIndice = new Map(
    historicos.map(([codigo, valores]) => [codigo, valores[0]] as const),
  );

  return (
    <section className={estilos['pagina']} aria-labelledby="titulo-contratos">
      <PageHeader
        id="titulo-contratos"
        title="Contratos"
        breadcrumb={
          <span>
            <a href="/platform">Plataforma</a> ·{' '}
            <a href={`/platform/${tenantId}`}>{nomeDaAcademia}</a>
          </span>
        }
      />

      <DataTable
        testId="tabela-de-contratos"
        rows={contratos}
        rowKey={(contrato) => contrato.id}
        caption={`Contratos do ArenaHub com ${nomeDaAcademia}`}
        columns={[
          {
            key: 'vigencia',
            header: 'Vigência',
            role: 'identity',
            /*
              SEM PRAZO É A REGRA, não a exceção: quase todo contrato é por
              prazo indeterminado, e imprimir "— sem prazo" em cada linha
              gastava duas linhas de altura para dizer o que não distingue
              nada. Só o contrato COM prazo ganha texto.
            */
            render: (c) => (c.endsAt ? `${dia(c.startsAt)} a ${dia(c.endsAt)}` : dia(c.startsAt)),
          },
          {
            key: 'modelo',
            header: 'Modelo',
            render: (c) => (c.model === 'PER_STUDENT' ? 'Por aluno' : 'Fixo mensal'),
          },
          { key: 'valor', header: 'Preço acordado', role: 'value', render: valor },
          {
            key: 'total',
            header: 'Valor do mês',
            role: 'value',
            /*
              O QUE A ACADEMIA PAGA neste mês, e não o preço unitário da coluna
              ao lado. No modelo por aluno o contrato não tem um valor — ele só
              existe multiplicado pela contagem, e é a prévia da fatura quem faz
              essa conta (F64). Contrato não vigente não tem prévia: a prévia é
              do contrato ATIVO do tenant, e atribuí-la a um rascunho ou a um
              encerrado diria que eles cobram algo.
            */
            render: (c) =>
              c.status === 'ACTIVE' && previa ? (
                <Money cents={previa.totalMinor} currency={previa.currency} />
              ) : (
                '—'
              ),
          },
          {
            key: 'reajuste',
            header: 'Reajuste',
            render: (c) => {
              const corrente = correnteDoIndice.get(c.indexCode);

              return (
                <>
                  {/*
                    O DIA VEM COM ZERO À ESQUERDA e a palavra "aniversário"
                    junto: "IPCA · 1/1" solto lê-se como fração, não como data.
                  */}
                  <div>{c.indexCode}</div>
                  <div className={estilos['variacao']}>
                    aniversário em{' '}
                    {`${c.anniversaryDay.toString().padStart(2, '0')}/${c.anniversaryMonth.toString().padStart(2, '0')}`}
                  </div>
                  {/*
                    A VARIAÇÃO CORRENTE ao lado do nome do índice: "IPCA" sozinho
                    não diz se alguém cadastrou o mês, e a correção anual não roda
                    com a janela incompleta. Sem valor nenhum, a linha diz isso em
                    vez de calar.
                  */}
                  <div className={estilos['variacao']}>
                    {corrente
                      ? `${porcentoDoIndice(corrente.variationBasisPoints)} em ${mes(corrente.competencia)}`
                      : 'sem variação cadastrada'}
                  </div>
                </>
              );
            },
          },
          { key: 'situacao', header: 'Situação', role: 'state', render: (c) => situacao(c.status) },
          {
            key: 'acoes',
            header: 'Ações',
            role: 'actions',
            render: (c) => (
              <AcoesDoContrato
                contratoId={c.id}
                tenantId={tenantId}
                status={c.status}
                temDocumento={c.temDocumento}
              />
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="contratos-vazio"
            title="Nenhum contrato com esta academia ainda."
            hint="Abra um contrato para registrar o plano e os valores acordados."
          />
        }
      />

      <FormularioDeContrato
        tenantId={tenantId}
        planos={planos}
        temVigente={contratos.some((contrato) => contrato.status === 'ACTIVE')}
      />
    </section>
  );
}
