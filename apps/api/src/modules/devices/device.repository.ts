import { Injectable } from '@nestjs/common';
import type { Device } from '@arenahub/database';

import { EdgeNodeNaoEncontradoError } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

export interface DadosDeDispositivo {
  gymUnitId: string;
  edgeNodeId?: string | undefined;
  kind: 'FACIAL_READER' | 'TURNSTILE';
  model: string;
  firmware?: string | undefined;
  serial: string;
}

/**
 * Inventario de dispositivos fisicos.
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento -- INV-003.
 */
@Injectable()
export class DeviceRepository {
  constructor(private readonly db: PrismaService) {}

  async criar(
    contexto: TenantContext,
    dados: DadosDeDispositivo,
    correlationId: string,
  ): Promise<Device> {
    return this.db.$transaction(async (tx) => {
      const dispositivo = await tx.device.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: dados.gymUnitId,
          edgeNodeId: dados.edgeNodeId ?? null,
          kind: dados.kind,
          model: dados.model,
          firmware: dados.firmware ?? null,
          serial: dados.serial,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'device.created',
          target: 'device',
          targetId: dispositivo.id,
          correlationId,
          // Serial e dado de inventario, nao segredo -- mas modelo e
          // firmware bastam para auditar sem repetir a identificacao fisica.
          metadata: { kind: dados.kind, model: dados.model },
        },
      });

