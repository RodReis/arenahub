import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * O que o leitor FISICAMENTE tem, vinculado a aluno ou nao -- #475.
 *
 * Sem este registro, "proximo numero livre" nao teria como saber que o
 * leitor ja usa um numero que nenhum aluno tem (cadastro de fabrica, ou
 * feito direto no equipamento sem passar pela nuvem). Alimentado pelo mesmo
 * caminho que ja recebe a base do leitor (#468, `legacy-links`).
 */
@Injectable()
export class DeviceReaderNumberRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Registra que o leitor tem este numero -- idempotente (regra de
   * arquitetura no 4): reenviar a mesma base so atualiza `seenAt`.
   */
  async registrarLote(
    tenantId: string,
    deviceId: string,
    externalUserIds: readonly string[],
    vistoEm: Date,
  ): Promise<void> {
    if (externalUserIds.length === 0) return;

    await this.db.$transaction(
      externalUserIds.map((externalUserId) =>
        this.db.deviceReaderNumber.upsert({
          where: { deviceId_externalUserId: { deviceId, externalUserId } },
          create: { tenantId, deviceId, externalUserId, seenAt: vistoEm },
          update: { seenAt: vistoEm },
        }),
      ),
    );
  }

  /** Todos os numeros que algum leitor do tenant ja teve. */
  async listarNumerosDoTenant(tenantId: string): Promise<string[]> {
    const linhas = await this.db.deviceReaderNumber.findMany({
      where: { tenantId },
      select: { externalUserId: true },
    });

    return linhas.map((l) => l.externalUserId);
  }
}
