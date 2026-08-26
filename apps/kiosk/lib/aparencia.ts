/**
 * Precedencia do alto contraste -- ADR-042, Decisao 6.
 *
 * A unidade define o padrao de BOOT (`altoContrastePadrao`). O aluno tem um
 * interruptor na tela, e a escolha dele SEMPRE vence enquanto ele estiver
 * usando: gerente nao desliga acessibilidade de quem esta na frente do totem.
 * Encerrada a sessao, a escolha morre e o padrao da unidade volta -- o proximo
 * aluno nao herda a preferencia do anterior (que tambem e privacidade: a
 * escolha diz algo sobre a visao de quem passou por ali).
 *
 * PURA: sem DOM, sem storage. `null` significa "o aluno nao escolheu".
 */
export function contrasteEfetivo(
  escolhaDoAluno: boolean | null,
  padraoDaUnidade: boolean,
): boolean {
  return escolhaDoAluno ?? padraoDaUnidade;
}
