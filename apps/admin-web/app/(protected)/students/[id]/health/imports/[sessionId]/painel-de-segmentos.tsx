import { Ausente, StateBadge } from '@arenahub/ui';

import estilos from './sessao.module.css';

/**
 * "Gordura por segmento" e "Massa muscular por segmento" -- mock do PI.
 *
 * Cinco linhas fixas (braço esquerdo/direito, tronco, perna esquerda/direita),
 * vindas de `GET /students/:id/body-evolution` (mesmo formato do boneco do
 * app/totem -- `RegiaoCorporal`, `body-evolution.service.ts`).
 *
 * O mock pede "kg e o percentual do padrão" por linha; o `body-evolution` só
 * devolve `fatMassKg`/`muscleMassKg` e a LEITURA já resolvida contra a faixa
 * do fabricante (`fatReading`/`muscleReading`) -- não o percentual numérico
 * em si (esse só existe em `campos[].standardPercent`, na sessão de
 * importação, não no histórico consolidado). A barra mostra kg mais o badge
 * de leitura no lugar do percentual; inventar um número aqui violaria a
 * regra de não fabricar dado.
 *
 * NÃO reusa `BarrasDeFaixa` do design system: aquele componente resolve
 * ausência como barra de valor zero e omite a linha do gráfico ("faixa
 * zerada sai do gráfico") -- comportamento certo para faixa de atraso
 * financeiro, errado aqui: medida segmentar ausente é `—` (INV-104), nunca
 * uma barra de largura zero que parece "sem gordura ali".
 */

export interface MedidaDoSegmento {
  readonly fatMassKg: number | null;
  readonly muscleMassKg: number | null;
  readonly fatReading: 'BELOW' | 'WITHIN' | 'ABOVE' | 'AT_LIMIT' | 'UNKNOWN';
  readonly muscleReading: 'BELOW' | 'WITHIN' | 'ABOVE' | 'AT_LIMIT' | 'UNKNOWN';
}

export type RegiaoCorporal = 'ARM_LEFT' | 'ARM_RIGHT' | 'TRUNK' | 'LEG_LEFT' | 'LEG_RIGHT';

const ROTULO_DA_REGIAO: Record<RegiaoCorporal, string> = {
  ARM_LEFT: 'Braço esquerdo',
  ARM_RIGHT: 'Braço direito',
  TRUNK: 'Tronco',
  LEG_LEFT: 'Perna esquerda',
  LEG_RIGHT: 'Perna direita',
};

const ORDEM_DAS_REGIOES: readonly RegiaoCorporal[] = [
  'ARM_LEFT',
  'ARM_RIGHT',
  'TRUNK',
  'LEG_LEFT',
  'LEG_RIGHT',
];

const UMA_CASA = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

interface Props {
  readonly titulo: string;
  readonly regioes: Readonly<Record<RegiaoCorporal, MedidaDoSegmento>> | null;
  /** `'fat'` monta com `fatMassKg`; `'muscle'` monta com `muscleMassKg`. */
  readonly chave: 'fat' | 'muscle';
  readonly testId: string;
}

/** Maior valor entre as cinco regiões -- serve de teto para a largura relativa da barra. */
function maiorValor(regioes: Readonly<Record<RegiaoCorporal, MedidaDoSegmento>>, chave: 'fat' | 'muscle'): number {
  let maior = 0;

  for (const regiao of ORDEM_DAS_REGIOES) {
    const valor = chave === 'fat' ? regioes[regiao].fatMassKg : regioes[regiao].muscleMassKg;

    if (valor !== null && valor > maior) maior = valor;
  }

  return maior;
}

export function PainelDeSegmentos({ titulo, regioes, chave, testId }: Props) {
  const idDoTitulo = `titulo-${testId}`;

  if (regioes === null) {
    return (
      <section className={estilos['painel']} aria-labelledby={idDoTitulo} data-testid={testId}>
        <h2 id={idDoTitulo}>{titulo}</h2>
        <p>
          <Ausente /> nenhuma medição segmentar publicada ainda
        </p>
      </section>
    );
  }

  const teto = maiorValor(regioes, chave);

  return (
    <section className={estilos['painel']} aria-labelledby={idDoTitulo} data-testid={testId}>
      <h2 id={idDoTitulo}>{titulo}</h2>

      <table className={estilos['tabelaDeSegmentos']}>
        <caption>{titulo}, por segmento corporal</caption>
        <tbody>
          {ORDEM_DAS_REGIOES.map((regiao) => {
            const medida = regioes[regiao];
            const valor = chave === 'fat' ? medida.fatMassKg : medida.muscleMassKg;
            const leitura = chave === 'fat' ? medida.fatReading : medida.muscleReading;
            const largura = valor === null || teto === 0 ? 0 : Math.round((valor / teto) * 100);

            return (
              <tr key={regiao}>
                <th scope="row">{ROTULO_DA_REGIAO[regiao]}</th>
                <td>
                  <div className={estilos['trilhaDaBarra']}>
                    <div className={estilos['barraDoSegmento']} style={{ width: `${largura}%` }} />
                  </div>
                </td>
                <td className={estilos['valorDoSegmento']}>
                  {valor === null ? <Ausente /> : `${UMA_CASA.format(valor)} kg`}
                </td>
                <td>
                  <StateBadge machine="leitura" state={leitura} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
