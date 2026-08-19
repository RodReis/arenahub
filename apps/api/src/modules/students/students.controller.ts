import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Student } from '@arenahub/database';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { MembershipRepository } from '../iam/membership.repository.js';
import { GymUnitRepository } from '../tenancy/gym-unit.repository.js';
import { normalizarCep, ufEhValida } from './domain/endereco.js';
import { cpfEhValido, mascararCpf } from './domain/identificacao.js';
import { transicionarAluno } from './domain/student.js';
import {
  StudentRepository,
  type AlunoComDetalhes,
  type CandidatoADuplicata,
} from './student.repository.js';

/**
 * Data no formato `YYYY-MM-DD`, convertida para meia-noite UTC.
 *
 * `new Date('2000-05-10')` ja produz UTC; o cuidado e nao aceitar
 * `datetime`, que traria hora e fuso para um campo que nao tem nem um nem
 * outro (a coluna e `@db.Date`).
 */
const dataSimples = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato YYYY-MM-DD')
  .transform((valor) => new Date(`${valor}T00:00:00.000Z`))
  .refine((data) => !Number.isNaN(data.getTime()), 'data invalida');

const contato = z
  .object({
    type: z.enum(['EMAIL', 'PHONE', 'WHATSAPP', 'EMERGENCY']),
    value: z.string().min(1).max(160),
    isPrimary: z.boolean().default(false),
    /** So faz sentido em `EMERGENCY` -- nos demais, o contato E o aluno. */
    label: z.string().min(1).max(160).optional(),
    relationship: z.string().min(1).max(80).optional(),
  })
  .strict();

/**
 * Endereco do aluno.
 *
 * CEP e UF sao normalizados AQUI, no boundary, e nao no repositorio: o que
 * chega da rede e `unknown` ate ser validado (`CLAUDE.md`), e a forma
 * canonica tem de ser uma so antes de qualquer comparacao.
 *
 * `number`, `complement` e `district` sao opcionais porque endereco de
 * verdade e assim -- "s/n", chacara sem numero, distrito que o CEP nao
 * informa. Exigi-los faria a recepcao inventar valor.
 */
const endereco = z
  .object({
    postalCode: z
      .string()
      .transform((valor) => normalizarCep(valor))
      .refine((valor): valor is string => valor !== null, 'CEP invalido'),
    street: z.string().min(1).max(200),
    number: z.string().max(20).optional(),
    complement: z.string().max(120).optional(),
    district: z.string().max(120).optional(),
    city: z.string().min(1).max(120),
    state: z
      .string()
      .refine((valor) => ufEhValida(valor), 'UF invalida')
      .transform((valor) => valor.trim().toUpperCase()),
  })
  .strict();

const sexoCadastral = z.enum(['FEMALE', 'MALE', 'NOT_INFORMED']);

const origemDoLead = z.enum([
  'INDICACAO',
  'REDES_SOCIAIS',
  'PASSAGEM_NA_PORTA',
  'CAMPANHA',
  'SITE',
  'OUTRO',
]);

/** Situacao inicial. `ARCHIVED` fica de fora: nasce-se aluno, nao arquivo. */
const situacaoInicial = z.enum(['LEAD', 'TRIAL', 'ACTIVE']);

// `.strict()`: `tenantId` ou `membershipNumber` no corpo sao RECUSADOS, nao
// ignorados. O tenant vem da identidade (regra no 2) e a matricula e gerada
// pelo servidor (INV-010) -- aceitar qualquer um dos dois seria deixar o
// cliente escolher.
const esquemaDeCriacao = z
  .object({
    fullName: z.string().min(2).max(160),
    birthDate: dataSimples,
    /**
     * Unidade de ORIGEM. Unico campo que a F45 tornou obrigatorio -- decisao
     * do PI de 18/08/2026. Nome, nascimento e unidade sao os tres unicos
     * obrigatorios do cadastro inteiro: quem chega sem documento, sem
     * endereco e sem telefone e cadastrado do mesmo jeito.
     */
    gymUnitId: z.string().uuid(),
    cpf: z
      .string()
      .optional()
      .refine((valor) => valor === undefined || cpfEhValido(valor), 'CPF invalido'),
    /** Texto livre: RG nao tem formato nacional unico. */
    rg: z.string().min(1).max(40).optional(),
    registeredSex: sexoCadastral.optional(),
    leadSource: origemDoLead.optional(),
    advisorUserId: z.string().uuid().optional(),
    status: situacaoInicial.optional(),
    contacts: z.array(contato).max(10).default([]),
    address: endereco.optional(),
  })
  .strict();

