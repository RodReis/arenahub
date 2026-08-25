import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { precoVigenteEm } from './domain/dinheiro.js';
import {
  montarSerie,
  taxaDeInadimplencia,
  ticketMedio,
  validarJanela,
  type SerieDeCompetencia,
} from './domain/resumo-financeiro.js';

/**
 * O painel financeiro gerencial. F54, `SPEC-054`.
 *
 * Responde tres perguntas do dono: quanto entrou, quanto falta entrar e
 * quanto esta vencido -- por periodo.
 *
 * SO LE. Nenhuma escrita acontece aqui, pelo mesmo motivo do
 * `ConsultarInadimplenciaUseCase`: um painel que corrigisse estado de
 * passagem faria a situacao do aluno depender de alguem ter aberto a tela.
 *
 * ## Agregacao NO BANCO, e por que isso importa aqui
 *
 * A `SPEC-054` §3.1 exige agregacao no banco, "nao em memoria do Node". O
 * `ConsultarInadimplenciaUseCase` faz o oposto -- carrega as invoices
 * vencidas e reduz em memoria -- e esta certo la: a fila de cobranca e
 * pequena por natureza, porque academia com mil inadimplentes fechou.
 *
 * Aqui nao ha esse teto. O resumo olha TODO o historico de invoices e
 * pagamentos do tenant, que cresce um lote por mes para sempre. Carregar isso
 * para somar no Node funcionaria por um ano e degradaria calado depois --
 * exatamente o tipo de coisa que ninguem liga a esta fatia quando acontecer.
 *
 * ## O que NAO esta aqui
 *
 * Nenhuma acao sobre invoice (é a F53) e nenhuma regua de cobranca (é a F38,
 * MVP 6). Esta fatia é leitura, e o escopo negativo da §6 da spec é explicito.
 */

/** Faixas de atraso: mesma escada da F15, e o motivo esta la. */
export interface FaixaDaDivida {
  readonly rotulo: string;
  readonly minorTotal: number;
  readonly quantidade: number;
}

export interface QuebraPorMetodo {
  readonly metodo: 'MANUAL' | 'PIX' | 'CARD';
  readonly minorTotal: number;
  readonly quantidade: number;
}

export interface ResumoFinanceiro {
  /** Janela efetivamente aplicada, ecoada para a tela nao supor a sua. */
  readonly de: Date;
  readonly ate: Date;

  /**
   * Recebido LIQUIDO: pagamentos `CONFIRMED` na janela, menos os estornos
   * confirmados nela. Ver `estornadoMinor`.
   */
  readonly recebidoMinor: number;
  readonly pagamentosConfirmados: number;

  /**
   * Estornos confirmados na janela, ja descontados de `recebidoMinor`.
   *
   * VAI SEPARADO porque devolver dinheiro nao e o mesmo que nao te-lo
   * recebido: um mes com R$ 5.000 de entrada e R$ 800 de estorno conta uma
   * historia diferente de um mes com R$ 4.200 de entrada, e o painel existe
   * para o dono ver a diferenca.
   */
  readonly estornadoMinor: number;

  /**
   * Soma do `PlanPrice` vigente das assinaturas ativas -- decisao 3 do PI.
   * NAO e a soma das invoices emitidas: ver o comentario de
   * `receitaEsperada()`.
   */
  readonly receitaEsperadaMinor: number;

  /** Invoices `OPEN` com `dueAt` na janela: o que ainda deve entrar. */
  readonly aReceberMinor: number;
  readonly faturasAReceber: number;

  /** Invoices vencidas em aberto, com a composicao por idade do atraso. */
  readonly vencidoMinor: number;
  readonly faturasVencidas: number;
  readonly faixas: readonly FaixaDaDivida[];

  /** `null` quando nao ha do que tirar -- nunca zero. Ver o dominio. */
  readonly ticketMedioMinor: number | null;
  readonly taxaDeInadimplencia: number | null;

  readonly quebraPorMetodo: readonly QuebraPorMetodo[];
  readonly serie: SerieDeCompetencia;

  /**
   * Todas as competencias com movimento, `YYYY-MM`, da mais antiga para a mais
   * recente. INDEPENDENTE DA JANELA.
   *
   * SEPARADO DA SERIE de proposito, e o defeito que essa separacao conserta e
   * concreto: a serie olha 12 meses PARA TRAS a partir do fim da janela, o que
   * esta certo para ela ("como chegamos ate aqui"). O filtro de periodo da tela
   * derivava dessa mesma lista -- entao apurar maio devolvia so maio, o filtro
   * ficava com um chip so, e nao havia caminho de volta para junho.
   *
   * As duas perguntas sao diferentes: a serie responde "como chegamos ate
   * aqui", este campo responde "que periodos existem para escolher". A segunda
   * nao pode depender de qual esta aberto.
   */
  readonly competenciasDisponiveis: readonly string[];

