import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { EngagementChallengesService } from '../engagement/engagement-challenges.service.js';
import { EngagementRankingService } from '../engagement/engagement-ranking.service.js';
import { dataLocalIso } from '../health/domain/periodo.js';
import { DashboardRepository, type ContagemDeSituacao } from './dashboard.repository.js';
import type { FeriadoDoCalendario } from './domain/feriados.js';
import { OperationsRepository } from './operations.repository.js';

/**
 * Dashboard operacional -- F57, `SPEC-057`.
 *
 * A porta de entrada do painel: quem faz login cai aqui e responde "a
 * academia esta de pe?" sem clicar em nada. `/operations` continua sendo a
 * tela de INVESTIGACAO -- este e o resumo que decide se vale investigar.
 *
 * SO LE. As unicas escritas deste controller sao o cadastro e a remocao de
 * feriado municipal, e elas nao sao do dashboard: sao da tela de configuracao
 * da unidade, que compartilha o repositorio. A tela que fica aberta o turno
 * inteiro na recepcao nao ganha botao que muda estado.
 */

const esquemaDeConsulta = z
  .object({
    /** A unidade do "hoje". Sem ela nao existe meia-noite local. */
    gymUnitId: z.string().uuid().optional(),
  })
  .strict();

const esquemaDeFeriado = z
  .object({
    data: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD')
      .refine((valor) => !Number.isNaN(Date.parse(`${valor}T00:00:00Z`)), 'Data inexistente'),
    nome: z.string().trim().min(1, 'Informe o nome do feriado').max(120),
  })
  .strict();

/**
 * Schema da resposta no OpenAPI.
 *
 * Declarado a mao, e nao inferido do tipo: o Nest so gera schema a partir de
 * CLASSE decorada, e o painel consome `interface`. O contrato tem guarda
 * propria (`openapi.int-spec.ts`) -- rota nova sem schema reprova.
 */
const ESQUEMA_DA_UNIDADE = {
  type: 'object',
  required: ['id', 'name', 'timezone'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    timezone: { type: 'string' },
  },
};

const ESQUEMA_DO_FERIADO = {
  type: 'object',
  required: ['data', 'nome', 'origem'],
  properties: {
    data: { type: 'string', format: 'date' },
    nome: { type: 'string' },
    origem: { type: 'string', enum: ['NACIONAL', 'MUNICIPAL'] },
  },
};

const ESQUEMA_DO_DASHBOARD = {
  type: 'object',
  required: ['unidade', 'unidades', 'geradoEm', 'dispositivos', 'situacoes', 'feriados'],
  properties: {
    unidade: { ...ESQUEMA_DA_UNIDADE, nullable: true },
    unidades: { type: 'array', items: ESQUEMA_DA_UNIDADE },
    geradoEm: { type: 'string', format: 'date-time' },
    dispositivos: {
      type: 'object',
      required: ['online', 'total', 'degradados'],
      properties: {
        online: { type: 'integer' },
        total: { type: 'integer' },
        degradados: { type: 'integer' },
      },
    },
    acessosDeHoje: {
      type: 'object',
      nullable: true,
      required: ['desde', 'allow', 'deny', 'override'],
      properties: {
        desde: { type: 'string', format: 'date-time' },
        allow: { type: 'integer' },
        deny: { type: 'integer' },
        override: { type: 'integer' },
      },
    },
    situacoes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['status', 'motivo', 'quantidade'],
        properties: {
          status: { type: 'string', enum: ['SUSPENDED', 'BLOCKED'] },
          motivo: {
            type: 'string',
            nullable: true,
            enum: ['DELINQUENCY', 'STUDENT_REQUEST', 'MEDICAL', 'CONDUCT'],
          },
          quantidade: { type: 'integer' },
        },
      },
    },
    placar: {
      type: 'object',
      nullable: true,
      required: ['mes', 'publicadoEm', 'entradas'],
      properties: {
        mes: { type: 'string' },
        publicadoEm: { type: 'string', format: 'date-time', nullable: true },
        entradas: {
          type: 'array',
          items: {
            type: 'object',
            required: ['position', 'points', 'nome'],
            properties: {
              position: { type: 'integer' },
              points: { type: 'integer' },
              nome: { type: 'string' },
            },
          },
        },
      },
    },
    desafiosAtivos: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'endsOn', 'participantes'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          endsOn: { type: 'string', format: 'date' },
          participantes: { type: 'integer' },
        },
      },
    },
    feriados: { type: 'array', items: ESQUEMA_DO_FERIADO },
  },
};

