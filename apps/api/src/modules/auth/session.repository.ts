import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma, Session } from '@arenahub/database';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
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
   *
   * NUNCA RESSUSCITA UM ELO REVOGADO (issue #558). `refresh()` le a sessao e so
   * depois chega aqui, sem lock: se a troca de senha ou o logout revogou a
   * familia nesse intervalo, um `update` incondicional sobrescreveria
   * `REVOKED` por `ROTATED` e criaria um elo `ACTIVE` -- a sessao que devia
   * cair sobreviveria com refresh valido. A marcacao e condicionada ao status.
   *
   * ACEITA `ACTIVE` E `ROTATED`, e e de proposito: dois refresh simultaneos do
   * MESMO token legitimo (duas navegacoes do painel) precisam continuar
   * funcionando. O `proxy.ts` apaga os dois cookies quando o refresh e
   * recusado, entao recusar a rotacao concorrente transformaria isso em
   * loteria de logout. So o REVOGADO e recusado -- e ai deslogar e o certo.
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
    return this.db.$transaction(async (tx) => {
      const marcado = await tx.session.updateMany({
        where: { id: dados.sessaoAtualId, status: { in: ['ACTIVE', 'ROTATED'] } },
        data: { status: 'ROTATED', rotatedAt: new Date() },
      });

      if (marcado.count === 0) throw new NaoAutenticadoError();

      const nova = await tx.session.create({
        data: {
          userId: dados.userId,
          tenantId: dados.tenantId,
          tokenHash: dados.novoTokenHash,
          familyId: dados.familyId,
          expiresAt: dados.validoAte,
        },
      });

      return nova.id;
    });
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
    await this.varrer(this.db, { familyId }, motivo);
  }

  /**
   * Derruba toda familia do usuario EXCETO a mantida -- troca de senha.
   *
   * Recebe o cliente da transacao do chamador: o hash novo e a revogacao
   * valem juntos ou nao valem.
   */
  async revogarOutrasFamilias(
    cliente: Prisma.TransactionClient,
    userId: string,
    familiaMantida: string,
    motivo: string,
  ): Promise<void> {
    await this.varrer(cliente, { userId, familyId: { not: familiaMantida } }, motivo);
  }

  /**
   * DUAS PASSADAS, e a segunda nao e redundancia (issue #558).
   *
   * Um refresh em voo ja segura o lock da linha do elo antigo e inseriu o elo
   * novo, ainda nao comitado. O `updateMany` espera o lock, revoga o antigo
   * depois do commit -- mas o elo novo nao esta no SNAPSHOT dele, e fica
   * `ACTIVE`. Cada comando de uma transacao READ COMMITTED tira um snapshot
   * novo: a segunda passada ja enxerga o que o refresh comitou.
   *
   * Fecha o intercalamento inteiro porque a rotacao e condicionada ao status:
   * um refresh que ainda NAO tocou o elo antigo perde para a primeira passada
   * (acha `REVOKED` e e recusado).
   */
  private async varrer(
    cliente: Pick<Prisma.TransactionClient, 'session'>,
    escopo: Prisma.SessionWhereInput,
    motivo: string,
  ): Promise<void> {
    for (let passada = 0; passada < 2; passada += 1) {
      await cliente.session.updateMany({
        where: { ...escopo, status: { in: ['ACTIVE', 'ROTATED'] } },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: motivo },
      });
    }
  }

  async revogar(sessaoId: string, motivo: string): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessaoId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: motivo },
    });
  }
}