  /**
   * A BASE SOBRE A QUAL A TELA CALCULA, declarada (`SPEC-054` §5.2).
   *
   * Os ~340 alunos ativados da base do Pacto e os 1.926 importados como
   * `CANCELLED` (ADR-033) distorcem qualquer percentual, e quem le o painel
   * precisa saber que denominador esta olhando. Sem isto, uma taxa de 12%
   * parece afirmar algo sobre a academia quando afirma algo sobre a
   * importacao.
   */
  readonly base: {
    readonly alunosPagantes: number;
    readonly alunosInadimplentes: number;
    readonly assinaturasAtivas: number;
  };
}

const UM_DIA_EM_MS = 86_400_000;

/** Quantos meses a serie por competencia olha para tras. Ver `inicioDaSerie`. */
const MESES_DA_SERIE = 12;

/**
 * As quatro idades da divida.
 *
 * MESMOS CORTES DA F15 (`consultar-inadimplencia.use-case.ts`), e de
 * proposito: duas telas do mesmo financeiro que classificassem atraso de
 * formas diferentes fariam o gestor ver dois valores para "mais de 30 dias" e
 * nao saber qual esta errado.
 *
 * A diferenca e o que cada uma separa. La, "Em carencia" e quem AINDA ENTRA
 * na academia -- a fila de cobranca precisa disso para nao queimar relacao
 * com quem esta no prazo combinado. Aqui a pergunta e sobre DINHEIRO, e
 * dinheiro atrasado e atrasado independente de o aluno ainda passar na
 * catraca; por isso a escada e so por dias, sem o estado de acesso.
 */
const FAIXAS: ReadonlyArray<{ rotulo: string; de: number; ate: number }> = [
  { rotulo: 'Até 15 dias', de: 0, ate: 15 },
  { rotulo: '16 a 30 dias', de: 15, ate: 30 },
  { rotulo: '31 a 60 dias', de: 30, ate: 60 },
  { rotulo: 'Mais de 60 dias', de: 60, ate: Number.POSITIVE_INFINITY },
];

const METODOS: ReadonlyArray<'MANUAL' | 'PIX' | 'CARD'> = ['MANUAL', 'PIX', 'CARD'];

@Injectable()
export class ConsultarResumoFinanceiroUseCase {
  constructor(private readonly db: PrismaService) {}

