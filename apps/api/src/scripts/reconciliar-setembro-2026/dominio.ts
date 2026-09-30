/**
 * Regras puras da reconciliacao de setembro/2026 -- issue #450.
 *
 * FONTE DE VERDADE (decisao do PI, 29/09/2026): o export da catraca
 * (Topdata, 26/09) diz quem e aluno; o relatorio de pagamentos diz quem
 * pagou. Aluno da catraca que pagou = pagante; que nao pagou = inadimplente.
 *
 * O relatorio nao tem CPF -- o nome dele casa com a linha da catraca, e o
 * CPF da catraca casa com a base. Casar direto nome-com-base foi o que deixou
 * 41 pagamentos de fora na #386.
 *
 * Sem banco, sem rede, sem relogio (`CLAUDE.md`).
 */
import { cpfEhValido, normalizarCpf } from '../../modules/students/domain/identificacao.js';
import { normalizarNome, paraCentavos, parsearDataBr } from '../import-pagamentos-set2026/dominio.js';

export interface PessoaDaCatraca {
  nome: string;
  cpf: string;
  /** `Permissoes de Acesso` do Topdata: 1 = aluno; 3/4 = time. */
  permissao: string;
  nascimento: Date | null;
  telefone: string;
  email: string;
}

export interface Pagamento {
  nome: string;
  data: string;
  valor: number;
}

export interface AlunoDaBase {
  id: string;
  nome: string;
  cpf: string | null;
  status: string;
  profile: string;
  assinaturaAtivaId: string | null;
  /** Plano da assinatura mais recente -- a nova assinatura herda ele. */
  planoId: string | null;
  /** Assinaturas nao-ACTIVE que ainda seguram entitlement ACTIVE (#450). */
  orfas: { id: string; versao: number }[];
  faturaSet: { id: string; status: string; totalMinor: number } | null;
}

export type Acao =
  | { tipo: 'CRIAR_ALUNO' }
  | { tipo: 'REATIVAR_ALUNO' }
  | { tipo: 'ATIVAR_ASSINATURA'; planoId: string | null }
  | { tipo: 'CANCELAR_ORFA'; assinaturaId: string; versao: number }
  | { tipo: 'ABRIR_FATURA' }
  | { tipo: 'DAR_BAIXA'; faturaId: string | null; totalMinor: number | null; valorMinor: number; pagoEm: Date };

export interface PlanoDaPessoa {
  pessoa: PessoaDaCatraca;
  studentId: string | null;
  pagou: boolean;
  acoes: Acao[];
  pendencia: string | null;
}

function casar(pessoa: PessoaDaCatraca, alunos: readonly AlunoDaBase[]): AlunoDaBase | 'AMBIGUO' | null {
  if (cpfEhValido(pessoa.cpf)) {
    const cpf = normalizarCpf(pessoa.cpf);
    const porCpf = alunos.find((a) => a.cpf !== null && normalizarCpf(a.cpf) === cpf);
    if (porCpf) return porCpf;
  }

  const nome = normalizarNome(pessoa.nome);
  const porNome = alunos.filter((a) => normalizarNome(a.nome) === nome);

  if (porNome.length > 1) return 'AMBIGUO';
  return porNome[0] ?? null;
}

function baixa(pagamento: Pagamento, fatura: AlunoDaBase['faturaSet']): Acao {
  return {
    tipo: 'DAR_BAIXA',
    faturaId: fatura?.id ?? null,
    totalMinor: fatura?.totalMinor ?? null,
    valorMinor: paraCentavos(pagamento.valor),
    pagoEm: parsearDataBr(pagamento.data),
  };
}

function planejarPessoa(
  pessoa: PessoaDaCatraca,
  pagamentos: readonly Pagamento[],
  alunos: readonly AlunoDaBase[],
): PlanoDaPessoa {
  const pagou = pagamentos.length > 0;
  const plano = (studentId: string | null, acoes: Acao[], pendencia: string | null = null): PlanoDaPessoa => ({
    pessoa,
    studentId,
    pagou,
    acoes,
    pendencia,
  });

  if (pagamentos.length > 1) return plano(null, [], 'PAGAMENTO_REPETIDO');

  const pagamento = pagamentos[0];
  const encontrado = casar(pessoa, alunos);

  if (encontrado === 'AMBIGUO') return plano(null, [], 'AMBIGUO');

  if (encontrado === null) {
    if (!pessoa.nascimento) return plano(null, [], 'SEM_NASCIMENTO');

    const acoes: Acao[] = [{ tipo: 'CRIAR_ALUNO' }, { tipo: 'ATIVAR_ASSINATURA', planoId: null }, { tipo: 'ABRIR_FATURA' }];
    if (pagamento) acoes.push(baixa(pagamento, null));
    return plano(null, acoes);
  }

  if (encontrado.profile !== 'STUDENT') return plano(encontrado.id, [], `PERFIL_${encontrado.profile}`);

  const acoes: Acao[] = [];

  if (encontrado.status === 'CANCELLED') {
    if (!pagamento) return plano(encontrado.id, [], 'CANCELADO_SEM_PAGAMENTO');
    acoes.push({ tipo: 'REATIVAR_ALUNO' });
  } else if (encontrado.status !== 'ACTIVE' && !encontrado.assinaturaAtivaId) {
    return plano(encontrado.id, [], `STATUS_${encontrado.status}`);
  }

  if (!encontrado.assinaturaAtivaId) {
    // ANTES de cancelar a orfa: o novo direito existe antes de o antigo ser
    // revogado, entao a catraca nao fecha nem por um instante.
    acoes.push({ tipo: 'ATIVAR_ASSINATURA', planoId: encontrado.planoId });
    for (const orfa of encontrado.orfas) {
      acoes.push({ tipo: 'CANCELAR_ORFA', assinaturaId: orfa.id, versao: orfa.versao });
    }
  }

  if (!encontrado.faturaSet) acoes.push({ tipo: 'ABRIR_FATURA' });

  if (pagamento && encontrado.faturaSet?.status !== 'PAID') acoes.push(baixa(pagamento, encontrado.faturaSet));

  return plano(encontrado.id, acoes);
}

/** Um plano por pessoa-aluno da catraca. Time (permissao != 1) fica de fora. */
export function planejarReconciliacao(
  pessoas: readonly PessoaDaCatraca[],
  pagamentos: readonly Pagamento[],
  alunos: readonly AlunoDaBase[],
): PlanoDaPessoa[] {
  const pagamentosPorNome = new Map<string, Pagamento[]>();
  for (const p of pagamentos) {
    const chave = normalizarNome(p.nome);
    pagamentosPorNome.set(chave, [...(pagamentosPorNome.get(chave) ?? []), p]);
  }

  return pessoas
    .filter((p) => p.permissao === '1')
    .map((p) => planejarPessoa(p, pagamentosPorNome.get(normalizarNome(p.nome)) ?? [], alunos));
}

/** Pagamentos cujo nome nao existe na catraca -- nao ha como saber de quem sao. */
export function pagamentosSemPessoa(pessoas: readonly PessoaDaCatraca[], pagamentos: readonly Pagamento[]): Pagamento[] {
  const nomes = new Set(pessoas.map((p) => normalizarNome(p.nome)));
  return pagamentos.filter((p) => !nomes.has(normalizarNome(p.nome)));
}
