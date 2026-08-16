import { Injectable } from '@nestjs/common';
import type { Entitlement, Plan, Prisma, Subscription } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { alunoRecebeAcessoNormal, type StatusDeAluno } from '../students/domain/student.js';
import { StudentRepository } from '../students/student.repository.js';
import { montarSnapshotDePolitica } from './domain/entitlement.js';
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

export interface DadosDeCriacaoDePlano {
  name: string;
  description?: string | undefined;
  gymUnitIds: readonly string[];
  janelas: readonly JanelaDeAcesso[];
  salesStartAt?: Date | undefined;
  salesEndAt?: Date | undefined;
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

  // -------------------------------------------------------------------------
  // Planos
  // -------------------------------------------------------------------------

  /**
   * Cria plano, unidades e janelas numa transacao.
   *
   * As unidades sao conferidas contra o tenant ANTES de gravar: `PlanUnit`
   * nao tem FK para `GymUnit` (a relacao e por id solto), entao sem esta
   * checagem daria para vincular um plano a unidade de outra academia.
   */
  async criarPlano(
    contexto: TenantContext,
    dados: DadosDeCriacaoDePlano,
    correlationId: string,
  ): Promise<Plan> {
    const janelas = validarJanelas(dados.janelas);

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
          salesStartAt: dados.salesStartAt ?? null,
          salesEndAt: dados.salesEndAt ?? null,
          units: { create: dados.gymUnitIds.map((gymUnitId) => ({ gymUnitId })) },
          accessWindows: { create: janelas.map((j) => ({ ...j })) },
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
          metadata: { name: plano.name, unidades: dados.gymUnitIds.length },
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
      include: { units: true, accessWindows: true },
      orderBy: { name: 'asc' },
    });
  }

  async encontrarPlano(contexto: TenantContext, id: string): Promise<PlanoComRegras | null> {
    return this.db.plan.findFirst({
      where: { id, tenantId: contexto.tenantId },
      include: { units: true, accessWindows: true },
    });
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
          unitWindows: { create: janelas.map((j) => ({ ...j })) },
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
          unitWindows: { create: janelas.map((j) => ({ ...j })) },
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

  async listarEntitlementsDoAluno(
    contexto: TenantContext,
    studentId: string,
  ): Promise<EntitlementComJanelas[]> {
    return this.db.entitlement.findMany({
      where: { tenantId: contexto.tenantId, studentId },
      include: { unitWindows: true },
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
}

export type PlanoComRegras = Prisma.PlanGetPayload<{
  include: { units: true; accessWindows: true };
}>;

export type EntitlementComJanelas = Prisma.EntitlementGetPayload<{
  include: { unitWindows: true };
}>;

export type EventoDeTimeline = Prisma.StudentTimelineEventGetPayload<object>;
