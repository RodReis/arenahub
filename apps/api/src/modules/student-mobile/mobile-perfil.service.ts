import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';
import { AlunoDaSessaoNaoEncontradoError } from './contexto-do-aluno.js';

export interface RespostaDoPerfil {
  readonly asOf: string;
  readonly nome: string;
  readonly matricula: string;
  /** `AAAA-MM-DD`. */
  readonly nascimento: string;
  readonly email: string | null;
  readonly telefone: string | null;
  readonly alunoDesde: string;
  readonly unidade: string;
}

/**
 * O cadastro do proprio aluno, somente leitura.
 *
 * NOME COMPLETO, diferente da saudacao da Home: aqui e o titular conferindo
 * o proprio cadastro, numa tela que ele abriu para isso. CPF e RG ficam de
 * fora -- a tela nao os mostra, e o que nao e mostrado nao viaja para o
 * celular (onde ficaria em cache de rede e em log de crash).
 *
 * Leitura direta e nao caso de uso de `students`: o modulo de alunos nao
 * expoe leitura por aluno para canal sem permissao de painel, e o BFF ja le
 * `students` do mesmo jeito na Home (`mobile-home.service.ts`).
 */
@Injectable()
export class MobilePerfilService {
  constructor(private readonly db: PrismaService) {}

  async montar(ctx: StudentChannelContext, agora: Date): Promise<RespostaDoPerfil> {
    // `comTenant` -- ADR-054 §3, ver `mobile-home.service.ts`. A raiz e a
    // tabela com politica; `gymUnit` e `contacts` vem aninhados e nao tem
    // politica, entao nao caem no caso do include que volta nulo.
    const aluno = await this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id: ctx.studentId, tenantId: ctx.tenantId },
        select: {
          fullName: true,
          membershipNumber: true,
          birthDate: true,
          createdAt: true,
          gymUnit: { select: { name: true } },
          contacts: {
            where: { type: { in: ['EMAIL', 'PHONE', 'WHATSAPP'] } },
            /*
             * orderBy EXPLICITO, com desempate por `id`: sem ele a ordem e a
             * fisica do Postgres, que muda depois de um UPDATE -- e o "telefone
             * principal" trocaria sozinho entre dois carregamentos da tela.
             * Principal primeiro; entre iguais, o cadastrado antes.
             */
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
            select: { type: true, value: true },
          },
        },
      }),
    );

    if (!aluno) throw new AlunoDaSessaoNaoEncontradoError();

    return {
      asOf: agora.toISOString(),
      nome: aluno.fullName,
      matricula: aluno.membershipNumber,
      // `@db.Date` chega como meia-noite UTC: formatar em UTC e o que devolve
      // o dia gravado. No fuso local, 01/01 viraria 31/12.
      nascimento: aluno.birthDate.toISOString().slice(0, 10),
      email: aluno.contacts.find((contato) => contato.type === 'EMAIL')?.value ?? null,
      // PHONE e WHATSAPP sao o mesmo numero para o aluno; vale o primeiro da
      // ordem acima, qualquer que seja o tipo.
      telefone: aluno.contacts.find((contato) => contato.type !== 'EMAIL')?.value ?? null,
      alunoDesde: aluno.createdAt.toISOString(),
      unidade: aluno.gymUnit.name,
    };
  }
}