/**
 * Edicao de dado cadastral (`PATCH /students/:id`) -- NAO EXISTIA ATE A F45.
 *
 * `.nullable()` onde o campo pode ser APAGADO, e a distincao importa: campo
 * ausente significa "nao mexer", `null` significa "limpar". Sem os dois, um
 * RG digitado errado seria permanente -- que e o mesmo defeito que esta
 * fatia veio corrigir no endereco.
 *
 * `status` NAO esta aqui: tem endpoint proprio, com a maquina de estados que
 * valida a transicao. Duplicar aqui seria um segundo caminho para mudar
 * situacao, sem as regras do primeiro.
 */
const esquemaDeEdicao = z
  .object({
    version: z.number().int().min(0),
    fullName: z.string().min(2).max(160).optional(),
    birthDate: dataSimples.optional(),
    gymUnitId: z.string().uuid().optional(),
    cpf: z
      .string()
      .nullable()
      .optional()
      .refine((valor) => valor === undefined || valor === null || cpfEhValido(valor), 'CPF invalido'),
    rg: z.string().min(1).max(40).nullable().optional(),
    registeredSex: sexoCadastral.nullable().optional(),
    leadSource: origemDoLead.nullable().optional(),
    advisorUserId: z.string().uuid().nullable().optional(),
    contacts: z.array(contato).max(10).optional(),
    address: endereco.nullable().optional(),
  })
  .strict();

/**
 * As sete situacoes do aluno. UMA lista, usada pela transicao de status E pelo
 * filtro da listagem -- duas copias divergem na primeira situacao nova.
 */
const situacaoDoAluno = z.enum([
  'LEAD',
  'TRIAL',
  'ACTIVE',
  'SUSPENDED',
  'BLOCKED',
  'CANCELLED',
  'ARCHIVED',
]);

const esquemaDeStatus = z
  .object({
    status: situacaoDoAluno,
    version: z.number().int().min(0),
  })
  .strict();

/** Colunas por onde a listagem aceita ordenar. Lista branca. */
const ordemDeListagem = z.enum(['nome', 'matricula', 'nascimento']);

/** DTO de saida. Nunca a entidade -- e nunca o CPF completo. */
interface AlunoDto {
  id: string;
  membershipNumber: string;
  fullName: string;
  birthDate: string;
  cpfMasked: string | null;
  /** RG vai INTEIRO: nao e chave de nada e a recepcao precisa conferir. */
  rg: string | null;
  registeredSex: string | null;
  leadSource: string | null;
  gymUnitId: string;
  advisorUserId: string | null;
  status: string;
  archivedAt: string | null;
  version: number;
  /**
   * Plano da assinatura que vale agora. `null` quando o aluno não tem nenhuma
   * — que é o caso normal de um interessado, não um erro.
   */
  planName: string | null;
  /** Situação da assinatura, para a lista distinguir ativo de em atraso. */
  subscriptionStatus: string | null;
  /** Telefone principal, para o atalho de conversa na lista. */
  phone: string | null;
}

interface ContatoDto {
  type: string;
  value: string;
  isPrimary: boolean;
  label: string | null;
  relationship: string | null;
}

interface EnderecoDto {
  postalCode: string;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
}

/** `GET /students/:id`: o cadastro inteiro, para a ficha e para a edicao. */
interface AlunoDetalhadoDto extends AlunoDto {
  contacts: ContatoDto[];
  address: EnderecoDto | null;
}

interface AlunoCriadoDto extends AlunoDto {
  /**
   * Avisa, nao bloqueia (INV-014): a recepcao decide. Nao ha endpoint de
   * merge nesta fatia.
   */
  duplicateCandidates: CandidatoADuplicata[];
}

