/**
 * Regras puras da reconciliacao de pagamentos de setembro/2026 (relatorio de
 * 01 a 30/09).
 *
 * FONTE DE VERDADE (decisao do PI, 01/10/2026): o relatorio de pagamentos diz
 * quem pagou e quanto; o VALOR escolhe o plano (preco vigente em set/2026).
 * Valor que nao e preco de nenhum plano nao e adivinhado: vira pendencia.
 *
 * O relatorio nao tem CPF -- o nome casa com a linha da catraca, e o CPF da
 * catraca casa com a base (mesma ponte da #450). Sem banco, sem rede, sem
 * relogio.
 */
import { cpfEhValido, normalizarCpf } from '../../modules/students/domain/identificacao.js';
import { normalizarNome, paraCentavos, parsearDataBr } from '../import-pagamentos-set2026/dominio.js';

export interface Pagamento {
  nome: string;
  data: string;
  valor: number;
}

export interface PlanoPorValor {
  id: string;
  nome: string;
}

export interface AlunoDaBase {
  id: string;
  nome: string;
  cpf: string | null;
  status: string;
  profile: string;
  assinaturaAtivaId: string | null;
  planoId: string | null;
  faturaSet: { id: string; status: string; totalMinor: number } | null;
}

export type Acao =
  | { tipo: 'TROCAR_PLANO'; planoId: string; planoNome: string }
  | { tipo: 'CORRIGIR_VALOR'; faturaId: string; valorMinor: number }
  | { tipo: 'ABRIR_FATURA' }
  | { tipo: 'DAR_BAIXA'; faturaId: string | null; valorMinor: number; pagoEm: Date };

export interface PlanoDoPagamento {
  pagamento: Pagamento;
  studentId: string | null;
  acoes: Acao[];
  pendencia: string | null;
}

/** Nome normalizado -> CPFs da catraca com esse nome. */
export type CpfsPorNome = ReadonlyMap<string, readonly string[]>;

function casar(nome: string, cpfsPorNome: CpfsPorNome, alunos: readonly AlunoDaBase[]): AlunoDaBase | 'AMBIGUO' | null {
  for (const cpf of cpfsPorNome.get(normalizarNome(nome)) ?? []) {
    if (!cpfEhValido(cpf)) continue;
    const alvo = normalizarCpf(cpf);
    const porCpf = alunos.filter((a) => a.cpf !== null && normalizarCpf(a.cpf) === alvo);
    if (porCpf.length === 1) return porCpf[0]!;
  }

  const porNome = alunos.filter((a) => normalizarNome(a.nome) === normalizarNome(nome));
  if (porNome.length > 1) return 'AMBIGUO';
  return porNome[0] ?? null;
}

function acoesDaFatura(aluno: AlunoDaBase, valorMinor: number, pagoEm: Date): Acao[] | string {
  const fatura = aluno.faturaSet;

  if (!fatura) return [{ tipo: 'ABRIR_FATURA' }, { tipo: 'DAR_BAIXA', faturaId: null, valorMinor, pagoEm }];

  if (fatura.status === 'PAID') {
    return fatura.totalMinor === valorMinor ? [] : 'FATURA_PAGA_VALOR_DIVERGENTE';
  }

  if (fatura.status !== 'OPEN' && fatura.status !== 'OVERDUE') return `FATURA_${fatura.status}`;

  const corrigir: Acao[] =
    fatura.totalMinor === valorMinor ? [] : [{ tipo: 'CORRIGIR_VALOR', faturaId: fatura.id, valorMinor }];

  return [...corrigir, { tipo: 'DAR_BAIXA', faturaId: fatura.id, valorMinor, pagoEm }];
}

function planejarUm(
  pagamento: Pagamento,
  repetido: boolean,
  cpfsPorNome: CpfsPorNome,
  alunos: readonly AlunoDaBase[],
  planosPorValor: ReadonlyMap<number, PlanoPorValor>,
): PlanoDoPagamento {
  const resultado = (studentId: string | null, acoes: Acao[], pendencia: string | null): PlanoDoPagamento => ({
    pagamento,
    studentId,
    acoes,
    pendencia,
  });

  if (repetido) return resultado(null, [], 'PAGAMENTO_REPETIDO');

  const aluno = casar(pagamento.nome, cpfsPorNome, alunos);

  if (aluno === 'AMBIGUO') return resultado(null, [], 'AMBIGUO');
  if (aluno === null) return resultado(null, [], 'SEM_ALUNO');
  if (aluno.profile !== 'STUDENT') return resultado(aluno.id, [], `PERFIL_${aluno.profile}`);
  if (aluno.status !== 'ACTIVE') return resultado(aluno.id, [], `STATUS_${aluno.status}`);
  if (!aluno.assinaturaAtivaId) return resultado(aluno.id, [], 'SEM_ASSINATURA_ATIVA');

  const valorMinor = paraCentavos(pagamento.valor);
  const plano = planosPorValor.get(valorMinor);

  if (!plano) return resultado(aluno.id, [], 'VALOR_SEM_PLANO');

  const fatura = acoesDaFatura(aluno, valorMinor, parsearDataBr(pagamento.data));

  if (typeof fatura === 'string') return resultado(aluno.id, [], fatura);

  const troca: Acao[] =
    aluno.planoId === plano.id ? [] : [{ tipo: 'TROCAR_PLANO', planoId: plano.id, planoNome: plano.nome }];

  return resultado(aluno.id, [...troca, ...fatura], null);
}

/** Um plano por linha do relatorio; nome com mais de uma linha vira pendencia. */
export function planejarPagamentos(
  pagamentos: readonly Pagamento[],
  cpfsPorNome: CpfsPorNome,
  alunos: readonly AlunoDaBase[],
  planosPorValor: ReadonlyMap<number, PlanoPorValor>,
): PlanoDoPagamento[] {
  const contagem = new Map<string, number>();
  for (const p of pagamentos) {
    const chave = normalizarNome(p.nome);
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }

  return pagamentos.map((p) =>
    planejarUm(p, (contagem.get(normalizarNome(p.nome)) ?? 0) > 1, cpfsPorNome, alunos, planosPorValor),
  );
}
