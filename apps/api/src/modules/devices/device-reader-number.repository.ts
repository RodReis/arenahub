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
/**
 * Teto de numeros registrados por leitor (#601): o leitor comporta 5.000
 * usuarios, o teto e o dobro. Sem ele, um Edge com chave valida inflava a
 * tabela sem limite -- e `listarNumerosDoTenant` carrega tudo a cada sugestao
 * de numero livre.
 */
export const TETO_DE_NUMEROS_POR_LEITOR = 10_000;

@Injectable()
export class DeviceReaderNumberRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Registra que o leitor tem este numero -- idempotente (regra de
   * arquitetura no 4): reenviar a mesma base so atualiza `seenAt`.
   *
   * Numero ja registrado sempre atualiza; numero NOVO so entra enquanto o
   * leitor estiver abaixo do teto. Devolve quantos novos ficaram de fora.
   */
  async registrarLote(
    tenantId: string,
    deviceId: string,
    externalUserIds: readonly string[],
    vistoEm: Date,
  ): Promise<{ ignorados: number }> {
    if (externalUserIds.length === 0) return { ignorados: 0 };

    // ponytail: contagem fora da transacao -- dois lotes simultaneos podem
    // passar do teto por ate um lote (1.000). O teto e de protecao, nao exato.
    const [total, conhecidos] = await Promise.all([
      this.db.deviceReaderNumber.count({ where: { deviceId } }),
      this.db.deviceReaderNumber.findMany({
        where: { deviceId, externalUserId: { in: [...externalUserIds] } },
        select: { externalUserId: true },
      }),
    ]);

    const jaRegistrados = new Set(conhecidos.map((c) => c.externalUserId));
    const novos = externalUserIds.filter((n) => !jaRegistrados.has(n));
    const vagas = Math.max(0, TETO_DE_NUMEROS_POR_LEITOR - total);
    const aceitos = [...externalUserIds.filter((n) => jaRegistrados.has(n)), ...novos.slice(0, vagas)];

    await this.db.$transaction(
      aceitos.map((externalUserId) =>
        this.db.deviceReaderNumber.upsert({
          where: { deviceId_externalUserId: { deviceId, externalUserId } },
          create: { tenantId, deviceId, externalUserId, seenAt: vistoEm },
          update: { seenAt: vistoEm },
        }),
      ),
    );

    return { ignorados: novos.length - Math.min(novos.length, vagas) };
  }

  /**
   * Nome que o leitor guarda -- so atualiza numero ja registrado (nao cria).
   * Devolve quantos numeros atualizou.
   */
  async registrarNomes(
    tenantId: string,
    deviceId: string,
    nomes: readonly { externalUserId: string; name: string }[],
  ): Promise<number> {
    if (nomes.length === 0) return 0;

    const resultados = await this.db.$transaction(
      nomes.map((n) =>
        this.db.deviceReaderNumber.updateMany({
          where: { tenantId, deviceId, externalUserId: n.externalUserId },
          data: { readerName: n.name.trim().slice(0, 100) },
        }),
      ),
    );

    return resultados.reduce((total, r) => total + r.count, 0);
  }

  /** Leitores do tenant que TEM este numero -- vinculo imediato (spec 2026-10-03). */
  async leitoresComNumero(
    tenantId: string,
    externalUserId: string,
  ): Promise<{ deviceId: string; serial: string }[]> {
    const linhas = await this.db.deviceReaderNumber.findMany({
      where: { tenantId, externalUserId },
      select: { deviceId: true, device: { select: { serial: true } } },
    });

    return linhas.map((l) => ({ deviceId: l.deviceId, serial: l.device.serial }));
  }

  /** Todos os numeros que algum leitor do tenant ja teve. */
  async listarNumerosDoTenant(tenantId: string): Promise<string[]> {
    const linhas = await this.db.deviceReaderNumber.findMany({
      where: { tenantId },
      select: { externalUserId: true },
    });

    return linhas.map((l) => l.externalUserId);
  }

  /**
   * Todos os numeros dos leitores do tenant, com o nome gravado no leitor e o
   * serial -- a aba "Do leitor" da acao da lista (spec 2026-10-03).
   *
   * Nao filtra por aluno: `devices` nao le `student_credentials` (regra de
   * arquitetura no 9). Quem chama cruza com `listarNumerosDoTenant` das
   * credenciais para achar o que esta sem aluno.
   */
  async listarComNome(
    tenantId: string,
  ): Promise<{ externalId: string; readerName: string | null; deviceSerial: string }[]> {
    const linhas = await this.db.deviceReaderNumber.findMany({
      where: { tenantId },
      select: { externalUserId: true, readerName: true, device: { select: { serial: true } } },
      orderBy: { externalUserId: 'asc' },
    });

    return linhas.map((l) => ({
      externalId: l.externalUserId,
      readerName: l.readerName,
      deviceSerial: l.device.serial,
    }));
  }
}
