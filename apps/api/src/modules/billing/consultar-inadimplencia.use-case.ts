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

/**
 * Situacao de acesso derivada do `Entitlement` real da assinatura -- ver o
 * comentario de `situacao()` (FIX #392) para o porque disto existir.
 */
type SituacaoDoEntitlement = 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'SCHEDULED' | 'EXPIRED' | null;

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
  /**
   * Quantas FATURAS estao vencidas -- o card "Faturas vencidas agora" da
   * tela. Um aluno com duas competencias em atraso conta DUAS.
   */
  readonly faturasVencidas: number;
  /**
   * Quantas PESSOAS devem -- o contador da aba "Inadimplentes" (issue #416).
   *
   * Separado de `faturasVencidas` porque a aba vizinha ("Pagantes") conta
   * aluno distinto: enquanto esta contava fatura, as duas mediam unidades
   * diferentes lado a lado e a comparacao entre elas nao significava nada.
   */
  readonly alunosInadimplentes: number;
  readonly bloqueados: number;
  /** Percentual com uma casa. `null` quando nao ha assinatura ativa alguma. */
  readonly taxaDeInadimplencia: number | null;
}

export interface PainelDeInadimplencia {
  readonly resumo: ResumoDaInadimplencia;
  readonly faixas: readonly FaixaDeAtraso[];
  readonly linhas: readonly LinhaDeInadimplencia[];
  /** Ha mais linhas depois desta pagina? `null` quando nao ha proxima. */
  readonly proximoCursor: string | null;
}

/** Filtro e paginacao da fila -- pedido do PI (busca por nome, 10 em 10). */
export interface OpcoesDeConsulta {
  /** Nome do aluno, comparacao livre de acentos e caixa. */
  readonly busca?: string;
  /** `invoiceId` da ultima linha da pagina anterior. */
  readonly cursor?: string;
}

const TAMANHO_DA_PAGINA = 10;

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

/**
 * Compara nome livre de acento e caixa -- "jose" acha "José", "MARIA" acha
 * "maria". Mesmo padrao de `semAcento` em `triagem-de-alias.ts` (engagement),
 * repetido aqui em vez de importado: e uma funcao de duas linhas, e importar
 * de outro modulo por isto criaria acoplamento que a regra de arquitetura no
 * 9 reserva para caso de uso publico, nao para um utilitario deste tamanho.
 */
function nomeContem(nome: string, busca: string): boolean {
  const semAcento = (texto: string): string =>
    texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  return semAcento(nome).includes(semAcento(busca));
}

@Injectable()
export class ConsultarInadimplenciaUseCase {
  constructor(private readonly db: PrismaService) {}

