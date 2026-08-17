import { Button } from './Button.js';
import { Icon } from './Icon.js';
import { TenantDateTime } from './TenantDateTime.js';
import estilos from './DataFreshness.module.css';

type Estado = 'current' | 'stale' | 'unavailable';

interface Props {
  readonly state: Estado;
  readonly at?: string | null;
  readonly timeZone: string;
  readonly onReload?: () => void;
}

/**
 * Tres estados, NUNCA colapsados -- DS-PAINEL.md §8.2.
 *
 * "Desatualizado" e "indisponivel" pedem acoes diferentes: no primeiro ha dado
 * antigo na tela e a operacao decide se serve; no segundo nao ha dado nenhum.
 * Colapsar os dois em "erro" faz a recepcao tratar cache de tres minutos como
 * catraca fora do ar.
 */
export function DataFreshness({ state, at, timeZone, onReload }: Props) {
  if (state === 'unavailable') {
    return (
      <p className={estilos['indisponivel']} role="status">
        <Icon name="alert-circle" />
        Não foi possível carregar
        {onReload ? (
          <Button variant="ghost" onClick={onReload}>
            Recarregar
          </Button>
        ) : null}
      </p>
    );
  }

  return (
    <p className={estilos['carimbo']} data-state={state}>
      <Icon name={state === 'stale' ? 'alert-circle' : 'clock'} />
      Atualizado às <TenantDateTime iso={at ?? null} timeZone={timeZone} format="time" />
    </p>
  );
}
