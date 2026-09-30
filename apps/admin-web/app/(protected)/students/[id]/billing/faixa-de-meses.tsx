'use client';

import { useMemo, useState } from 'react';

import { Button, Money, useToast } from '@arenahub/ui';

import { receberPagamentoEmLote } from '../../../../actions/billing';
import type { MesPagavelUI } from '../../../../../src/billing/meses-pagaveis';
import { SeletorDeForma, type FormaDePagamento } from './seletor-de-forma';

import styles from './faixa-de-meses.module.css';

interface FaixaDeMesesProps {
  readonly faixa: readonly MesPagavelUI[];
  readonly subscriptionId: string;
  readonly onPago: () => void;
}

const ROTULO_STATUS: Record<MesPagavelUI['status'], string> = {
  OVERDUE: 'Vencido',
  OPEN: 'Em aberto',
  NOT_OPENED: 'Adiantado',
};

function formatarMesAno(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${nomes[Number(mes) - 1]}/${ano!.slice(2)}`;
}

/** Indice do ultimo mes que faz parte da selecao inicial: todo OVERDUE + o primeiro OPEN. */
function indiceInicial(faixa: readonly MesPagavelUI[]): number {
  let ultimo = -1;

  for (let i = 0; i < faixa.length; i += 1) {
    if (faixa[i]!.status === 'OVERDUE' || faixa[i]!.status === 'OPEN') {
      ultimo = i;
    } else {
      break;
    }
  }

  return ultimo;
}

/**
 * Faixa de meses pagaveis -- F83, Task 7.
 *
 * Substitui o "Receber no balcao" de UMA invoice (`painel-de-cobranca.tsx`,
 * pre-F83) por selecao continua de varios meses. A regra de selecao (Decisao
 * 1 do PI): clicar em qualquer mes seleciona o PREFIXO ate ali -- nunca cria
 * buraco. Clicar no ultimo mes ja selecionado recua a selecao em um, porque e
 * o unico jeito de encolher sem um segundo controle.
 *
 * O SERVIDOR SEMPRE RECALCULA (`receberPagamentoEmLote` -> `manual-payment-batch`,
 * F83 Task 4): `expectedTotalMinor` e conferencia optimista, nao autoridade.
 * Se o total mudar entre abrir a tela e clicar em "Receber" (outra cobranca
 * emitida, valor reajustado), o servidor recusa com
 * `BILLING_BATCH_TOTAL_CHANGED` e `onPago` recarrega a faixa com os valores
 * atuais -- nunca envia o valor antigo por cima.
 */
export function FaixaDeMeses({ faixa, subscriptionId, onPago }: FaixaDeMesesProps) {
  const [indiceSelecionado, setIndiceSelecionado] = useState(() => indiceInicial(faixa));
  const [forma, setForma] = useState<FormaDePagamento>('DINHEIRO');
  const [enviando, setEnviando] = useState(false);
  const { show } = useToast();

  const selecao = useMemo(() => faixa.slice(0, indiceSelecionado + 1), [faixa, indiceSelecionado]);
  const total = useMemo(() => selecao.reduce((soma, m) => soma + m.totalMinor, 0), [selecao]);

  function handleClique(indice: number): void {
    // Clicar no ultimo mes ja selecionado recua a selecao em um; qualquer
    // outro clique estende ate ali (Decisao 1 do PI: nunca cria buraco).
    setIndiceSelecionado(indice === indiceSelecionado ? Math.max(indice - 1, -1) : indice);
  }

  async function handleReceber(): Promise<void> {
    if (selecao.length === 0) {
      return;
    }

    setEnviando(true);

    const resultado = await receberPagamentoEmLote({
      subscriptionId,
      ateCompetencia: selecao[selecao.length - 1]!.competencia,
      channel: forma,
      expectedTotalMinor: total,
    });

    setEnviando(false);

    if (!resultado.ok) {
      show('warn', resultado.error, 'erro-lote');
      onPago(); // forca recarregar a faixa com os valores atuais
      return;
    }

    show(
      'info',
      `${selecao.length} ${selecao.length === 1 ? 'mês recebido' : 'meses recebidos'}`,
      'lote-recebido',
    );
    onPago();
  }

  return (
    <section aria-labelledby="titulo-faixa" className={styles['faixa']}>
      <h3 id="titulo-faixa">Receber no balcão</h3>

      <div className={styles['chips']}>
        {faixa.map((mes, indice) => (
          <button
            key={mes.competencia}
            type="button"
            className={styles['chip']}
            data-selecionado={indice <= indiceSelecionado ? 'true' : undefined}
            onClick={() => handleClique(indice)}
            aria-pressed={indice <= indiceSelecionado}
          >
            <span className={styles['mesAno']}>{formatarMesAno(mes.competencia)}</span>
            <span className={styles['status']}>{ROTULO_STATUS[mes.status]}</span>
            <span className={styles['valor']}>
              <Money cents={mes.totalMinor} />
            </span>
          </button>
        ))}
      </div>

      {selecao.length > 0 ? (
        <p className={styles['resumo']}>
          {selecao.length} {selecao.length === 1 ? 'mês' : 'meses'} · {formatarMesAno(selecao[0]!.competencia)} a{' '}
          {formatarMesAno(selecao[selecao.length - 1]!.competencia)} · Total <Money cents={total} />
        </p>
      ) : null}

      <SeletorDeForma onEscolher={setForma} escolhida={forma} />

      <Button
        variant="solid"
        type="button"
        disabled={selecao.length === 0 || enviando}
        onClick={() => void handleReceber()}
      >
        {enviando ? 'Recebendo…' : 'Receber'}
      </Button>
    </section>
  );
}
