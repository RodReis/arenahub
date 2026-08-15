import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Estados do aluno. Espelha `StudentStatus` do Prisma, declarado aqui como
 * tipo proprio para que a maquina de estados nao dependa do client gerado --
 * funcao pura nao importa banco (`CLAUDE.md`, Convencoes de codigo).
 */
export type StatusDeAluno =
  | 'LEAD'
  | 'TRIAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'ARCHIVED';

/**
 * Transicao invalida de estado do aluno.
 *
 * Codigo estavel (`CLAUDE.md`, Convencoes): `409` porque o pedido esta bem
 * formado -- o conflito e com o estado atual, nao com a sintaxe. `400` diria
 * "voce escreveu errado", que e falso.
 */
export class TransicaoDeAlunoInvalidaError extends ErroDeDominio {
  constructor(
    readonly atual: StatusDeAluno,
    readonly alvo: StatusDeAluno,
  ) {
    super('STUDENT_INVALID_TRANSITION', 409, `Transicao invalida: ${atual} para ${alvo}`);
  }
}

/**
 * Tabela de transicoes do ciclo de vida do aluno.
 *
 * ORIGEM DESTA TABELA, e por que ela merece atencao na revisao: o
 * `docs/CONVENTION.md` secao 3.1 declara as transicoes de `Student` como
 * `[indefinido]` e manda defini-las "na spec de F7" -- mas a SPEC-007 secao 2
 * saiu vazia. A tabela abaixo vem do plano de apoio
 * (`2026-08-14-mvp-01-02-students-entitlements.md`, Task 2), que e material
 * de apoio e nao contrato. Adotada nesta fatia por decisao do PI em
 * 15/08/2026; o CONVENTION.md secao 3.1 precisa da emenda correspondente.
 *
 * `Record` completo e `ReadonlySet`, SEM ramo `default: allow`. Se um estado
 * novo entrar no enum sem entrada aqui, o TypeScript acusa -- que e
 * exatamente o momento de decidir suas transicoes, e nao seis meses depois
 * quando alguem descobrir que o estado novo permitia tudo.
 */
export const TRANSICOES_DE_ALUNO: Record<StatusDeAluno, ReadonlySet<StatusDeAluno>> = {
  LEAD: new Set(['TRIAL', 'ACTIVE', 'CANCELLED', 'ARCHIVED']),
  TRIAL: new Set(['ACTIVE', 'CANCELLED', 'ARCHIVED']),
  ACTIVE: new Set(['SUSPENDED', 'BLOCKED', 'CANCELLED', 'ARCHIVED']),
  SUSPENDED: new Set(['ACTIVE', 'BLOCKED', 'CANCELLED', 'ARCHIVED']),
  BLOCKED: new Set(['ACTIVE', 'CANCELLED', 'ARCHIVED']),
  CANCELLED: new Set(['ACTIVE', 'ARCHIVED']),
  /** Terminal (INV-013): arquivar preserva historico e nao tem volta. */
  ARCHIVED: new Set([]),
};

/**
 * Estados em que o aluno NAO recebe acesso normal.
 *
 * INV-033 e `M1-BR-002`, palavra por palavra: `BLOCKED`, `CANCELLED` ou
 * `ARCHIVED`. `SUSPENDED` NAO esta na lista -- nem no invariante, nem na
 * regra de negocio. Acrescenta-lo aqui seria inventar regra que nenhum
 * documento pede.
 */
const SEM_ACESSO_NORMAL: ReadonlySet<StatusDeAluno> = new Set([
  'BLOCKED',
  'CANCELLED',
  'ARCHIVED',
]);

/**
 * Aplica uma transicao de estado, ou lanca.
 *
 * Funcao pura: sem banco, sem rede, sem relogio (`CLAUDE.md`). Quem persiste
 * o resultado e o caso de uso, dentro da transacao -- e por isso que
 * transicao recusada nao escreve timeline nem outbox: o erro sobe antes de a
 * transacao comecar.
 */
export function transicionarAluno(
  atual: StatusDeAluno,
  alvo: StatusDeAluno,
): StatusDeAluno {
  if (!TRANSICOES_DE_ALUNO[atual].has(alvo)) {
    throw new TransicaoDeAlunoInvalidaError(atual, alvo);
  }

  return alvo;
}

/** INV-033: o status do aluno permite acesso normal? */
export function alunoRecebeAcessoNormal(status: StatusDeAluno): boolean {
  return !SEM_ACESSO_NORMAL.has(status);
}
