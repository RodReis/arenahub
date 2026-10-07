'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button, Field, Money, useToast } from '@arenahub/ui';

import { receberPagamentoEmLote } from '../../../../actions/billing';
import {
  formatarMesAno,
  mesesDispensaveis,
  selecaoInicial,
  situacoesDosMeses,
  vigenteAte,
  type MesPagavelUI,
  type SituacaoDoMes,
} from '../../../../../src/billing/meses-pagaveis';
import { SeletorDeForma, type FormaDePagamento } from './seletor-de-forma';

import styles from './faixa-de-meses.module.css';

interface FaixaDeMesesProps {
  readonly faixa: readonly MesPagavelUI[];
  readonly subscriptionId: string;
  readonly onPago: () => void;
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

/** Hoje no relogio do navegador (a recepcao), como 'YYYY-MM-DD'. */
function hojeLocal(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/** A regra mora em `situacoesDosMeses`; aqui so o texto de cada situacao. */
const ROTULO_DA_SITUACAO: Record<SituacaoDoMes, string> = {
  vencido: 'Vencido',
  aVencer: 'A vencer',
  antecipar: 'Antecipar',
};

/**
 * Receber no balcao -- F83, Task 7, com a escolha LIVRE dos meses.
 *
 * Decisao do PI (01/10/2026): a academia funciona no modelo "pagou, usou",
 * sem contrato de 12 meses. A recepcao marca QUAIS meses recebe -- qualquer
 * combinacao da faixa, sem obrigar o mes anterior --, informa o DIA em que o
 * aluno pagou e, para cada mes anterior em aberto que ficou de fora, escolhe
 * dispensar (aluno nao usou) ou deixar em aberto. A vigencia conta da data do
 * pagamento: 30 dias por mes pago.
 *
 * O SERVIDOR SEMPRE RECALCULA (`receberPagamentoEmLote` -> `manual-payment-batch`):
 * `expectedTotalMinor` e conferencia optimista, nao autoridade. Se o total
 * mudar entre abrir a tela e clicar em "Receber", o servidor recusa com
 * `BILLING_BATCH_TOTAL_CHANGED` e `onPago` recarrega a faixa.
 */
export function FaixaDeMeses({ faixa, subscriptionId, onPago }: FaixaDeMesesProps) {
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(() => selecaoInicial(faixa));
  const [dispensados, setDispensados] = useState<ReadonlySet<string>>(() => new Set());
  const [dataPagamento, setDataPagamento] = useState('');
  const [forma, setForma] = useState<FormaDePagamento>('DINHEIRO');
  const [enviando, setEnviando] = useState(false);
  const [hoje, setHoje] = useState('');
  const { show } = useToast();

  // So no cliente: `hojeLocal()` no render do servidor (UTC) divergiria do
  // navegador perto da meia-noite e geraria erro de hidratacao.
  useEffect(() => {
    setDataPagamento(hojeLocal());
    setHoje(hojeLocal());
  }, []);

  const selecao = useMemo(() => faixa.filter((m) => selecionados.has(m.competencia)), [faixa, selecionados]);
  const total = useMemo(() => selecao.reduce((soma, m) => soma + m.totalMinor, 0), [selecao]);
  const dispensaveis = useMemo(() => mesesDispensaveis(faixa, selecionados), [faixa, selecionados]);
  const dispensadosValidos = useMemo(
    () => dispensaveis.filter((m) => dispensados.has(m.competencia)).map((m) => m.competencia),
    [dispensaveis, dispensados],
  );
  const dataValida = dataPagamento !== '' && dataPagamento <= hojeLocal();
  const situacoes = useMemo(() => situacoesDosMeses(faixa, hoje), [faixa, hoje]);

  function alternar(competencia: string): void {
    const proximo = new Set(selecionados);
    if (proximo.has(competencia)) {
      proximo.delete(competencia);
    } else {
      proximo.add(competencia);
    }
    setSelecionados(proximo);
  }

  function alternarDispensa(competencia: string): void {
    const proximo = new Set(dispensados);
    if (proximo.has(competencia)) {
      proximo.delete(competencia);
    } else {
      proximo.add(competencia);
    }
    setDispensados(proximo);
  }

  async function handleReceber(): Promise<void> {
    if (selecao.length === 0 || !dataValida) {
      return;
    }

    setEnviando(true);

    /*
     * `try/finally`: se a action LANCAR (500, rede), sem isto o botao ficava
     * preso em "Recebendo…" e a tela muda -- nenhum toast, nenhum refresh.
     * Quem estava no balcao nao sabia se o dinheiro tinha entrado.
     */
    try {
      const resultado = await receberPagamentoEmLote({
        subscriptionId,
        competencias: selecao.map((m) => m.competencia),
        dispensar: dispensadosValidos,
        paidAt: dataPagamento,
        channel: forma,
        expectedTotalMinor: total,
      });

      if (resultado.ok) {
        show(
          'info',
          `${selecao.length} ${selecao.length === 1 ? 'mês recebido' : 'meses recebidos'}`,
          'lote-recebido',
        );
      } else {
        show('warn', resultado.error, 'erro-lote');
      }
    } catch {
      show(
        'error',
        'Não foi possível confirmar o recebimento. Confira a grid antes de cobrar de novo.',
        'erro-lote',
      );
    } finally {
      setEnviando(false);
      onPago(); // recarrega a faixa e a grid com o estado do servidor
    }
  }

  return (
    <section aria-labelledby="titulo-faixa" className={styles['faixa']}>
      <h3 id="titulo-faixa">Receber no balcão</h3>

      <div className={styles['chips']}>
        {faixa.map((mes, indice) => {
          const marcado = selecionados.has(mes.competencia);
          const tom = situacoes[indice]!;
          const ehMesAtual = hoje !== '' && mes.competencia === hoje.slice(0, 7);

          return (
            <button
              key={mes.competencia}
              type="button"
              className={styles['chip']}
              data-selecionado={marcado ? 'true' : undefined}
              data-tom={tom}
              data-mes-atual={ehMesAtual ? 'true' : undefined}
              onClick={() => alternar(mes.competencia)}
              aria-pressed={marcado}
            >
              <span className={styles['mesAno']}>{formatarMesAno(mes.competencia)}</span>
              {ehMesAtual ? <span className={styles['marcaAtual']}>Mês atual</span> : null}
              <span className={styles['status']}>{ROTULO_DA_SITUACAO[tom]}</span>
              <span className={styles['valor']}>
                <Money cents={mes.totalMinor} />
              </span>
            </button>
          );
        })}
      </div>

      {dispensaveis.length > 0 ? (
        <fieldset className={styles['dispensa']}>
          <legend>Meses anteriores em aberto — o aluno não usou?</legend>
          {dispensaveis.map((mes) => (
            <label key={mes.competencia} className={styles['dispensaLinha']}>
              <input
                type="checkbox"
                checked={dispensados.has(mes.competencia)}
                onChange={() => alternarDispensa(mes.competencia)}
              />
              <span>
                Dispensar {formatarMesAno(mes.competencia)} (<Money cents={mes.totalMinor} />) — mês não usado
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {selecao.length > 0 ? (
        <p className={styles['resumo']}>
          {selecao.length} {selecao.length === 1 ? 'mês' : 'meses'} · {selecao.map((m) => formatarMesAno(m.competencia)).join(', ')} ·
          Total <Money cents={total} />
        </p>
      ) : null}

      <div className={styles['data']}>
        <Field
          id="data-do-pagamento"
          type="date"
          label="Data do pagamento"
          value={dataPagamento}
          max={hojeLocal()}
          onChange={(evento) => setDataPagamento(evento.target.value)}
          aria-required="true"
          {...(dataPagamento !== '' && !dataValida
            ? { invalid: true, error: 'A data do pagamento não pode ser futura.' }
            : {})}
        />
        {selecao.length > 0 && dataValida ? (
          <p className={styles['vigencia']}>
            Vigente até {formatarData(vigenteAte(dataPagamento, selecao.length))}.
          </p>
        ) : null}
      </div>

      <SeletorDeForma onEscolher={setForma} escolhida={forma} />

      <Button
        variant="solid"
        type="button"
        disabled={selecao.length === 0 || !dataValida || enviando}
        onClick={() => void handleReceber()}
      >
        {enviando ? 'Recebendo…' : 'Receber'}
      </Button>
    </section>
  );
}
