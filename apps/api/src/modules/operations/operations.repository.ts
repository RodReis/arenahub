import { Injectable } from '@nestjs/common';
import type { OperationalAlert, Prisma } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  avaliarDispositivo,
  avaliarEdge,
  avaliarFinanceiro,
  avaliarSync,
  impressaoDigital,
  type Alerta,
  type EstadoDeSync,
  type EstadoDoFinanceiro,
  type EstadoDoDispositivo,
  type EstadoDoEdge,
} from './domain/alert-rules.js';

/**
 * Leitura operacional e ciclo de vida dos alertas -- F11.
 *
 * POR QUE NAO HA TABELA DE PROJECAO AQUI
 * --------------------------------------
 * O plano da fatia pede `EdgeOperationalState`, `DeviceOperationalState` e
 * afins -- modelos de leitura alimentados por eventos. Nao foram criados, e a
 * ausencia e deliberada: `EdgeNode` ja tem `lastHeartbeat`, `clockOffsetMs` e
 * `agentVersion`; `Device` ja tem `lastHeartbeat` e `status`. Projetar esses
 * campos para outra tabela criaria uma segunda copia do mesmo dado, com
 * atraso proprio e a possibilidade de divergir da fonte.
 *
 * Projecao paga por si quando a leitura e cara ou o dado vem de muitas
 * fontes. Aqui a leitura e um `findMany` por tenant numa tabela pequena --
 * uma unidade tem unidades de dispositivos, nao milhares. Se um dia o painel
 * ficar lento, a medicao justifica a projecao; hoje ela so acrescentaria uma
 * fonte de bug silencioso.
 *
 * O que existe de verdade e o `OperationalAlert`, que NAO e projecao: ele
 * guarda historico (quando comecou, quem reconheceu) que nao da para derivar
 * do estado atual.
 */

export interface PanoramaOperacional {
  edges: {
    id: string;
    codigo: string;
    gymUnitId: string;
    status: string;
    agentVersion: string | null;
    ultimoHeartbeat: string | null;
    derivaMs: number | null;
  }[];
  dispositivos: {
    id: string;
    serial: string;
    modelo: string;
    kind: string;
    status: string;
    gymUnitId: string;
    ultimoHeartbeat: string | null;
    ultimoSync: string | null;
  }[];
  sync: {
    pendentes: number;
    processando: number;
    falhados: number;
    deadLetters: number;
    /** Do dia corrente, em UTC. */
    totalDoDia: number;
    sucessosDoDia: number;
  };
  acesso: {
    /** Ultimas 24 h. */
    allow: number;
    deny: number;
    override: number;
  };
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Tudo que o painel mostra, numa consulta por recurso.
   *
   * Escopo de unidade aplicado aqui: um operador restrito a unidade A nao ve
   * o Edge da unidade B nem sabendo o UUID.
   */
  async panorama(contexto: TenantContext): Promise<PanoramaOperacional> {
    const filtroDeUnidade =
      contexto.allowedUnitIds === 'ALL'
        ? {}
        : { gymUnitId: { in: [...contexto.allowedUnitIds] } };

    const inicioDoDia = new Date();
    inicioDoDia.setUTCHours(0, 0, 0, 0);

    const ultimas24h = new Date(Date.now() - 86_400_000);

    const [edges, dispositivos, syncPorEstado, syncDoDia, acessoPorResultado, overrides] =
      await Promise.all([
        this.db.edgeNode.findMany({
          where: { tenantId: contexto.tenantId, ...filtroDeUnidade },
          select: {
            id: true,
            code: true,
            gymUnitId: true,
            status: true,
            agentVersion: true,
            lastHeartbeat: true,
            clockOffsetMs: true,
          },
        }),

        this.db.device.findMany({
          where: { tenantId: contexto.tenantId, ...filtroDeUnidade },
          select: {
            id: true,
            serial: true,
            model: true,
            kind: true,
            status: true,
            gymUnitId: true,
            lastHeartbeat: true,
            lastSyncAt: true,
          },
        }),

        this.db.deviceSyncJob.groupBy({
          by: ['state'],
          where: { tenantId: contexto.tenantId },
          _count: true,
        }),

        this.db.deviceSyncJob.groupBy({
          by: ['state'],
          where: { tenantId: contexto.tenantId, createdAt: { gte: inicioDoDia } },
          _count: true,
        }),

        this.db.accessEvent.groupBy({
          by: ['outcome'],
          where: {
            tenantId: contexto.tenantId,
            occurredAt: { gte: ultimas24h },
            ...filtroDeUnidade,
          },
          _count: true,
        }),

        this.db.accessEvent.count({
          where: {
            tenantId: contexto.tenantId,
            mode: 'OVERRIDE',
            occurredAt: { gte: ultimas24h },
            ...filtroDeUnidade,
          },
        }),
      ]);

    const contarPorEstado = (
      grupos: { state: string; _count: number }[],
      estados: string[],
    ): number =>
      grupos.filter((g) => estados.includes(g.state)).reduce((soma, g) => soma + g._count, 0);

    const totalDoDia = syncDoDia.reduce((soma, g) => soma + g._count, 0);

    return {
      edges: edges.map((e) => ({
        id: e.id,
        codigo: e.code,
        gymUnitId: e.gymUnitId,
        status: e.status,
        agentVersion: e.agentVersion,
        ultimoHeartbeat: e.lastHeartbeat?.toISOString() ?? null,
        derivaMs: e.clockOffsetMs,
      })),
      dispositivos: dispositivos.map((d) => ({
        id: d.id,
        serial: d.serial,
        modelo: d.model,
        kind: d.kind,
        status: d.status,
        gymUnitId: d.gymUnitId,
        ultimoHeartbeat: d.lastHeartbeat?.toISOString() ?? null,
        ultimoSync: d.lastSyncAt?.toISOString() ?? null,
      })),
      sync: {
        pendentes: contarPorEstado(syncPorEstado, ['PENDING', 'RETRYING']),
        processando: contarPorEstado(syncPorEstado, ['PROCESSING']),
        falhados: contarPorEstado(syncPorEstado, ['FAILED']),
        // Dead letter aqui e o job que esgotou as tentativas. F8 o marca como
        // FAILED com `nextAttemptAt` nulo -- ver `device-sync.repository.ts`.
        deadLetters: contarPorEstado(syncPorEstado, ['FAILED']),
        totalDoDia,
        sucessosDoDia: contarPorEstado(syncDoDia, ['SYNCED', 'REMOVED']),
      },
      acesso: {
        allow: acessoPorResultado.find((g) => g.outcome === 'ALLOW')?._count ?? 0,
        deny: acessoPorResultado.find((g) => g.outcome === 'DENY')?._count ?? 0,
        override: overrides,
      },
    };
  }