  /**
   * `agora` entra por parametro (`CLAUDE.md`): a janela e validada contra ele
   * e "dias em atraso" depende dele. O teste precisa fixar o instante.
   */
  async executar(
    contexto: TenantContext,
    entrada: { de: Date; ate: Date; agora: Date },
  ): Promise<ResumoFinanceiro> {
    validarJanela(entrada.de, entrada.ate, entrada.agora);

    const doTenant = { tenantId: contexto.tenantId };

    /**
     * A serie olha para TRAS a partir do fim da janela -- ver o comentario da
     * consulta de competencia. Doze meses porque e o ciclo que o dono compara
     * ("como foi agosto do ano passado?"); mais que isso vira arquivo, nao
     * painel.
     */
    const inicioDaSerie = new Date(entrada.ate);
    inicioDaSerie.setUTCMonth(inicioDaSerie.getUTCMonth() - MESES_DA_SERIE);

    /**
     * Tudo em paralelo: sao consultas independentes, e serializa-las faria a
     * tela somar oito latencias de banco por carregamento.
     */
    const [
      recebido,
      estornado,
      aReceber,
      vencidas,
      porMetodo,
      faturadoNaSerie,
      recebidoNaSerie,
      competencias,
      assinaturas,
    ] = await Promise.all([
        // RECEBIDO: pagamento CONFIRMED com `paidAt` na janela.
        //
        // `paidAt` e nao `createdAt`: o pagamento manual da recepcao e
        // reconhecido HOJE com a data em que o dinheiro entrou, que pode ser
        // ontem. Agrupar pelo registro faria o caixa de ontem aparecer hoje.
        this.db.payment.aggregate({
          where: {
            ...doTenant,
            status: 'CONFIRMED',
            paidAt: { gte: entrada.de, lt: entrada.ate },
          },
          _sum: { amountMinor: true },
          _count: true,
        }),

        /**
         * ESTORNOS CONFIRMADOS NA JANELA -- e o defeito que esta consulta
         * existe para nao ter.
         *
         * ESTORNO PARCIAL NAO MEXE NO `Payment`: `EstornarPagamentoUseCase`
         * so move o pagamento para `REFUNDED` quando o estorno e TOTAL --
         * parcial deixa `CONFIRMED` com o `amountMinor` inteiro, de proposito
         * (parte do dinheiro entrou mesmo). Somar `CONFIRMED` sem descontar
         * faria um pagamento de R$ 150 estornado em R$ 90 continuar contando
         * R$ 150 no painel: o dono leria que entraram 150 quando entraram 60.
         *
         * `settledAt` E NAO `paidAt` do pagamento original: o estorno abate no
         * periodo em que o dinheiro SAIU. Atribui-lo ao periodo do pagamento
         * faria um mes ja fechado mudar de valor semanas depois -- justamente
         * o que a janela fechada existe para impedir.
         */
        this.db.refund.aggregate({
          where: {
            ...doTenant,
            status: 'CONFIRMED',
            settledAt: { gte: entrada.de, lt: entrada.ate },
          },
          _sum: { amountMinor: true },
        }),

        // A RECEBER: invoice OPEN vencendo na janela.
        this.db.invoice.aggregate({
          where: { ...doTenant, status: 'OPEN', dueAt: { gte: entrada.de, lt: entrada.ate } },
          _sum: { totalMinor: true },
          _count: true,
        }),

        /**
         * VENCIDO NAO E FILTRADO PELA JANELA, e a excecao e deliberada.
         *
         * "Quanto esta vencido" e uma pergunta sobre AGORA, nao sobre o
         * periodo: divida de junho continua sendo dinheiro que falta em
         * agosto. Recortar o vencido pela janela faria o numero ENCOLHER
         * quando o gestor olhasse um mes mais recente -- a divida velha
         * sumiria da tela sem ter sido paga, que e o unico jeito de um painel
         * de inadimplencia mentir para melhor.
         *
         * So o que precisa da idade individual e carregado; o resto agrega no
         * banco. Aqui o `findMany` e justificavel pelo mesmo teto da F15:
         * fatura vencida em aberto e conjunto pequeno por natureza.
         */
        this.db.invoice.findMany({
          where: {
            ...doTenant,
            status: { in: ['OPEN', 'OVERDUE'] },
            dueAt: { lt: entrada.agora },
          },
          select: { totalMinor: true, dueAt: true, studentId: true },
        }),

        // QUEBRA POR METODO, dentro da janela.
        this.db.payment.groupBy({
          by: ['method'],
          where: {
            ...doTenant,
            status: 'CONFIRMED',
            paidAt: { gte: entrada.de, lt: entrada.ate },
          },
          _sum: { amountMinor: true },
          _count: true,
        }),

        /**
         * SERIE POR COMPETENCIA, nao por data de pagamento (`SPEC-054` §3.1).
         *
         * A SERIE NAO E RECORTADA PELA JANELA -- e a segunda excecao
         * deliberada, pelo mesmo motivo do vencido acima.
         *
         * A janela dos KPIs e de UM mes, e a serie existe para COMPARAR
         * meses. Recortando-a pela janela ela teria sempre exatamente um
         * ponto, e o aviso de "dado insuficiente para comparar periodos"
         * ficaria permanente: um bloco que promete evolucao (`SPEC-054` §3.2)
         * e e incapaz de mostra-la. Foi o que a primeira versao desta fatia
         * fez, e so apareceu com dado real na tela.
         *
         * O RECORTE E RETROSPECTIVO: os 12 meses que terminam no fim da
         * janela. Olhar para tras a partir do periodo apurado responde "como
         * chegamos ate aqui"; incluir competencia POSTERIOR a janela
         * misturaria faturamento que o periodo escolhido nao explica.
         *
         * `billingPeriod` e `@db.Date` -- mes de referencia, sem hora e sem
         * fuso.
         */
        this.db.invoice.groupBy({
          by: ['billingPeriod'],
          where: {
            ...doTenant,
            status: { notIn: ['DRAFT', 'CANCELLED'] },
            billingPeriod: { gte: inicioDaSerie, lt: entrada.ate },
          },
          _sum: { totalMinor: true },
        }),

        /**
         * O RECEBIDO DA SERIE ATRIBUI O PAGAMENTO A COMPETENCIA DA INVOICE
         * que ele quitou, nao ao mes em que o dinheiro entrou. Quem paga
         * agosto atrasado em setembro faz AGOSTO fechar -- setembro inflar
         * seria a leitura errada, e a que faria o gestor achar que teve um
         * mes bom.
         *
         * `groupBy` do Prisma nao agrega por coluna de uma RELACAO (mesmo
         * limite documentado em `health/import.repository.ts`), entao a
         * competencia vem do lado da invoice e a soma e feita aqui. O
         * conjunto e uma linha por pagamento confirmado da janela de
         * competencias -- nao o historico inteiro.
         */
        this.db.payment.findMany({
          where: {
            ...doTenant,
            status: 'CONFIRMED',
            invoice: { billingPeriod: { gte: inicioDaSerie, lt: entrada.ate } },
          },
          select: { amountMinor: true, invoice: { select: { billingPeriod: true } } },
        }),

        /*
          AS COMPETENCIAS QUE EXISTEM, sem recorte de janela.

          Alimenta o filtro de periodo da tela, que precisa oferecer TODOS os
          meses independente de qual esta aberto. `groupBy` sem `where` de data
          -- o conjunto e uma linha por mes de faturamento do tenant, algumas
          dezenas na vida do produto, nao o historico de invoices.
        */
        this.db.invoice.groupBy({
          by: ['billingPeriod'],
          where: { ...doTenant, status: { notIn: ['DRAFT', 'CANCELLED'] } },
        }),

        // Assinaturas que deveriam estar pagando, com o plano para o preco.
        this.db.subscription.findMany({
          where: { ...doTenant, status: { in: ['ACTIVE', 'PAST_DUE'] } },
          select: { status: true, planId: true, studentId: true },
        }),
      ]);

    const inadimplentes = new Set(vencidas.map((invoice) => invoice.studentId));
    const pagantes = new Set(assinaturas.map((assinatura) => assinatura.studentId));

    const estornadoMinor = estornado._sum.amountMinor ?? 0;

    /**
     * LIQUIDO, e nunca negativo.
     *
     * O piso em zero cobre o caso real de estorno que atravessa a janela: um
     * pagamento de julho estornado em agosto abate em agosto, e se agosto
     * tiver recebido pouco o liquido daria negativo. "Recebi menos vinte
     * reais" nao e leitura util para o dono -- o que ele precisa ver e a
     * entrada em zero e o estorno declarado ao lado, que e o que a tela faz.
     */
    const recebidoMinor = Math.max((recebido._sum.amountMinor ?? 0) - estornadoMinor, 0);

    return {
      de: entrada.de,
      ate: entrada.ate,

      recebidoMinor,
      pagamentosConfirmados: recebido._count,
      estornadoMinor,

      receitaEsperadaMinor: await this.receitaEsperada(contexto, assinaturas, entrada.agora),

      aReceberMinor: aReceber._sum.totalMinor ?? 0,
      faturasAReceber: aReceber._count,

      vencidoMinor: vencidas.reduce((soma, invoice) => soma + invoice.totalMinor, 0),
      faturasVencidas: vencidas.length,
      faixas: this.faixas(vencidas, entrada.agora),

      ticketMedioMinor: ticketMedio(recebidoMinor, recebido._count),
      taxaDeInadimplencia: taxaDeInadimplencia(inadimplentes.size, pagantes.size),

      quebraPorMetodo: METODOS.map((metodo) => {
        const grupo = porMetodo.find((g) => g.method === metodo);

        return {
          metodo,
          minorTotal: grupo?._sum.amountMinor ?? 0,
          quantidade: grupo?._count ?? 0,
        };
      }),

      serie: montarSerie(
        this.porCompetencia(
          faturadoNaSerie.map((g) => ({
            competencia: g.billingPeriod,
            minor: g._sum.totalMinor ?? 0,
          })),
        ),
        this.porCompetencia(
          recebidoNaSerie.map((pagamento) => ({
            competencia: pagamento.invoice.billingPeriod,
            minor: pagamento.amountMinor,
          })),
        ),
      ),

      competenciasDisponiveis: competencias
        .map((linha) => linha.billingPeriod.toISOString().slice(0, 7))
        .sort(),

      base: {
        alunosPagantes: pagantes.size,
        alunosInadimplentes: inadimplentes.size,
        assinaturasAtivas: assinaturas.filter((a) => a.status === 'ACTIVE').length,
      },
    };
  }

