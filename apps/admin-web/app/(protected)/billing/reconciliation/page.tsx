import type { Metadata } from 'next';

import { DataTable, EmptyState, Money, PageHeader, ProblemDetail, StateBadge } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { diferencaMinor } from '../../../../src/billing/conciliacao';
import { FormularioDeResolucao } from './formulario-de-resolucao';
import estilos from './reconciliation.module.css';

export const metadata: Metadata = {
  title: 'Conciliação financeira — ArenaHub',
};

/**
 * Sem cache: a fila de divergência é trabalhada por duas pessoas ao mesmo
 * tempo, e uma lista de dois minutos atrás faria a segunda tentar resolver o
 * que a primeira já fechou.
 */
export const dynamic = 'force-dynamic';

export interface ItemDeConciliacao {
  id: string;
  runId: string;
  status: string;
  paymentId: string | null;
  refundId: string | null;
  externalMovementId: string | null;
  internalAmountMinor: number | null;
  externalAmountMinor: number | null;
  recommendedAction: string;
  resolution: string | null;
  resolutionReason: string | null;
  resolvedAt: string | null;
}

export default async function PaginaDeConciliacao() {
  const resposta = await chamarApi<ItemDeConciliacao[]>('/api/v1/reconciliation/items');

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-conciliacao">
        <PageHeader id="titulo-conciliacao" title="Conciliação financeira" />
        <ProblemDetail
          testId="erro-de-conciliacao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar a conciliação (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const itens = resposta.dados;
  const emAberto = itens.filter((i) => i.status !== 'MATCHED' && i.status !== 'RESOLVED');
  const conferidos = itens.length - emAberto.length;

  return (
    <>
      <PageHeader
        id="titulo-conciliacao"
        title="Conciliação financeira"
        breadcrumb={<span>Receita</span>}
      />

      {/*
        Diz de saída o que a tela NÃO faz. O operador chega aqui com um número
        que não bate e o impulso de corrigi-lo; a frase existe para redirecionar
        esse impulso antes de ele virar um pedido de acesso ao banco.
      */}
      <p className={estilos['intro']}>
        Movimentos do provedor conferidos contra os registros do ArenaHub. Nenhuma ação desta tela
        altera valor — cada uma registra uma decisão auditada.
      </p>

      <section className={estilos['resumo']} aria-label="Resumo da conciliação">
        <div className={estilos['cartao']}>
          <span className={estilos['rotulo']}>Pendentes</span>
          <strong className={estilos['numero']} data-tom={emAberto.length > 0 ? 'alerta' : 'ok'}>
            {emAberto.length}
          </strong>
          <span className={estilos['apoio']}>divergências aguardando decisão</span>
        </div>
        <div className={estilos['cartao']}>
          <span className={estilos['rotulo']}>Conferidos</span>
          <strong className={estilos['numero']}>{conferidos}</strong>
          {/*
            Mostrar o que BATEU, e não só o que falhou, é o que responde
            "conciliei 100%?" — a métrica que o `MVP-02` §3 cobra.
          */}
          <span className={estilos['apoio']}>movimentos sem divergência</span>
        </div>
      </section>

      <DataTable
        caption="Movimentos conciliados e divergências"
        testId="tabela-de-conciliacao"
        rows={itens}
        rowKey={(item) => item.id}
        rowTestId={(item) => `item-${item.id}`}
        empty={
          <EmptyState
            testId="sem-conciliacao"
            title="Nenhuma conciliação executada"
            hint="Rode uma conciliação por período fechado para comparar o extrato do provedor com os registros desta academia."
          />
        }
        columns={[
          {
            key: 'situacao',
            header: 'Situação',
            render: (item) => <StateBadge machine="reconciliation" state={item.status} />,
          },
          {
            key: 'interno',
            header: 'ArenaHub',
            numeric: true,
            render: (item) =>
              item.internalAmountMinor === null ? (
                <span className={estilos['ausente']}>não registrado</span>
              ) : (
                <Money cents={item.internalAmountMinor} />
              ),
          },
          {
            key: 'externo',
            header: 'Provedor',
            numeric: true,
            render: (item) =>
              item.externalAmountMinor === null ? (
                <span className={estilos['ausente']}>não reportado</span>
              ) : (
                <Money cents={item.externalAmountMinor} />
              ),
          },
          {
            key: 'diferenca',
            header: 'Diferença',
            numeric: true,
            render: (item) => {
              const diferenca = diferencaMinor(item.internalAmountMinor, item.externalAmountMinor);

              /*
                Ausência não é diferença de valor: mostrar o valor do único
                lado sugeriria erro de conta onde o problema é o movimento não
                existir de um dos lados.
              */
              return diferenca === null ? (
                <span className={estilos['ausente']}>—</span>
              ) : (
                <Money cents={diferenca} />
              );
            },
          },
          {
            key: 'acao',
            header: 'O que fazer',
            render: (item) =>
              item.status === 'RESOLVED' ? (
                <span className={estilos['resolvido']}>{item.resolutionReason}</span>
              ) : (
                <span className={estilos['acao']}>{item.recommendedAction}</span>
              ),
          },
          {
            key: 'resolver',
            header: 'Resolver',
            render: (item) => <FormularioDeResolucao item={item} />,
          },
        ]}
      />
    </>
  );
}
