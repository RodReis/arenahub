/**
 * Estado de preenchimento de um passo do cadastro — F45.
 *
 * PURA, e por isso fora do componente: recebe tudo por parâmetro (CLAUDE.md
 * → Convenções de código, "funções de cálculo puras"). Dentro do componente
 * ela fechava sobre três estados do React e não havia como testá-la sem
 * montar o wizard inteiro.
 */

/** Um campo obrigatório e o passo em que ele mora. */
export interface CampoObrigatorio {
  readonly campo: string;
  readonly passo: number;
}

export type EstadoDoPasso = 'pronto' | 'pendente' | 'aberto';

/**
 * Diz o que FALTA num passo — nunca por onde a pessoa passou.
 *
 * O código anterior usava `indice < passo`, isto é, POSIÇÃO: quem pulasse do
 * passo 1 direto ao 4 via 1, 2 e 3 carimbados como concluídos sem ter
 * digitado nada. A trilha existe para responder *quanto falta*, e respondia
 * *por onde passei*; numa tela de vinte e dois campos as duas perguntas não
 * são a mesma, e a errada é a que dá confiança falsa.
 *
 * `aberto` é o padrão em dois casos diferentes, e isso é deliberado:
 * passo sem nenhum obrigatório (endereço, plano) não tem o que concluir, e
 * passo incompleto antes da primeira tentativa de envio ainda não é erro.
 * Nos dois, a trilha não afirma nada — que é mais honesto que carimbar.
 *
 * @param indice        o passo avaliado
 * @param obrigatorios  todos os campos obrigatórios do formulário
 * @param valorDe       lê o que foi digitado num campo
 * @param jaTentouEnviar `true` depois do primeiro clique em "Cadastrar aluno"
 */
export function estadoDoPasso(
  indice: number,
  obrigatorios: readonly CampoObrigatorio[],
  valorDe: (campo: string) => string,
  jaTentouEnviar: boolean,
): EstadoDoPasso {
  const doPasso = obrigatorios.filter((o) => o.passo === indice);

  if (doPasso.length === 0) return 'aberto';

  const incompleto = doPasso.some((o) => valorDe(o.campo).trim() === '');

  if (!incompleto) return 'pronto';

  // Cobra só DEPOIS da tentativa de envio: pintar de vermelho um campo que a
  // pessoa ainda nem alcançou é acusar antes de haver erro.
  return jaTentouEnviar ? 'pendente' : 'aberto';
}
