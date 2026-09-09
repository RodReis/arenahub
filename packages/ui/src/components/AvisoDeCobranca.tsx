import { Money } from './Money.js';
import estilos from './AvisoDeCobranca.module.css';

interface Props {
  /** Dias inteiros que faltam para o gate fechar. Negativo apos esgotada. */
  readonly diasRestantes: number;
  /** Soma das faturas vencidas, na menor unidade monetaria. */
  readonly emAbertoMinor: number;
  /** `true` quando o gate ja fechou a catraca deste tenant. */
  readonly suspensa: boolean;
}

/**
 * Faixa PERSISTENTE de cobranca vencida -- F65, Task 9.
 *
 * ESPELHA `ElevatedSessionBanner` de proposito: mesmo precedente visual, mesma
 * faixa nao dispensavel no topo do `AppShell`. O dono da academia precisa
 * saber, sem abrir tela nenhuma, quanto falta ate a catraca fechar.
 *
 * Sem prop `onDismiss`, pelo mesmo motivo do precedente: dispensar o aviso
 * nao muda o prazo nem a divida, so escondia o problema da tela.
 */
export function AvisoDeCobranca({ diasRestantes, emAbertoMinor, suspensa }: Props) {
  return (
    <div className={estilos['faixa']} role="status" data-testid="faixa-de-cobranca">
      <span className={estilos['texto']}>
        {suspensa ? (
          <>
            Acesso bloqueado por falta de pagamento
          </>
        ) : (
          <>Fatura em atraso -- fecha em {formatarPrazo(diasRestantes)}</>
        )}{' '}
        · em aberto: <Money cents={emAbertoMinor} />
      </span>
    </div>
  );
}

/**
 * "Faltam 0 dias" nao avisa ninguem -- "hoje" diz que e AGORA. Extraida
 * porque a mesma regra (0 e "hoje", nao "0 dias") vale em qualquer lugar que
 * `avaliarCarencia` alimentar no futuro.
 */
function formatarPrazo(diasRestantes: number): string {
  if (diasRestantes === 0) return 'hoje';
  if (diasRestantes === 1) return '1 dia';

  return `${diasRestantes} dias`;
}
