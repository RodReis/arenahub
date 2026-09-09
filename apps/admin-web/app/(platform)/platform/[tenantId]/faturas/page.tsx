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
import { AcoesDaFatura } from './acoes-da-fatura';
import { EmitirFatura } from './emitir-fatura';
import estilos from './faturas.module.css';

export const metadata: Metadata = {
  title: 'Faturas da academia — ArenaHub',
};

interface FaturaNaLista {
  id: string;
  tenantId: string;
  competencia: string;
  model: 'PER_STUDENT' | 'FIXED_MONTHLY';
  activeCount: number;
  inactiveCount: number;
  activeStudentPriceMinor: number | null;
  inactiveStudentPriceMinor: number | null;
  totalMinor: number;
  currency: string;
  dueAt: string;
  status: 'OPEN' | 'PAID' | 'OVERDUE';
  paidAt: string | null;
}

interface Previa {
  competencia: string;
  emiteEm: string;
  vencimento: string;
  model: string;
  activeCount: number;
  inactiveCount: number;
  activeStudentPriceMinor: number | null;
  inactiveStudentPriceMinor: number | null;
  totalMinor: number;
  currency: string;
  jaEmitida: boolean;
}

interface TenantEmDetalhe {
  id: string;
  displayName: string;
}

/** `2026-03-01T00:00:00.000Z` -> `01/03/2026`. Data é `@db.Date`: lê-se em UTC. */
function dia(iso: string): string {
  const data = new Date(iso);
  const d = data.getUTCDate().toString().padStart(2, '0');
  const m = (data.getUTCMonth() + 1).toString().padStart(2, '0');

  return `${d}/${m}/${data.getUTCFullYear()}`;
}

/** `2026-03` -> `03/2026`. */
function mes(competencia: string): string {
  const [ano, numero] = competencia.split('-');

  return `${numero}/${ano}`;
}

function situacao(fatura: FaturaNaLista) {
  if (fatura.status === 'PAID') return <EstadoSimples label="Paga" tom="positivo" />;
  if (fatura.status === 'OVERDUE') return <EstadoSimples label="Vencida" tom="negativo" />;

  return <EstadoSimples label="Em aberto" tom="neutro" />;
}

/**
 * Faturas da academia — F64, ADR-052 (Fatura da plataforma).
 *
 * TELA PRÓPRIA e irmã da de contratos, pela mesma razão: a página do tenant já
 * carrega cadastro, situação, marca e elevação, e cobrança é assunto de peso
 * próprio.
 *
 * A PRÉVIA NO TOPO É A MITIGAÇÃO DE UM RISCO, não um enfeite. O PI aceitou de
 * olhos abertos que a fatura pode ser dominada por quem não treina (66% na base
 * real de 08/09), e a contrapartida foi o tenant ver o número antes de ele
 * virar cobrança. Por isso as parcelas aparecem decompostas — total sozinho
 * esconderia exatamente o que o risco pede para mostrar.
 *
 * OS VALORES DA TABELA SÃO OS QUE A FATURA CONGELOU, e não um recálculo. É o
 * aceite da fatia, e a tela seria o lugar mais fácil de quebrá-lo: bastaria
 * multiplicar a contagem de alunos de hoje pelo preço do contrato para a
 * coluna passar a mentir sobre o que foi cobrado.
 */
