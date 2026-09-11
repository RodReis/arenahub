import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon.js';
import estilos from './SummaryStrip.module.css';

export interface CelulaDeResumo {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly value: ReactNode;
  /** Uma linha de contexto sob o numero -- o que ele decompoe, ou de quando e. */
  readonly hint?: string;
  /**
   * O tom vem do ESTADO que o numero descreve, e some quando nao ha estado:
   * "clientes ativos" nao e uma boa noticia, e um numero verde por ser numero
   * gastaria a cor que o alerta de inadimplencia precisa.
   */
  readonly tom?: 'positivo' | 'atencao' | 'risco';
}

interface Props {
  readonly celulas: readonly CelulaDeResumo[];
  /** Nome acessivel do grupo. Ex.: "Resumo da carteira". */
  readonly label: string;
  readonly testId?: string;
}

/**
 * Faixa de resumo -- o numero que se le de longe, acima da tabela.
 *
 * `<dl>` E NAO UMA GRADE DE CARDS: cada celula e um par rotulo/valor, e a
 * lista de definicao e o que o leitor de tela anuncia como tal. Uma grade de
 * `<div>` com um numero grande dentro e o "hero-metric template" -- forma sem
 * semantica, que soa como texto solto em audio.
 *
 * CADA CELULA CARREGA TRES CANAIS quando tem tom: o fundo tingido, o glifo na
 * cor cheia e o rotulo textual. Quem nao distingue as cores le o rotulo; quem
 * usa audio ouve o par completo.
 */
export function SummaryStrip({ celulas, label, testId }: Props) {
  return (
    <dl className={estilos['faixa']} aria-label={label} data-testid={testId}>
      {celulas.map((celula) => (
        <div
          key={celula.id}
          className={estilos['celula']}
          data-tom={celula.tom}
          data-testid={`resumo-${celula.id}`}
        >
          <dt className={estilos['rotulo']}>
            <Icon name={celula.icon} />
            {celula.label}
          </dt>
          <dd className={estilos['valor']}>{celula.value}</dd>
          {celula.hint !== undefined ? (
            <dd className={estilos['apoio']}>{celula.hint}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
