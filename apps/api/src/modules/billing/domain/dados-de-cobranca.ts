/**
 * Que dados de cadastro o pagamento com CARTAO exige — e por que os outros
 * dois caminhos nao exigem nada.
 *
 * O antifraude da Getnet bloqueia `customer` incompleto (SPEC-053 §9): nome,
 * e-mail, telefone, CPF e endereco de cobranca. Dinheiro e PIX nao passam
 * pelo antifraude, entao exigir cadastro completo neles barraria recebimento
 * legitimo -- o aluno legado sem CPF paga em especie normalmente.
 *
 * PURA de proposito: nao le banco nem chama provedor. A tela precisa da
 * mesma resposta ANTES de clicar (para desabilitar a opcao com o motivo) e o
 * caso de uso precisa dela DEPOIS (para recusar sem gastar requisicao). Duas
 * copias da regra divergiriam no primeiro campo novo.
 */

export type DadoFaltante = 'CPF' | 'ENDERECO';

export interface DadosDoAluno {
  /** Anulavel: a coluna e `String?` e 308 alunos do Pacto nao tem (ADR-034). */
  readonly cpf: string | null;
  readonly temEndereco: boolean;
}

export function faltaParaCartao(aluno: DadosDoAluno): readonly DadoFaltante[] {
  const faltando: DadoFaltante[] = [];

  // `trim()`: importacao antiga produz string vazia, que nao e CPF.
  if (aluno.cpf === null || aluno.cpf.trim() === '') {
    faltando.push('CPF');
  }

  if (!aluno.temEndereco) {
    faltando.push('ENDERECO');
  }

  return faltando;
}
