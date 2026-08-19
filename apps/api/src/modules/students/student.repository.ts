import { Injectable } from '@nestjs/common';
import type {
  LeadSource,
  Prisma,
  Student,
  StudentAddress,
  StudentContact,
  StudentRegisteredSex,
  StudentStatus,
} from '@arenahub/database';

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
  type: 'EMAIL' | 'PHONE' | 'WHATSAPP' | 'EMERGENCY';
  value: string;
  isPrimary: boolean;
  /** So `EMERGENCY` preenche: nome de quem atende e parentesco. */
  label?: string | undefined;
  relationship?: string | undefined;
}

/** Endereco do aluno. Ja normalizado -- CEP em digitos, UF em maiusculas. */
export interface EnderecoDeEntrada {
  postalCode: string;
  street: string;
  number?: string | undefined;
  complement?: string | undefined;
  district?: string | undefined;
  city: string;
  state: string;
}

export interface DadosDeCriacaoDeAluno {
  fullName: string;
  birthDate: Date;
  /** Unidade de ORIGEM, obrigatoria (F45). Nunca lida na decisao de acesso. */
  gymUnitId: string;
  cpf?: string | undefined;
  rg?: string | undefined;
  registeredSex?: StudentRegisteredSex | undefined;
  leadSource?: LeadSource | undefined;
  advisorUserId?: string | undefined;
  status?: StudentStatus | undefined;
  contacts: readonly ContatoDeEntrada[];
  address?: EnderecoDeEntrada | undefined;
}

/**
 * Campos editaveis do cadastro (`PATCH /students/:id`).
 *
 * `membershipNumber` e `tenantId` NAO estao aqui, e a ausencia e a regra:
 * matricula e imutavel (INV-010) e tenant vem da identidade (regra no 2).
 * `status` tambem fica de fora -- tem endpoint proprio, com maquina de
 * estados que valida a transicao.
 *
 * `undefined` significa "nao mexer"; `null` significa "apagar". Sem essa
 * distincao nao haveria como limpar um RG digitado errado.
 */
export interface DadosDeEdicaoDeAluno {
  fullName?: string | undefined;
  birthDate?: Date | undefined;
  gymUnitId?: string | undefined;
  cpf?: string | null | undefined;
  rg?: string | null | undefined;
  registeredSex?: StudentRegisteredSex | null | undefined;
  leadSource?: LeadSource | null | undefined;
  advisorUserId?: string | null | undefined;
  contacts?: readonly ContatoDeEntrada[] | undefined;
  address?: EnderecoDeEntrada | null | undefined;
}

/** Aluno com endereco e contatos, para o `GET /students/:id`. */
export type AlunoComDetalhes = Student & {
  contacts: StudentContact[];
  addresses: StudentAddress[];
};

/** Possivel duplicata, ja mascarada para exibicao (INV-014). */
export interface CandidatoADuplicata {
  studentId: string;
  membershipNumber: string;
  fullName: string;
  status: StudentStatus;
  motivo: 'CPF' | 'EMAIL' | 'PHONE' | 'NAME_AND_BIRTH_DATE';
}

/**
 * Valor do contato na forma que vai para o banco.
 *
 * UM lugar so, de proposito: a deteccao de duplicata (INV-014) compara o
 * valor gravado com o valor recebido, e as duas normalizacoes divergirem
 * significa duplicata que nunca aparece. Antes da F45 esta expressao estava
 * escrita duas vezes; `EMERGENCY` seria a terceira.
 *
 * `EMERGENCY` normaliza como telefone -- e um telefone, o de outra pessoa.
 */
/**
 * Endereco pronto para gravar.
 *
 * `undefined` vira `null` porque a coluna e anulavel e o `tsconfig` roda com
 * `exactOptionalPropertyTypes`: "campo ausente" e "campo vazio" sao coisas
 * distintas para o TypeScript, e o Prisma so aceita a segunda.
 */
function linhaDeEndereco(endereco: EnderecoDeEntrada): {
  postalCode: string;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
} {
  return {
    postalCode: endereco.postalCode,
    street: endereco.street,
    number: endereco.number ?? null,
    complement: endereco.complement ?? null,
    district: endereco.district ?? null,
    city: endereco.city,
    state: endereco.state,
  };
}