  /**
   * Receita esperada: a soma do preco VIGENTE do plano em que cada aluno esta
   * matriculado -- decisao 3 do PI, 23/08/2026.
   *
   * POR QUE NAO E A SOMA DAS INVOICES EMITIDAS: invoice so existe depois de o
   * ciclo rodar. No dia 1 do mes, antes do faturamento, a soma das invoices
   * seria ZERO -- e o painel diria que a academia nao espera receber nada
   * justamente no comeco do mes. O plano matriculado sabe a resposta antes de
   * a cobranca existir.
   *
   * O PRECO E O VIGENTE HOJE, nao o da ultima invoice: reajuste agendado
   * (`PlanPrice.validFrom`) ja aparece na expectativa antes de ser cobrado, e
   * e isso que o dono quer ver ao decidir o reajuste.
   *
   * Carrega os precos de UMA vez para os planos distintos -- tipicamente
   * meia duzia numa academia. Uma consulta por assinatura seria N+1 numa tela
   * que o gestor abre o dia inteiro.
   */
  private async receitaEsperada(
    contexto: TenantContext,
    assinaturas: readonly { planId: string }[],
    agora: Date,
  ): Promise<number> {
    const planIds = [...new Set(assinaturas.map((assinatura) => assinatura.planId))];

    if (planIds.length === 0) {
      return 0;
    }

    const precos = await this.db.planPrice.findMany({
      where: { tenantId: contexto.tenantId, planId: { in: planIds } },
      select: { planId: true, amountMinor: true, currency: true, validFrom: true },
    });

    const porPlano = new Map<string, { amountMinor: number; currency: string; validFrom: Date }[]>();
    for (const preco of precos) {
      const lista = porPlano.get(preco.planId) ?? [];
      lista.push(preco);
      porPlano.set(preco.planId, lista);
    }

    /**
     * Plano SEM preco vigente soma zero, nao quebra a tela.
     *
     * O caso existe de verdade: preco agendado so para o mes que vem deixa o
     * plano sem vigencia hoje. Lancar erro faria uma configuracao legitima
     * derrubar o painel inteiro; somar zero mantem o resto legivel, e a
     * ausencia aparece no numero em vez de na pagina de erro.
     */
    return assinaturas.reduce((soma, assinatura) => {
      const vigente = precoVigenteEm(porPlano.get(assinatura.planId) ?? [], agora);

      return soma + (vigente?.amountMinor ?? 0);
    }, 0);
  }

