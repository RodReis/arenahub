import { Injectable } from '@nestjs/common';
import type { Prisma, Student, StudentStatus } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  calcularHashDeCpf,
  formatarMatricula,
  normalizarEmail,
  normalizarTelefone,
  ultimosTresDigitosDoCpf,
} from './domain/identificacao.js';
import { alunoRecebeAcessoNormal } from './domain/student.js';

/** Contato normalizado, pronto para gravar. */
export interface ContatoDeEntrada {
  type: 'EMAIL' | 'PHONE' | 'WHATSAPP';
  value: string;
  isPrimary: boolean;
}

export interface DadosDeCriacaoDeAluno {
  fullName: string;
  birthDate: Date;
  cpf?: string | undefined;
  contacts: readonly ContatoDeEntrada[];
}

/** Possivel duplicata, ja mascarada para exibicao (INV-014). */
export interface CandidatoADuplicata {
  studentId: string;
  membershipNumber: string;
  fullName: string;
  status: StudentStatus;
  motivo: 'CPF' | 'EMAIL' | 'PHONE' | 'NAME_AND_BIRTH_DATE';
}

/**
 * Acesso a alunos.
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento -- INV-003 e
 * regra de arquitetura no 2, igual ao `GymUnitRepository`.
 */
@Injectable()
export class StudentRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Gera a proxima matricula do tenant, DENTRO da transacao recebida.
   *
   * `SELECT ... FOR UPDATE` na linha do contador serializa as criacoes
   * concorrentes ali, e nao na tabela `students`. Duas recepcionistas
   * cadastrando ao mesmo tempo esperam uma a outra por milissegundos e
   * recebem numeros distintos e sequenciais.
   *
   * Por que nao as alternativas obvias:
   *
   *   - `COUNT(*) + 1` reusa numero depois de arquivamento -- quebra INV-010;
   *   - fragmento de UUID colide e nao e sequencial;
   *   - `SEQUENCE` do Postgres e global: o tenant B veria o volume do A.
   *
   * O `ano` entra por parametro para a formatacao continuar pura e testavel.
   */
  private async proximaMatricula(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ano: number,
  ): Promise<string> {
    // `ON CONFLICT DO NOTHING` cria a linha do contador na primeira vez sem
    // corrida: se dois pedidos chegarem juntos, um insere e o outro segue
    // para o lock abaixo.
    await tx.$executeRaw`
      INSERT INTO student_sequences (tenant_id, next_value, updated_at)
      VALUES (${tenantId}::uuid, 1, now())
      ON CONFLICT (tenant_id) DO NOTHING
    `;

    const travadas = await tx.$queryRaw<{ next_value: number }[]>`
      SELECT next_value FROM student_sequences
      WHERE tenant_id = ${tenantId}::uuid
      FOR UPDATE
    `;

    const sequencial = travadas[0]?.next_value ?? 1;

    await tx.$executeRaw`
      UPDATE student_sequences
      SET next_value = ${sequencial + 1}, updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid
    `;

    return formatarMatricula(ano, sequencial);
  }

  /**
   * Procura possiveis duplicatas dentro do tenant (INV-014).
   *
   * AVISA, NAO BLOQUEIA: o resultado vai para a recepcao decidir. Bloquear
   * automaticamente impediria gemeos, homonimos e a pessoa que trocou de
   * telefone -- e nao ha endpoint de merge nesta fatia.
   */
  async buscarCandidatosADuplicata(
    contexto: TenantContext,
    dados: { fullName: string; birthDate: Date; cpf?: string | undefined; contacts: readonly ContatoDeEntrada[] },
  ): Promise<CandidatoADuplicata[]> {
    const encontrados = new Map<string, CandidatoADuplicata>();

    const registrar = (
      aluno: Pick<Student, 'id' | 'membershipNumber' | 'fullName' | 'status'>,
      motivo: CandidatoADuplicata['motivo'],
    ): void => {
      // Primeiro motivo vence: a ordem das buscas abaixo vai do sinal mais
      // forte (CPF) ao mais fraco (nome + nascimento).
      if (encontrados.has(aluno.id)) return;

      encontrados.set(aluno.id, {
        studentId: aluno.id,
        membershipNumber: aluno.membershipNumber,
        fullName: aluno.fullName,
        status: aluno.status,
        motivo,
      });
    };

    const selecao = { id: true, membershipNumber: true, fullName: true, status: true };

    if (dados.cpf) {
      const porCpf = await this.db.student.findMany({
        where: {
          tenantId: contexto.tenantId,
          cpfHash: calcularHashDeCpf(contexto.tenantId, dados.cpf),
        },
        select: selecao,
      });

      for (const aluno of porCpf) registrar(aluno, 'CPF');
    }

    for (const contato of dados.contacts) {
      const valor =
        contato.type === 'EMAIL'
          ? normalizarEmail(contato.value)
          : normalizarTelefone(contato.value);

      const porContato = await this.db.student.findMany({
        where: {
          tenantId: contexto.tenantId,
          contacts: { some: { type: contato.type, value: valor } },
        },
        select: selecao,
      });

      for (const aluno of porContato) {
        registrar(aluno, contato.type === 'EMAIL' ? 'EMAIL' : 'PHONE');
      }
    }

    // Sinal mais fraco: mesmo nome E mesma data de nascimento. Sozinho, nome
    // igual seria ruido; com a data, vira aviso util.
    const porNome = await this.db.student.findMany({
      where: {
        tenantId: contexto.tenantId,
        fullName: { equals: dados.fullName, mode: 'insensitive' },
        birthDate: dados.birthDate,
      },
      select: selecao,
    });

    for (const aluno of porNome) registrar(aluno, 'NAME_AND_BIRTH_DATE');

    return [...encontrados.values()];
  }

  /**
   * Cria o aluno, a matricula, os contatos, a timeline e o evento de dominio
   * NUMA TRANSACAO SO (regra de arquitetura no 5, INV-084).
   *
   * `ano` entra por parametro -- o caso de uso e quem le o relogio.
   */
  async criar(
    contexto: TenantContext,
    dados: DadosDeCriacaoDeAluno,
    correlationId: string,
    ano: number,
  ): Promise<Student> {
    return this.db.$transaction(async (tx) => {
      const membershipNumber = await this.proximaMatricula(tx, contexto.tenantId, ano);

      const aluno = await tx.student.create({
        data: {
          tenantId: contexto.tenantId,
          membershipNumber,
          fullName: dados.fullName,
          birthDate: dados.birthDate,
          // O CPF completo nao e persistido: so o hash (para comparar) e os
          // tres ultimos digitos (para a recepcao conferir).
          cpfHash: dados.cpf ? calcularHashDeCpf(contexto.tenantId, dados.cpf) : null,
          cpfLast3: dados.cpf ? ultimosTresDigitosDoCpf(dados.cpf) : null,
          contacts: {
            create: dados.contacts.map((contato) => ({
              tenantId: contexto.tenantId,
              type: contato.type,
              value:
                contato.type === 'EMAIL'
                  ? normalizarEmail(contato.value)
                  : normalizarTelefone(contato.value),
              isPrimary: contato.isPrimary,
            })),
          },
        },
      });

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: aluno.id,
          type: 'STUDENT_CREATED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          // Sem PII: matricula e dado operacional; nome e CPF ficam de fora.
          payload: { membershipNumber },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'student.created',
          target: 'student',
          targetId: aluno.id,
          correlationId,
          metadata: { membershipNumber },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'StudentCreated',
          aggregateType: 'Student',
          aggregateId: aluno.id,
          payload: { membershipNumber, status: aluno.status },
        },
      });

      return aluno;
    });
  }

  async encontrar(contexto: TenantContext, id: string): Promise<Student | null> {
    // `findFirst` com tenantId no filtro, nunca `findUnique` por id: id de
    // outro tenant simplesmente nao entra no conjunto.
    return this.db.student.findFirst({ where: { id, tenantId: contexto.tenantId } });
  }

  /**
   * Existe e esta apto a receber direito novo?
   *
   * ESTE METODO E A PORTA PUBLICA do modulo `students` para o `membership`
   * (regra de arquitetura no 9): modulo nao le tabela privada de outro. Sem
   * ele, o `MembershipRepository` consultaria `db.student` direto -- funciona
   * hoje e apodrece amanha, quando a regra de elegibilidade mudar em um lugar
   * e nao no outro.
   *
   * Devolve `null` quando o aluno nao existe NESTE tenant. Quem chama traduz
   * para 404.
   */
  async verificarElegibilidade(
    contexto: TenantContext,
    id: string,
  ): Promise<{ status: StudentStatus; elegivel: boolean } | null> {
    const aluno = await this.db.student.findFirst({
      where: { id, tenantId: contexto.tenantId },
      select: { status: true },
    });

    if (!aluno) return null;

    return { status: aluno.status, elegivel: alunoRecebeAcessoNormal(aluno.status) };
  }

  /**
   * Busca por nome, matricula exata ou telefone normalizado.
   *
   * Paginacao por cursor `(createdAt, id)` -- `OFFSET` alto fica lento e
   * pula linha quando alguem cadastra durante a navegacao.
   */
  async buscar(
    contexto: TenantContext,
    filtro: { termo?: string | undefined; limite: number; cursor?: string | undefined },
  ): Promise<Student[]> {
    const termo = filtro.termo?.trim();

    const condicoes: Prisma.StudentWhereInput = termo
      ? {
          OR: [
            { fullName: { contains: termo, mode: 'insensitive' } },
            { membershipNumber: termo },
            {
              contacts: {
                some: { value: { contains: normalizarTelefone(termo) || termo } },
              },
            },
          ],
        }
      : {};

    return this.db.student.findMany({
      where: { tenantId: contexto.tenantId, ...condicoes },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filtro.limite,
      ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
    });
  }

  /**
   * Troca o status do aluno com trava otimista.
   *
   * `version` no filtro: se outro comando alterou o aluno entre a leitura e
   * a escrita, `count` volta 0 e o caso de uso decide -- em vez de
   * sobrescrever uma decisao que este comando nunca viu.
   *
   * ARQUIVAR SUSPENDE OS DIREITOS na mesma transacao (INV-013): o historico
   * fica, o acesso para. Sem isso o aluno arquivado continuaria com
   * entitlement ACTIVE no banco.
   */
  async alterarStatus(
    contexto: TenantContext,
    id: string,
    versaoEsperada: number,
    novoStatus: StudentStatus,
    correlationId: string,
    agora: Date,
  ): Promise<Student | null> {
    const arquivando = novoStatus === 'ARCHIVED';

    return this.db.$transaction(async (tx) => {
      const alterados = await tx.student.updateMany({
        where: { id, tenantId: contexto.tenantId, version: versaoEsperada },
        data: {
          status: novoStatus,
          version: { increment: 1 },
          ...(arquivando ? { archivedAt: agora } : {}),
        },
      });

      if (alterados.count === 0) return null;

      if (arquivando) {
        await tx.entitlement.updateMany({
          where: {
            tenantId: contexto.tenantId,
            studentId: id,
            status: { in: ['SCHEDULED', 'ACTIVE'] },
          },
          data: { status: 'SUSPENDED', suspendedAt: agora },
        });
      }

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: id,
          type: arquivando ? 'STUDENT_ARCHIVED' : 'STUDENT_STATUS_CHANGED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          payload: { status: novoStatus },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: arquivando ? 'student.archived' : 'student.status_changed',
          target: 'student',
          targetId: id,
          correlationId,
          metadata: { status: novoStatus },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'StudentStatusChanged',
          aggregateType: 'Student',
          aggregateId: id,
          payload: { status: novoStatus },
        },
      });

      return tx.student.findFirstOrThrow({ where: { id, tenantId: contexto.tenantId } });
    });
  }
}