const ESQUEMA_DA_LISTA_DE_FERIADOS = {
  type: 'array',
  items: {
    type: 'object',
    required: ['id', 'data', 'nome'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      data: { type: 'string', format: 'date' },
      nome: { type: 'string' },
    },
  },
};

const ESQUEMA_DE_REMOCAO = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
};

interface UnidadeDoDashboard {
  id: string;
  name: string;
  timezone: string;
}

export interface DashboardDto {
  /** A unidade a que os numeros se referem, e as demais para o seletor. */
  unidade: UnidadeDoDashboard | null;
  unidades: readonly UnidadeDoDashboard[];
  /** Quando o servidor montou esta resposta -- o "Atualizado as HH:MM". */
  geradoEm: string;
  dispositivos: { online: number; total: number; degradados: number };
  acessosDeHoje: { desde: string; allow: number; deny: number; override: number } | null;
  situacoes: readonly ContagemDeSituacao[];
  placar: {
    mes: string;
    publicadoEm: string | null;
    entradas: readonly { position: number; points: number; nome: string }[];
  } | null;
  desafiosAtivos: readonly { id: string; title: string; endsOn: string; participantes: number }[];
  feriados: readonly FeriadoDoCalendario[];
}

@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardRepository,
    private readonly operacoes: OperationsRepository,
    private readonly ranking: EngagementRankingService,
    private readonly desafios: EngagementChallengesService,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Os sete blocos numa resposta so.
   *
   * Uma chamada, e nao sete: a tela carrega inteira ou nao carrega, e sete
   * requisicoes em paralelo pela mesma sessao dariam sete oportunidades de
   * meia-tela. O feed em tempo real (bloco 3) e a excecao proposital -- ele
   * recarrega a cada 5 s por `GET /access-events`, e reusar ESTA rota para
   * isso arrastaria os outros seis blocos junto a cada ciclo.
   */
  @Get()
  @RequirePermissions('access.read')
  @ApiOkResponse({ schema: ESQUEMA_DO_DASHBOARD })
  async panorama(@Query() consulta: unknown): Promise<DashboardDto> {
    const { gymUnitId } = esquemaDeConsulta.parse(consulta);
    const contexto = this.contexto.require();
    const agora = new Date();

    const unidades = await this.dashboard.unidadesAtivas(contexto);
    const visiveis = unidades.filter((u) => this.dentroDoEscopo(contexto, u.id));

    /*
     * Sem unidade pedida, a unica ativa e o contexto -- com uma unidade nao
     * ha o que selecionar. Com varias e sem escolha explicita, os blocos que
     * dependem de "hoje" ficam NULOS em vez de somar unidades: somar daria um
     * numero que nao corresponde a academia nenhuma, e a recepcao compararia
     * com a propria contagem sem nunca bater.
     */
    const escolhida = gymUnitId
      ? (visiveis.find((u) => u.id === gymUnitId) ?? null)
      : visiveis.length === 1
        ? (visiveis[0] ?? null)
        : null;

    // Pedir unidade que nao existe OU que esta fora do escopo da pessoa da o
    // MESMO 404: a diferenca revelaria que a unidade existe em algum lugar.
    if (gymUnitId && !escolhida) throw new NotFoundException({ code: 'UNIT_NOT_FOUND' });

    const panorama = await this.operacoes.panorama(contexto);

    const dispositivosDaUnidade = escolhida
      ? panorama.dispositivos.filter((d) => d.gymUnitId === escolhida.id)
      : panorama.dispositivos;

    const base = {
      unidade: escolhida,
      unidades: visiveis,
      geradoEm: agora.toISOString(),
      dispositivos: {
        online: dispositivosDaUnidade.filter((d) => d.status === 'ACTIVE').length,
        total: dispositivosDaUnidade.length,
        degradados: dispositivosDaUnidade.filter((d) => d.status === 'MAINTENANCE').length,
      },
    };

    if (!escolhida) {
      return {
        ...base,
        acessosDeHoje: null,
        situacoes: [],
        placar: null,
        desafiosAtivos: [],
        feriados: [],
      };
    }

    // `AAAA-MM` no fuso da UNIDADE: o mes do placar e o mes do calendario sao
    // os da academia, nao os de UTC. Virada de mes as 21h de Brasilia com
    // corte UTC mostraria o placar do mes seguinte, ainda vazio.
    const mes = dataLocalIso(agora, escolhida.timezone).slice(0, 7);

    const [acessosDeHoje, situacoes, placar, desafios, feriados] = await Promise.all([
      this.dashboard.acessosDeHoje(contexto, escolhida.id, escolhida.timezone, agora),
      this.dashboard.situacoesRestritivas(contexto, escolhida.id),
      this.ranking.lerPlacarInterno(contexto, escolhida.id, mes),
      this.desafios.listar(contexto),
      this.dashboard.feriadosDoMesCorrente(contexto, escolhida.id, mes),
    ]);

    return {
      ...base,
      acessosDeHoje,
      situacoes,
      placar: { mes, publicadoEm: placar.publicadoEm, entradas: placar.entradas },
      /*
       * So `ACTIVE`. `DRAFT` ainda nao abriu, `CLOSED` e `CANCELLED` ja
       * terminaram -- nenhum deles responde "o que esta rolando agora", que e
       * a unica pergunta que este bloco existe para responder.
       *
       * Desafio de OUTRA unidade nao entra; desafio SEM unidade (`null`) e do
       * tenant inteiro e vale para todas.
       */
      desafiosAtivos: desafios
        .filter((d) => d.status === 'ACTIVE' && (d.gymUnitId === null || d.gymUnitId === escolhida.id))
        .map((d) => ({
          id: d.id,
          title: d.title,
          endsOn: d.endsOn,
          participantes: d.participantes,
        })),
      feriados,
    };
  }

  /**
   * Feriados municipais cadastrados na unidade -- tela de CONFIGURACAO.
   *
   * Separada do panorama de proposito: o dashboard mostra o mes corrente
   * (nacionais + municipais juntos, so leitura); esta lista e o que da para
   * editar, e nacional nao esta nela porque nacional nao se edita.
   */
  @Get('units/:gymUnitId/holidays')
  @RequirePermissions('unit.read')
  @ApiOkResponse({ schema: ESQUEMA_DA_LISTA_DE_FERIADOS })
  async listarFeriados(
    @Param('gymUnitId') gymUnitId: string,
  ): Promise<readonly { id: string; data: string; nome: string }[]> {
    const contexto = this.contexto.require();

    await this.exigirUnidade(contexto, gymUnitId);

    return this.dashboard.feriadosCadastrados(contexto, gymUnitId);
  }

  @Post('units/:gymUnitId/holidays')
  @RequirePermissions('unit.update')
  @ApiOkResponse({ schema: ESQUEMA_DO_FERIADO })
  async cadastrarFeriado(
    @Param('gymUnitId') gymUnitId: string,
    @Body() corpo: unknown,
  ): Promise<FeriadoDoCalendario> {
    const { data, nome } = esquemaDeFeriado.parse(corpo);
    const contexto = this.contexto.require();

    await this.exigirUnidade(contexto, gymUnitId);

    return this.dashboard.cadastrarFeriado(contexto, gymUnitId, data, nome);
  }

  @Delete('units/:gymUnitId/holidays/:id')
  @RequirePermissions('unit.update')
  @ApiOkResponse({ schema: ESQUEMA_DE_REMOCAO })
  async removerFeriado(
    @Param('gymUnitId') gymUnitId: string,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const contexto = this.contexto.require();

    await this.exigirUnidade(contexto, gymUnitId);

    if (!(await this.dashboard.removerFeriado(contexto, gymUnitId, id))) {
      throw new NotFoundException({ code: 'LOCAL_HOLIDAY_NOT_FOUND' });
    }

    return { ok: true };
  }

  /**
   * A unidade existe, e do tenant e esta no escopo de quem pergunta.
   *
   * 404 nos tres casos, nunca 403: distinguir "nao existe" de "existe mas nao
   * e sua" entregaria a existencia da unidade alheia.
   */
  private async exigirUnidade(contexto: TenantContext, gymUnitId: string): Promise<void> {
    const unidade = await this.dashboard.unidade(contexto, gymUnitId);

    if (!unidade || !this.dentroDoEscopo(contexto, gymUnitId)) {
      throw new NotFoundException({ code: 'UNIT_NOT_FOUND' });
    }
  }

  /** Mesmo padrao de `EngagementXpController`: gerente da unidade A nao le a B. */
  private dentroDoEscopo(contexto: TenantContext, gymUnitId: string): boolean {
    return contexto.allowedUnitIds === 'ALL' || contexto.allowedUnitIds.has(gymUnitId);
  }
}
