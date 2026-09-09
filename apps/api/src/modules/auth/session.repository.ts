import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Session } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';

export interface SessaoCriada {
  sessionId: string;
  token: string;
}

/**
 * Guarda a cadeia de refresh tokens.
 *
 * O modelo e uma FAMILIA: cada rotacao cria um elo novo com o mesmo
 * `familyId`. Isso existe para responder uma pergunta que o token sozinho
 * nao responde -- "este refresh e o atual, ou uma copia de um ja usado?".
 */
@Injectable()
export class SessionRepository {
  constructor(private readonly db: PrismaService) {}

  async abrir(dados: {
    userId: string;
    /** Nulo na sessao de PLATAFORMA -- o Super Admin nao esta em tenant nenhum. */
    tenantId: string | null;
    tokenHash: string;
    validoAte: Date;
  }): Promise<string> {
    const sessao = await this.db.session.create({
      data: {
        userId: dados.userId,
        tenantId: dados.tenantId,
        tokenHash: dados.tokenHash,
        familyId: randomUUID(),
        expiresAt: dados.validoAte,
      },
    });

    return sessao.id;
  }

  async encontrarPorHash(tokenHash: string): Promise<Session | null> {
    return this.db.session.findUnique({ where: { tokenHash } });
  }

  /**
   * Rotaciona numa transacao so: marca o elo atual como usado e cria o
   * proximo com o mesmo `familyId`.
   *
   * Em transacao porque o estado intermediario e perigoso -- se o antigo
   * fosse marcado e o novo falhasse, a sessao sumiria; se o novo fosse
   * criado e a marcacao falhasse, dois tokens valeriam ao mesmo tempo.
   */
  async rotacionar(dados: {
    sessaoAtualId: string;
    familyId: string;
    userId: string;
    /** Nulo na sessao de PLATAFORMA -- o Super Admin nao esta em tenant nenhum. */
    tenantId: string | null;
    novoTokenHash: string;
    validoAte: Date;
  }): Promise<string> {
    const [, nova] = await this.db.$transaction([
      this.db.session.update({
        where: { id: dados.sessaoAtualId },
        data: { status: 'ROTATED', rotatedAt: new Date() },
      }),
      this.db.session.create({
        data: {
          userId: dados.userId,
          tenantId: dados.tenantId,
          tokenHash: dados.novoTokenHash,
          familyId: dados.familyId,
          expiresAt: dados.validoAte,
        },
      }),
    ]);

    return nova.id;
  }

  /**
   * Derruba a familia inteira.
   *
   * Chamado quando um token ja rotacionado reaparece: alguem o copiou, e
   * nao ha como distinguir a vitima do ladrao -- os dois apresentam
   * credencial legitima. Encerrar tudo e obrigar login novo e a unica saida
   * que nao aposta em qual dos dois e qual.
   */
  async revogarFamilia(familyId: string, motivo: string): Promise<void> {
    await this.db.session.updateMany({
      where: { familyId, status: { in: ['ACTIVE', 'ROTATED'] } },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: motivo },
    });
  }

  async revogar(sessaoId: string, motivo: string): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessaoId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: motivo },
    });
  }
}
