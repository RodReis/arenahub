import { Injectable } from '@nestjs/common';
import {
  resolverHoraLocal,
  type AccessPolicyInput,
  type EntitlementInput,
  type EntitlementStatus,
  type StudentStatus,
} from '@arenahub/access-policy';

import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * Monta a ENTRADA do motor de decisao.
 *
 * Este arquivo e a fronteira: daqui para dentro do motor nao existe Prisma,
 * relogio nem fuso. Todo o I/O da decisao acontece aqui, num lugar so, e o
 * que sai e uma estrutura de dados inerte.
 *
 * REGRA DE ARQUITETURA no 1. Note o que NAO e consultado: `Subscription`,
 * `Invoice`, nada financeiro. A catraca ve `Entitlement` e mais nada. Se um
 * dia alguem precisar do estado da assinatura para decidir acesso, o lugar
 * de discutir isso e um ADR, nao um `include` a mais nesta query.
 */
@Injectable()
export class AccessProjectionRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * @param avaliadoEm relogio do SERVIDOR. O `recognizedAt` do equipamento e
   *   guardado como evidencia, mas nao decide: catraca com relogio adiantado
   *   nao pode estender a validade de um direito.
   */
  async montarEntrada(
    tenantId: string,
    gymUnitId: string,
    studentId: string,
    studentStatus: StudentStatus,
    avaliadoEm: Date,
  ): Promise<AccessPolicyInput> {
    const [unidade, tenant, entitlements, bloqueio] = await Promise.all([
      this.db.gymUnit.findFirstOrThrow({
        where: { id: gymUnitId, tenantId },
        select: { timezone: true },
      }),

      /*
       * GATE DO CONTRATANTE -- F65, ADR-053.
       *
       * `findUniqueOrThrow`, e nao `findUnique`: tenant que sumiu no meio da
       * requisicao nao pode virar `null` e cair no `?? false` de um
       * opcional, porque `false` aqui significa ABRIR A CATRACA. Falhar alto
       * e a unica leitura segura de "nao sei o estado do tenant".
       */
      this.db.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { status: true },
      }),

      // Somente ACTIVE e dentro do periodo -- o motor refaz a checagem, e a
      // duplicacao e deliberada: aqui ela reduz o volume que trafega; la ela
      // e a regra. Filtrar so aqui deixaria a regra dependendo do SQL.
      this.db.entitlement.findMany({
        where: {
          tenantId,
          studentId,
          status: 'ACTIVE',
          startsAt: { lte: avaliadoEm },
          endsAt: { gte: avaliadoEm },
        },
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          unitWindows: {
            select: { gymUnitId: true, dayOfWeek: true, startMinute: true, endMinute: true },
          },
        },
      }),

      this.db.administrativeBlock.findFirst({
        where: {
          tenantId,
          studentId,
          liftedAt: null,
          startsAt: { lte: avaliadoEm },
          OR: [{ endsAt: null }, { endsAt: { gte: avaliadoEm } }],
        },
        select: { id: true },
      }),
    ]);

    const local = resolverHoraLocal(avaliadoEm, unidade.timezone);

    return {
      evaluatedAt: avaliadoEm.toISOString(),
      unitId: gymUnitId,
      localDayOfWeek: local.dayOfWeek,
      localMinuteOfDay: local.minuteOfDay,
      /*
       * DERIVADO do status, nunca de coluna propria: um `gate_active` a mais
       * seria um segundo lugar onde a verdade mora, e o primeiro caminho que
       * escrevesse um sem o outro deixaria a catraca discordando do painel.
       *
       * `INACTIVE` NAO fecha a catraca: ADR-052 §4 diz que ele e o dono do
       * SaaS desligando o cliente, e o ADR-053 fala so de inadimplencia.
       * Colapsar os dois faria um desligamento administrativo negar com a
       * razao "suspensa por divida" -- mentira gravada em fato imutavel.
       */
      tenant: { gateActive: tenant.status === 'SUSPENDED' },
      student: { status: studentStatus },
      entitlements: entitlements.map((e) => this.paraEntrada(e, gymUnitId)),
      adminBlock: { active: bloqueio !== null },
    };
  }

  /**
   * `EntitlementUnitWindow` guarda unidade E horario na mesma linha. O motor
   * separa os dois conceitos porque precisa distinguir `WRONG_UNIT` de
   * `OUTSIDE_SCHEDULE` (ADR-024) -- entao a traducao acontece aqui.
   *
   * Sutileza que custou um bug em potencial: as janelas passadas ao motor sao
   * SO as desta unidade. Mandar todas faria o horario de sabado da unidade B
   * abrir a catraca da unidade A no sabado.
   */
  private paraEntrada(
    entitlement: {
      id: string;
      status: string;
      startsAt: Date;
      endsAt: Date;
      unitWindows: {
        gymUnitId: string;
        dayOfWeek: number;
        startMinute: number;
        endMinute: number;
      }[];
    },
    gymUnitId: string,
  ): EntitlementInput {
    // TODAS as unidades onde o direito vale -- o motor precisa da lista
    // completa para decidir entre `WRONG_UNIT` e as demais razoes.
    const unitIds = [...new Set(entitlement.unitWindows.map((j) => j.gymUnitId))];

    // Mas SO as janelas DESTA unidade. Mandar todas faria o horario de
    // sabado da unidade B abrir a catraca da unidade A no sabado -- o motor
    // nao tem como saber a qual unidade cada janela pertence, porque o tipo
    // `AccessWindow` deliberadamente nao carrega unidade.
    const windows = entitlement.unitWindows
      .filter((j) => j.gymUnitId === gymUnitId)
      .map((j) => ({
        dayOfWeek: j.dayOfWeek,
        startMinute: j.startMinute,
        endMinute: j.endMinute,
      }));

    return {
      id: entitlement.id,
      status: entitlement.status as EntitlementStatus,
      startsAt: entitlement.startsAt.toISOString(),
      endsAt: entitlement.endsAt.toISOString(),
      unitIds,
      windows,
    };
  }
}
