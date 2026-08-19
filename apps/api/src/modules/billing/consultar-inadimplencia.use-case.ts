import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { deveBloquear } from './domain/bloqueio-por-inadimplencia.js';

/**
 * A tela de inadimplencia e cobranca. `MVP-02` 7, Slice 2.4.
 *
 * SO LE. Nenhuma escrita acontece aqui: quem bloqueia e o job
 * (`AplicarInadimplenciaUseCase`), quem desbloqueia e o webhook de pagamento.
 * Uma consulta que corrigisse estado de passagem faria a situacao do aluno
 * depender de alguem ter aberto a tela -- e dois caminhos de escrita para o
 * mesmo fato e o que a INV-076 existe para impedir.
 *
 * ## Por que a situacao e derivada, e nao lida de uma coluna
 *
 * "Bloqueado" e "em carencia" NAO sao estados guardados: sao a mesma invoice
 * vencida, de um lado ou do outro do instante de bloqueio. Guardar a diferenca
 * criaria uma terceira fonte de verdade que envelhece entre execucoes do job
 * -- a tela mostraria "em carencia" para quem o motor ja nega.
 */

export type SituacaoDeAcesso = 'BLOQUEADO' | 'EM_CARENCIA';

export interface LinhaDeInadimplencia {
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly studentId: string;
  readonly studentName: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly dueAt: Date;
  readonly diasEmAtraso: number;
  readonly situacao: SituacaoDeAcesso;
  /** Telefone do aluno, para o link de cobranca. Nulo quando nao ha. */
  readonly telefone: string | null;
  /** Ha liberacao financeira viva? A tela precisa nao oferecer outra. */
  readonly liberadoAte: Date | null;
  /**
   * Fuso da UNIDADE do aluno -- ADR-019 3, sem fallback.
   *
   * Vai para a tela porque o vencimento e exibido nele: com `America/Manaus`
   * (UTC-4) e a tela fixada em Sao Paulo, a data mostrada poderia divergir em
   * um dia da que o backend usou para decidir o bloqueio. Reintroduzir o
   * fallback na exibicao seria o mesmo bug de um dia, num lugar onde ele
   * parece inofensivo.
   */
  readonly fusoDaUnidade: string;
}

/**
 * Composicao da divida por idade do atraso.
 *
 * POR QUE ISTO E O GRAFICO, e nao a evolucao mensal que se costuma desenhar:
 * o sistema tem UM mes de dado. Uma linha temporal com um ponto so nao e
 * informacao -- e desenha-la com meses vazios antes faria a curva subir do
 * zero, sugerindo uma piora que nao aconteceu.
 *
 * A composicao, por outro lado, responde hoje a pergunta que o gestor faz:
 * "quanto do meu dinheiro ja e velho demais para voltar?". Divida de mais de
 * 30 dias raramente e paga, e ver o peso dela e o que decide se a academia
 * muda a politica de cobranca.
 */
export interface FaixaDeAtraso {
  readonly rotulo: string;
  readonly minorTotal: number;
  readonly quantidade: number;
}

export interface ResumoDaInadimplencia {
  readonly emAtrasoMinor: number;
  readonly faturasVencidas: number;
  readonly bloqueados: number;
  /** Percentual com uma casa. `null` quando nao ha assinatura ativa alguma. */
  readonly taxaDeInadimplencia: number | null;
}

export interface PainelDeInadimplencia {
  readonly resumo: ResumoDaInadimplencia;
  readonly faixas: readonly FaixaDeAtraso[];
  readonly linhas: readonly LinhaDeInadimplencia[];
}

/**
 * As quatro idades da divida.
 *
 * Os cortes nao sao redondos por estetica: 15 e 30 dias sao onde a
 * probabilidade de recuperacao cai de forma visivel na cobranca de
 * mensalidade. "Em carencia" fica separado porque essa pessoa AINDA ENTRA --
 * juntar com quem ja esta bloqueado misturaria dinheiro em risco com dinheiro
 * apenas atrasado.
 */
const FAIXAS: ReadonlyArray<{ rotulo: string; ate: number }> = [
  { rotulo: 'Em carência', ate: 0 },
  { rotulo: 'Até 15 dias', ate: 15 },
  { rotulo: '16 a 30 dias', ate: 30 },
  { rotulo: 'Mais de 30 dias', ate: Number.POSITIVE_INFINITY },
];

const UM_DIA_EM_MS = 86_400_000;

@Injectable()
export class ConsultarInadimplenciaUseCase {
  constructor(private readonly db: PrismaService) {}

