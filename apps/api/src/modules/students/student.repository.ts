import { Injectable } from '@nestjs/common';
import type {
  GymUnitModality,
  LeadSource,
  Prisma,
  Student,
  StudentAddress,
  StudentContact,
  StudentModality,
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
  /**
   * Modalidades da unidade de origem (F60). Varias por aluno.
   *
   * Quem prova que cada id e da unidade escolhida e o controller, ANTES de
   * chegar aqui -- pelo mesmo motivo que `gymUnitId` ja funcionava assim.
   */
  modalityIds?: readonly string[] | undefined;
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
  /*
   * Motivo da situacao VIGENTE -- corrigivel sem trocar de estado (issue
   * #241). Quem ja estava suspenso ou bloqueado antes do campo existir nao
   * tinha por onde preenche-lo: `PATCH /:id/status` exige mudanca de estado,
   * e reativar so para rebloquear grava na timeline uma reativacao que nunca
   * aconteceu.
   *
   * `null` limpa, como nos demais campos deste tipo. Quem valida contra a
   * situacao vigente e o controller, que a conhece.
   */
  statusReason?: 'DELINQUENCY' | 'STUDENT_REQUEST' | 'MEDICAL' | 'CONDUCT' | null | undefined;
  statusReasonNote?: string | null | undefined;
}

