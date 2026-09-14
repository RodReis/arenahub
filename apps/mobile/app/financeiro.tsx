import { Redirect } from 'expo-router';

/**
 * `/financeiro` virou a aba Planos no App Mobile v2.
 *
 * A rota continua existindo porque o SERVIDOR a emite: o aviso `OPEN_INVOICE`
 * da caixa de avisos (F29) aponta para ca, e aviso ja entregue no aparelho
 * nao se reescreve. Sem este desvio, tocar num aviso antigo abriria "rota nao
 * encontrada".
 */
export default function Financeiro() {
  return <Redirect href="/planos" />;
}
