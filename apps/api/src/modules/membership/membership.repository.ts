import { Injectable } from '@nestjs/common';
import type {
  Entitlement,
  GuestPass,
  Plan,
  PlanPrice,
  Prisma,
  Subscription,
} from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { competenciaDe, inicioDoProximoCiclo } from '../billing/domain/ciclo-de-cobranca.js';
import { validarValorMonetario } from '../billing/domain/dinheiro.js';
import { cpfEhValido, normalizarCpf } from '../students/domain/identificacao.js';
import { alunoRecebeAcessoNormal, type StatusDeAluno } from '../students/domain/student.js';
import { StudentRepository } from '../students/student.repository.js';
import { montarSnapshotDePolitica } from './domain/entitlement.js';
import { competenciaMensalDe, limiteDeConvidadosExcedido } from './domain/guest-pass.js';
import { validarJanelas, type JanelaDeAcesso } from './domain/plan.js';

export class PlanoNaoEncontradoError extends ErroDeDominio {
  constructor() {
    super('PLAN_NOT_FOUND', 404, 'Plano nao encontrado');
  }
}

export class AlunoNaoElegivelError extends ErroDeDominio {
  constructor(status: string) {
    super('STUDENT_NOT_ELIGIBLE', 409, `Aluno em estado ${status} nao recebe acesso normal`);
  }
}

export class ConflitoDeVersaoError extends ErroDeDominio {
  constructor() {
    super('SUBSCRIPTION_VERSION_CONFLICT', 409, 'A assinatura mudou durante a operacao');
  }
}

/**
 * `validFrom` de reajuste ja usado para este plano. `@@unique([planId,
 * validFrom])` da a garantia; este erro traduz o `P2002` em 409 de dominio.
 */
export class PrecoDeVigenciaDuplicadaError extends ErroDeDominio {
  constructor() {
    super(
      'PLAN_PRICE_VALID_FROM_TAKEN',
      409,
      'Ja existe um preco cadastrado para esta data de vigencia',
    );
  }
}

/** Direitos por `createMany` na propagacao de janelas -- ver `propagarJanelasAosDireitos`. */
const DIREITOS_POR_LOTE = 500;

/**
 * Reajuste com `validFrom` no passado.
 *
 * DECISAO DESTA FATIA (registrada no relatorio): recusar, nao aceitar com
 * aviso. `validFrom` retroativo mudaria o preco de competencias que ainda
 * nao foram cobradas sem o operador escolher isso deliberadamente -- e a
 * tela ainda nao tem um passo de confirmacao para esse caso. Aceitar em
 * silencio seria o comportamento acidental que o brief pede para nao
 * deixar acontecer.
 */
export class ReajusteRetroativoError extends ErroDeDominio {
  constructor() {
    super(
      'PLAN_PRICE_RETROACTIVE',
      422,
      'validFrom nao pode estar no passado; reajuste retroativo nao e permitido',
    );
  }
}

/**
 * Desativacao de plano que ainda tem aluno vinculado.
 *
 * DECISAO DO PI (24/08/2026): plano nao se APAGA, se DESATIVA -- quem teve
 * assinatura nele mantem o registro legivel e a auditoria nao fica com
 * referencia quebrada. E a desativacao e recusada enquanto houver aluno
 * USANDO: `PENDING`, `ACTIVE`, `PAST_DUE` e `PAUSED` ainda vinculam alguem.
 *
 * `CANCELLED` e `EXPIRED` NAO bloqueiam: sao historico, e exigir que nenhuma
 * assinatura tenha existido tornaria indesativavel todo plano que ja rodou
 * uma vez -- exatamente os que mais precisam sair da lista de escolha.
 */
export class PlanoEmUsoError extends ErroDeDominio {
  constructor(assinaturas: number) {
    super(
      'PLAN_IN_USE',
      409,
      `Plano tem ${assinaturas} assinatura(s) em vigor; encerre-as antes de desativar`,
    );
  }
}

/**
 * Plano sem janela de acesso nao gera direito nenhum.
 *
 * O snapshot de politica sairia vazio e o entitlement nasceria ATIVO sem
 * liberar hora nenhuma: a ficha diz que o aluno tem acesso, a catraca nega,
 * e a divergencia so aparece com o aluno parado no totem. Recusar aqui troca
 * uma falha invisivel por um erro que a recepcao ve na hora, com o que fazer
 * a respeito.
 *
 * `POST /plans` ja exige `janelas: min(1)`, entao este estado nao nasce pela
 * API -- nasce de escrita direta no banco (era o caso do seed, issue #188).
 * A guarda fica assim mesmo: quem cria o entitlement e quem responde por ele.
 */
export class PlanoSemJanelaError extends ErroDeDominio {
  constructor() {
    super(
      'PLAN_HAS_NO_ACCESS_WINDOW',
      422,
      'Plano nao tem janela de acesso e por isso nao libera a catraca; cadastre o horario do plano',
    );
  }
}

/**
 * Troca agendada para o plano que a assinatura ja tem -- nao ha o que trocar.
 * Recusar aqui e melhor que agendar uma troca que o job aplicaria como no-op
 * e que ainda cancelaria a invoice do mes.
 */
export class TrocaParaOMesmoPlanoError extends ErroDeDominio {
  constructor() {
    super('SUBSCRIPTION_PLAN_UNCHANGED', 422, 'A assinatura ja esta neste plano');
  }
}

/**
 * Vigencia da assinatura acaba antes do proximo ciclo: a troca nunca valeria.
 * Quem quer o plano novo depois disso renova -- e outro ato, com outro
 * periodo.
 */
export class TrocaAposOFimDaVigenciaError extends ErroDeDominio {
  constructor() {
    super(
      'SUBSCRIPTION_ENDS_BEFORE_NEXT_CYCLE',
      422,
      'A vigencia termina antes do proximo ciclo; renove no plano novo em vez de agendar a troca',
    );
  }
}

/**
 * Assinatura cujo plano nao tem `guestPassesPerMonth` (F76, ADR-060).
 *
 * O limite vive no PLANO, nao na assinatura -- registrar convidado sem que
 * o plano ofereca o beneficio seria conceder algo que a venda nunca
 * prometeu.
 */
export class BeneficioDeConvidadoNaoIncluidoError extends ErroDeDominio {
  constructor() {
    super(
      'GUEST_PASS_NOT_INCLUDED',
      422,
      'O plano desta assinatura nao inclui convidados',
    );
  }
}

/** CPF do convidado reprovado pelo digito verificador (INV-014, mesma regra de aluno). */
export class CpfDeConvidadoInvalidoError extends ErroDeDominio {
  constructor() {
    super('GUEST_PASS_INVALID_CPF', 422, 'CPF do convidado invalido');
  }
}

/** Limite mensal de convidados da assinatura ja foi usado (SPEC-076 5). */
export class LimiteDeConvidadosExcedidoError extends ErroDeDominio {
  constructor(limite: number) {
    super(
      'GUEST_PASS_LIMIT_EXCEEDED',
      409,
      `Limite de ${limite} convidado(s) neste mes ja foi atingido`,
    );
  }
}

export interface DadosDeCriacaoDePlano {
  name: string;
  description?: string | undefined;
  gymUnitIds: readonly string[];
  janelas: readonly JanelaDeAcesso[];
  salesStartAt?: Date | undefined;
  salesEndAt?: Date | undefined;
  /** Centavos, INV-065. Preco vigente a partir de agora, na mesma transacao do plano. */
  amountMinor: number;
  /**
   * Modalidade de cobranca (ADR-043, Decisao 2). Ausente = `AVULSO`, que e o
   * default da coluna -- plano criado por chamador antigo continua avulso.
   */
  billingMode?: 'AVULSO' | 'ASSINATURA' | 'DIARIA' | undefined;
  /**
   * Limite mensal de convidados (F76, ADR-060). Ausente = sem o beneficio,
   * mesmo default da coluna.
   */
  guestPassesPerMonth?: number | undefined;
}

