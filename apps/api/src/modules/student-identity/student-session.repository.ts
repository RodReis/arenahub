import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma, StudentSession } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';
import { SessaoRevogadaError } from './erros.js';

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
   *
   * NUNCA RESSUSCITA UM ELO REVOGADO. `renovar()` le a sessao e so depois chega
   * aqui, sem lock: se a troca de senha ou o logout revogou a familia nesse
   * intervalo, um `update` incondicional sobrescreveria `REVOKED` por `ROTATED`
   * e criaria um elo `ACTIVE` -- o refresh devolvido continuaria valendo depois
   * da troca de senha. A marcacao e condicionada ao status (mesma correcao do
   * painel, issue #558).
   *
   * ACEITA `ACTIVE` E `ROTATED`, de proposito, como o painel: dois refresh
   * simultaneos do MESMO token legitimo nao podem virar loteria de logout. So o
   * REVOGADO e recusado.
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
    return this.db.$transaction(async (tx) => {
      const marcado = await tx.studentSession.updateMany({
        where: { id: dados.sessaoAtualId, status: { in: ['ACTIVE', 'ROTATED'] } },
        data: { status: 'ROTATED', rotatedAt: dados.agora },
      });

      if (marcado.count === 0) throw new SessaoRevogadaError();

      const nova = await tx.studentSession.create({
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
      });

      return nova.id;
    });
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
    await this.varrer({ familyId }, motivo, agora);
  }

  /** Todas as sessoes da conta -- usado quando a senha muda. */
  async revogarTodasDaConta(accountId: string, motivo: string, agora: Date): Promise<void> {
    await this.varrer({ accountId }, motivo, agora);
  }

  /**
   * DUAS PASSADAS, e a segunda nao e redundancia (issue #558, #580).
   *
   * Um refresh em voo ja segura o lock da linha do elo antigo e inseriu o elo
   * novo, ainda nao comitado. O `updateMany` espera o lock, revoga o antigo
   * depois do commit -- mas o elo novo nao esta no SNAPSHOT dele e ficaria
   * `ACTIVE`. Cada comando de uma transacao READ COMMITTED tira um snapshot
   * novo: a segunda passada ja enxerga o que o refresh comitou.
   */
  private async varrer(
    escopo: Prisma.StudentSessionWhereInput,
    motivo: string,
    agora: Date,
  ): Promise<void> {
    for (let passada = 0; passada < 2; passada += 1) {
      await this.db.studentSession.updateMany({
        where: { ...escopo, status: { in: ['ACTIVE', 'ROTATED'] } },
        data: { status: 'REVOKED', revokedAt: agora, revokedReason: motivo },
      });
    }
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