  /**
   * Coleta o estado bruto que as regras de alerta avaliam.
   *
   * Separado de `panorama` porque o avaliador roda em background, sem
   * `TenantContext` de usuario: quem dispara e o agendador, para TODOS os
   * tenants. Reusar o `panorama` obrigaria a inventar um contexto falso, e
   * contexto falso e como isolamento de tenant se perde.
   */
  async coletarEstadoParaAlertas(tenantId: string): Promise<{
    edges: EstadoDoEdge[];
    dispositivos: EstadoDoDispositivo[];
    sync: EstadoDeSync[];
    financeiro: EstadoDoFinanceiro[];
  }> {
    const agora = new Date();
    const inicioDoDia = new Date(agora);
    inicioDoDia.setUTCHours(0, 0, 0, 0);

    const [edges, dispositivos, unidades] = await Promise.all([
      this.db.edgeNode.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: {
          id: true,
          code: true,
          gymUnitId: true,
          lastHeartbeat: true,
          clockOffsetMs: true,
          credentials: {
            where: { revokedAt: null, activeFrom: { lte: agora } },
            select: { expiresAt: true },
          },
        },
      }),

      this.db.device.findMany({
        where: { tenantId },
        select: {
          id: true,
          serial: true,
          gymUnitId: true,
          kind: true,
          status: true,
          lastHeartbeat: true,
        },
      }),

      this.db.gymUnit.findMany({ where: { tenantId }, select: { id: true } }),
    ]);

    const sync = await Promise.all(
      unidades.map(async ({ id }) => {
        const [falhas, doDia, sucessos] = await Promise.all([
          this.db.deviceSyncJob.count({ where: { tenantId, state: 'FAILED' } }),
          this.db.deviceSyncJob.count({ where: { tenantId, createdAt: { gte: inicioDoDia } } }),
          this.db.deviceSyncJob.count({
            where: {
              tenantId,
              createdAt: { gte: inicioDoDia },
              state: { in: ['SYNCED', 'REMOVED'] },
            },
          }),
        ]);

        return {
          gymUnitId: id,
          falhasPermanentes: falhas,
          deadLetters: falhas,
          totalDoDia: doDia,
          sucessosDoDia: sucessos,
        };
      }),
    );

    const financeiro = await this.coletarEstadoFinanceiro(tenantId);

    return {
      financeiro,
      edges: edges.map((e) => ({
        edgeNodeId: e.id,
        codigo: e.code,
        gymUnitId: e.gymUnitId,
        ultimoHeartbeat: e.lastHeartbeat,
        derivaMs: e.clockOffsetMs,
        // A credencial que vence POR ULTIMO e a que importa: enquanto uma
        // valer, o Edge fala. Pegar a mais proxima do fim alertaria sobre a
        // credencial antiga durante toda janela de rotacao, que e justamente
        // quando o sistema esta funcionando como deveria.
        credencialExpiraEm: escolherVigenciaMaisLonga(e.credentials),
      })),
      dispositivos: dispositivos.map((d) => ({
        deviceId: d.id,
        serial: d.serial,
        gymUnitId: d.gymUnitId,
        kind: d.kind,
        status: d.status,
        ultimoHeartbeat: d.lastHeartbeat,
      })),
      sync,
    };
  }

  /**
   * Grava os alertas de uma avaliacao.
   *
   * `upsert` por `fingerprint`: condicao que persiste ATUALIZA `lastSeenAt`,
   * nao cria linha nova. E o que impede um Edge fora do ar por uma noite de
   * virar centenas de linhas no painel.
   *
   * Alerta que reaparece depois de resolvido **reabre**: `resolvedAt` volta a
   * nulo e o estado sai de `RESOLVED`. Sem isso, um Edge que cai, volta e cai
   * de novo ficaria eternamente "resolvido".
   */
  async registrarAlertas(
    tenantId: string,
    alertas: readonly Alerta[],
    agora: Date,
  ): Promise<{ abertos: number; atualizados: number }> {
    let abertos = 0;
    let atualizados = 0;

    for (const alerta of alertas) {
      const fingerprint = impressaoDigital(tenantId, alerta);

      const existente = await this.db.operationalAlert.findUnique({ where: { fingerprint } });

      const evidencia = alerta.evidencia as Prisma.InputJsonValue;

      if (!existente) {
        await this.db.operationalAlert.create({
          data: {
            tenantId,
            gymUnitId: alerta.gymUnitId,
            fingerprint,
            code: alerta.codigo,
            severity: alerta.severidade,
            state: 'OPEN',
            resource: alerta.recurso,
            resourceId: alerta.recursoId,
            impact: alerta.impacto,
            recommendedAction: alerta.acaoRecomendada,
            evidence: evidencia,
            firstSeenAt: agora,
            lastSeenAt: agora,
          },
        });

        abertos += 1;
        continue;
      }

      const reabrindo = existente.state === 'RESOLVED';

      await this.db.operationalAlert.update({
        where: { fingerprint },
        data: {
          lastSeenAt: agora,
          severity: alerta.severidade,
          evidence: evidencia,
          impact: alerta.impacto,
          recommendedAction: alerta.acaoRecomendada,
          ...(reabrindo
            ? {
                state: 'OPEN',
                resolvedAt: null,
                // Reconhecimento antigo nao vale para a ocorrencia nova: quem
                // reconheceu ontem nao sabe que caiu de novo hoje.
                acknowledgedAt: null,
                acknowledgedById: null,
                firstSeenAt: agora,
              }
            : {}),
        },
      });

      if (reabrindo) abertos += 1;
      else atualizados += 1;
    }

    return { abertos, atualizados };
  }

  /**
   * Fecha os alertas cuja condicao sumiu.
   *
   * Recebe as impressoes digitais que AINDA estao ativas; tudo que estava
   * aberto e nao aparece na lista virou resolvido.
   */
  async resolverAusentes(
    tenantId: string,
    ativos: readonly string[],
    agora: Date,
  ): Promise<number> {
    const resultado = await this.db.operationalAlert.updateMany({
      where: {
        tenantId,
        state: { in: ['OPEN', 'ACKNOWLEDGED'] },
        fingerprint: { notIn: [...ativos] },
      },
      data: { state: 'RESOLVED', resolvedAt: agora },
    });

    return resultado.count;
  }

  async listar(
    contexto: TenantContext,
    filtro: { apenasAbertos: boolean; limite: number },
  ): Promise<OperationalAlert[]> {
    const filtroDeUnidade =
      contexto.allowedUnitIds === 'ALL'
        ? {}
        : { gymUnitId: { in: [...contexto.allowedUnitIds] } };

    return this.db.operationalAlert.findMany({
      where: {
        tenantId: contexto.tenantId,
        ...filtroDeUnidade,
        ...(filtro.apenasAbertos ? { state: { in: ['OPEN', 'ACKNOWLEDGED'] } } : {}),
      },
      // Severidade primeiro: o painel precisa mostrar o que para a catraca
      // antes do que atrasa um cadastro.
      orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
      take: filtro.limite,
    });
  }

  /**
   * Reconhece um alerta -- `M1-AC-011`.
   *
   * RECONHECER NAO RESOLVE. O estado vira `ACKNOWLEDGED`, e a condicao
   * continua sendo avaliada: se o Edge ainda estiver fora, o alerta continua
   * lá. Deixar o operador "fechar" um alarme ativo transformaria o painel numa
   * lista de coisas que alguem clicou, nao do que esta acontecendo.
   */
  async reconhecer(
    contexto: TenantContext,
    id: string,
    agora: Date,
    correlationId: string,
  ): Promise<OperationalAlert | null> {
    return this.db.$transaction(async (tx) => {
      const alerta = await tx.operationalAlert.findFirst({
        where: { id, tenantId: contexto.tenantId },
      });

      if (!alerta) return null;

      if (alerta.state !== 'OPEN') return alerta;

      const atualizado = await tx.operationalAlert.update({
        where: { id },
        data: {
          state: 'ACKNOWLEDGED',
          acknowledgedAt: agora,
          acknowledgedById: contexto.actorId,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'operations.alert.acknowledged',
          target: 'operational_alert',
          targetId: id,
          correlationId,
          metadata: { code: alerta.code, severity: alerta.severity },
        },
      });

      return atualizado;
    });
  }

  /** Avalia e persiste, para um tenant. Usado pelo agendador. */
  async avaliarTenant(tenantId: string, agora: Date): Promise<{ ativos: number }> {
    const estado = await this.coletarEstadoParaAlertas(tenantId);

    const alertas = [
      ...estado.edges.flatMap((e) => avaliarEdge(e, agora)),
      ...estado.dispositivos.flatMap((d) => avaliarDispositivo(d, agora)),
      ...estado.sync.flatMap((s) => avaliarSync(s)),
      ...estado.financeiro.flatMap((f) => avaliarFinanceiro(f, agora)),
    ];

    await this.registrarAlertas(tenantId, alertas, agora);

    const ativos = alertas.map((a) => impressaoDigital(tenantId, a));

    await this.resolverAusentes(tenantId, ativos, agora);

    return { ativos: alertas.length };
  }

  /**
   * Saude do webhook e da conciliacao, por conta do provedor -- F16.
   *
   * POR CONTA, e nao por tenant: com dois provedores (ADR-032), o PIX pode
   * estar mudo enquanto o cartao vai bem. Agregar por tenant esconderia
   * exatamente a metade quebrada.
   */
  private async coletarEstadoFinanceiro(tenantId: string): Promise<EstadoDoFinanceiro[]> {
    const contas = await this.db.providerAccount.findMany({
      where: { tenantId, active: true },
      select: { id: true },
    });

    return Promise.all(
      contas.map(async (conta) => {
        const [pendentes, maisAntigo, ultimo, divergencias] = await Promise.all([
          this.db.providerEvent.count({
            where: { tenantId, providerAccountId: conta.id, processedAt: null },
          }),
          this.db.providerEvent.findFirst({
            where: { tenantId, providerAccountId: conta.id, processedAt: null },
            orderBy: { receivedAt: 'asc' },
            select: { receivedAt: true },
          }),
          this.db.providerEvent.findFirst({
            where: { tenantId, providerAccountId: conta.id },
            orderBy: { receivedAt: 'desc' },
            select: { receivedAt: true },
          }),
          this.db.reconciliationItem.count({
            where: {
              tenantId,
              run: { providerAccountId: conta.id },
              status: { in: ['MISSING_INTERNAL', 'MISSING_EXTERNAL', 'AMOUNT_MISMATCH'] },
            },
          }),
        ]);

        return {
          providerAccountId: conta.id,
          eventosPendentes: pendentes,
          eventoPendenteMaisAntigo: maisAntigo?.receivedAt ?? null,
          ultimoEventoRecebido: ultimo?.receivedAt ?? null,
          divergenciasEmAberto: divergencias,
        };
      }),
    );
  }

  async listarTenantsAtivos(): Promise<string[]> {
    const tenants = await this.db.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    return tenants.map((t) => t.id);
  }
}

/**
 * Entre as credenciais ativas, a que vence por ULTIMO.
 *
 * `null` em `expiresAt` significa "sem prazo" (credencial de F8, anterior a
 * coluna) e vence a comparacao: uma credencial eterna torna o alerta de
 * expiracao irrelevante para este Edge.
 */
function escolherVigenciaMaisLonga(
  credenciais: readonly { expiresAt: Date | null }[],
): Date | null {
  if (credenciais.length === 0) return null;

  if (credenciais.some((c) => c.expiresAt === null)) {
    // Sem prazo: devolve uma data absurdamente distante em vez de `null`,
    // porque `null` no contrato das regras significa "sem credencial ativa",
    // que e o caso CRITICO oposto.
    return new Date('9999-12-31T00:00:00.000Z');
  }

  return credenciais.reduce<Date | null>((maior, atual) => {
    if (atual.expiresAt === null) return maior;
    if (maior === null) return atual.expiresAt;

    return atual.expiresAt > maior ? atual.expiresAt : maior;
  }, null);
}
