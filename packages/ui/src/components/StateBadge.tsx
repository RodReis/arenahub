import { Ausente } from './Ausente.js';
import { Icon } from './Icon.js';
import { stateLabel, type StateMachine } from '../domain/state-labels.js';
import estilos from './StateBadge.module.css';

interface Props {
  readonly machine: StateMachine;
  readonly state: string;
  /**
   * Liga `role="status"` -- DS-PAINEL.md §7: estado que muda em tempo real
   * precisa ser anunciado. Fica DESLIGADO por padrao porque uma tabela de 20
   * linhas com `role="status"` em cada celula transforma o leitor de tela num
   * despejo continuo.
   */
  readonly live?: boolean;
}

export function StateBadge({ machine, state, live = false }: Props) {
  const rotulo = stateLabel(machine, state);

  /**
   * Estado desconhecido vira `—`, nao badge vazio nem codigo em ingles.
   * Acontece de verdade: enum novo no backend chega antes do rotulo aqui.
   *
   * Reusa `<Ausente />` em vez de repetir o `aria-label`: o §10 item 5 exige
   * UM texto alternativo, e duas copias divergem na primeira correcao.
   */
  if (!rotulo) {
    return (
      <span className={estilos['ausente']}>
        <Ausente />
      </span>
    );
  }

  return (
    <span
      className={estilos['badge']}
      data-tone={rotulo.tone}
      {...(live ? { role: 'status' } : {})}
    >
      <Icon name={rotulo.icon} />
      {rotulo.label}
    </span>
  );
}