  /**
   * `agora` entra por parametro (`CLAUDE.md`): "dias em atraso" e a situacao
   * dependem do relogio, e o teste precisa fixar o instante.
   */
  async executar(contexto: TenantContext, agora: Date): Promise<PainelDeInadimplencia> {
    const configuracao = await this.db.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
      select: { graceDays: true, blockAnchor: true },
    });

    const invoices = await this.db.invoice.findMany({
      where: {
        tenantId: contexto.tenantId,
        status: { in: ['OPEN', 'OVERDUE'] },
        dueAt: { lt: agora },
      },
      select: {
        id: true,
        number: true,
        totalMinor: true,
        currency: true,
        dueAt: true,
        blockAt: true,
        studentId: true,
        student: {
          select: {
            fullName: true,
            gymUnit: { select: { timezone: true } },
            /**
             * WHATSAPP na frente de PHONE. O botao de cobranca abre o
             * WhatsApp, e o aluno pode ter um numero fixo cadastrado como
             * `PHONE` que nunca receberia a mensagem. `orderBy` no tipo
             * resolve sem duas consultas.
             */
            contacts: {
              where: { type: { in: ['WHATSAPP', 'PHONE'] } },
              orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
              select: { value: true, type: true },
            },
          },
        },
      },
      orderBy: { dueAt: 'asc' },
    });

    /**
     * Uma consulta so para todas as liberacoes vivas, e nao uma por linha:
     * quinze inadimplentes virariam quinze `SELECT` no caminho de uma tela
     * que a recepcao abre o dia inteiro.
     */
    const liberacoes = await this.db.financialAccessOverride.findMany({
      where: {
        tenantId: contexto.tenantId,
        revokedAt: null,
        expiresAt: { gt: agora },
        studentId: { in: [...new Set(invoices.map((i) => i.studentId))] },
      },
      select: { studentId: true, expiresAt: true },
      orderBy: { expiresAt: 'desc' },
    });

    const liberadoAte = new Map<string, Date>();
    for (const liberacao of liberacoes) {
      if (!liberadoAte.has(liberacao.studentId)) {
        liberadoAte.set(liberacao.studentId, liberacao.expiresAt);
      }
    }

    const linhas = invoices.map<LinhaDeInadimplencia>((invoice) => ({
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      studentId: invoice.studentId,
      studentName: invoice.student.fullName,
      amountMinor: invoice.totalMinor,
      currency: invoice.currency,
      dueAt: invoice.dueAt,
      diasEmAtraso: Math.floor((agora.getTime() - invoice.dueAt.getTime()) / UM_DIA_EM_MS),
      situacao: this.situacao(invoice, configuracao, agora),
      telefone:
        invoice.student.contacts.find((c) => c.type === 'WHATSAPP')?.value ??
        invoice.student.contacts[0]?.value ??
        null,
      liberadoAte: liberadoAte.get(invoice.studentId) ?? null,
      fusoDaUnidade: invoice.student.gymUnit.timezone,
    }));

    return {
      resumo: await this.resumo(contexto, linhas),
      faixas: this.faixas(linhas),
      linhas: this.ordenadasPorUrgencia(linhas),
    };
  }

  /**
   * A fila de cobranca, na ordem em que a recepcao deve trabalhar.
   *
   * NAO E POR DATA. Ordenar por vencimento responde "quem venceu primeiro?",
   * que ninguem pergunta. A recepcao tem meia hora entre um aluno e outro e
   * precisa saber POR ONDE COMECAR -- e comeca por onde ha mais dinheiro
   * parado ha mais tempo.
   *
   * O peso e `valor x dias`: uma fatura de R$ 350 com 12 dias vem antes de uma
   * de R$ 130 com 30, porque recupera mais. Empate desempata pelo mais antigo,
   * que e determinstico e reproduz a mesma ordem entre recargas.
   *
   * Quem esta EM CARENCIA vai para o fim, sempre: ainda entra na academia, e
   * cobrar quem esta no prazo combinado queima a relacao por nada.
   */
  private ordenadasPorUrgencia(
    linhas: readonly LinhaDeInadimplencia[],
  ): readonly LinhaDeInadimplencia[] {
    return [...linhas].sort((a, b) => {
      if (a.situacao !== b.situacao) {
        return a.situacao === 'BLOQUEADO' ? -1 : 1;
      }

      const pesoDeA = a.amountMinor * Math.max(a.diasEmAtraso, 1);
      const pesoDeB = b.amountMinor * Math.max(b.diasEmAtraso, 1);

      if (pesoDeA !== pesoDeB) {
        return pesoDeB - pesoDeA;
      }

      return a.dueAt.getTime() - b.dueAt.getTime();
    });
  }

  /**
   * Agrupa a divida por idade. Ver o comentario de `FaixaDeAtraso`.
   *
   * TODA LINHA CAI EM EXATAMENTE UMA FAIXA. A soma das barras tem de bater com
   * o numero grande ao lado -- se uma fatura escapar, o grafico contradiz o
   * total e quem confere perde a confianca na tela inteira.
   *
   * O caso que escapava, achado testando os limites: bloqueado com
   * `diasEmAtraso === 0`. Parece impossivel, mas nao e -- academia com
   * `graceDays = 0` bloqueia na meia-noite do dia do vencimento, entao uma
   * fatura que venceu as 14h ja esta bloqueada as 20h com ZERO dia inteiro de
   * atraso. O piso da primeira faixa de bloqueio precisa ser -1, e nao 0.
   */
  private faixas(linhas: readonly LinhaDeInadimplencia[]): readonly FaixaDeAtraso[] {
    return FAIXAS.map((faixa, indice) => {
      /**
       * O piso da PRIMEIRA faixa de bloqueio e -1 para incluir o dia zero. As
       * demais herdam o teto da anterior, o que fecha a escada sem buraco nem
       * sobreposicao.
       */
      const piso = indice <= 1 ? -1 : (FAIXAS[indice - 1]?.ate ?? 0);

      const daFaixa = linhas.filter((linha) =>
        faixa.rotulo === 'Em carência'
          ? linha.situacao === 'EM_CARENCIA'
          : linha.situacao === 'BLOQUEADO' &&
            linha.diasEmAtraso > piso &&
            linha.diasEmAtraso <= faixa.ate,
      );

      return {
        rotulo: faixa.rotulo,
        minorTotal: daFaixa.reduce((soma, linha) => soma + linha.amountMinor, 0),
        quantidade: daFaixa.length,
      };
    });
  }

  /**
   * Bloqueado ou em carencia?
   *
   * `blockAt` congelado tem precedencia -- ver `AplicarInadimplenciaUseCase`:
   * quem ja entrou na regua mantem o instante, e trocar a politica nao move
   * ninguem retroativamente.
   *
   * SEM CONFIGURACAO, TODO MUNDO APARECE EM CARENCIA. E o mesmo criterio do
   * job, que sem `BillingSettings` nao bloqueia ninguem: a tela nao pode
   * afirmar um bloqueio que o motor nao aplica.
   */
  private situacao(
    invoice: { dueAt: Date; blockAt: Date | null; student: { gymUnit: { timezone: string } } },
    configuracao: { graceDays: number; blockAnchor: 'DUE_PLUS_GRACE' } | null,
    agora: Date,
  ): SituacaoDeAcesso {
    if (invoice.blockAt !== null) {
      return agora.getTime() >= invoice.blockAt.getTime() ? 'BLOQUEADO' : 'EM_CARENCIA';
    }

    if (!configuracao) {
      return 'EM_CARENCIA';
    }

    return deveBloquear(
      invoice.dueAt,
      {
        ancora: configuracao.blockAnchor,
        diasDeCarencia: configuracao.graceDays,
        fusoDaUnidade: invoice.student.gymUnit.timezone,
      },
      agora,
    )
      ? 'BLOQUEADO'
      : 'EM_CARENCIA';
  }

  private async resumo(
    contexto: TenantContext,
    linhas: readonly LinhaDeInadimplencia[],
  ): Promise<ResumoDaInadimplencia> {
    const emAtrasoMinor = linhas.reduce((soma, linha) => soma + linha.amountMinor, 0);
    const bloqueados = new Set(
      linhas.filter((l) => l.situacao === 'BLOQUEADO').map((l) => l.studentId),
    ).size;

    /**
     * Denominador: assinaturas que DEVERIAM estar pagando -- ativas mais em
     * atraso. Contar so as ativas faria a taxa cair quando mais gente ficasse
     * inadimplente, porque o proprio atraso tira a assinatura de `ACTIVE`.
     */
    const pagantes = await this.db.subscription.count({
      where: { tenantId: contexto.tenantId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
    });

    const inadimplentes = new Set(linhas.map((l) => l.studentId)).size;

    return {
      emAtrasoMinor,
      faturasVencidas: linhas.length,
      bloqueados,
      /**
       * `null` e nao zero quando nao ha pagante: academia sem assinatura nao
       * tem 0% de inadimplencia, tem uma taxa que nao existe. Zero seria uma
       * meta batida em cima de nada.
       */
      taxaDeInadimplencia:
        pagantes === 0 ? null : Math.round((inadimplentes / pagantes) * 1000) / 10,
    };
  }
}
