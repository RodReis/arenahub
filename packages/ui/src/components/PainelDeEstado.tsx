import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon.js';
import estilos from './PainelDeEstado.module.css';

/** Os seis tons do DS-PAINEL §2.3 -- os mesmos do `StateBadge`, de proposito. */
export type TomDeEstado = 'success' | 'warning' | 'danger' | 'info' | 'risk' | 'neutral';

interface Props {
  /** Overline do painel: o que o valor mede ("Situação atual", "Recebido no mês"). */
  readonly rotulo: string;
  readonly tom: TomDeEstado;
  /** Glifo do selo. Decorativo -- quem informa e o `rotulo`. */
  readonly icone: IconName;
  /**
   * Liga a intensidade de ALERTA: fundo inteiro tingido, degrade mais forte.
   * So quando o proprio numero e o problema -- divida em aberto, bloqueio
   * proximo. Em repouso o painel fica tingido de leve.
   */
  readonly emAlerta?: boolean;
  /** O numero e o que o acompanha na mesma linha de base (badge, moeda). */
  readonly children: ReactNode;
  /** Linha de apoio abaixo do valor: vencimento, competencia, urgencia. */
  readonly apoio?: ReactNode;
  readonly testId?: string;
}

/**
 * Painel de estado -- superficie tingida pelo tom do que ela mede.
 *
 * O QUE ELE E: o card de KPI da tela de cobranca, extraido para o design
 * system. Aresta superior de 3 px no tom, degrade de 165° que some antes do
 * meio, selo de 32 px a direita do rotulo (DS-PAINEL §4.6, emenda de
 * 28/09/2026 -- decisao do PI, "nao quero card branco simples").
 *
 * POR QUE VIROU COMPONENTE: aquilo nasceu como `estiloDoKpi`, `SeloDoTom` e
 * `CabecalhoDoKpi`, tres helpers privados de UMA tela. A segunda tela que
 * precisasse do mesmo tratamento copiaria os tres -- e copia foi como o
 * painel financeiro e a inadimplencia acabaram com dois vermelhos diferentes
 * para a mesma faixa de atraso. Um componente so tem um vermelho so.
 *
 * O QUE ELE NAO FAZ: nao escolhe o tom. Quem chama sabe se `OVERDUE` e
 * `danger` ou `risk`; o painel so pinta. Enfiar a maquina de estado aqui
 * dentro repetiria o `state-labels.ts` com outro nome.
 *
 * COR NUNCA E CANAL UNICO (§10 item 1, `M1-NFR-008`): o selo e `aria-hidden`
 * e o rotulo textual carrega o sentido. Valor em `text-strong` e rotulo em
 * `text-secondary` nos dois niveis de intensidade -- o contraste nao cede
 * para a cor entrar.
 */
export function PainelDeEstado({
  rotulo,
  tom,
  icone,
  emAlerta = false,
  children,
  apoio,
  testId,
}: Props) {
  return (
    <div
      className={estilos['painel']}
      data-tom={tom}
      data-alerta={emAlerta ? 'true' : undefined}
      data-testid={testId}
    >
      <div className={estilos['cabecalho']}>
        <p className={estilos['rotulo']}>{rotulo}</p>
        <span className={estilos['selo']} aria-hidden="true">
          <Icon name={icone} />
        </span>
      </div>

      <div className={estilos['corpo']}>{children}</div>

      {apoio !== undefined ? <div className={estilos['apoio']}>{apoio}</div> : null}
    </div>
  );
}
