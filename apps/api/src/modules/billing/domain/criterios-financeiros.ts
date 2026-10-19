import type { Prisma } from '@arenahub/database';

import { dataLocalDe, meiaNoiteLocalEmUtc } from './bloqueio-por-inadimplencia.js';

/**
 * Os critérios financeiros que mais de uma tela usa, num lugar só.
 *
 * Antes daqui cada um morava dentro do use-case da tela de Cobrança
 * (`consultar-inadimplencia` e `consultar-pagos`). O Relatório de Alunos
 * precisa responder "quem está inadimplente?" e "quem é pagante?" com a MESMA
 * resposta da Cobrança: duas cópias divergem na primeira edição, e o gestor
 * veria um número no relatório e outro na fila de cobrança.
 */

/**
 * Fatura vencida e em aberto -- o que a tela Cobrança chama de inadimplência.
 * `agora` entra por parâmetro: o critério depende do relógio.
 */
export function faturaVencidaEmAberto(agora: Date): Prisma.InvoiceWhereInput {
  return { status: { in: ['OPEN', 'OVERDUE'] }, dueAt: { lt: agora } };
}

/**
 * Quem a tela Cobrança considera: aluno em situação Ativo e perfil Aluno --
 * decisão do PI (16/10/2026, #634). É exatamente o filtro Situação = Ativo +
 * Perfil = Aluno do Relatório de Alunos; por isso os dois números batem.
 */
export const ALUNO_COBRAVEL: Prisma.StudentWhereInput = { status: 'ACTIVE', profile: 'STUDENT' };

/** Fatura paga. */
export const FATURA_PAGA: Prisma.InvoiceWhereInput = { status: 'PAID', paidAt: { not: null } };

export interface UnidadeComFuso {
  readonly id: string;
  readonly timezone: string;
}

/**
 * Fatura paga NO MÊS CORRENTE -- o que a aba Pagantes e o filtro Pagantes do
 * Relatório de Alunos consideram (decisão do PI, 19/10/2026). Antes valia
 * qualquer fatura paga em qualquer data: 128 inadimplentes apareciam também
 * como pagantes e as duas abas somavam mais que os alunos ativos.
 *
 * O mês é o da UNIDADE do aluno (ADR-019, fuso sem fallback): um pagamento às
 * 22h do último dia do mês em Manaus já é o mês seguinte em UTC. Um intervalo
 * por unidade, ligado ao aluno da fatura pelo `gymUnitId`.
 */
export function faturaPagaNoMes(
  agora: Date,
  unidades: readonly UnidadeComFuso[],
): Prisma.InvoiceWhereInput {
  return {
    ...FATURA_PAGA,
    OR: unidades.map(({ id, timezone }) => {
      const { ano, mes } = dataLocalDe(agora, timezone);
      // Dezembro vira janeiro do ano seguinte; `meiaNoiteLocalEmUtc` não normaliza mês 13.
      const proximo = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };

      return {
        student: { gymUnitId: id },
        paidAt: {
          gte: meiaNoiteLocalEmUtc({ ano, mes, dia: 1 }, timezone),
          lt: meiaNoiteLocalEmUtc({ ...proximo, dia: 1 }, timezone),
        },
      };
    }),
  };
}
