import { Injectable } from '@nestjs/common';
import type { StudentAccount, StudentAccountToken } from '@arenahub/database';
import { comContexto } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';
import { calcularHashDeCpf } from '../students/domain/identificacao.js';

export interface ContaComAluno extends StudentAccount {
  readonly student: { readonly id: string; readonly fullName: string; readonly status: string };
}

export interface TokenComConta extends StudentAccountToken {
  readonly account: StudentAccount;
}

/**
 * Aluno achado pela consulta de ativacao self-service (SPEC-071 §6.2/§7).
 *
 * `contaExistente` distingue os tres casos que a Decisao 5 da ADR-057
 * precisa: sem conta (nunca convidado), conta `PENDING` (convite emitido,
 * nao consumido -- corrida legitima com o self-service) e conta `ACTIVE`
 * (ja tem senha -- self-service nao e recuperacao, essa e outra tela).
 */
export interface CandidatoParaAtivacao {
  readonly studentId: string;
  readonly fullName: string;
  readonly cpf: string;
  readonly birthDate: Date;
  readonly gymUnitName: string;
  readonly createdAt: Date;
  readonly planoAtivo: string | null;
  readonly inicioDoPlano: Date | null;
  readonly contaExistente: { readonly id: string; readonly status: 'PENDING' | 'ACTIVE' | 'DISABLED' } | null;
}

@Injectable()
export class StudentAccountRepository {
  constructor(private readonly db: PrismaService) {}

  /** Busca por identificador (e-mail ou telefone, F23; ou CPF, SPEC-071 login §3). */
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

  /**
   * Consulta da ativacao self-service -- SPEC-071 §6.2/§7. Acha o aluno por
   * CPF (via `cpfHash`, nunca `cpf` em claro na consulta -- mesmo padrao do
   * `KioskSessionService`) + data de nascimento, escopado por tenant.
   *
   * ROTA E `@Public()`: nao ha `tenantContext`/`kioskContext` no request
   * para o `TenantRlsInterceptor` abrir o escopo de RLS (`students` tem
   * FORCE RLS desde a F66) -- por isso este metodo abre o proprio escopo com
   * `comContexto`, do mesmo jeito que o interceptor faria, pelo tenant JA
   * resolvido do `tenantSlug`. Sem isso a consulta voltaria vazia em
   * silencio sob o role restrito, e todo CPF pareceria "nao encontrado".
   *
   * `findFirst` com `orderBy` explicito: `cpfHash` NAO e unico (a base real
   * tem CPF repetido), e sem ordem o resultado mudaria a cada UPDATE na
   * tabela -- mesma armadilha documentada no `KioskSessionService`.
   */
  async encontrarCandidatoParaAtivacao(
    tenantId: string,
    cpf: string,
    dataNascimento: Date,
  ): Promise<CandidatoParaAtivacao | null> {
    const aluno = await comContexto({ kind: 'tenant', tenantId }, () =>
      this.db.comTenant((tx) =>
        tx.student.findFirst({
          where: {
            tenantId,
            cpfHash: calcularHashDeCpf(tenantId, cpf),
            birthDate: dataNascimento,
            status: { in: ['ACTIVE', 'TRIAL', 'SUSPENDED'] },
          },
          orderBy: { createdAt: 'asc' },
          include: {
            gymUnit: { select: { name: true } },
            account: { select: { id: true, status: true } },
            subscriptions: {
              where: { status: 'ACTIVE' },
              orderBy: { startsAt: 'desc' },
              take: 1,
              include: { plan: { select: { name: true } } },
            },
          },
        }),
      ),
    );

    if (!aluno || aluno.cpf === null) return null;

    const [assinaturaAtiva] = aluno.subscriptions;

    return {
      studentId: aluno.id,
      fullName: aluno.fullName,
      cpf: aluno.cpf,
      birthDate: aluno.birthDate,
      gymUnitName: aluno.gymUnit.name,
      createdAt: aluno.createdAt,
      planoAtivo: assinaturaAtiva?.plan.name ?? null,
      inicioDoPlano: assinaturaAtiva?.startsAt ?? null,
      contaExistente: aluno.account,
    };
  }

  /**
   * Cria (se nao existir) ou ativa a conta do aluno com a senha do
   * self-service -- SPEC-071 §7, ADR-057 Decisao 5. Devolve `null` quando a
   * corrida foi perdida -- nem `PENDING` para ativar, nem `create` livre; o
   * chamador trata como falha generica, igual a qualquer outro motivo desta
   * consulta.
   *
   * DOIS PASSOS, NAO `upsert`: `upsert` do Prisma so aceita a chave unica no
   * `where`, entao "so ativa se ainda nao esta ACTIVE" nao cabe nele -- e
   * essa e exatamente a exclusao mutua que a Decisao 5 exige (duas
   * confirmacoes de self-service para a MESMA conta `PENDING` nao podem
   * sobrescrever senha uma da outra). O primeiro passo (`updateMany`
   * condicionado a `PENDING`) e a exclusao mutua contra outra requisicao
   * ativando a mesma conta; o segundo (`create`) so roda quando NAO havia
   * conta -- e o indice unico de `studentId` fecha a corrida entre duas
   * criacoes simultaneas (a perdedora cai em `ehViolacaoDeUnicidade`).
   */
  async criarOuAtivarConta(dados: {
    tenantId: string;
    studentId: string;
    identifier: string;
    passwordHash: string;
    agora: Date;
  }): Promise<StudentAccount | null> {
    const ativouExistente = await this.db.studentAccount.updateMany({
      where: { studentId: dados.studentId, status: 'PENDING' },
      data: {
        identifier: dados.identifier,
        passwordHash: dados.passwordHash,
        status: 'ACTIVE',
        activatedAt: dados.agora,
      },
    });

    if (ativouExistente.count > 0) {
      return this.db.studentAccount.findUniqueOrThrow({ where: { studentId: dados.studentId } });
    }

    try {
      return await this.db.studentAccount.create({
        data: {
          tenantId: dados.tenantId,
          studentId: dados.studentId,
          identifier: dados.identifier,
          passwordHash: dados.passwordHash,
          status: 'ACTIVE',
          activatedAt: dados.agora,
        },
      });
    } catch (erro) {
      if (ehViolacaoDeUnicidade(erro)) return null;
      throw erro;
    }
  }

  /**
   * Resolve o slug da academia para o id do tenant.
   *
   * Necessario porque o identificador do aluno e unico POR TENANT, e nao
   * global como o `User.email` do painel: sem saber a academia, "ana@x.test"
   * pode ser duas pessoas. O painel nao precisa disso -- la o vinculo do
   * usuario diz o tenant --, mas o aluno se identifica antes de existir
   * qualquer vinculo autenticado.
   *
   * Devolve `null` para slug inexistente, e QUEM CHAMA decide o que fazer.
   * No login, o caminho segue ate o fim mesmo assim: parar aqui responderia
   * mais rapido para academia que nao existe, e isso enumera os tenants.
   */
  async resolverTenantPorSlug(slug: string): Promise<string | null> {
    const tenant = await this.db.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });

    return tenant?.id ?? null;
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

/**
 * Violacao de unicidade do Prisma (P2002).
 *
 * Checagem estrutural, nao `instanceof PrismaClientKnownRequestError` --
 * mesmo padrao ja usado em `billing/` (`cobrar-assinatura-no-cartao`,
 * `criar-checkout-de-cartao`).
 */
function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}
