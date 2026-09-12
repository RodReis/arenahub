import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { StudentSession } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * Guarda a cadeia de refresh tokens do APP DO ALUNO.
 *
 * Espelha `auth/session.repository.ts` de proposito: o modelo de FAMILIA ja
 * provou valer no painel, e divergir aqui criaria duas semanticas de sessao no
 * mesmo produto -- quem consertasse uma esqueceria a outra.
 *
 * A tabela e separada porque o SUJEITO e outro: `Session.userId` aponta para
 * `User`, e nao existe join entre sessao de aluno e usuario de painel.
 */
@Injectable()
export class StudentSessionRepository {
  constructor(private readonly db: PrismaService) {}

  async abrir(dados: {
    tenantId: string;
    accountId: string;
    tokenHash: string;
    deviceLabel: string | null;
    validoAte: Date;
    agora: Date;
  }): Promise<string> {
    const sessao = await this.db.studentSession.create({
      data: {
        tenantId: dados.tenantId,
        accountId: dados.accountId,
        tokenHash: dados.tokenHash,
        familyId: randomUUID(),
        deviceLabel: dados.deviceLabel,
        expiresAt: dados.validoAte,
        // O login CONTA como autenticacao recente para o step-up do
        // `M4-FR-005`: o aluno acabou de digitar a senha.
        reauthenticatedAt: dados.agora,
      },
    });

    return sessao.id;
  }

  async encontrarPorHash(tokenHash: string): Promise<StudentSession | null> {
    return this.db.studentSession.findUnique({ where: { tokenHash } });
  }

  /** Usado pelo guard a cada requisicao, para pegar revogacao na hora. */
  async encontrarPorId(sessaoId: string): Promise<StudentSession | null> {
    return this.db.studentSession.findUnique({ where: { id: sessaoId } });
  }

  /**
   * Rotaciona numa transacao so: marca o elo atual como usado e cria o
   * proximo com o mesmo `familyId`.
   *
   * Em transacao porque o estado intermediario e perigoso -- se o antigo
   * fosse marcado e o novo falhasse, a sessao sumiria; se o novo fosse criado
   * e a marcacao falhasse, dois tokens valeriam ao mesmo tempo.
   */
  async rotacionar(dados: {
    sessaoAtualId: string;
    familyId: string;
    tenantId: string;
    accountId: string;
    novoTokenHash: string;
    deviceLabel: string | null;
    reauthenticatedAt: Date | null;
    validoAte: Date;
    agora: Date;
  }): Promise<string> {
    const [, nova] = await this.db.$transaction([
      this.db.studentSession.update({
        where: { id: dados.sessaoAtualId },
        data: { status: 'ROTATED', rotatedAt: dados.agora },
      }),
      this.db.studentSession.create({
        data: {
          tenantId: dados.tenantId,
          accountId: dados.accountId,
          tokenHash: dados.novoTokenHash,
          familyId: dados.familyId,
          deviceLabel: dados.deviceLabel,
          // A rotacao PRESERVA o instante do step-up. Renovar o token nao e
          // prova de que a pessoa continua ali -- zerar aqui obrigaria a
          // digitar a senha a cada 10 minutos; renovar mentiria dizendo que
          // ela se autenticou agora.
          reauthenticatedAt: dados.reauthenticatedAt,
          expiresAt: dados.validoAte,
        },
      }),
    ]);

    return nova.id;
  }

  /**
   * Derruba a familia inteira.
   *
   * Chamado quando um token ja rotacionado reaparece: alguem o copiou, e nao
   * ha como distinguir a vitima do ladrao -- os dois apresentam credencial
   * legitima. Encerrar tudo e obrigar login novo e a unica saida que nao
   * aposta em qual dos dois e qual.
   */
  async revogarFamilia(familyId: string, motivo: string, agora: Date): Promise<void> {
    await this.db.studentSession.updateMany({
      where: { familyId, status: { in: ['ACTIVE', 'ROTATED'] } },
      data: { status: 'REVOKED', revokedAt: agora, revokedReason: motivo },
    });
  }

  /** Todas as sessoes da conta -- usado quando a senha muda. */
  async revogarTodasDaConta(accountId: string, motivo: string, agora: Date): Promise<void> {
    await this.db.studentSession.updateMany({
      where: { accountId, status: { in: ['ACTIVE', 'ROTATED'] } },
      data: { status: 'REVOKED', revokedAt: agora, revokedReason: motivo },
    });
  }

  /**
   * Revoga UMA sessao, e so se ela for da conta informada.
   *
   * O `accountId` no `where` NAO e redundante com a checagem do servico: e a
   * autorizacao por objeto do `M4-NFR-006` aplicada onde nao ha como pular.
   * Um `where: { id }` sozinho deixaria qualquer aluno autenticado derrubar a
   * sessao de outro conhecendo o id.
   */
  async revogarDaConta(dados: {
    sessaoId: string;
    accountId: string;
    motivo: string;
    agora: Date;
  }): Promise<number> {
    const { count } = await this.db.studentSession.updateMany({
      where: {
        id: dados.sessaoId,
        accountId: dados.accountId,
        status: { in: ['ACTIVE', 'ROTATED'] },
      },
      data: { status: 'REVOKED', revokedAt: dados.agora, revokedReason: dados.motivo },
    });

    return count;
  }

  /**
   * Sessoes vivas da conta, para a tela de "onde estou conectado".
   *
   * So `ACTIVE`: os elos `ROTATED` sao historico da mesma sessao, e listar
   * todos mostraria uma linha nova a cada 10 minutos.
   */
  async listarAtivas(accountId: string, agora: Date): Promise<StudentSession[]> {
    return this.db.studentSession.findMany({
      where: { accountId, status: 'ACTIVE', expiresAt: { gt: agora } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Marca que o aluno confirmou a senha agora -- `M4-FR-005`. */
  async registrarReautenticacao(sessaoId: string, agora: Date): Promise<void> {
    await this.db.studentSession.update({
      where: { id: sessaoId },
      data: { reauthenticatedAt: agora },
    });
  }
}