function normalizarValorDeContato(
  tipo: ContatoDeEntrada['type'],
  valor: string,
): string {
  return tipo === 'EMAIL' ? normalizarEmail(valor) : normalizarTelefone(valor);
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
      // Contato de emergencia e de OUTRA pessoa: o telefone do conjuge nao
      // torna dois alunos a mesma pessoa. Comparar por ele produziria
      // duplicata falsa em toda familia que se cadastra junto.
      if (contato.type === 'EMERGENCY') continue;

      const valor = normalizarValorDeContato(contato.type, contato.value);

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
          // Unidade de ORIGEM (F45). Obrigatoria no modelo; quem valida que
          // ela pertence a este tenant e o controller, antes de chegar aqui.
          gymUnitId: dados.gymUnitId,
          rg: dados.rg ?? null,
          registeredSex: dados.registeredSex ?? null,
          leadSource: dados.leadSource ?? null,
          advisorUserId: dados.advisorUserId ?? null,
          ...(dados.status ? { status: dados.status } : {}),
          // `student_addresses` existe desde a F7 e nunca foi escrita por
          // nada. Aqui ela passa a ser.
          ...(dados.address
            ? {
                addresses: {
                  create: [{ tenantId: contexto.tenantId, ...linhaDeEndereco(dados.address) }],
                },
              }
            : {}),
          contacts: {
            create: dados.contacts.map((contato) => ({
              tenantId: contexto.tenantId,
              type: contato.type,
              value: normalizarValorDeContato(contato.type, contato.value),
              isPrimary: contato.isPrimary,
              label: contato.label ?? null,
              relationship: contato.relationship ?? null,
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
   * Aluno com endereco e contatos (`GET /students/:id`).
   *
   * Separado do `encontrar`: a decisao de acesso e a checagem de
   * elegibilidade nao precisam de endereco, e carregar duas relacoes em toda
   * consulta de catraca seria custo por nada.
   */
  async encontrarComDetalhes(
    contexto: TenantContext,
    id: string,
  ): Promise<AlunoComDetalhes | null> {
    return this.db.student.findFirst({
      where: { id, tenantId: contexto.tenantId },
      include: {
        contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        // Uma linha hoje, mas a tabela e 1:N: ordenar deixa a leitura
        // deterministica em vez de depender da ordem fisica das paginas.
        addresses: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  /**
   * Edita dado cadastral com trava otimista.
   *
   * ATE A F45 NAO EXISTIA EDICAO: so `PATCH /students/:id/status`. Um
   * formulario de vinte e dois campos sem edicao torna todo CEP digitado
   * errado permanente.
   *
   * `version` no filtro pelo mesmo motivo do `alterarStatus`: duas
   * recepcionistas na mesma ficha, uma sobrescreveria a outra em silencio.
   * `count === 0` devolve `null` e quem chama traduz para conflito.
   *
   * CONTATOS E ENDERECO SAO SUBSTITUIDOS, nao mesclados: o formulario manda
   * a lista inteira, e "apagar o que sumiu" e a unica leitura que permite
   * remover um contato. Mesclar exigiria id estavel por linha na UI, que a
   * fatia nao tem -- e mesclagem silenciosa deixaria contato antigo vivo
   * depois de a recepcao te-lo apagado da tela.
   */
  async atualizar(
    contexto: TenantContext,
    id: string,
    versaoEsperada: number,
    dados: DadosDeEdicaoDeAluno,
    correlationId: string,
  ): Promise<Student | null> {
    return this.db.$transaction(async (tx) => {
      const alterados = await tx.student.updateMany({
        where: { id, tenantId: contexto.tenantId, version: versaoEsperada },
        data: {
          version: { increment: 1 },
          ...(dados.fullName !== undefined ? { fullName: dados.fullName } : {}),
          ...(dados.birthDate !== undefined ? { birthDate: dados.birthDate } : {}),
          ...(dados.gymUnitId !== undefined ? { gymUnitId: dados.gymUnitId } : {}),
          ...(dados.rg !== undefined ? { rg: dados.rg } : {}),
          ...(dados.registeredSex !== undefined ? { registeredSex: dados.registeredSex } : {}),
          ...(dados.leadSource !== undefined ? { leadSource: dados.leadSource } : {}),
          ...(dados.advisorUserId !== undefined ? { advisorUserId: dados.advisorUserId } : {}),
          // Os dois campos de CPF andam JUNTOS: hash sem os ultimos digitos
          // esconde o aluno da recepcao, e ultimos digitos sem hash o
          // esconde da deteccao de duplicata.
          ...(dados.cpf !== undefined
            ? dados.cpf === null
              ? { cpfHash: null, cpfLast3: null }
              : {
                  cpfHash: calcularHashDeCpf(contexto.tenantId, dados.cpf),
                  cpfLast3: ultimosTresDigitosDoCpf(dados.cpf),
                }
            : {}),
        },
      });

      if (alterados.count === 0) return null;

      if (dados.contacts !== undefined) {
        await tx.studentContact.deleteMany({ where: { studentId: id, tenantId: contexto.tenantId } });

        if (dados.contacts.length > 0) {
          await tx.studentContact.createMany({
            data: dados.contacts.map((contato) => ({
              tenantId: contexto.tenantId,
              studentId: id,
              type: contato.type,
              value: normalizarValorDeContato(contato.type, contato.value),
              isPrimary: contato.isPrimary,
              label: contato.label ?? null,
              relationship: contato.relationship ?? null,
            })),
          });
        }
      }

      if (dados.address !== undefined) {
        await tx.studentAddress.deleteMany({ where: { studentId: id, tenantId: contexto.tenantId } });

        if (dados.address !== null) {
          await tx.studentAddress.create({
            data: { tenantId: contexto.tenantId, studentId: id, ...linhaDeEndereco(dados.address) },
          });
        }
      }

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: id,
          type: 'STUDENT_UPDATED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          // Nomes dos campos tocados, NUNCA os valores: a timeline diria o
          // CPF e o endereco de quem quer que a leia (INV-022).
          payload: { campos: Object.keys(dados).filter((c) => dados[c as keyof DadosDeEdicaoDeAluno] !== undefined) },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'student.updated',
          target: 'student',
          targetId: id,
          correlationId,
          metadata: { campos: Object.keys(dados).filter((c) => dados[c as keyof DadosDeEdicaoDeAluno] !== undefined) },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'StudentUpdated',
          aggregateType: 'Student',
          aggregateId: id,
          payload: { studentId: id },
        },
      });

      return tx.student.findFirstOrThrow({ where: { id, tenantId: contexto.tenantId } });
    });
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
    filtro: {
      termo?: string | undefined;
      limite: number;
      cursor?: string | undefined;
      /**
       * Unidade de ORIGEM (F45). Opcional de proposito: o painel ainda nao
       * tem seletor de unidade no cabecalho -- ele mostra um indicador
       * estatico, e criar o seletor e decisao de produto adiada
       * (`DS-PAINEL.md` §5). Ausente, a listagem segue mostrando o tenant
       * inteiro, como antes desta fatia.
       */
      gymUnitId?: string | undefined;
      /**
       * Situacao do aluno. Opcional: ausente, a listagem mostra TODAS as
       * situacoes -- que e o que a tela fazia antes do filtro existir.
       *
       * Filtra pela COLUNA, nao por regra derivada: "sem acesso a catraca" e
       * consequencia do status (`impedeAcesso`), nao um status por si. Quem
       * quer ver os bloqueados filtra por `BLOCKED`.
       */
      status?: StudentStatus | undefined;
      /**
       * Coluna e direcao da ordenacao. Ausente, mantem o padrao historico
       * (cadastro mais recente primeiro), que e o que a tela sempre mostrou.
       *
       * LISTA BRANCA, nao string livre: `orderBy` montado com entrada do
       * usuario e injecao de campo -- o Prisma recusaria coluna inexistente,
       * mas ordenar por `cpfHash` vazaria a ordem do hash.
       */
      ordem?: 'nome' | 'matricula' | 'nascimento' | undefined;
      direcao?: 'asc' | 'desc' | undefined;
    },
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
      where: {
        tenantId: contexto.tenantId,
        ...(filtro.gymUnitId ? { gymUnitId: filtro.gymUnitId } : {}),
        ...(filtro.status ? { status: filtro.status } : {}),
        ...condicoes,
      },
      orderBy: ordenacao(filtro.ordem, filtro.direcao),
      take: filtro.limite,
      ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
      /**
       * O PLANO VEM JUNTO -- a lista responde "quem e este aluno?", e o plano
       * e metade da resposta na recepcao ("ele tem Mensal Fit ou Anual
       * Black?"). Sem isto, descobrir exigia abrir a ficha de cada um.
       *
       * SO A ASSINATURA QUE VALE AGORA: `ACTIVE` ou `PAST_DUE`, a mais
       * recente. Um aluno pode ter historico de assinaturas canceladas, e
       * mostrar a antiga diria que ele tem plano que nao tem.
       *
       * `take: 1` no include, e nao um segundo `findMany`: a alternativa seria
       * uma consulta por aluno, que e o N+1 que o `docs/REVIEW.md` §3.4 barra.
       */
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'PAST_DUE'] } },
          orderBy: { startsAt: 'desc' },
          take: 1,
          select: {
            status: true,
            plan: { select: { name: true } },
          },
        },
        contacts: {
          where: { type: 'PHONE' },
          orderBy: { isPrimary: 'desc' },
          take: 1,
          select: { value: true },
        },
      },
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

/**
 * Traduz a ordem pedida para o `orderBy` do Prisma.
 *
 * O `id` entra SEMPRE como ultimo criterio: sem desempate estavel, duas linhas
 * com o mesmo nome trocam de lugar entre paginas, e a paginacao por cursor
 * repete ou pula registro. E o bug classico de lista ordenada por campo
 * repetido.
 */
function ordenacao(
  ordem: 'nome' | 'matricula' | 'nascimento' | undefined,
  direcao: 'asc' | 'desc' | undefined,
): Prisma.StudentOrderByWithRelationInput[] {
  const dir = direcao ?? 'asc';

  switch (ordem) {
    case 'nome':
      return [{ fullName: dir }, { id: 'desc' }];
    case 'matricula':
      return [{ membershipNumber: dir }, { id: 'desc' }];
    case 'nascimento':
      return [{ birthDate: dir }, { id: 'desc' }];
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}
