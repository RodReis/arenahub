import { Ausente } from '@arenahub/ui';

import estilos from './sessao.module.css';

/**
 * "Histórico da composição corporal" -- mock do PI: Data, Peso (kg),
 * M. esquelética (kg), Gordura (%).
 *
 * Vem de `GET /students/:id/body-evolution?period=ALL` -- cada mês traz
 * `metrics[]` com `WEIGHT`, `SKELETAL_MUSCLE_MASS` e `BODY_FAT_PERCENT`
 * quando existirem. Uma avaliação sem bioimpedância (só balança, por
 * exemplo) não tem as três: a célula ausente mostra `Ausente`, nunca `0`
 * (INV-104).
 */

export interface MetricaDoMes {
  readonly type: string;
  readonly value: number;
}

export interface MesDoHistorico {
  readonly assessedAtLocal: string;
  readonly metrics: readonly MetricaDoMes[];
}

interface Props {
  readonly meses: readonly MesDoHistorico[];
}

const UMA_CASA = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function valorDoTipo(metrics: readonly MetricaDoMes[], tipo: string): number | null {
  return metrics.find((metrica) => metrica.type === tipo)?.value ?? null;
}

function Celula({ valor, sufixo }: { valor: number | null; sufixo: string }) {
  return valor === null ? <Ausente /> : <>{`${UMA_CASA.format(valor)}${sufixo}`}</>;
}

/**
 * `assessedAtLocal` já chega como `AAAA-MM-DD` no fuso da unidade
 * (`dataLocalIso`, resolvido no servidor) -- não é um instante UTC, então
 * `TenantDateTime` (que aplica `timeZone` a um instante) reinterpretaria a
 * data errado. `DD/MM/AAAA` direto da string, sem `new Date()`.
 */
function dataLegivel(assessedAtLocal: string): string {
  const [ano, mes, dia] = assessedAtLocal.split('-');

  return ano && mes && dia ? `${dia}/${mes}/${ano}` : assessedAtLocal;
}

export function HistoricoDeComposicao({ meses }: Props) {
  return (
    <section className={estilos['painel']} aria-labelledby="titulo-historico-composicao">
      <h2 id="titulo-historico-composicao">Histórico da composição corporal</h2>

      {meses.length === 0 ? (
        <p data-testid="historico-vazio">
          <Ausente /> nenhuma avaliação publicada ainda
        </p>
      ) : (
        <table className={estilos['tabela']} data-testid="tabela-historico-composicao">
          <caption>Peso, massa muscular esquelética e gordura por avaliação</caption>
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Peso (kg)</th>
              <th scope="col">M. esquelética (kg)</th>
              <th scope="col">Gordura (%)</th>
            </tr>
          </thead>
          <tbody>
            {meses.map((mes) => (
              <tr key={mes.assessedAtLocal}>
                <td>
                  <time dateTime={mes.assessedAtLocal}>{dataLegivel(mes.assessedAtLocal)}</time>
                </td>
                <td>
                  <Celula valor={valorDoTipo(mes.metrics, 'WEIGHT')} sufixo=" kg" />
                </td>
                <td>
                  <Celula valor={valorDoTipo(mes.metrics, 'SKELETAL_MUSCLE_MASS')} sufixo=" kg" />
                </td>
                <td>
                  <Celula valor={valorDoTipo(mes.metrics, 'BODY_FAT_PERCENT')} sufixo="%" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