      return dispositivo;
    });
  }

  async listar(
    contexto: TenantContext,
    filtro: { gymUnitId?: string | undefined; limite: number },
  ): Promise<Device[]> {
    return this.db.device.findMany({
      where: {
        tenantId: contexto.tenantId,
        ...(filtro.gymUnitId ? { gymUnitId: filtro.gymUnitId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: filtro.limite,
    });
  }

  async encontrar(contexto: TenantContext, id: string): Promise<Device | null> {
    return this.db.device.findFirst({ where: { id, tenantId: contexto.tenantId } });
  }

  /** Para quem so tem o tenant (decisao do Edge), sem sessao de usuario. */
  async serialDoDispositivo(tenantId: string, id: string): Promise<string | null> {
    const dispositivo = await this.db.device.findFirst({
      where: { id, tenantId },
      select: { serial: true },
    });

    return dispositivo?.serial ?? null;
  }

  /**
   * Dispositivos-alvo de uma unidade: os que recebem cadastro biometrico.
   *
   * Somente `FACIAL_READER` `ACTIVE`. Leitor em manutencao nao entra na lista
   * de alvos -- e o que impede a identidade de ficar eternamente "pendente
   * em todos os dispositivos" (INV-027) por causa de um equipamento
   * desligado para conserto.
   */
  async listarAlvosDeSync(contexto: TenantContext, gymUnitId: string): Promise<Device[]> {
    return this.db.device.findMany({
      where: {
        tenantId: contexto.tenantId,
        gymUnitId,
        kind: 'FACIAL_READER',
        status: 'ACTIVE',
      },
    });
  }

  async atualizar(
    contexto: TenantContext,
    id: string,
    dados: {
      status?: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED' | undefined;
      firmware?: string | undefined;
      /** `null` limpa o dono; `undefined` nao mexe. */
      edgeNodeId?: string | null | undefined;
    },
    correlationId: string,
    /*
     * MOTIVO E DO ATO, NAO DO DISPOSITIVO -- separado de `dados` e sem
     * coluna. Aposentar e acao sensivel (DS-PAINEL.md §5.1): exige motivo, e
     * motivo que nao e gravado em lugar nenhum e teatro de auditoria. Mora
     * no `metadata` do `AuditLog`, que ja e `Json?`.
     */
    motivo?: string,
  ): Promise<Device | null> {
    return this.db.$transaction(async (tx) => {
      const atual = await tx.device.findFirst({
        where: { id, tenantId: contexto.tenantId },
        select: { gymUnitId: true, edgeNodeId: true },
      });

      if (!atual) return null;

      /*
       * O Edge novo tem de ser do MESMO tenant e da MESMA unidade do
       * dispositivo (regra no 2): `Device.edgeNodeId` tem FK, mas a FK nao
       * sabe de tenant nem de unidade. 404, como o resto: distinguir "nao
       * existe" de "e de outro tenant" confirmaria o UUID a quem o tentou.
       *
       * So Edge `ACTIVE`: o guard do Edge recusa o suspenso (`EDGE_KEY_REVOKED`)
       * e o leitor ficaria mudo sem aviso. Reenviar o dono ATUAL nao e troca --
       * o formulario do painel manda o campo em toda edicao, e editar firmware
       * de um leitor cujo Edge foi suspenso nao pode falhar por isso.
       */
      if (dados.edgeNodeId && dados.edgeNodeId !== atual.edgeNodeId) {
        const edge = await tx.edgeNode.findFirst({
          where: {
            id: dados.edgeNodeId,
            tenantId: contexto.tenantId,
            gymUnitId: atual.gymUnitId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });

        if (!edge) throw new EdgeNodeNaoEncontradoError();
      }

      await tx.device.updateMany({
        where: { id, tenantId: contexto.tenantId },
        data: {
          ...(dados.status ? { status: dados.status } : {}),
          ...(dados.firmware !== undefined ? { firmware: dados.firmware } : {}),
          ...(dados.edgeNodeId !== undefined ? { edgeNodeId: dados.edgeNodeId } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'device.updated',
          target: 'device',
          targetId: id,
          correlationId,
          metadata: {
            status: dados.status ?? null,
            ...(dados.edgeNodeId === undefined
              ? {}
              : { edgeNodeId: dados.edgeNodeId, edgeNodeAnterior: atual.edgeNodeId }),
            ...(motivo === undefined ? {} : { motivo }),
          },
        },
      });

      return tx.device.findFirstOrThrow({ where: { id, tenantId: contexto.tenantId } });
    });
  }

  /**
   * O leitor pelo SERIAL, no escopo do Edge que assinou -- #468, #488.
   *
   * O Edge nao conhece o UUID do `Device`, so o `sn` do equipamento. O
   * escopo e o da decisao de acesso: tenant, unidade e EdgeNode vem da
   * assinatura, nunca do corpo (regra no 2).
   *
   * **ESTA BUSCA TAMBEM REIVINDICA.** Dispositivo cadastrado ANTES de o Edge
   * existir tem `edgeNodeId` nulo, e nada no produto o liga a um Edge depois
   * (`PATCH /devices/:id` nao aceita, o painel nao tem o campo). Na Arena
   * Positiva isso deu 404 no vinculo dos alunos e DENY em todo
   * reconhecimento (#488). Entao o Edge que apresenta o serial de um
   * dispositivo SEM DONO, da PROPRIA unidade, passa a ser o dono.
   *
   * O limite e o que mantem a regra no 2 de pe:
   *   - so `edgeNodeId` NULO -- nunca toma dispositivo de outro Edge, nem na
   *     mesma unidade;
   *   - so do mesmo tenant E da mesma unidade da assinatura;
   *   - a escrita e `updateMany` com `edgeNodeId: null` no filtro, entao dois
   *     Edges disputando o mesmo dispositivo nao sobrescrevem um ao outro --
   *     o segundo ve `count 0` e confere quem ficou com ele;
   *   - `AuditLog` com ator `SYSTEM`: a mudanca de dono nao e silenciosa.
   */
  async resolverDoEdgePorSerial(
    edge: { tenantId: string; gymUnitId: string; edgeNodeId: string },
    serial: string,
  ): Promise<{ id: string } | null> {
    const escopo = { serial, tenantId: edge.tenantId, gymUnitId: edge.gymUnitId };

    const proprio = await this.db.device.findFirst({
      where: { ...escopo, edgeNodeId: edge.edgeNodeId },
      select: { id: true },
    });

    if (proprio) return proprio;

    const semDono = await this.db.device.findFirst({
      where: { ...escopo, edgeNodeId: null },
      select: { id: true },
    });

    if (!semDono) return null;

    return this.db.$transaction(async (tx) => {
      const reivindicado = await tx.device.updateMany({
        where: { id: semDono.id, edgeNodeId: null },
        data: { edgeNodeId: edge.edgeNodeId },
      });

      if (reivindicado.count === 1) {
        await tx.auditLog.create({
          data: {
            tenantId: edge.tenantId,
            gymUnitId: edge.gymUnitId,
            actorType: 'SYSTEM',
            actorId: null,
            action: 'device.claimed_by_edge',
            target: 'device',
            targetId: semDono.id,
            correlationId: `claim-${semDono.id}`,
            // Serial e dado de inventario, nao segredo.
            metadata: { edgeNodeId: edge.edgeNodeId },
          },
        });
      }

      // `count 0`: outro Edge chegou primeiro. So devolve se o dono for ESTE.
      return tx.device.findFirst({
        where: { id: semDono.id, edgeNodeId: edge.edgeNodeId },
        select: { id: true },
      });
    });
  }

  /**
   * Proximo `external_user_id` do dispositivo.
   *
   * `MAX + 1` dentro da transacao do chamador. A unicidade real e da
   * constraint `(deviceId, externalUserId)` -- este metodo escolhe um
   * candidato, e a constraint e quem decide. Duas criacoes simultaneas fazem
   * a segunda falhar e retentar, que e o comportamento correto.
   */
  async proximoExternalUserId(deviceId: string): Promise<number> {
    const usados = await this.db.deviceUser.findMany({
      where: { deviceId },
      select: { externalUserId: true },
    });

    const maior = usados.reduce((maximo, { externalUserId }) => {
      const numero = Number(externalUserId);

      return Number.isInteger(numero) && numero > maximo ? numero : maximo;
    }, 0);

    return maior + 1;
  }

  /**
   * Todos os numeros ja usados por `DeviceUser`, em qualquer leitor do
   * tenant -- #475. Mesmo numero vinculado em dois leitores diferentes do
   * mesmo tenant continua contando uma vez (`Set` de quem chama).
   */
  async listarNumerosVinculadosDoTenant(tenantId: string): Promise<string[]> {
    const linhas = await this.db.deviceUser.findMany({
      where: { tenantId },
      select: { externalUserId: true },
    });

    return linhas.map((l) => l.externalUserId);
  }

  /**
   * O numero com que o aluno esta VIVO no leitor (`DeviceUser` SYNCED), ou
   * `null` -- aluno legado pode estar vinculado sem credencial facial.
   * Varios leitores: o vinculo mais antigo, desempate pelo numero.
   */
  async numeroVinculadoDoAluno(tenantId: string, studentId: string): Promise<string | null> {
    const vinculo = await this.db.deviceUser.findFirst({
      where: { tenantId, studentId, state: 'SYNCED' },
      orderBy: [{ createdAt: 'asc' }, { externalUserId: 'asc' }],
      select: { externalUserId: true },
    });

    return vinculo?.externalUserId ?? null;
  }
}
