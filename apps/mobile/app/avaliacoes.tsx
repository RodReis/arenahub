import { Redirect } from 'expo-router';

/**
 * `/avaliacoes` virou a aba Evolução no App Mobile v2.
 *
 * Mesmo motivo de `financeiro.tsx`: o aviso `OPEN_HEALTH` do servidor aponta
 * para esta rota, e aviso ja entregue nao se reescreve.
 */
export default function Avaliacoes() {
  return <Redirect href="/evolucao" />;
}
