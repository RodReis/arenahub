import type { EventoDoFeed } from '../../actions/dashboard';

export interface Recusado {
  /** Aluno pelo id, ou o numero do leitor de quem nao foi identificado. */
  readonly chave: string;
  /**
   * A recusa MAIS RECENTE desta pessoa hoje -- o evento inteiro, para o
   * cartao desenhar foto, nome e numero da catraca igual ao feed ao vivo.
   */
  readonly evento: EventoDoFeed;
  /** Quantas vezes foi recusada hoje. */
  readonly vezes: number;
}

/**
 * Quem a catraca recusou hoje -- pedido do PI, 02/10/2026: o cartao
 * "Bloqueados e suspensos" mostrava so o STATUS do cadastro; quem foi barrado
 * na porta por plano vencido, sem identificacao ou fora de horario nao
 * aparecia em lugar nenhum do dashboard.
 *
 * UMA LINHA POR PESSOA: o leitor reconhece a mesma pessoa varias vezes na
 * frente da catraca, e dez linhas iguais esconderiam as outras recusas.
 * `eventos` chega do mais recente para o mais antigo (ordem do feed), entao a
 * primeira ocorrencia e a recusa mais recente.
 */
export function recusadosDoDia(eventos: readonly EventoDoFeed[]): Recusado[] {
  const porPessoa = new Map<string, Recusado>();

  for (const evento of eventos) {
    if (evento.outcome !== 'DENY') continue;

    const chave = evento.student
      ? `aluno:${evento.student.id}`
      : `numero:${evento.externalUserId ?? 'nao-identificado'}`;
    const anterior = porPessoa.get(chave);

    porPessoa.set(chave, anterior ? { ...anterior, vezes: anterior.vezes + 1 } : { chave, evento, vezes: 1 });
  }

  return [...porPessoa.values()];
}