/** Aluno com endereco e contatos, para o `GET /students/:id`. */
export type AlunoComDetalhes = Student & {
  contacts: StudentContact[];
  addresses: StudentAddress[];
  /** F60. Vem com a modalidade junto -- a ficha exibe o NOME, nao o UUID. */
  modalities: (StudentModality & { modality: GymUnitModality })[];
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
   *
   * -------------------------------------------------------------------------
   * O CONTADOR SOZINHO NAO BASTA -- ELE PODE ESTAR ATRAS DE `students`.
   * -------------------------------------------------------------------------
   *
   * Defeito real encontrado em producao em 04/09/2026, pelo import da base
   * ativa: nada garante que `student_sequences` esteja a frente das
   * matriculas ja gravadas. Um import que gravou matricula sem passar pelo
   * contador, uma restauracao de backup, ou um tenant criado por outro
   * caminho deixam o contador para tras -- e ele emite um numero que outro
   * aluno ja tem, morrendo no UNIQUE `(tenant_id, membership_number)`.
   *
   * E NAO SE RECUPERA SOZINHO: o `UPDATE` do contador e revertido junto com o
   * `create` que falhou, entao a proxima tentativa repete o mesmo numero. No
   * import foram 30 cadastros seguidos colidindo no mesmo valor; aqui seria a
   * recepcao sem conseguir cadastrar ninguem, com erro que nao explica nada.
   *
   * Por isso o piso e o MAIOR entre o contador e o maior sufixo ja gravado. O
   * `substring` ancora o formato COMPLETO porque a base tem matricula de
   * legado fora do padrao (`LEGADO-<hex>`): o que nao casa vira `NULL` e o
   * `MAX` ignora, em vez de o `CAST` quebrar a consulta ou o hex inflar o
   * contador em milhoes.
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

    // O CONTADOR PODE ESTAR ATRAS DO QUE JA EXISTE -- ver o bloco no cabecalho
    // deste metodo. Lido DENTRO do lock, pelo mesmo motivo que o `FOR UPDATE`
    // existe: fora dele, duas transacoes enxergariam o mesmo piso.
    const maiores = await tx.$queryRaw<{ maior: number | null }[]>`
      SELECT MAX(CAST(substring(membership_number from '^AP-[0-9]{4}-([0-9]{8})$') AS INTEGER))
        AS maior
      FROM students
      WHERE tenant_id = ${tenantId}::uuid
    `;

    const contador = travadas[0]?.next_value ?? 1;
    const maiorGravado = maiores[0]?.maior ?? 0;
    const sequencial = Math.max(contador, maiorGravado + 1);

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

    // `comTenant`: sao varias leituras em `students` (politica RLS desde a
    // F66) fora de qualquer escrita -- sem a transacao interceptada, o
    // `set_config` nunca aplica e a politica devolve ZERO LINHAS em
    // silencio sob o role restrito (issue #302).
    await this.db.comTenant(async (tx) => {
      if (dados.cpf) {
        const porCpf = await tx.student.findMany({
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

        const porContato = await tx.student.findMany({
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

      // Sinal mais fraco: mesmo nome E mesma data de nascimento. Sozinho,
      // nome igual seria ruido; com a data, vira aviso util.
      const porNome = await tx.student.findMany({
        where: {
          tenantId: contexto.tenantId,
          fullName: { equals: dados.fullName, mode: 'insensitive' },
          birthDate: dados.birthDate,
        },
        select: selecao,
      });

      for (const aluno of porNome) registrar(aluno, 'NAME_AND_BIRTH_DATE');
    });

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
          // CPF em claro (ADR-034) + hash, que continua sendo o indice de
          // busca por duplicata (evita varredura de tabela em texto claro).
          cpf: dados.cpf ?? null,
          cpfHash: dados.cpf ? calcularHashDeCpf(contexto.tenantId, dados.cpf) : null,
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
          // F60: vinculo aluno <-> modalidade, na MESMA transacao do aluno.
          // Criar depois, fora dela, deixaria aluno gravado sem modalidade
          // se a segunda escrita falhasse.
          ...(dados.modalityIds && dados.modalityIds.length > 0
            ? {
                modalities: {
                  create: dados.modalityIds.map((modalityId) => ({
                    tenantId: contexto.tenantId,
                    modalityId,
                  })),
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
    //
    // `comTenant`: fora de transacao interceptada, o `set_config` nunca
    // aplica e a politica RLS (F66) devolve ZERO LINHAS em silencio sob o
    // role restrito -- o "nao encontrei" indistinguivel de "nao ha
    // contexto" que a issue #302 corrige.
    return this.db.comTenant((tx) =>
      tx.student.findFirst({ where: { id, tenantId: contexto.tenantId } }),
    );
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
    return this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id, tenantId: contexto.tenantId },
        include: {
          contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
          // Uma linha hoje, mas a tabela e 1:N: ordenar deixa a leitura
          // deterministica em vez de depender da ordem fisica das paginas.
          addresses: { orderBy: { createdAt: 'asc' } },
          // F60. `orderBy` explicito: sem ele a ordem e a fisica do Postgres, e
          // um UPDATE em qualquer linha embaralha a lista entre dois
          // carregamentos da mesma ficha.
          modalities: { include: { modality: true }, orderBy: { modality: { name: 'asc' } } },
        },
      }),
    );
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
          ...(dados.statusReason !== undefined ? { statusReason: dados.statusReason } : {}),
          ...(dados.statusReasonNote !== undefined
            ? { statusReasonNote: dados.statusReasonNote }
            : {}),
          // `cpf` e `cpfHash` andam JUNTOS: hash sem o campo em claro esconde
          // o aluno da recepcao, e o campo em claro sem hash o esconde da
          // deteccao de duplicata.
          ...(dados.cpf !== undefined
            ? dados.cpf === null
              ? { cpf: null, cpfHash: null }
              : {
                  cpf: dados.cpf,
                  cpfHash: calcularHashDeCpf(contexto.tenantId, dados.cpf),
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
    const aluno = await this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id, tenantId: contexto.tenantId },
        select: { status: true },
      }),
    );

    if (!aluno) return null;

    return { status: aluno.status, elegivel: alunoRecebeAcessoNormal(aluno.status) };
  }

  /**
   * Busca por nome, matricula exata ou telefone normalizado.
   *
   * Paginacao por cursor `(createdAt, id)` -- `OFFSET` alto fica lento e
   * pula linha quando alguem cadastra durante a navegacao.
   */
  /**
   * Quantos alunos o filtro atual alcanca -- o denominador do "20 de N".
   *
   * REUSA `condicoesDaListagem`, e essa e a parte que importa: se a contagem
   * montasse o proprio `where`, os dois divergiriam no primeiro filtro novo e
   * a tela mostraria "20 de 341" enquanto pagina outra coisa. Numero errado e
   * pior que numero nenhum -- parece conferido.
   *
   * `COUNT` direto, e nao estimativa do planejador: medido no banco da
   * bancada (1.968 alunos), **0,27 ms sem filtro e 0,38 ms com filtro e
   * busca**, os dois por indice. `reltuples` seria instantaneo mas nao
   * respeita filtro nem busca -- que e justamente o caso util.
   *
   * GATILHO DE REVISAO: se a base passar de algumas centenas de milhares de
   * alunos, remedir. Ate la, o custo e menor que o da propria listagem.
   */
  async contar(
    contexto: TenantContext,
    filtro: {
      termo?: string | undefined;
      gymUnitId?: string | undefined;
      status?: StudentStatus | undefined;
      modalityId?: string | undefined;
    },
  ): Promise<number> {
    return this.db.comTenant((tx) =>
      tx.student.count({
        where: {
          tenantId: contexto.tenantId,
          ...(filtro.gymUnitId ? { gymUnitId: filtro.gymUnitId } : {}),
          ...(filtro.status ? { status: filtro.status } : {}),
          ...(filtro.modalityId ? condicaoDeModalidade(filtro.modalityId) : {}),
          ...condicoesDaListagem(filtro.termo),
        },
      }),
    );
  }

  /**
   * Professores da unidade -- `Student` com `profile = TRAINER`, para a
   * agenda de aulas escolher quem da a aula (F77, ADR-061 decisao 5).
   *
   * Lista LEVE de proposito: so `id` e `fullName`, sem o `include` pesado de
   * `buscar` (assinatura, invoice). Quem chama e um `<select>`, nao uma
   * grade de aluno.
   */
  async listarProfessores(
    contexto: TenantContext,
    gymUnitId: string,
  ): Promise<{ id: string; fullName: string }[]> {
    return this.db.comTenant((tx) =>
      tx.student.findMany({
        where: {
          tenantId: contexto.tenantId,
          gymUnitId,
          profile: 'TRAINER',
          archivedAt: null,
        },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
    );
  }

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
      /**
       * Modalidade (F60). Opcional: ausente, a listagem mostra todo mundo --
       * inclusive quem nao tem modalidade nenhuma, que e o caso de
       * funcionario, personal e administrador.
       */
      modalityId?: string | undefined;
    },
    /**
     * O "agora" ENTRA POR PARAMETRO (`CLAUDE.md`, Convencoes): so assim o
     * teste consegue fixar o instante que decide se um direito vale hoje.
     * Ausente, vale o relogio -- a rota nao precisa saber disso.
     */
    agora: Date = new Date(),
  ): Promise<Student[]> {
    const condicoes = condicoesDaListagem(filtro.termo);

    // `comTenant`: findMany solto nunca chamava `set_config` -- sob o role
    // restrito a politica (F66) devolvia ZERO LINHAS em silencio, mesmo com
    // o aluno existindo no tenant certo (issue #302).
    return this.db.comTenant((tx) =>
      tx.student.findMany({
        where: {
          tenantId: contexto.tenantId,
          ...(filtro.gymUnitId ? { gymUnitId: filtro.gymUnitId } : {}),
          ...(filtro.status ? { status: filtro.status } : {}),
          ...(filtro.modalityId ? condicaoDeModalidade(filtro.modalityId) : {}),
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
              /*
               * A invoice em aberto/vencida MAIS ANTIGA da assinatura vigente --
               * F53 Task 12, mesmo criterio de `listar-invoices.use-case.ts`
               * (`dueAt asc` primeiro traz a mais antiga). SEM segunda consulta:
               * nested include sob o `take: 1` de cima, mesma tecnica que ja
               * evita o N+1 aqui.
               */
              invoices: {
                where: { status: { in: ['OPEN', 'OVERDUE'] } },
                orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
                take: 1,
                select: { status: true, dueAt: true, blockAt: true },
              },
            },
          },
          /*
           * O DIREITO QUE NAO NASCE DE ASSINATURA -- cortesia, funcionario,
           * personal trainer, dependente, convenio.
           *
           * Sem isto a coluna PLANO saia de `subscriptions[0]` e so ela: quem
           * tem acesso por VINCULO nao tem assinatura nenhuma, entao a ficha
           * mostrava "Ativo, Personal trainer, vale agora" e a lista mostrava
           * "—" para a MESMA pessoa. Eram 33 alunos da bancada (24 funcionarios,
           * 9 personal trainers), e a recepcao olha a lista para decidir se
           * libera.
           *
           * `subscriptionId: null` FILTRA no banco, nao no DTO: o direito
           * derivado de assinatura ja chega pelo include de cima, com o NOME do
           * plano, que e melhor resposta que a origem.
           *
           * VIGENTE AGORA, nao qualquer um: `startsAt <= agora <= endsAt` com
           * status ativo. Direito expirado ou agendado na coluna diria que o
           * aluno tem acesso hoje.
           *
           * `take: 1` pelo mesmo motivo do bloco de cima -- consulta por aluno
           * seria o N+1 que `docs/REVIEW.md` §3.4 barra.
           */
          entitlements: {
            where: {
              subscriptionId: null,
              status: 'ACTIVE',
              startsAt: { lte: agora },
              endsAt: { gte: agora },
            },
            orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { source: true },
          },
          /*
           * Fuso da unidade de ORIGEM do aluno (INV-144, ADR-019) -- sem ele
           * `situacaoDeVencimento` nao tem como decidir o dia civil de `dueAt`.
           * SEM FALLBACK: unidade sem fuso cadastrado nao aparece com aviso
           * errado, aparece sem aviso (ver `paraDtoDaLista`).
           */
          gymUnit: { select: { timezone: true } },
          contacts: {
            where: { type: 'PHONE' },
            /*
              DUAS chaves, nao uma. `isPrimary` e boolean, logo NAO e ordem
              total: dois telefones com o mesmo valor de `isPrimary` empatam, e
              o desempate cai na ordem FISICA do Postgres -- que muda depois de
              qualquer UPDATE na tabela.

              Com `take: 1` em cima, o empate nao embaralha a ordem: ele troca
              QUAL telefone aparece. A recepcao ligaria para um numero num
              carregamento e para outro no seguinte, sem nada ter mudado no
              cadastro.

              Corrigido junto da F53, que consertou o mesmo defeito no caminho
              do checkout de cartao (o telefone que vai ao antifraude do
              provedor). Sao os dois unicos pontos do `apps/api` com boolean
              como criterio unico de ordenacao.
            */
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { value: true },
          },
          /*
            O NUMERO QUE A CATRACA LE -- e a pergunta que a recepcao faz
            olhando a lista ("qual o id dele no equipamento?"), que antes
            exigia abrir a ficha.

            SEM `take`, ao contrario dos dois de cima: uma pessoa pode ter mais
            de um numero (cartao trocado, credencial vinda de linha duplicada
            do Pacto), e cortar em um esconderia justamente o caso que precisa
            ser resolvido -- um cartao antigo que continua valido no leitor.
          */
          credentials: {
            orderBy: { createdAt: 'asc' },
            select: { externalId: true },
          },
        },
      }),
    );
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
    /*
     * SEMPRE GRAVADO, inclusive como par de nulos -- e por isso nao e
     * opcional. O chamador ja decidiu, a partir do status de DESTINO, se ha
     * motivo; aqui so se escreve o que ele decidiu.
     *
     * Se este parametro fosse opcional e o campo pudesse ficar de fora do
     * `data`, sair de `BLOCKED` para `ACTIVE` preservaria o motivo antigo --
     * e o `CHECK` do banco derrubaria a transacao.
     */
    motivo: {
      reason: 'DELINQUENCY' | 'STUDENT_REQUEST' | 'MEDICAL' | 'CONDUCT' | null;
      reasonNote: string | null;
    },
  ): Promise<Student | null> {
    const arquivando = novoStatus === 'ARCHIVED';

    return this.db.$transaction(async (tx) => {
      const alterados = await tx.student.updateMany({
        where: { id, tenantId: contexto.tenantId, version: versaoEsperada },
        data: {
          status: novoStatus,
          statusReason: motivo.reason,
          statusReasonNote: motivo.reasonNote,
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
          /*
           * O MOTIVO ENTRA NO PAYLOAD, e e aqui que ele vira historico.
           *
           * A coluna do aluno guarda o motivo VIGENTE e e limpa na volta
           * para `ACTIVE` -- de proposito. Quem precisa da sequencia ("foi
           * suspenso por atestado em agosto e bloqueado por conduta em
           * outubro") le esta timeline, que nao e reescrita.
           */
          payload: {
            status: novoStatus,
            reason: motivo.reason,
            reasonNote: motivo.reasonNote,
          },
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
/**
 * O `where` do filtro por MODALIDADE (F60).
 *
 * Funcao propria pelo mesmo motivo de `condicoesDaListagem` logo abaixo:
 * DUAS consultas dependem dela -- a listagem e a contagem do "20 de N". Se
 * cada uma montasse a propria, a tela mostraria "20 de 341" enquanto pagina
 * outro conjunto, e os dois numeros continuariam plausiveis.
 *
 * `some` na relacao, e nao `every`: o aluno pode ter varias modalidades, e
 * quem filtra por "Cross Fit" quer todo mundo que a tem -- nao so quem a tem
 * como unica.
 *
 * SEM filtro por tenant aqui: o `where` de fora ja fixa `tenantId` do aluno, e
 * modalidade de outro tenant simplesmente nao esta vinculada a aluno deste --
 * o filtro devolveria lista vazia, que e a resposta correta.
 */
function condicaoDeModalidade(modalityId: string): Prisma.StudentWhereInput {
  return { modalities: { some: { modalityId } } };
}

/**
 * O `where` de BUSCA da listagem -- nome, matricula ou telefone.
 *
 * Funcao propria, e nao inline, porque DUAS consultas dependem dela: a
 * listagem e a contagem que alimenta o "20 de N". Duplicar produziria um
 * denominador que descreve outro conjunto no primeiro criterio novo -- e o
 * defeito seria invisivel, porque os dois numeros continuariam plausiveis.
 *
 * Termo vazio devolve `{}`, nao um OR com string vazia: `contains: ''` casa
 * com tudo, mas o `OR` acrescenta trabalho ao planejador sem filtrar nada.
 *
 * O braco de telefone só entra com 8+ digitos normalizados (refs #351): um
 * nome ou UUID pode ter 1-3 digitos soltos no meio, e `contains` de uma
 * sequencia curta casa qualquer telefone que a contenha por acaso -- a busca
 * por nome devolveria aluno nenhum a ver com o termo.
 */
const DIGITOS_MINIMOS_PARA_BUSCAR_COMO_TELEFONE = 8;

function condicoesDaListagem(termoBruto?: string): Prisma.StudentWhereInput {
  const termo = termoBruto?.trim();

  if (!termo) return {};

  const digitos = normalizarTelefone(termo);
  const pareceTelefone = digitos.length >= DIGITOS_MINIMOS_PARA_BUSCAR_COMO_TELEFONE;

  return {
    OR: [
      { fullName: { contains: termo, mode: 'insensitive' } },
      { membershipNumber: termo },
      ...(pareceTelefone
        ? [{ contacts: { some: { value: { contains: digitos } } } } satisfies Prisma.StudentWhereInput]
        : []),
    ],
  };
}

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