export interface DadosDeEdicaoDePlano {
  name: string;
  description?: string | undefined;
  gymUnitIds: readonly string[];
  janelas: readonly JanelaDeAcesso[];
}

export interface DadosDeReajuste {
  amountMinor: number;
  validFrom: Date;
}

@Injectable()
export class MembershipRepository {
  constructor(
    private readonly db: PrismaService,
    /**
     * A conversa com o modulo `students` passa por AQUI, e nao por
     * `db.student` (regra de arquitetura no 9). O `StudentsModule` exporta
     * este provider justamente para isso.
     */
    private readonly alunos: StudentRepository,
  ) {}

  /**
   * Sentinela para "sem termino previsto" -- distingue assinatura recorrente
   * com prazo aberto (endsAt null) de entitlement que exige endsAt nao-nulo
   * no schema. O valor absurdamente distante evita colisao com datas legais e
   * torna o intent claro em logs/queries. Mesma pratica em
   * `operations.repository.ts:escolherVigenciaMaisLonga`.
   */
  private readonly SEM_TERMINO_PREVISTO = new Date('9999-12-31T00:00:00.000Z');

  // -------------------------------------------------------------------------
  // Planos
  // -------------------------------------------------------------------------

  /**
   * Cria plano, unidades, janelas e a PRIMEIRA linha de preco numa unica
   * transacao.
   *
   * O preco entra aqui, e nao numa rota separada, para o plano nunca
   * existir sem preco -- nem por um instante (decisao do PI, 24/08/2026).
   *
   * `validFrom = competenciaDe(agora)`, NAO o instante exato da criacao.
   * ACHADO [FIX] registrado no PR desta fatia: com `validFrom = agora`
   * literal, um plano criado no dia 24 nascia com vigencia a partir do dia
   * 24 -- mas `abrirInvoiceDoPeriodo` calcula a competencia como o
   * PRIMEIRO DIA do mes corrente (`competenciaDe`), e `precoVigenteEm` exige
   * `validFrom <= competencia`. Resultado: todo plano criado fora do dia 1
   * nascia SEM conseguir cobrar a propria competencia do mes em que nasceu
   * -- o oposto do que esta fatia promete ("plano criado pela API ja nasce
   * cobravel"). Normalizar para o inicio da competencia fecha a lacuna sem
   * tocar `precoVigenteEm`/`competenciaDe` (funcoes puras ja testadas por
   * outros caminhos) e sem violar nenhuma invariante: a vigencia so recua
   * dentro do MESMO mes em que o plano nasceu, nunca para tras dele.
   * "Agora" ainda vem de `new Date()` no controller, nunca daqui dentro
   * (regra de arquitetura: "agora" entra por parametro).
   *
   * As unidades sao conferidas contra o tenant ANTES de gravar: `PlanUnit`
   * nao tem FK para `GymUnit` (a relacao e por id solto), entao sem esta
   * checagem daria para vincular um plano a unidade de outra academia.
   */
  async criarPlano(
    contexto: TenantContext,
    dados: DadosDeCriacaoDePlano,
    correlationId: string,
    agora: Date,
  ): Promise<Plan> {
    const janelas = validarJanelas(dados.janelas);

    validarValorMonetario(dados.amountMinor);

    const unidades = await this.db.gymUnit.findMany({
      where: { id: { in: [...dados.gymUnitIds] }, tenantId: contexto.tenantId },
      select: { id: true },
    });

    if (unidades.length !== dados.gymUnitIds.length) {
      throw new ErroDeDominio('PLAN_UNIT_NOT_FOUND', 422, 'Unidade inexistente neste tenant');
    }

    // Janela que aponta para unidade fora do plano seria regra morta: nunca
    // avaliada, e mesmo assim gravada. Recusar e mais honesto que ignorar.
    const permitidas = new Set(dados.gymUnitIds);
    for (const janela of janelas) {
      if (!permitidas.has(janela.gymUnitId)) {
        throw new ErroDeDominio(
          'PLAN_WINDOW_UNIT_NOT_IN_PLAN',
          422,
          'Janela aponta para unidade que nao esta no plano',
        );
      }
    }

    return this.db.$transaction(async (tx) => {
      const plano = await tx.plan.create({
        data: {
          tenantId: contexto.tenantId,
          name: dados.name,
          description: dados.description ?? null,
          ...(dados.billingMode === undefined ? {} : { billingMode: dados.billingMode }),
          guestPassesPerMonth: dados.guestPassesPerMonth ?? null,
          salesStartAt: dados.salesStartAt ?? null,
          salesEndAt: dados.salesEndAt ?? null,
          units: {
            create: dados.gymUnitIds.map((gymUnitId) => ({
              // F67: escrita aninhada NAO herda `tenant_id` do pai.
              tenantId: contexto.tenantId,
              gymUnitId,
            })),
          },
          accessWindows: {
            create: janelas.map((j) => ({ ...j, tenantId: contexto.tenantId })),
          },
          prices: {
            create: {
              tenantId: contexto.tenantId,
              amountMinor: dados.amountMinor,
              validFrom: competenciaDe(agora),
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'plan.created',
          target: 'plan',
          targetId: plano.id,
          correlationId,
          metadata: {
            name: plano.name,
            unidades: dados.gymUnitIds.length,
            amountMinor: dados.amountMinor,
            billingMode: plano.billingMode,
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'PlanCreated',
          aggregateType: 'Plan',
          aggregateId: plano.id,
          payload: { name: plano.name },
        },
      });

      return plano;
    });
  }

  async listarPlanos(contexto: TenantContext): Promise<PlanoComRegras[]> {
    return this.db.plan.findMany({
      where: { tenantId: contexto.tenantId },
      include: { units: true, accessWindows: true, prices: true },
      orderBy: { name: 'asc' },
    });
  }

  async encontrarPlano(contexto: TenantContext, id: string): Promise<PlanoComRegras | null> {
    return this.db.plan.findFirst({
      where: { id, tenantId: contexto.tenantId },
      include: { units: true, accessWindows: true, prices: true },
    });
  }

  /**
   * Liga e desliga o plano da lista de escolha.
   *
   * DESATIVA, NAO APAGA (decisao do PI, 24/08/2026). Apagar deixaria invoice
   * e timeline antigas citando um plano que nao existe mais -- e o historico
   * financeiro e auditado. `isActive` ja existia no schema, era lido pelo
   * DTO e exibido na tela; o que nunca existiu foi quem o escrevesse.
   *
   * DESATIVAR E RECUSADO com aluno em uso; REATIVAR nunca e, porque devolver
   * um plano a lista de escolha nao tira acesso de ninguem.
   *
   * `agora` nao entra aqui: nao ha decisao temporal nesta operacao.
   */
  /**
   * Edita nome, descricao, unidades e janelas do plano.
   *
   * PRECO FICA DE FORA: ele tem rota propria (`POST /plans/:id/prices`) e
   * historico de vigencia -- trocar o valor por aqui apagaria a linha do
   * tempo que INV-068 existe para preservar.
   *
   * UNIDADES E JANELAS ANDAM JUNTAS, e nao e escolha de conveniencia: a
   * janela aponta para `gymUnitId`, entao trocar a unidade sem reescrever as
   * janelas deixaria regra MORTA -- janela nunca avaliada, para uma unidade
   * que saiu do plano. Substituir as duas na mesma transacao e o unico jeito
   * de o plano nunca existir num estado incoerente.
   *
   * QUEM JA TEM O PLANO RECEBE A EDICAO (decisao do PI, 06/10/2026). Ate
   * entao valia so para assinaturas novas, e o horario do plano mudava sem a
   * catraca saber: 541 dos 543 direitos ativos ficaram com a copia antiga e
   * a recepcao via "Fora do horario do plano" para quem estava dentro dele.
   * As janelas de cada direito VIVO (agendado, ativo ou suspenso, ainda nao
   * vencido) sao trocadas pelas do plano na mesma transacao. O que ja
   * encerrou (revogado, expirado) e historico e nao se toca. O
   * `policySnapshot` segue como registro do que valia na concessao: quem
   * decide acesso e a janela, nao o snapshot.
   *
   * ENCURTAR o plano tira o horario de quem esta dentro, na hora -- e o
   * mesmo efeito de qualquer outra regra de plano, e fica na auditoria.
   */
  async editarPlano(
    contexto: TenantContext,
    id: string,
    dados: DadosDeEdicaoDePlano,
    correlationId: string,
    agora: Date,
  ): Promise<Plan> {
    const janelas = validarJanelas(dados.janelas);

    const existente = await this.db.plan.findFirst({
      where: { id, tenantId: contexto.tenantId },
      select: { id: true },
    });

    if (!existente) throw new PlanoNaoEncontradoError();

    // MESMA checagem da criacao: `PlanUnit` nao tem FK para `GymUnit` (a
    // relacao e por id solto), entao sem isto daria para mover o plano para
    // a unidade de outra academia.
    const unidades = await this.db.gymUnit.findMany({
      where: { id: { in: [...dados.gymUnitIds] }, tenantId: contexto.tenantId },
      select: { id: true },
    });

    if (unidades.length !== dados.gymUnitIds.length) {
      throw new ErroDeDominio('PLAN_UNIT_NOT_FOUND', 422, 'Unidade inexistente neste tenant');
    }

    const permitidas = new Set(dados.gymUnitIds);
    for (const janela of janelas) {
      if (!permitidas.has(janela.gymUnitId)) {
        throw new ErroDeDominio(
          'PLAN_WINDOW_UNIT_NOT_IN_PLAN',
          422,
          'Janela aponta para unidade que nao esta no plano',
        );
      }
    }

    return this.db.$transaction(async (tx) => {
      /*
       * SUBSTITUI, nao faz merge: `deleteMany` seguido de `create`. Merge
       * exigiria um identificador estavel de janela que nao existe -- e
       * tentar casar por (dia, inicio, fim) confundiria "mudei o horario"
       * com "criei outra faixa".
       */
      await tx.planUnit.deleteMany({ where: { planId: id } });
      await tx.planAccessWindow.deleteMany({ where: { planId: id } });

      const plano = await tx.plan.update({
        where: { id },
        data: {
          name: dados.name,
          description: dados.description ?? null,
          units: {
            create: dados.gymUnitIds.map((gymUnitId) => ({
              // F67: escrita aninhada NAO herda `tenant_id` do pai.
              tenantId: contexto.tenantId,
              gymUnitId,
            })),
          },
          accessWindows: {
            create: janelas.map((j) => ({ ...j, tenantId: contexto.tenantId })),
          },
        },
      });

      const direitosAtualizados = await this.propagarJanelasAosDireitos(
        tx,
        contexto.tenantId,
        id,
        janelas,
        agora,
      );

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'plan.updated',
          target: 'plan',
          targetId: id,
          correlationId,
          metadata: {
            name: plano.name,
            unidades: dados.gymUnitIds.length,
            janelas: janelas.length,
            direitosAtualizados,
          },
        },
      });

      return plano;
    });
  }

