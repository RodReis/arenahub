import type { Metadata } from 'next';

import {
  AcoesDaLinha,
  AusenteDeAcao,
  DataTable,
  EmptyState,
  Identidade,
  Money,
  PageHeader,
  ProblemDetail,
  StateBadge,
} from '@arenahub/ui';

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

      {/*
        `div` e nao `section`: o `globals.css` da a TODO `section` o desenho de
        card -- borda, fundo e `flex-direction: column`. Envolver os dois
        cartoes numa `section` produzia card dentro de card (que o proprio
        comentario de la chama de erro) e empilhava o que devia ficar lado a
        lado. Visto no navegador, nao deduzido.
      */}
      <div className={estilos['resumo']} role="group" aria-label="Resumo da conciliação">
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
      </div>

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
            key: 'movimento',
            header: 'Movimento',
            role: 'identity',
            /*
              A identidade da linha é o MOVIMENTO, não o aluno: a conciliação
              compara dinheiro que entrou com dinheiro que o provedor reporta,
              e quem paga não é a pergunta desta tela. `semAvatar` porque
              movimento financeiro não tem rosto — pôr uma inicial aqui seria
              enfeite fingindo ser informação.
            */
            render: (item) => (
              <Identidade
                semAvatar
                nome={referenciaLegivel(item)}
                secundario={<span>{DESCRICAO_DO_ITEM[item.status] ?? ''}</span>}
              />
            ),
          },
          {
            key: 'situacao',
            header: 'Situação',
            role: 'state',
            render: (item) => <StateBadge machine="reconciliation" state={item.status} />,
          },
          {
            key: 'interno',
            header: 'ArenaHub',
            role: 'value',
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
            role: 'value',
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
            role: 'value',
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
                <span className={estilos['diferenca']} data-sinal={diferenca === 0 ? 'zero' : 'nao-zero'}>
                  <Money cents={diferenca} />
                </span>
              );
            },
          },
          {
            key: 'acao',
            header: 'O que fazer',
            role: 'support',
            render: (item) =>
              item.status === 'RESOLVED' ? (
                <span className={estilos['resolvido']}>{item.resolutionReason}</span>
              ) : (
                <span>{item.recommendedAction}</span>
              ),
          },
          {
            key: 'resolver',
            header: '',
            role: 'actions',
            render: (item) =>
              item.status === 'MATCHED' || item.status === 'RESOLVED' ? (
                <AusenteDeAcao />
              ) : (
                <AcoesDaLinha>
                  <FormularioDeResolucao item={item} />
                </AcoesDaLinha>
              ),
          },
        ]}
      />
    </>
  );
}

/**
 * A referência que identifica o movimento na conversa com o provedor.
 *
 * O id externo é o que a operadora digita no painel do banco para achar a
 * mesma transação — é ele que identifica a linha, não o UUID interno, que não
 * existe em lugar nenhum fora daqui.
 */
function referenciaLegivel(item: ItemDeConciliacao): string {
  if (item.externalMovementId !== null) {
    return item.externalMovementId;
  }

  return item.paymentId !== null ? `Pagamento ${item.paymentId.slice(0, 8)}` : 'Movimento sem referência';
}

/** Uma linha dizendo de que LADO está o problema, sob a referência. */
const DESCRICAO_DO_ITEM: Readonly<Record<string, string>> = {
  MATCHED: 'os dois lados batem',
  MISSING_INTERNAL: 'só no extrato do provedor',
  MISSING_EXTERNAL: 'só nos registros do ArenaHub',
  AMOUNT_MISMATCH: 'valores diferentes nos dois lados',
  RESOLVED: 'decidido e registrado',
};
