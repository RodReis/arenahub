import { Injectable } from '@nestjs/common';
import type { StudentAccount, StudentAccountToken } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';

export interface ContaComAluno extends StudentAccount {
  readonly student: { readonly id: string; readonly fullName: string; readonly status: string };
}

export interface TokenComConta extends StudentAccountToken {
  readonly account: StudentAccount;
}

@Injectable()
export class StudentAccountRepository {
  constructor(private readonly db: PrismaService) {}

  async encontrarPorIdentificador(
    tenantId: string,
    identifier: string,
  ): Promise<ContaComAluno | null> {
    return this.db.studentAccount.findUnique({
      where: { tenantId_identifier: { tenantId, identifier } },
      include: { student: { select: { id: true, fullName: true, status: true } } },
    });
  }

  async encontrarPorId(accountId: string): Promise<StudentAccount | null> {
    return this.db.studentAccount.findUnique({ where: { id: accountId } });
  }

  async encontrarTokenPorHash(tokenHash: string): Promise<TokenComConta | null> {
    return this.db.studentAccountToken.findUnique({
      where: { tokenHash },
      include: { account: true },
    });
  }

  async emitirToken(dados: {
    tenantId: string;
    accountId: string;
    purpose: 'ACTIVATION' | 'PASSWORD_RESET';
    tokenHash: string;
    validoAte: Date;
  }): Promise<string> {
    const token = await this.db.studentAccountToken.create({
      data: {
        tenantId: dados.tenantId,
        accountId: dados.accountId,
        purpose: dados.purpose,
        tokenHash: dados.tokenHash,
        expiresAt: dados.validoAte,
      },
    });

    return token.id;
  }

  /**
   * Consome o token E define a senha, ATOMICAMENTE.
   *
   * Devolve `false` quando o token ja tinha sido consumido -- e essa e a
   * unica forma de saber, porque a decisao NAO esta num `if` do servico.
   *
   * O `updateMany` condicionado ao `status: 'PENDING'` E a exclusao mutua.
   * Duas requisicoes simultaneas com o mesmo token passariam as duas pela
   * leitura antes de qualquer escrita, e um `if (token.status === 'PENDING')`
   * aprovaria as duas -- a conta ativaria duas vezes, e a segunda senha
   * sobrescreveria a primeira em silencio. E o mesmo defeito de contagem que
   * ja cobrou aluno em dobro neste repositorio: exclusao mutua vive em
   * indice ou em escrita condicionada, nunca numa leitura seguida de decisao.
   */
  async consumirTokenEDefinirSenha(dados: {
    tokenId: string;
    accountId: string;
    passwordHash: string;
    ativarConta: boolean;
    agora: Date;
  }): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.studentAccountToken.updateMany({
        where: { id: dados.tokenId, status: 'PENDING' },
        data: { status: 'CONSUMED', consumedAt: dados.agora },
      });

      if (count === 0) return false;

      await tx.studentAccount.update({
        where: { id: dados.accountId },
        data: {
          passwordHash: dados.passwordHash,
          ...(dados.ativarConta ? { status: 'ACTIVE', activatedAt: dados.agora } : {}),
        },
      });

      return true;
    });
  }

  /**
   * Invalida os tokens pendentes de um proposito.
   *
   * Chamado ao emitir um novo: dois links de recuperacao validos ao mesmo
   * tempo dobram a janela de ataque sem dar nada ao aluno, que usa o ultimo
   * que recebeu.
   */
  async revogarTokensPendentes(dados: {
    accountId: string;
    purpose: 'ACTIVATION' | 'PASSWORD_RESET';
  }): Promise<void> {
    await this.db.studentAccountToken.updateMany({
      where: { accountId: dados.accountId, purpose: dados.purpose, status: 'PENDING' },
      data: { status: 'REVOKED' },
    });
  }
}