  /**
   * Agrupa por competencia no formato `YYYY-MM`.
   *
   * `billingPeriod` e `@db.Date` e chega como `Date` a meia-noite UTC. O
   * recorte e por `toISOString`, e nao por `getMonth()`: o segundo usa o fuso
   * DO SERVIDOR, e a competencia de 01/08 gravada as 00:00 UTC viraria julho
   * em qualquer maquina a oeste de Greenwich -- incluindo a academia. E o
   * mesmo bug de um dia que a serializacao de `billingPeriod` ja produziu na
   * F53.
   */
  private porCompetencia(
    linhas: readonly { competencia: Date; minor: number }[],
  ): ReadonlyMap<string, number> {
    const mapa = new Map<string, number>();

    for (const linha of linhas) {
      const chave = linha.competencia.toISOString().slice(0, 7);
      mapa.set(chave, (mapa.get(chave) ?? 0) + linha.minor);
    }

    return mapa;
  }

  /**
   * Composicao da divida por idade do atraso.
   *
   * TODA INVOICE VENCIDA CAI EM EXATAMENTE UMA FAIXA -- a soma das barras tem
   * de bater com `vencidoMinor`. Se uma escapar, o grafico contradiz o numero
   * ao lado e quem confere perde a confianca na tela inteira. Foi o cuidado
   * que a F15 documentou, e vale igual aqui.
   *
   * O piso da primeira faixa e ZERO INCLUSIVE e nao -1 como na F15: la a
   * escada comecava depois do estado "em carencia" e precisava recuperar o
   * bloqueado de dia zero; aqui nao ha estado de acesso, entao o dia zero de
   * atraso e simplesmente o primeiro dia da primeira faixa.
   */
  private faixas(
    vencidas: readonly { totalMinor: number; dueAt: Date }[],
    agora: Date,
  ): readonly FaixaDaDivida[] {
    return FAIXAS.map((faixa) => {
      const daFaixa = vencidas.filter((invoice) => {
        const dias = Math.floor((agora.getTime() - invoice.dueAt.getTime()) / UM_DIA_EM_MS);

        return dias >= faixa.de && dias < faixa.ate;
      });

      return {
        rotulo: faixa.rotulo,
        minorTotal: daFaixa.reduce((soma, invoice) => soma + invoice.totalMinor, 0),
        quantidade: daFaixa.length,
      };
    });
  }
}
