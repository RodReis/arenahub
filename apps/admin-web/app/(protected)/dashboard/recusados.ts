import type { EventoDoFeed } from '../../actions/dashboard';

export interface Recusado {
  /** Aluno pelo nome, ou o numero do leitor de quem nao foi identificado. */
  readonly chave: string;
  readonly nome: string;
  /** A recusa MAIS RECENTE desta pessoa hoje. */
  readonly occurredAt: string;
  readonly reason: string;
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

    const nome = evento.student?.fullName ?? evento.externalUserId ?? 'Não identificado';
    const chave = evento.student ? `aluno:${nome}` : `numero:${nome}`;
    const anterior = porPessoa.get(chave);

    porPessoa.set(
      chave,
      anterior
        ? { ...anterior, vezes: anterior.vezes + 1 }
        : {
            chave,
            nome,
            occurredAt: evento.occurredAt,
            reason: evento.reason,
            vezes: 1,
          },
    );
  }

  return [...porPessoa.values()];
}