  /**
   * Troca as janelas de cada direito vivo do plano pelas do plano. Devolve
   * quantos direitos atualizou, para a auditoria.
   *
   * VIVO = agendado, ativo ou suspenso (pausa volta com o horario novo) e
   * ainda nao vencido. Revogado e expirado sao historico.
   *
   * SUBSTITUI, nao faz merge, pelo mesmo motivo da edicao do plano: nao ha
   * identificador estavel de janela para casar linha a linha.
   */
  private async propagarJanelasAosDireitos(
    tx: Prisma.TransactionClient,
    tenantId: string,
    planId: string,
    janelas: readonly JanelaDeAcesso[],
    agora: Date,
  ): Promise<number> {
    const direitos = await tx.entitlement.findMany({
      where: {
        tenantId,
        status: { in: ['SCHEDULED', 'ACTIVE', 'SUSPENDED'] },
        endsAt: { gt: agora },
        subscription: { planId },
      },
      select: { id: true },
    });

    if (direitos.length === 0) return 0;

    const ids = direitos.map((d) => d.id);

    await tx.entitlementUnitWindow.deleteMany({ where: { tenantId, entitlementId: { in: ids } } });
    // Em lotes: cada linha leva 7 binds (6 colunas + o `id`), e o Postgres
    // aceita 65.535 por comando. 500 direitos x 12 janelas ainda cabe folgado.
    for (let i = 0; i < ids.length; i += DIREITOS_POR_LOTE) {
      await tx.entitlementUnitWindow.createMany({
        data: ids
          .slice(i, i + DIREITOS_POR_LOTE)
          .flatMap((entitlementId) => janelas.map((j) => ({ ...j, entitlementId, tenantId }))),
      });
    }

    return ids.length;
  }

  async alterarAtivacaoDePlano(
    contexto: TenantContext,
    id: string,
    isActive: boolean,
    correlationId: string,
  ): Promise<Plan> {
    const plano = await this.db.plan.findFirst({
      where: { id, tenantId: contexto.tenantId },
      select: { id: true, name: true },
    });

    if (!plano) throw new PlanoNaoEncontradoError();

    if (!isActive) {
      /*
       * "EM USO" e o que ainda vincula aluno: PENDING, ACTIVE, PAST_DUE e
       * PAUSED. CANCELLED e EXPIRED sao historico -- exigir que nenhuma
       * assinatura tenha existido tornaria indesativavel todo plano que ja
       * rodou, que sao justamente os que mais precisam sair da lista.
       *
       * PAUSED entra porque pausa e reversivel: o aluno volta a ter acesso
       * ao retomar, e o plano precisa continuar de pe para isso.
       */
      const emUso = await this.db.subscription.count({
        where: {
          tenantId: contexto.tenantId,
          planId: id,
          status: { in: ['PENDING', 'ACTIVE', 'PAST_DUE', 'PAUSED'] },
        },
      });

      if (emUso > 0) throw new PlanoEmUsoError(emUso);
    }

    return this.db.$transaction(async (tx) => {
      const atualizado = await tx.plan.update({ where: { id }, data: { isActive } });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: isActive ? 'plan.activated' : 'plan.deactivated',
          target: 'plan',
          targetId: id,
          correlationId,
          metadata: { name: atualizado.name },
        },
      });