  /**
   * `agora` entra por parametro (`CLAUDE.md`): "dias em atraso" e a situacao
   * dependem do relogio, e o teste precisa fixar o instante.
   *
   * `opcoes` filtra e pagina SO a lista devolvida -- `resumo` e `faixas`
   * continuam sobre o TENANT INTEIRO, nunca sobre a pagina atual. Se o cartao
   * "Faturas vencidas agora" mudasse ao digitar na busca, ele deixaria de
   * responder "quanto e a divida real" e passaria a responder "quantos
   * resultados bateram com o texto" -- duas perguntas diferentes.
   */
  async executar(
    contexto: TenantContext,
    agora: Date,
    opcoes: OpcoesDeConsulta = {},
  ): Promise<PainelDeInadimplencia> {
    const configuracao = await this.db.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
      select: { graceDays: true, blockAnchor: true },
    });

    /*
     * FIX (issue #306, mesmo padrao ja documentado em `EmitirReciboUseCase`):
     * `comTenant`, embora a raiz seja `invoice`. O `select` traz `student` por
     * baixo, e `students` TEM politica RLS (F66). Fora de transacao
     * interceptada o `set_config` nunca aplica, e sob o role restrito
     * (`RUNTIME_DATABASE_URL`, o que a API usa de verdade) o aninhado vinha
     * NULO enquanto a raiz voltava inteira -- o Prisma tipa a relacao como
     * nao-nula, entao nem o TypeScript nem um teste de integracao SEM RLS
     * avisavam. Reproduzido contra o tenant Arena Positiva: toda invoice
     * vencida vinha com `student: null`, e `invoice.student.fullName` estourava
     * em runtime.
     */
    const invoices = await this.db.comTenant((tx) =>
      tx.invoice.findMany({
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
          subscriptionId: true,
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
      }),
    );

    /**
     * O ENTITLEMENT REAL de cada assinatura envolvida, numa consulta so --
     * ver `situacao()` para o porque de precisar disto (FIX #392).
     *
     * Uma assinatura pode ter mais de um Entitlement no historico (F17); o
     * que importa aqui e o mais recente por `createdAt`, que e o vigente.
     */
    const entitlementsPorAssinatura = await this.entitlementsVigentes(
      contexto.tenantId,
      [...new Set(invoices.map((i) => i.subscriptionId))],
    );

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
      situacao: this.situacao(
        invoice,
        configuracao,
        agora,
        entitlementsPorAssinatura.get(invoice.subscriptionId) ?? null,
      ),
      telefone:
        invoice.student.contacts.find((c) => c.type === 'WHATSAPP')?.value ??
        invoice.student.contacts[0]?.value ??
        null,
      liberadoAte: liberadoAte.get(invoice.studentId) ?? null,
      fusoDaUnidade: invoice.student.gymUnit.timezone,
    }));

    const ordenadas = this.ordenadasPorUrgencia(linhas);
    const { pagina, proximoCursor } = this.paginar(ordenadas, opcoes);

    return {
      resumo: await this.resumo(contexto, linhas),
      faixas: this.faixas(linhas),
      linhas: pagina,
      proximoCursor,
    };
  }

  /**
   * Busca por nome (livre de acento e caixa) e paginacao por cursor -- as
   * DUAS em memoria, sobre a lista ja ordenada por urgencia.
   *
   * NAO E SQL porque a ordenacao nao e uma coluna do banco: `valor x dias` e
   * calculado apos juntar invoice, entitlement e liberacao (ver
   * `ordenadasPorUrgencia`). Pedir ao Postgres para paginar uma ordem que so
   * existe depois do calculo exigiria refazer o calculo inteiro em SQL, ou
   * duas leituras. Em memoria, sobre o volume real de uma academia (centenas
   * de faturas vencidas, nao milhoes), o custo e desprezivel -- o mesmo motivo
   * que ja fazia a consulta trazer tudo de uma vez, sem paginacao alguma, ate
   * esta fatia.
   *
   * CURSOR = INVOICEID da ultima linha da pagina anterior, nao um numero de
   * pagina: a lista pode mudar de tamanho entre uma carga e outra (fatura
   * paga sai da fila), e um numero fixo devolveria a pagina errada. Buscando
   * o indice do cursor na lista ATUAL, a proxima pagina sempre comeca
   * imediatamente apos a ultima linha que a pessoa viu.
   */
  private paginar(
    linhas: readonly LinhaDeInadimplencia[],
    opcoes: OpcoesDeConsulta,
  ): { pagina: readonly LinhaDeInadimplencia[]; proximoCursor: string | null } {
    const filtradas = opcoes.busca
      ? linhas.filter((linha) => nomeContem(linha.studentName, opcoes.busca!))
      : linhas;

    const inicio = opcoes.cursor
      ? filtradas.findIndex((linha) => linha.invoiceId === opcoes.cursor) + 1
      : 0;

    /*
     * CURSOR NAO ENCONTRADO (`findIndex` devolveu -1, `inicio` vira 0) volta
     * para a PRIMEIRA pagina, em vez de lancar erro ou devolver lista vazia.
     * Acontece de verdade quando a fatura que ancorava o cursor foi paga
     * entre uma pagina e outra -- a recepcao nao pode ficar presa numa tela
     * em branco por isso.
     */
    const pagina = filtradas.slice(inicio, inicio + TAMANHO_DA_PAGINA);
    const haProxima = inicio + TAMANHO_DA_PAGINA < filtradas.length;
    const ultima = pagina[pagina.length - 1];

    return {
      pagina,
      proximoCursor: haProxima && ultima ? ultima.invoiceId : null,
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

      if (a.dueAt.getTime() !== b.dueAt.getTime()) {
        return a.dueAt.getTime() - b.dueAt.getTime();
      }

      /**
       * DESEMPATE FINAL PELO ID, apontado pela revisao.
       *
       * Duas faturas do mesmo valor, mesmo atraso e mesmo vencimento -- o caso
       * comum de faturamento em lote de um plano so -- empatavam em todos os
       * criterios, e a ordem caia para o que o Postgres devolvesse. Sem chave
       * de desempate no `ORDER BY`, isso NAO e estavel: as duas trocavam de
       * lugar entre recargas, sem nenhum dado ter mudado.
       *
       * A fila de cobranca dançando sozinha faz quem trabalha nela perder a
       * marca de onde parou.
       */
      return a.invoiceId.localeCompare(b.invoiceId);
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
   * O ENTITLEMENT MAIS RECENTE de cada assinatura da lista, numa consulta so.
   *
   * `distinct` nao alcanca "o mais recente por grupo" no Prisma -- ordena
   * por `subscriptionId` e depois `createdAt desc`, e o primeiro de cada
   * assinatura no laco e o vigente. Lista vazia de `subscriptionIds` nao
   * dispara consulta: nenhuma invoice vencida, nada a resolver.
   */
  private async entitlementsVigentes(
    tenantId: string,
    subscriptionIds: readonly string[],
  ): Promise<ReadonlyMap<string, SituacaoDoEntitlement>> {
    if (subscriptionIds.length === 0) {
      return new Map();
    }

    const entitlements = await this.db.entitlement.findMany({
      where: { tenantId, subscriptionId: { in: [...subscriptionIds] } },
      select: { subscriptionId: true, status: true },
      orderBy: { createdAt: 'desc' },
    });

    const mapa = new Map<string, SituacaoDoEntitlement>();
    for (const entitlement of entitlements) {
      if (entitlement.subscriptionId === null) continue;
      if (!mapa.has(entitlement.subscriptionId)) {
        mapa.set(entitlement.subscriptionId, entitlement.status);
      }
    }

    return mapa;
  }

  /**
   * Bloqueado ou em carencia?
   *
   * FIX #392: "Bloqueado" so pode ser afirmado quando o ENTITLEMENT REAL da
   * assinatura esta `SUSPENDED` ou `REVOKED` -- e a Regra de Arquitetura no 1
   * (`CLAUDE.md`): "Pagamento nao controla acesso. Entitlement controla."
   *
   * A conta de `blockAt`/`graceDays` abaixo continua existindo, mas so decide
   * ENTRE "em carencia" e "vencida sem bloqueio real" -- nunca produz
   * "Bloqueado" sozinha. Antes deste fix, uma invoice vencida virava
   * "Bloqueado" na tela mesmo quando `AplicarInadimplenciaUseCase` (o job que
   * de fato suspende o Entitlement) nunca tinha rodado -- a recepcao lia
   * "sem acesso a catraca" para alguem que continuava entrando normalmente.
   *
   * SEM CONFIGURACAO, OU SEM ENTITLEMENT LOCALIZADO, NUNCA BLOQUEIA. O mesmo
   * criterio do job: a tela nao pode afirmar um bloqueio que o motor nao
   * aplica nem consegue confirmar.
   */
  private situacao(
    invoice: { dueAt: Date; blockAt: Date | null; student: { gymUnit: { timezone: string } } },
    configuracao: { graceDays: number; blockAnchor: 'DUE_PLUS_GRACE' } | null,
    agora: Date,
    situacaoDoEntitlement: SituacaoDoEntitlement,
  ): SituacaoDeAcesso {
    if (situacaoDoEntitlement !== 'SUSPENDED' && situacaoDoEntitlement !== 'REVOKED') {
      return 'EM_CARENCIA';
    }

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
      alunosInadimplentes: inadimplentes,
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