export default async function PaginaDeFaturas({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const [respostaDeFaturas, respostaDaPrevia, respostaDoTenant] = await Promise.all([
    chamarApi<FaturaNaLista[]>(
      `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/invoices`,
    ),
    chamarApi<Previa>(
      `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/invoices/preview`,
    ),
    chamarApi<TenantEmDetalhe>(`/api/v1/platform/tenants/${encodeURIComponent(tenantId)}`),
  ]);

  if (!respostaDeFaturas.ok) {
    return (
      <section aria-labelledby="titulo-faturas">
        <PageHeader id="titulo-faturas" title="Faturas" />
        <ProblemDetail
          testId="erro-de-faturas"
          problem={{
            ...(respostaDeFaturas.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar as faturas (${respostaDeFaturas.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const faturas = respostaDeFaturas.dados ?? [];
  const nomeDaAcademia = respostaDoTenant.dados?.displayName ?? 'Academia';
  /*
   * A prévia FALHA quando não há contrato vigente, e isso não é erro da tela:
   * a academia simplesmente ainda não tem o que faturar. O histórico continua
   * carregando, e o bloco de prévia dá lugar a uma explicação.
   */
  const previa = respostaDaPrevia.ok ? respostaDaPrevia.dados : undefined;

  return (
    <section aria-labelledby="titulo-faturas">
      <PageHeader
        id="titulo-faturas"
        title="Faturas"
        breadcrumb={
          <span>
            <a href="/platform">Plataforma</a> ·{' '}
            <a href={`/platform/${tenantId}`}>{nomeDaAcademia}</a>
          </span>
        }
        /*
          A AÇÃO FICA NO CABEÇALHO, e não depois da tabela: emitir é o ato da
          tela, e abaixo do histórico ele só se alcança rolando -- pior ainda
          numa academia com dois anos de faturas.
        */
        actions={previa ? <EmitirFatura tenantId={tenantId} jaEmitida={previa.jaEmitida} /> : null}
      />

      {previa ? (
        <div className={estilos['previa']} data-testid="previa-da-fatura">
          <div className={estilos['cabecalhoDaPrevia']}>
            <h2 className={estilos['tituloDaPrevia']}>
              {previa.jaEmitida ? 'Fatura da competência' : 'Prévia da próxima fatura'}
            </h2>
            <span className={estilos['competencia']}>
              Competência {mes(previa.competencia)} · vence em {dia(previa.vencimento)}
            </span>
          </div>

          {previa.jaEmitida ? (
            <p className={estilos['aviso']}>
              Esta competência <strong>já foi emitida</strong>. Os valores abaixo são os que a
              fatura congelou, e não mudam mais com a base de alunos.
            </p>
          ) : null}

          <div className={estilos['parcelas']}>
            {previa.model === 'PER_STUDENT' ? (
              <>
                <div className={estilos['parcela']}>
                  <p className={estilos['rotuloDaParcela']}>Alunos ativos</p>
                  <p className={estilos['valorDaParcela']}>
                    <Money
                      cents={previa.activeCount * (previa.activeStudentPriceMinor ?? 0)}
                      currency={previa.currency}
                    />
                  </p>
                  <p className={estilos['contaDaParcela']}>
                    {previa.activeCount} ×{' '}
                    <Money
                      cents={previa.activeStudentPriceMinor}
                      currency={previa.currency}
                    />
                  </p>
                </div>

                <div className={estilos['parcela']}>
                  <p className={estilos['rotuloDaParcela']}>Alunos inativos</p>
                  <p className={estilos['valorDaParcela']}>
                    <Money
                      cents={previa.inactiveCount * (previa.inactiveStudentPriceMinor ?? 0)}
                      currency={previa.currency}
                    />
                  </p>
                  <p className={estilos['contaDaParcela']}>
                    {previa.inactiveCount} ×{' '}
                    <Money
                      cents={previa.inactiveStudentPriceMinor}
                      currency={previa.currency}
                    />
                  </p>
                </div>
              </>
            ) : (
              <div className={estilos['parcela']}>
                <p className={estilos['rotuloDaParcela']}>Valor fixo mensal</p>
                <p className={estilos['valorDaParcela']}>
                  <Money cents={previa.totalMinor} currency={previa.currency} />
                </p>
                <p className={estilos['contaDaParcela']}>já corrigido pelo índice do contrato</p>
              </div>
            )}

            <div className={estilos['parcela']} data-total="">
              <p className={estilos['rotuloDaParcela']}>Total</p>
              <p className={estilos['valorDaParcela']} data-testid="total-da-previa">
                <Money cents={previa.totalMinor} currency={previa.currency} />
              </p>
              <p className={estilos['contaDaParcela']}>
                {previa.jaEmitida ? 'emitida' : `emite em ${dia(previa.emiteEm)}`}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          testId="sem-contrato-para-faturar"
          title="Esta academia ainda não tem contrato vigente."
          hint="Feche um contrato para que a fatura da plataforma passe a ser emitida."
        />
      )}

      <DataTable
        testId="tabela-de-faturas"
        rows={faturas}
        rowKey={(fatura) => fatura.id}
        caption={`Faturas do ArenaHub sobre ${nomeDaAcademia}`}
        columns={[
          {
            key: 'competencia',
            header: 'Competência',
            role: 'identity',
            render: (f) => mes(f.competencia),
          },
          {
            key: 'base',
            header: 'Base de cálculo',
            render: (f) =>
              f.model === 'FIXED_MONTHLY'
                ? 'Fixo mensal'
                : `${f.activeCount} ativos · ${f.inactiveCount} inativos`,
          },
          {
            key: 'total',
            header: 'Total',
            role: 'value',
            render: (f) => <Money cents={f.totalMinor} currency={f.currency} />,
          },
          { key: 'vencimento', header: 'Vencimento', render: (f) => dia(f.dueAt) },
          { key: 'situacao', header: 'Situação', role: 'state', render: situacao },
          {
            key: 'acoes',
            header: 'Ações',
            render: (f) => (
              <AcoesDaFatura faturaId={f.id} tenantId={tenantId} status={f.status} />
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="faturas-vazio"
            title="Nenhuma fatura emitida para esta academia ainda."
            hint="A primeira sai no dia de emissão do contrato, ou agora pelo botão acima."
          />
        }
      />
    </section>
  );
}
