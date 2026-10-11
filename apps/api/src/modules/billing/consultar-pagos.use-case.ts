import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { FATURA_PAGA } from './domain/criterios-financeiros.js';

/**
 * A aba "Pagantes" da tela de cobranca. Espelho de
 * `ConsultarInadimplenciaUseCase`, mas para o outro lado da mesma pergunta:
 * quem ja pagou, nao quem deve.
 *
 * UMA LINHA POR ALUNO, nao por fatura. A pergunta desta aba e "quem esta em
 * dia", e um aluno que pagou doze mensalidades nao e doze respostas -- e uma
 * so, com o pagamento mais recente dele. Decisao do PI: a versao anterior
 * listava fatura por fatura e o contador da aba (a soma de faturas) nao batia
 * com "quantos alunos estao em dia", que e o numero que interessa ao lado de
 * "quantos alunos estao inadimplentes".
 *
 * SO LE. Ordenado pelo pagamento mais recente primeiro -- e o inverso da fila
 * de cobranca (que prioriza a divida mais urgente), porque aqui nao ha
 * urgencia: e so "quem pagou por ultimo".
 */

export interface LinhaDePago {
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly studentId: string;
  readonly studentName: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly paidAt: Date;
  readonly telefone: string | null;
  readonly fusoDaUnidade: string;
}

export interface PainelDePagos {
  readonly total: number;
  readonly linhas: readonly LinhaDePago[];
  /** Ha mais linhas depois desta pagina? `null` quando nao ha proxima. */
  readonly proximoCursor: string | null;
}

/** Filtro e paginacao da lista -- espelho de `OpcoesDeConsulta` da inadimplencia. */
export interface OpcoesDeConsultaDePagos {
  readonly busca?: string;
  /** `studentId` da ultima linha da pagina anterior. */
  readonly cursor?: string;
}

/**
 * Teto de FATURAS lidas do banco antes de agrupar por aluno -- nao e o teto
 * de linhas exibidas (essa e `linhas.length`, um aluno cada). Generoso de
 * proposito: baixo demais deixaria um aluno inadimplente reaparecer aqui como
 * "em dia" so porque a fatura paga mais recente dele caiu fora da leitura.
 */
const LIMITE_DE_FATURAS_LIDAS = 5000;

const TAMANHO_DA_PAGINA = 10;

/**
 * Compara nome livre de acento e caixa -- mesma funcao de
 * `consultar-inadimplencia.use-case.ts`, repetida aqui pelo mesmo motivo:
 * duas linhas nao justificam um modulo compartilhado.
 */
function nomeContem(nome: string, busca: string): boolean {
  const semAcento = (texto: string): string =>
    texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  return semAcento(nome).includes(semAcento(busca));
}

@Injectable()
export class ConsultarPagosUseCase {
  constructor(private readonly db: PrismaService) {}

  /**
   * `opcoes` filtra e pagina em memoria, sobre a lista ja deduplicada por
   * aluno -- mesmo motivo de `ConsultarInadimplenciaUseCase.paginar`: o dedup
   * so existe depois da leitura, entao nao ha coluna do banco para o SQL
   * paginar contra.
   */
  async executar(
    contexto: TenantContext,
    opcoes: OpcoesDeConsultaDePagos = {},
  ): Promise<PainelDePagos> {
    /*
     * `comTenant`, embora a raiz seja `invoice`: o `select` traz `student` por
     * baixo, e `students` TEM politica RLS (F66). Fora de transacao
     * interceptada o `set_config` nunca aplica, e sob o role restrito o
     * aninhado vem NULO enquanto a raiz volta inteira -- o Prisma tipa a
     * relacao como nao-nula, entao nem o TypeScript nem um teste sem RLS
     * avisam (issue #306, mesmo padrao de `EmitirReciboUseCase`).
     */
    const invoices = await this.db.comTenant((tx) =>
      tx.invoice.findMany({
        where: {
          tenantId: contexto.tenantId,
          ...FATURA_PAGA,
        },
        select: {
          id: true,
          number: true,
          totalMinor: true,
          currency: true,
          paidAt: true,
          studentId: true,
          student: {
            select: {
              fullName: true,
              gymUnit: { select: { timezone: true } },
              contacts: {
                where: { type: { in: ['WHATSAPP', 'PHONE'] } },
                orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
                select: { value: true, type: true },
              },
            },
          },
        },
        /*
         * Pago mais recente primeiro. `id` como desempate final -- mesmo
         * motivo do `ordenadasPorUrgencia` da fila de cobranca: sem chave
         * estavel, dois pagamentos no mesmo instante trocam de lugar entre
         * recargas.
         */
        orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
        take: LIMITE_DE_FATURAS_LIDAS,
      }),
    );

    /*
     * DEDUP POR ALUNO, mantendo a PRIMEIRA ocorrencia -- como a leitura acima
     * ja vem ordenada por `paidAt desc`, a primeira invoice de cada
     * `studentId` encontrada aqui e, por construcao, a mais recente dele. Um
     * segundo `sort` depois seria redundante.
     */
    const vistos = new Set<string>();
    const linhas: LinhaDePago[] = [];

    for (const invoice of invoices) {
      if (vistos.has(invoice.studentId)) continue;
      vistos.add(invoice.studentId);

      linhas.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        studentId: invoice.studentId,
        studentName: invoice.student.fullName,
        amountMinor: invoice.totalMinor,
        currency: invoice.currency,
        // `paidAt` filtrado por `not: null` acima -- garantido nao-nulo aqui.
        paidAt: invoice.paidAt!,
        telefone:
          invoice.student.contacts.find((c) => c.type === 'WHATSAPP')?.value ??
          invoice.student.contacts[0]?.value ??
          null,
        fusoDaUnidade: invoice.student.gymUnit.timezone,
      });
    }

    const filtradas = opcoes.busca
      ? linhas.filter((linha) => nomeContem(linha.studentName, opcoes.busca!))
      : linhas;

    const inicio = opcoes.cursor
      ? filtradas.findIndex((linha) => linha.studentId === opcoes.cursor) + 1
      : 0;

    /*
     * CURSOR NAO ENCONTRADO volta para a primeira pagina -- mesmo criterio de
     * `ConsultarInadimplenciaUseCase.paginar`: o aluno que ancorava o cursor
     * pode ter saido da lista (nova fatura vencida o tirou de "em dia") entre
     * uma pagina e outra.
     */
    const pagina = filtradas.slice(inicio, inicio + TAMANHO_DA_PAGINA);
    const haProxima = inicio + TAMANHO_DA_PAGINA < filtradas.length;
    const ultima = pagina[pagina.length - 1];

    return {
      total: filtradas.length,
      linhas: pagina,
      proximoCursor: haProxima && ultima ? ultima.studentId : null,
    };
  }
}