      return atualizado;
    });
  }

  /**
   * Reajuste: nova linha de vigencia, sem tocar nas invoices ja emitidas
   * (INV-068). O valor antigo continua na tabela, e `precoVigenteEm` passa a
   * escolher a linha nova a partir de `validFrom`.
   *
   * `validFrom` no passado e RECUSADO -- ver `ReajusteRetroativoError`.
   * `agora` entra por parametro, nunca `new Date()` aqui dentro.
   */
  async reajustarPreco(
    contexto: TenantContext,
    planId: string,
    dados: DadosDeReajuste,
    correlationId: string,
    agora: Date,
  ): Promise<PlanPrice> {
    validarValorMonetario(dados.amountMinor);

    // Compara DIA, nao instante: `validFrom` vem de um `<input type="date">` e
    // chega como meia-noite UTC. Contra o instante corrente, o proprio dia de
    // hoje era recusado a partir de 00:00:01 -- a recepcao nao conseguia dar
    // preco vigente hoje ao plano, so a partir de amanha.
    const inicioDeHoje = new Date(
      Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()),
    );

    if (dados.validFrom.getTime() < inicioDeHoje.getTime()) {
      throw new ReajusteRetroativoError();
    }

    const plano = await this.db.plan.findFirst({
      where: { id: planId, tenantId: contexto.tenantId },
      select: { id: true },
    });

    if (!plano) throw new PlanoNaoEncontradoError();

    try {
      return await this.db.$transaction(async (tx) => {
        const preco = await tx.planPrice.create({
          data: {
            tenantId: contexto.tenantId,
            planId,
            amountMinor: dados.amountMinor,
            validFrom: dados.validFrom,
          },
        });

        await tx.auditLog.create({
          data: {
            tenantId: contexto.tenantId,
            actorType: 'USER',
            actorId: contexto.actorId,
            action: 'plan.price_adjusted',
            target: 'plan',
            targetId: planId,
            correlationId,
            metadata: { amountMinor: dados.amountMinor, validFrom: dados.validFrom.toISOString() },
          },
        });

        await tx.outboxEvent.create({
          data: {
            tenantId: contexto.tenantId,
            eventType: 'PlanPriceAdjusted',
            aggregateType: 'Plan',
            aggregateId: planId,
            payload: { amountMinor: dados.amountMinor, validFrom: dados.validFrom.toISOString() },
          },
        });

        return preco;
      });
    } catch (erro) {
      if (violacaoDeUnicidade(erro)) {
        throw new PrecoDeVigenciaDuplicadaError();
      }

      throw erro;
    }
  }

  // -------------------------------------------------------------------------
  // Assinatura e entitlement
  // -------------------------------------------------------------------------

  /**
   * Trava a linha do aluno e reconfere a elegibilidade DENTRO da transacao.
   *
   * POR QUE NAO BASTA A CHECAGEM DE FORA: quem chama le o aluno antes de
   * abrir a transacao. Entre aquela leitura e a escrita, outra requisicao
   * pode arquivar o aluno -- e o direito nasceria ATIVO para quem acabou de
   * perder o acesso, violando INV-033 sem ninguem ter escrito uma linha
   * errada.
   *
   * `FOR UPDATE` segura a linha ate o commit: um `alterarStatus` concorrente
   * espera, e so entao decide -- enxergando o entitlement que criamos, que e
   * exatamente o que ele precisa suspender. Sem o lock, as duas transacoes
   * decidiriam sobre um estado que a outra ja mudou.
   *
   * A checagem de fora continua valendo: ela responde 409 sem custo de
   * transacao no caso comum. Esta aqui e a que fecha a janela.
   */
  private async travarAlunoElegivel(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    studentId: string,
  ): Promise<void> {
    const travado = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM students
      WHERE id = ${studentId}::uuid
        AND tenant_id = ${contexto.tenantId}::uuid
      FOR UPDATE
    `;

    const status = travado[0]?.status;

    if (!status) throw new ErroDeDominio('STUDENT_NOT_FOUND', 404, 'Aluno nao encontrado');

    if (!alunoRecebeAcessoNormal(status as StatusDeAluno)) {
      throw new AlunoNaoElegivelError(status);
    }
  }

  /**
   * Ativa a assinatura e DERIVA o entitlement na mesma transacao (INV-062).
   *
   * Aqui mora a regra de arquitetura no 1: quem concede acesso e o
   * entitlement, nunca a assinatura. O snapshot da politica e congelado
   * neste instante -- se o plano mudar amanha, o direito ja concedido nao
   * muda junto.
   *
   * NAO E IDEMPOTENTE, e isso e deliberado nesta fatia. Duas chamadas com a
   * mesma entrada criam DUAS assinaturas -- porque duas assinaturas para o
   * mesmo aluno sao um caso real (plano trocado, periodo novo), e nao ha
   * chave natural que distinga "repeti o clique" de "contratei de novo".
   *
   * Quem fecha isso e o `Idempotency-Key` do INV-087, que ainda nao existe
   * no repositorio: nenhuma rota o implementa, e inventa-lo aqui seria uma
   * regra de plataforma decidida dentro de uma fatia. Ate la, o duplo clique
   * na recepcao produz duas assinaturas visiveis na timeline -- erro que o
   * operador ve e corrige, e nao corrupcao silenciosa.
   */
  async ativarAssinatura(
    contexto: TenantContext,
    entrada: {
      studentId: string;
      planId: string;
      startsAt: Date;
      endsAt: Date;
      reason: string;
    },
    correlationId: string,
  ): Promise<{ subscription: Subscription; entitlement: Entitlement }> {
    // Porta publica do modulo `students` (regra de arquitetura no 9), nunca
    // `db.student` direto: a regra de elegibilidade mora la, e duplica-la
    // aqui a faria divergir na primeira mudanca.
    const aluno = await this.alunos.verificarElegibilidade(contexto, entrada.studentId);

    if (!aluno) throw new ErroDeDominio('STUDENT_NOT_FOUND', 404, 'Aluno nao encontrado');

    // INV-033: aluno inelegivel nao recebe direito novo. Bloquear aqui evita
    // criar entitlement que o motor negaria de todo jeito.
    if (!aluno.elegivel) throw new AlunoNaoElegivelError(aluno.status);

    const plano = await this.encontrarPlano(contexto, entrada.planId);
    if (!plano) throw new PlanoNaoEncontradoError();

    // Sem janela o entitlement nasceria ATIVO sem liberar hora nenhuma --
    // ver `PlanoSemJanelaError`. Antes da transacao: nao ha o que desfazer.
    if (plano.accessWindows.length === 0) throw new PlanoSemJanelaError();

    const janelas: JanelaDeAcesso[] = plano.accessWindows.map((j) => ({
      gymUnitId: j.gymUnitId,
      dayOfWeek: j.dayOfWeek,
      startMinute: j.startMinute,
      endMinute: j.endMinute,
    }));

    const snapshot = montarSnapshotDePolitica(
      plano.id,
      plano.name,
      plano.units.map((u) => u.gymUnitId),
      janelas,
    );

    return this.db.$transaction(async (tx) => {
      await this.travarAlunoElegivel(tx, contexto, entrada.studentId);

      const assinatura = await tx.subscription.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: entrada.studentId,
          planId: entrada.planId,
          status: 'ACTIVE',
          startsAt: entrada.startsAt,
          endsAt: entrada.endsAt,
          lastActorId: contexto.actorId,
          lastReason: entrada.reason,
        },
      });

      const entitlement = await tx.entitlement.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: entrada.studentId,
          source: 'SUBSCRIPTION',
          subscriptionId: assinatura.id,
          status: 'ACTIVE',
          startsAt: entrada.startsAt,
          endsAt: entrada.endsAt,
          policySnapshot: snapshot as unknown as Prisma.InputJsonValue,
          unitWindows: {
            create: janelas.map((j) => ({ ...j, tenantId: contexto.tenantId })),
          },
        },
      });

      await this.registrarDerivacao(tx, contexto, {
        studentId: entrada.studentId,
        subscriptionId: assinatura.id,
        entitlementId: entitlement.id,
        correlationId,
      });

      return { subscription: assinatura, entitlement };
    });
  }

  /** Timeline + auditoria + outbox da derivacao, na mesma transacao. */
  private async registrarDerivacao(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    dados: {
      studentId: string;
      subscriptionId: string;
      entitlementId: string;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.studentTimelineEvent.createMany({
      data: [
        {
          tenantId: contexto.tenantId,
          studentId: dados.studentId,
          type: 'SUBSCRIPTION_ACTIVATED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId: dados.correlationId,
          payload: { subscriptionId: dados.subscriptionId },
        },
        {
          tenantId: contexto.tenantId,
          studentId: dados.studentId,
          type: 'ENTITLEMENT_ACTIVATED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId: dados.correlationId,
          payload: { entitlementId: dados.entitlementId, source: 'SUBSCRIPTION' },
        },
      ],
    });

    await tx.auditLog.create({
      data: {
        tenantId: contexto.tenantId,
        actorType: 'USER',
        actorId: contexto.actorId,
        action: 'subscription.activated',
        target: 'subscription',
        targetId: dados.subscriptionId,
        correlationId: dados.correlationId,
        metadata: { entitlementId: dados.entitlementId },
      },
    });

    // Dois eventos porque sao dois fatos distintos: o comercial e o de
    // acesso. O consumidor de acesso (F9) so se importa com o segundo.
    await tx.outboxEvent.createMany({
      data: [
        {
          tenantId: contexto.tenantId,
          eventType: 'SubscriptionActivated',
          aggregateType: 'Subscription',
          aggregateId: dados.subscriptionId,
          payload: { studentId: dados.studentId },
        },
        {
          tenantId: contexto.tenantId,
          eventType: 'EntitlementActivated',
          aggregateType: 'Entitlement',
          aggregateId: dados.entitlementId,
          payload: { studentId: dados.studentId, source: 'SUBSCRIPTION' },
        },
      ],
    });
  }

  /**
   * SO a metade de `registrarDerivacao` que fala do ENTITLEMENT: timeline
   * `ENTITLEMENT_ACTIVATED` + outbox `EntitlementActivated`.
   *
   * NAO reaproveita `registrarDerivacao` inteiro (achado da revisao de
   * branch inteiro): aquele tambem grava `SUBSCRIPTION_ACTIVATED` +
   * `SubscriptionActivated` + `AuditLog` de `subscription.activated` -- que
   * aqui seria FALSO. A assinatura desta troca nao foi "ativada", foi criada
   * por uma substituicao, e ja tem o proprio evento dedicado
   * (`SUBSCRIPTION_PLAN_CHANGED`/`SubscriptionPlanChanged`, gravado por
   * `trocarPlanoDaAssinatura`). Duplicar o rotulo de ativacao confundiria
   * qualquer consumidor de outbox que conte ativacoes de assinatura.
   */
  private async registrarEntitlementAtivado(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    dados: { studentId: string; entitlementId: string; correlationId: string },
  ): Promise<void> {
    await tx.studentTimelineEvent.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: dados.studentId,
        type: 'ENTITLEMENT_ACTIVATED',
        actorType: 'USER',
        actorId: contexto.actorId,
        correlationId: dados.correlationId,
        payload: { entitlementId: dados.entitlementId, source: 'SUBSCRIPTION' },
      },
    });

    await tx.outboxEvent.create({
      data: {
        tenantId: contexto.tenantId,
        eventType: 'EntitlementActivated',
        aggregateType: 'Entitlement',
        aggregateId: dados.entitlementId,
        payload: { studentId: dados.studentId, source: 'SUBSCRIPTION' },
      },
    });
  }

  /**
   * Pausa, retoma ou cancela a assinatura, propagando ao entitlement.
   *
   * A propagacao e o ponto: mexer na assinatura sem mexer no direito
   * deixaria a catraca liberando quem a recepcao acabou de pausar --
   * exatamente o desalinhamento que a regra de arquitetura no 1 evita.
   *
   * Trava otimista por `version` (INV-061): comando que leu estado antigo
   * falha em vez de sobrescrever.
   */
  async alterarAssinatura(
    contexto: TenantContext,
    id: string,
    versaoEsperada: number,
    acao: 'PAUSE' | 'RESUME' | 'CANCEL',
    reason: string,
    correlationId: string,
    agora: Date,
  ): Promise<Subscription | null> {
    const mapa = {
      PAUSE: {
        assinatura: 'PAUSED',
        entitlement: 'SUSPENDED',
        evento: 'SUBSCRIPTION_PAUSED',
        acaoAuditada: 'subscription.paused',
      },
      RESUME: {
        assinatura: 'ACTIVE',
        entitlement: 'ACTIVE',
        evento: 'SUBSCRIPTION_RESUMED',
        acaoAuditada: 'subscription.resumed',
      },
      CANCEL: {
        assinatura: 'CANCELLED',
        entitlement: 'REVOKED',
        evento: 'SUBSCRIPTION_CANCELLED',
        acaoAuditada: 'subscription.cancelled',
      },
    } as const;

    const destino = mapa[acao];

    return this.db.$transaction(async (tx) => {
      const alterados = await tx.subscription.updateMany({
        where: { id, tenantId: contexto.tenantId, version: versaoEsperada },
        data: {
          status: destino.assinatura,
          version: { increment: 1 },
          lastActorId: contexto.actorId,
          lastReason: reason,
        },
      });

      if (alterados.count === 0) return null;

      const assinatura = await tx.subscription.findFirstOrThrow({
        where: { id, tenantId: contexto.tenantId },
      });

      // `REVOKED` e `EXPIRED` sao terminais (CONVENTION 3.3): retomar nao os
      // ressuscita. O filtro os deixa de fora em vez de tentar a transicao.
      await tx.entitlement.updateMany({
        where: {
          tenantId: contexto.tenantId,
          subscriptionId: id,
          status: { notIn: ['REVOKED', 'EXPIRED'] },
        },
        data: {
          status: destino.entitlement,
          ...(acao === 'PAUSE' ? { suspendedAt: agora } : {}),
          ...(acao === 'CANCEL' ? { revokedAt: agora } : {}),
          ...(acao === 'RESUME' ? { suspendedAt: null } : {}),
        },
      });

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: assinatura.studentId,
          type: destino.evento,
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          payload: { subscriptionId: id },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: destino.acaoAuditada,
          target: 'subscription',
          targetId: id,
          correlationId,
          // A razao e obrigatoria no comando e entra na trilha -- e o que
          // torna a decisao manual auditavel depois.
          metadata: { reason },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: `Subscription${acao === 'PAUSE' ? 'Paused' : acao === 'RESUME' ? 'Resumed' : 'Cancelled'}`,
          aggregateType: 'Subscription',
          aggregateId: id,
          payload: { studentId: assinatura.studentId },
        },
      });

      return assinatura;
    });
  }

  /**
   * Troca o plano de uma assinatura ACTIVE numa operacao atomica.
   *
   * NAO reaproveita `alterarAssinatura`: aquele muda o ESTADO da mesma
   * assinatura (PAUSE/RESUME/CANCEL); trocar plano CRIA uma assinatura nova
   * -- `planId` e imutavel numa `Subscription` existente. Substitui a UI
   * atual (`atribuir-plano.tsx`), que fazia isso como duas chamadas HTTP
   * separadas (CANCEL depois POST) com risco de falha parcial documentado
   * em comentario -- ver `apps/admin-web/app/actions/membership.ts:357-404`.
   *
   * Trava otimista por `version` (INV-061), mesmo padrao de
   * `alterarAssinatura`: comando que leu estado antigo devolve `null` em vez
   * de sobrescrever.
   */
  async trocarPlanoDaAssinatura(
    contexto: TenantContext,
    subscriptionId: string,
    entrada: { planId: string; versaoEsperada: number; reason: string },
    correlationId: string,
    agora: Date,
    /**
     * Reabre a parcela de UMA competencia cancelada, na assinatura nova. Roda
     * DENTRO da transacao da troca: se nao der para refazer a parcela, a troca
     * inteira volta atras -- melhor que um plano novo sem cobranca.
     */
    reabrirParcela?: (
      tx: Prisma.TransactionClient,
      subscriptionId: string,
      competencia: Date,
    ) => Promise<unknown>,
  ): Promise<{
    subscription: Subscription;
    entitlement: Entitlement;
    parcelasReabertas: number;
  } | null> {
    const origem = await this.encontrarAssinatura(contexto, subscriptionId);
    if (!origem) return null;

    if (origem.planId === entrada.planId) throw new TrocaParaOMesmoPlanoError();

    // INV-033, mesma ordem de `ativarAssinatura` (linha 676): falha ANTES da
    // transacao -- senao a assinatura antiga seria cancelada sem o aluno
    // poder receber a nova.
    const aluno = await this.alunos.verificarElegibilidade(contexto, origem.studentId);
    if (!aluno) throw new ErroDeDominio('STUDENT_NOT_FOUND', 404, 'Aluno nao encontrado');
    if (!aluno.elegivel) throw new AlunoNaoElegivelError(aluno.status);

    const plano = await this.encontrarPlano(contexto, entrada.planId);
    if (!plano) throw new PlanoNaoEncontradoError();

    // Falha ANTES da transacao: nao ha o que desfazer. Mesma ordem de
    // `ativarAssinatura` (linha 680) -- o entitlement nunca nasce sem
    // janela nenhuma (PlanoSemJanelaError).
    if (plano.accessWindows.length === 0) throw new PlanoSemJanelaError();

    const janelas: JanelaDeAcesso[] = plano.accessWindows.map((j) => ({
      gymUnitId: j.gymUnitId,
      dayOfWeek: j.dayOfWeek,
      startMinute: j.startMinute,
      endMinute: j.endMinute,
    }));

    const snapshot = montarSnapshotDePolitica(
      plano.id,
      plano.name,
      plano.units.map((u) => u.gymUnitId),
      janelas,
    );

    // Competencia CORRENTE apenas (achado da revisao de branch inteiro,
    // decisao do PI): trocar de plano cancela so a invoice do mes atual, nao
    // divida vencida de meses anteriores -- trocar de plano nao perdoa
    // atraso. Mesma funcao pura de normalizacao usada em todo o resto do
    // modulo de billing (`abrirInvoiceDoPeriodo`, `criarPlano`).
    const competenciaCorrente = competenciaDe(agora);

    return this.db.$transaction(async (tx) => {
      await this.travarAlunoElegivel(tx, contexto, origem.studentId);

      const alterados = await tx.subscription.updateMany({
        where: {
          id: subscriptionId,
          tenantId: contexto.tenantId,
          version: entrada.versaoEsperada,
          status: 'ACTIVE',
        },
        data: {
          status: 'CANCELLED',
          version: { increment: 1 },
          lastActorId: contexto.actorId,
          lastReason: entrada.reason,
        },
      });

      if (alterados.count === 0) return null;

      const antiga = await tx.subscription.findFirstOrThrow({
        where: { id: subscriptionId, tenantId: contexto.tenantId },
      });

      const nova = await tx.subscription.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: antiga.studentId,
          planId: entrada.planId,
          status: 'ACTIVE',
          startsAt: agora,
          // Mesma vigencia contratual -- trocar plano nao estende nem
          // encurta o contrato (spec SEC-082 #6).
          endsAt: antiga.endsAt,
          lastActorId: contexto.actorId,
          lastReason: entrada.reason,
        },
      });

      const entitlementNovo = await tx.entitlement.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: antiga.studentId,
          source: 'SUBSCRIPTION',
          subscriptionId: nova.id,
          status: 'ACTIVE',
          startsAt: agora,
          endsAt: antiga.endsAt ?? this.SEM_TERMINO_PREVISTO,
          policySnapshot: snapshot as unknown as Prisma.InputJsonValue,
          unitWindows: {
            create: janelas.map((j) => ({ ...j, tenantId: contexto.tenantId })),
          },
        },
      });

      // REVOKED e EXPIRED sao terminais (CONVENTION 3.3) -- mesmo filtro de
      // `alterarAssinatura` (linha 873).
      await tx.entitlement.updateMany({
        where: {
          tenantId: contexto.tenantId,
          subscriptionId,
          status: { notIn: ['REVOKED', 'EXPIRED'] },
        },
        data: { status: 'REVOKED', revokedAt: agora },
      });

      // Sem reemissao automatica -- a proxima cobranca sai do ciclo normal,
      // ja no plano novo (spec SEC-082 #6, fora de escopo #3). SO a
      // competencia CORRENTE: divida vencida de mes anterior nao e
      // perdoada pela troca (achado da revisao de branch inteiro). Caminho
      // comum tem ZERO invoice pendente: `updateMany` sobre zero linhas nao
      // e erro, so nao muda nada.
      const invoicesCanceladas = await tx.invoice.findMany({
        where: {
          tenantId: contexto.tenantId,
          subscriptionId,
          status: { in: ['OPEN', 'OVERDUE'] },
          // Corrente E futuras: parcela aberta adiante tambem e do plano
          // antigo. Mes anterior segue de fora (divida nao e perdoada).
          billingPeriod: { gte: competenciaCorrente },
        },
        select: { id: true, billingPeriod: true },
      });

      if (invoicesCanceladas.length > 0) {
        // Guarda de status NO UPDATE: um pagamento que comitou entre o `findMany`
        // e aqui deixou a invoice PAID, e PAID nao vai para CANCELLED.
        await tx.invoice.updateMany({
          where: {
            id: { in: invoicesCanceladas.map((i) => i.id) },
            status: { in: ['OPEN', 'OVERDUE'] },
          },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        });
      }

      // So o que de fato foi cancelado volta como parcela nova -- reabrir uma
      // competencia que ficou PAID cobraria o aluno em dobro.
      const canceladasDeFato =
        invoicesCanceladas.length === 0
          ? []
          : await tx.invoice.findMany({
              where: { id: { in: invoicesCanceladas.map((i) => i.id) }, status: 'CANCELLED' },
              select: { id: true, billingPeriod: true },
            });

      if (reabrirParcela) {
        for (const invoice of canceladasDeFato) {
          await reabrirParcela(tx, nova.id, invoice.billingPeriod);
        }
      }

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: antiga.studentId,
          type: 'SUBSCRIPTION_PLAN_CHANGED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          payload: {
            fromSubscriptionId: subscriptionId,
            toSubscriptionId: nova.id,
            fromPlanId: antiga.planId,
            toPlanId: entrada.planId,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'subscription.plan_changed',
          target: 'subscription',
          targetId: nova.id,
          correlationId,
          metadata: {
            fromSubscriptionId: subscriptionId,
            toSubscriptionId: nova.id,
            reason: entrada.reason,
            cancelledInvoiceIds: canceladasDeFato.map((i) => i.id),
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'SubscriptionPlanChanged',
          aggregateType: 'Subscription',
          aggregateId: nova.id,
          payload: {
            studentId: antiga.studentId,
            fromSubscriptionId: subscriptionId,
            toSubscriptionId: nova.id,
          },
        },
      });

      // MESMO evento de ENTITLEMENT que `ativarAssinatura` gera (achado da
      // revisao de branch inteiro): qualquer consumidor futuro de outbox que
      // espera `EntitlementActivated` para conceder/atualizar acesso nao
      // pode ficar cego so porque o entitlement nasceu de uma troca em vez
      // de uma ativacao. NAO usa `registrarDerivacao` inteiro -- ver
      // `registrarEntitlementAtivado`.
      await this.registrarEntitlementAtivado(tx, contexto, {
        studentId: antiga.studentId,
        entitlementId: entitlementNovo.id,
        correlationId,
      });

      return {
        subscription: nova,
        entitlement: entitlementNovo,
        parcelasReabertas: reabrirParcela ? canceladasDeFato.length : 0,
      };
    });
  }

  /**
   * AGENDA a troca de plano para o proximo ciclo (#337, decisao do PI de
   * 04/10/2026): sem proracao, sem credito, a assinatura vigente segue como
   * esta ate la. Agendar de novo SUBSTITUI o agendamento anterior.
   *
   * Nada de acesso muda agora -- nenhuma assinatura nasce, nenhum entitlement
   * e tocado. Quem aplica e `aplicarTrocaAgendada`, via job diario.
   *
   * Mesma trava otimista por `version` de `alterarAssinatura`: `null` = a
   * assinatura mudou (ou deixou de ser ACTIVE) desde a leitura.
   */
  async agendarTrocaDePlano(
    contexto: TenantContext,
    subscriptionId: string,
    entrada: { planId: string; versaoEsperada: number; reason: string },
    correlationId: string,
    agora: Date,
  ): Promise<Subscription | null> {
    const origem = await this.encontrarAssinatura(contexto, subscriptionId);
    if (!origem) return null;

    if (origem.planId === entrada.planId) throw new TrocaParaOMesmoPlanoError();

    const vigenteApartirDe = inicioDoProximoCiclo(agora);
    if (origem.endsAt !== null && origem.endsAt.getTime() < vigenteApartirDe.getTime()) {
      throw new TrocaAposOFimDaVigenciaError();
    }

    // Mesmas guardas de `trocarPlanoDaAssinatura`, ANTES de gravar: erro que a
    // recepcao ve agora, e nao um job que falha em silencio no dia 1.
    const aluno = await this.alunos.verificarElegibilidade(contexto, origem.studentId);
    if (!aluno) throw new ErroDeDominio('STUDENT_NOT_FOUND', 404, 'Aluno nao encontrado');
    if (!aluno.elegivel) throw new AlunoNaoElegivelError(aluno.status);

    const plano = await this.encontrarPlano(contexto, entrada.planId);
    if (!plano) throw new PlanoNaoEncontradoError();
    if (plano.accessWindows.length === 0) throw new PlanoSemJanelaError();

    return this.db.$transaction(async (tx) => {
      const alterados = await tx.subscription.updateMany({
        where: {
          id: subscriptionId,
          tenantId: contexto.tenantId,
          version: entrada.versaoEsperada,
          status: 'ACTIVE',
        },
        data: {
          scheduledPlanId: entrada.planId,
          scheduledPlanFrom: vigenteApartirDe,
          version: { increment: 1 },
          // Quem agenda e o ator que o job usa ao aplicar (nao ha usuario no
          // job), e a razao e a da troca.
          lastActorId: contexto.actorId,
          lastReason: entrada.reason,
        },
      });

      if (alterados.count === 0) return null;

      const agendada = await tx.subscription.findFirstOrThrow({
        where: { id: subscriptionId, tenantId: contexto.tenantId },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'subscription.plan_change_scheduled',
          target: 'subscription',
          targetId: subscriptionId,
          correlationId,
          metadata: {
            fromPlanId: origem.planId,
            toPlanId: entrada.planId,
            effectiveFrom: vigenteApartirDe.toISOString(),
            reason: entrada.reason,
          },
        },
      });

      return agendada;
    });
  }

  /**
   * Assinaturas ACTIVE cuja troca agendada ja venceu, de TODOS os tenants --
   * insumo do job diario. Cada uma e aplicada com o contexto do proprio tenant.
   */
  async listarTrocasAgendadasVencidas(
    agora: Date,
  ): Promise<
    readonly {
      id: string;
      tenantId: string;
      version: number;
      scheduledPlanId: string;
      lastActorId: string;
      lastReason: string;
    }[]
  > {
    const linhas = await this.db.subscription.findMany({
      where: {
        status: 'ACTIVE',
        scheduledPlanId: { not: null },
        scheduledPlanFrom: { lte: agora },
        lastActorId: { not: null },
        lastReason: { not: null },
      },
      orderBy: [{ scheduledPlanFrom: 'asc' }, { id: 'asc' }],
    });

    return linhas.map((l) => ({
      id: l.id,
      tenantId: l.tenantId,
      version: l.version,
      scheduledPlanId: l.scheduledPlanId!,
      lastActorId: l.lastActorId!,
      lastReason: l.lastReason!,
    }));
  }

  /**
   * Concede cortesia (INV-063): razao, responsavel e validade obrigatorios.
   *
   * `subscriptionId` fica nulo -- cortesia nao nasce de assinatura. Um
   * entitlement normal sobreposto NAO e alterado: sao direitos
   * independentes, e o motor de F9 resolve a sobreposicao pela regra mais
   * restritiva (INV-034).
   */
  async concederCortesia(
    contexto: TenantContext,
    entrada: {
      studentId: string;
      gymUnitIds: readonly string[];
      janelas: readonly JanelaDeAcesso[];
      startsAt: Date;
      endsAt: Date;
      reason: string;
    },
    correlationId: string,
  ): Promise<Entitlement> {
    const janelas = validarJanelas(entrada.janelas);

    const aluno = await this.alunos.verificarElegibilidade(contexto, entrada.studentId);

    if (!aluno) throw new ErroDeDominio('STUDENT_NOT_FOUND', 404, 'Aluno nao encontrado');

    // Cortesia nao contorna INV-033: aluno bloqueado nao recebe direito nem
    // por cortesia da gerencia.
    if (!aluno.elegivel) throw new AlunoNaoElegivelError(aluno.status);

    const unidades = await this.db.gymUnit.findMany({
      where: { id: { in: [...entrada.gymUnitIds] }, tenantId: contexto.tenantId },
      select: { id: true },
    });

    if (unidades.length !== entrada.gymUnitIds.length) {
      throw new ErroDeDominio('PLAN_UNIT_NOT_FOUND', 422, 'Unidade inexistente neste tenant');
    }

    const snapshot = montarSnapshotDePolitica(
      'COURTESY',
      'Cortesia',
      entrada.gymUnitIds,
      janelas,
    );

    return this.db.$transaction(async (tx) => {
      // Mesma janela de corrida da ativacao de assinatura: cortesia nao
      // contorna INV-033 nem por concorrencia.
      await this.travarAlunoElegivel(tx, contexto, entrada.studentId);

      const entitlement = await tx.entitlement.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: entrada.studentId,
          source: 'COURTESY',
          status: 'ACTIVE',
          startsAt: entrada.startsAt,
          endsAt: entrada.endsAt,
          grantedById: contexto.actorId,
          reason: entrada.reason,
          policySnapshot: snapshot as unknown as Prisma.InputJsonValue,
          unitWindows: {
            create: janelas.map((j) => ({ ...j, tenantId: contexto.tenantId })),
          },
        },
      });

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: entrada.studentId,
          type: 'COURTESY_GRANTED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          payload: { entitlementId: entitlement.id },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'entitlement.courtesy_granted',
          target: 'entitlement',
          targetId: entitlement.id,
          correlationId,
          metadata: { reason: entrada.reason },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'EntitlementActivated',
          aggregateType: 'Entitlement',
          aggregateId: entitlement.id,
          payload: { studentId: entrada.studentId, source: 'COURTESY' },
        },
      });

      return entitlement;
    });
  }

  /**
   * Registra o uso de um convidado sob a assinatura -- limite mensal do
   * plano, mes-calendario (F76, ADR-059/ADR-060, decisao do PI de
   * 18/09/2026).
   *
   * NAO CONCEDE ACESSO NOVO: o convidado passa pela catraca como VISITOR
   * (`Entitlement.source`, INV-064), caminho que ja existe hoje por
   * `ManualOverrideUseCase`. Esta funcao so registra QUEM usou o beneficio
   * e RECUSA acima do limite -- ela nunca cria `Entitlement`.
   *
   * TRAVA POR `Subscription FOR UPDATE`, mesmo remedio de
   * `travarAlunoElegivel`: sem ela, duas requisicoes simultaneas leem a
   * mesma contagem, as duas veem "1 de 2 usados" e as duas passam --
   * furando o limite por corrida. A trava serializa por assinatura, entao
   * a segunda requisicao so conta DEPOIS que a primeira commitou.
   */
  async registrarConvidado(
    contexto: TenantContext,
    entrada: {
      subscriptionId: string;
      guestName: string;
      guestCpf: string;
    },
    correlationId: string,
    agora: Date,
  ): Promise<GuestPass> {
    if (!cpfEhValido(entrada.guestCpf)) throw new CpfDeConvidadoInvalidoError();

    const competencia = competenciaMensalDe(agora);
    const proximaCompetencia = new Date(
      Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth() + 1, 1),
    );

    return this.db.$transaction(async (tx) => {
      const travada = await tx.$queryRaw<{ id: string; plan_id: string }[]>`
        SELECT s.id, s.plan_id
        FROM subscriptions s
        WHERE s.id = ${entrada.subscriptionId}::uuid
          AND s.tenant_id = ${contexto.tenantId}::uuid
        FOR UPDATE
      `;

      const assinatura = travada[0];
      if (!assinatura) {
        throw new ErroDeDominio('SUBSCRIPTION_NOT_FOUND', 404, 'Assinatura nao encontrada');
      }

      const plano = await tx.plan.findUniqueOrThrow({
        where: { id: assinatura.plan_id },
        select: { guestPassesPerMonth: true },
      });

      if (plano.guestPassesPerMonth === null) {
        throw new BeneficioDeConvidadoNaoIncluidoError();
      }

      const usosNoMes = await tx.guestPass.count({
        where: {
          tenantId: contexto.tenantId,
          subscriptionId: entrada.subscriptionId,
          usedAt: { gte: competencia, lt: proximaCompetencia },
        },
      });

      if (limiteDeConvidadosExcedido(usosNoMes, plano.guestPassesPerMonth)) {
        throw new LimiteDeConvidadosExcedidoError(plano.guestPassesPerMonth);
      }

      const convidado = await tx.guestPass.create({
        data: {
          tenantId: contexto.tenantId,
          subscriptionId: entrada.subscriptionId,
          guestName: entrada.guestName,
          guestCpf: normalizarCpf(entrada.guestCpf),
          usedAt: agora,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'guest_pass.registered',
          target: 'guest_pass',
          targetId: convidado.id,
          correlationId,
          metadata: { subscriptionId: entrada.subscriptionId },
        },
      });

      return convidado;
    });
  }

  async listarConvidados(
    contexto: TenantContext,
    subscriptionId: string,
  ): Promise<GuestPass[]> {
    const assinatura = await this.db.subscription.findFirst({
      where: { id: subscriptionId, tenantId: contexto.tenantId },
      select: { id: true },
    });

    if (!assinatura) {
      throw new ErroDeDominio('SUBSCRIPTION_NOT_FOUND', 404, 'Assinatura nao encontrada');
    }

    return this.db.guestPass.findMany({
      where: { tenantId: contexto.tenantId, subscriptionId },
      orderBy: [{ usedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async listarEntitlementsDoAluno(
    contexto: TenantContext,
    studentId: string,
  ): Promise<EntitlementComJanelas[]> {
    return this.db.entitlement.findMany({
      where: { tenantId: contexto.tenantId, studentId },
      include: {
        unitWindows: true,
        /*
         * F56: a ficha precisa saber se JA EXISTE recorrencia (mostra
         * "encerrar") ou nao (mostra "ativar"), e se o plano sequer aceita
         * assinatura. Sem os tres campos a tela faria uma segunda viagem por
         * assinatura listada.
         */
        subscription: {
          select: {
            version: true,
            externalSubscriptionId: true,
            scheduledPlanId: true,
            scheduledPlanFrom: true,
            plan: { select: { billingMode: true, name: true, prices: true } },
          },
        },
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    });
  }

  async encontrarAssinatura(
    contexto: TenantContext,
    id: string,
  ): Promise<Subscription | null> {
    return this.db.subscription.findFirst({ where: { id, tenantId: contexto.tenantId } });
  }

  /**
   * Timeline administrativa com cursor `(occurredAt, id)`.
   *
   * `id` desempata eventos no mesmo instante -- sem ele, paginacao por
   * cursor pula ou repete linha quando dois eventos compartilham o
   * timestamp, que e o caso comum: a transacao grava varios de uma vez.
   */
  async lerTimeline(
    contexto: TenantContext,
    studentId: string,
    limite: number,
    cursor?: { occurredAt: Date; id: string },
  ): Promise<EventoDeTimeline[]> {
    return this.db.studentTimelineEvent.findMany({
      where: {
        tenantId: contexto.tenantId,
        studentId,
        ...(cursor
          ? {
              OR: [
                { occurredAt: { lt: cursor.occurredAt } },
                { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limite,
    });
  }

  /**
   * Encerra UMA assinatura duplicada em favor de outra que sobrevive --
   * issue #390 (consolidacao pos-import F47/F48).
   *
   * DIFERENTE de `alterarAssinatura(CANCEL)`: aquele SEMPRE revoga o
   * entitlement da assinatura (REVOKED, terminal). Aqui, quando
   * `entitlementParaMigrarId` vem preenchido, o entitlement de risco
   * (ACTIVE e valido AGORA) MUDA DE DONO -- passa a apontar para
   * `sobreviventeId` em vez de ser revogado -- porque a assinatura
   * encerrada era a UNICA coisa dando acesso aquela pessoa. Decisao do PI
   * (23/09/2026): limpeza de cadastro nunca fecha a catraca de quem entra
   * hoje.
   *
   * `entitlementParaMigrarId` nulo = comportamento normal (revoga). A
   * decisao de QUAL entitlement migra, se algum, e do dominio puro
   * (`decidirConsolidacaoDoAluno`), nunca deste metodo.
   */
  async consolidarAssinaturaDuplicada(
    contexto: TenantContext,
    entrada: {
      assinaturaId: string;
      sobreviventeId: string;
      entitlementParaMigrarId: string | null;
      reason: string;
    },
    correlationId: string,
    agora: Date,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const alterada = await tx.subscription.updateMany({
        where: { id: entrada.assinaturaId, tenantId: contexto.tenantId },
        data: {
          status: 'CANCELLED',
          version: { increment: 1 },
          lastActorId: contexto.actorId,
          lastReason: entrada.reason,
        },
      });

      if (alterada.count === 0) {
        throw new ErroDeDominio(
          'SUBSCRIPTION_NOT_FOUND',
          404,
          `Assinatura ${entrada.assinaturaId} nao encontrada neste tenant`,
        );
      }

      const assinatura = await tx.subscription.findFirstOrThrow({
        where: { id: entrada.assinaturaId, tenantId: contexto.tenantId },
      });

      if (entrada.entitlementParaMigrarId) {
        // MIGRA: muda de subscriptionId, permanece ACTIVE. Nao passa por
        // REVOKED em nenhum momento -- ininterrupto para quem depende dele
        // para entrar.
        await tx.entitlement.updateMany({
          where: {
            id: entrada.entitlementParaMigrarId,
            tenantId: contexto.tenantId,
            subscriptionId: entrada.assinaturaId,
            status: 'ACTIVE',
          },
          data: { subscriptionId: entrada.sobreviventeId, version: { increment: 1 } },
        });
      } else {
        // Comportamento normal: revoga o que ainda nao e terminal.
        await tx.entitlement.updateMany({
          where: {
            tenantId: contexto.tenantId,
            subscriptionId: entrada.assinaturaId,
            status: { notIn: ['REVOKED', 'EXPIRED'] },
          },
          data: { status: 'REVOKED', revokedAt: agora, version: { increment: 1 } },
        });
      }

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: assinatura.studentId,
          type: 'SUBSCRIPTION_CANCELLED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          payload: {
            subscriptionId: entrada.assinaturaId,
            consolidacao: true,
            sobreviventeId: entrada.sobreviventeId,
            entitlementMigrado: entrada.entitlementParaMigrarId,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'membership.subscription.consolidated',
          target: 'subscription',
          targetId: entrada.assinaturaId,
          correlationId,
          metadata: {
            reason: entrada.reason,
            sobreviventeId: entrada.sobreviventeId,
            entitlementMigrado: entrada.entitlementParaMigrarId,
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'SubscriptionCancelled',
          aggregateType: 'Subscription',
          aggregateId: entrada.assinaturaId,
          payload: { studentId: assinatura.studentId, consolidacao: true },
        },
      });
    });
  }
}

export type PlanoComRegras = Prisma.PlanGetPayload<{
  include: { units: true; accessWindows: true; prices: true };
}>;

/**
 * `subscription` entra com UM campo so: a versao.
 *
 * Ela e o que `POST /subscriptions/:id/actions` exige para cancelar, e sem
 * ela a ficha tinha o `subscriptionId` sem poder usa-lo -- "trocar de plano"
 * virava atribuir um segundo por cima do primeiro. `select` em vez de
 * `include` porque o resto da assinatura nao e assunto do entitlement, e
 * carregar o registro inteiro so aumentaria a resposta.
 */
/**
 * O `include` esta ESCRITO DUAS VEZES -- aqui e em
 * `listarEntitlementsDoAluno`, e o Prisma nao liga as duas pontas sozinho.
 * Divergir faz o compilador reclamar do CONSUMIDOR, longe da causa: foi o que
 * aconteceu ao adicionar os campos da F56. Mexeu num, mexa no outro.
 */
export type EntitlementComJanelas = Prisma.EntitlementGetPayload<{
  include: {
    unitWindows: true;
    subscription: {
      select: {
        version: true;
        externalSubscriptionId: true;
        scheduledPlanId: true;
        scheduledPlanFrom: true;
        plan: { select: { billingMode: true; name: true; prices: true } };
      };
    };
  };
}>;

export type EventoDeTimeline = Prisma.StudentTimelineEventGetPayload<object>;

/**
 * Violacao de unicidade do Prisma (P2002).
 *
 * Aqui significa uma coisa so: `@@unique([planId, validFrom])` recusou uma
 * segunda linha de preco na mesma data de vigencia.
 */
function violacaoDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}