@Controller('api/v1/students')
export class StudentsController {
  constructor(
    private readonly alunos: StudentRepository,
    private readonly unidades: GymUnitRepository,
    private readonly membros: MembershipRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('student.read')
  async buscar(
    @Query('q') termo?: string,
    @Query('limit') limite?: string,
    @Query('cursor') cursor?: string,
    @Query('gymUnitId') gymUnitId?: string,
    @Query('status') status?: string,
    @Query('ordem') ordem?: string,
    @Query('direcao') direcao?: string,
  ): Promise<AlunoDto[]> {
    // Teto de 100: sem ele, `?limit=1000000` vira exportacao da base inteira
    // numa requisicao.
    const take = Math.min(Number(limite) || 20, 100);

    /*
     * Situacao invalida na querystring vira "sem filtro", nao 400.
     *
     * O parametro chega da URL, que a recepcao edita, colega manda por chat e
     * navegador restaura de sessao antiga -- devolver erro numa LISTAGEM por
     * causa de um `?status=ATIVO` datilografado troca a tela inteira por uma
     * pagina de erro. `safeParse` degrada para a lista completa, que e o que a
     * tela ja mostrava antes do filtro existir.
     */
    const situacao = situacaoDoAluno.safeParse(status);

    const encontrados = await this.alunos.buscar(this.contexto.require(), {
      termo,
      limite: take,
      cursor,
      // Filtro por unidade de ORIGEM (F45). Opcional: o painel ainda nao tem
      // seletor de unidade no cabecalho -- ele mostra um indicador estatico,
      // e criar o seletor e decisao de produto adiada (`DS-PAINEL.md` §5).
      // Ausente, a listagem segue como antes desta fatia.
      gymUnitId,
      ...(situacao.success ? { status: situacao.data } : {}),
      /*
       * Ordem invalida vira "sem ordem", nao 400 -- mesmo criterio do filtro
       * de situacao logo acima: o parametro chega da URL, que a recepcao
       * edita e o navegador restaura de sessao antiga.
       */
      ...(ordemDeListagem.safeParse(ordem).success
        ? { ordem: ordem as 'nome' | 'matricula' | 'nascimento' }
        : {}),
      ...(direcao === 'asc' || direcao === 'desc' ? { direcao } : {}),
    });

    return encontrados.map((a) => this.paraDtoDaLista(a));
  }

  @Get(':id')
  @RequirePermissions('student.read')
  async detalhar(@Param('id') id: string): Promise<AlunoDetalhadoDto> {
    const aluno = await this.alunos.encontrarComDetalhes(this.contexto.require(), id);

    // 404, nunca 403: 403 confirmaria que o recurso existe noutro tenant.
    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    return this.paraDtoDetalhado(aluno);
  }

  @Post()
  @RequirePermissions('student.create')
  async criar(@Body() corpo: unknown, @Req() requisicao: Request): Promise<AlunoCriadoDto> {
    const dados = esquemaDeCriacao.parse(corpo);
    const contexto = this.contexto.require();

    await this.exigirUnidadeDoTenant(dados.gymUnitId);

    if (dados.advisorUserId !== undefined) {
      await this.exigirConsultorDoTenant(dados.advisorUserId);
    }

    const candidatos = await this.alunos.buscarCandidatosADuplicata(contexto, dados);

    const agora = new Date();
    const aluno = await this.alunos.criar(
      contexto,
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
      agora.getUTCFullYear(),
    );

    return { ...this.paraDto(aluno), duplicateCandidates: candidatos };
  }

  /**
   * Troca de status, incluindo arquivamento.
   *
   * A transicao e validada pela funcao pura ANTES de tocar o banco: pedido
   * invalido nao abre transacao, e portanto nao escreve timeline nem outbox.
   */
  @Patch(':id/status')
  @RequirePermissions('student.update')
  async alterarStatus(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<AlunoDto> {
    const dados = esquemaDeStatus.parse(corpo);
    const contexto = this.contexto.require();

    const atual = await this.alunos.encontrar(contexto, id);
    if (!atual) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    const novoStatus = transicionarAluno(atual.status, dados.status);

    const aluno = await this.alunos.alterarStatus(
      contexto,
      id,
      dados.version,
      novoStatus,
      requisicao.correlationId ?? 'sem-correlacao',
      new Date(),
    );

    // `null` aqui e conflito de versao, nao ausencia: o aluno existe (foi
    // lido acima), mas mudou entre a leitura e a escrita.
    if (!aluno) throw new NotFoundException({ code: 'STUDENT_VERSION_CONFLICT' });

    return this.paraDto(aluno);
  }

  /**
   * Edicao de dado cadastral -- endpoint NOVO na F45.
   *
   * Ate aqui so existia `PATCH /:id/status`: dado cadastral errado era
   * permanente. Um formulario de vinte e dois campos sem edicao transforma
   * cada erro de digitacao em cadastro descartado.
   */
  @Patch(':id')
  @RequirePermissions('student.update')
  async editar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<AlunoDto> {
    const { version, ...dados } = esquemaDeEdicao.parse(corpo);
    const contexto = this.contexto.require();

    const atual = await this.alunos.encontrar(contexto, id);
    if (!atual) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    // Trocar a unidade de origem e permitido, mas so para unidade DESTE
    // tenant -- senao o UUID no corpo moveria o aluno para outra academia.
    if (dados.gymUnitId !== undefined) {
      await this.exigirUnidadeDoTenant(dados.gymUnitId);
    }

    // `null` limpa o consultor e nao precisa de checagem -- so um valor novo.
    if (dados.advisorUserId) {
      await this.exigirConsultorDoTenant(dados.advisorUserId);
    }

    const aluno = await this.alunos.atualizar(
      contexto,
      id,
      version,
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    // `null` e conflito de versao, nao ausencia: o aluno foi lido acima.
    if (!aluno) throw new NotFoundException({ code: 'STUDENT_VERSION_CONFLICT' });

    return this.paraDto(aluno);
  }

  /**
   * A unidade existe NESTE tenant?
   *
   * Sem esta checagem o banco ainda recusaria a FK, mas com erro de
   * constraint -- que vaza nome de tabela e nao diz a recepcao o que fazer.
   * 404 e nao 403 pelo motivo de sempre: 403 confirmaria que o UUID existe
   * em outra academia.
   */
  /**
   * O consultor e membro ATIVO deste tenant?
   *
   * SEM ISTO A FK NAO PROTEGE NADA. `User` e entidade global de proposito --
   * a mesma pessoa atende duas academias, e o vinculo mora em
   * `TenantMembership` --, entao `advisor_user_id -> users(id)` aceita
   * qualquer usuario do sistema, inclusive um que so pertence a outra
   * academia. O banco nao reclama; a regra de arquitetura no 2 sim.
   *
   * A checagem espelha a da unidade: mesma forma, mesmo 404, mesmo motivo de
   * nao ser 403.
   */
  private async exigirConsultorDoTenant(advisorUserId: string): Promise<void> {
    const ehMembro = await this.membros.ehMembroAtivo(this.contexto.require(), advisorUserId);

    if (!ehMembro) throw new NotFoundException({ code: 'ADVISOR_NOT_FOUND' });
  }

  private async exigirUnidadeDoTenant(gymUnitId: string): Promise<void> {
    const unidade = await this.unidades.encontrar(this.contexto.require(), gymUnitId);

    if (!unidade) throw new NotFoundException({ code: 'GYM_UNIT_NOT_FOUND' });
  }

  private paraDtoDetalhado(aluno: AlunoComDetalhes): AlunoDetalhadoDto {
    // A tabela e 1:N e a UI oferece um endereco. Pegar o primeiro (a
    // consulta ja ordena por `createdAt`) mantem a leitura deterministica
    // sem fechar a porta para varios enderecos depois.
    const endereco = aluno.addresses[0];

    return {
      ...this.paraDto(aluno),
      contacts: aluno.contacts.map((contato) => ({
        type: contato.type,
        value: contato.value,
        isPrimary: contato.isPrimary,
        label: contato.label,
        relationship: contato.relationship,
      })),
      address: endereco
        ? {
            postalCode: endereco.postalCode,
            street: endereco.street,
            number: endereco.number,
            complement: endereco.complement,
            district: endereco.district,
            city: endereco.city,
            state: endereco.state,
          }
        : null,
    };
  }

  private paraDto(aluno: Student): AlunoDto {
    return {
      id: aluno.id,
      membershipNumber: aluno.membershipNumber,
      fullName: aluno.fullName,
      // `@db.Date` volta como Date a meia-noite UTC; `toISOString` mantem o
      // dia correto porque a gravacao tambem foi em UTC.
      birthDate: aluno.birthDate.toISOString().slice(0, 10),
      cpfMasked: mascararCpf(aluno.cpfLast3),
      rg: aluno.rg,
      registeredSex: aluno.registeredSex,
      leadSource: aluno.leadSource,
      gymUnitId: aluno.gymUnitId,
      advisorUserId: aluno.advisorUserId,
      status: aluno.status,
      archivedAt: aluno.archivedAt?.toISOString() ?? null,
      version: aluno.version,
      planName: null,
      subscriptionStatus: null,
      phone: null,
    };
  }

  /**
   * DTO da LISTA -- carrega plano e telefone, que a ficha não precisa.
   *
   * Separado de `paraDto` porque são perguntas diferentes: a lista responde
   * "quem são estes alunos?" e a ficha responde "quem é este aluno?". Devolver
   * os mesmos campos nas duas faria a ficha carregar dado que ninguém lê ali,
   * ou a lista ficar sem o que a recepção veio buscar.
   */
  private paraDtoDaLista(aluno: AlunoComVinculos): AlunoDto {
    const assinatura = aluno.subscriptions?.[0];

    return {
      ...this.paraDto(aluno),
      planName: assinatura?.plan.name ?? null,
      subscriptionStatus: assinatura?.status ?? null,
      phone: aluno.contacts?.[0]?.value ?? null,
    };
  }
}

/** O aluno como a busca o devolve: com a assinatura vigente e o telefone. */
type AlunoComVinculos = Student & {
  subscriptions?: { status: string; plan: { name: string } }[];
  contacts?: { value: string }[];
};
