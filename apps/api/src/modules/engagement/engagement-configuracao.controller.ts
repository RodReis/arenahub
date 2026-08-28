import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { EngagementService } from './engagement.service.js';

/*
 * Todo campo OPCIONAL: a tela envia o que o operador mexeu. Exigir o objeto
 * inteiro faria duas abas abertas sobrescreverem uma a decisao da outra em
 * campos que nenhuma das duas tocou.
 *
 * `correctionLimitPoints` aceita `null` (sem teto) E `0` (ninguem corrige),
 * que sao valores DISTINTOS -- por isso `nullable()`, e nao so `optional()`.
 */
const esquemaDaConfiguracao = z
  .object({
    rankingEnabled: z.boolean().optional(),
    challengesEnabled: z.boolean().optional(),
    achievementsEnabled: z.boolean().optional(),
    correctionLimitPoints: z.number().int().min(0).nullable().optional(),
  })
  .strict();

interface IndicadoresDto {
  alunosAtivos: number;
  participandoDoRanking: number;
  optOut: number;
  apelidosPendentes: number;
  apelidosOcultos: number;
  contestacoesAbertas: number;
}

const CAMPOS_DOS_INDICADORES = [
  'alunosAtivos',
  'participandoDoRanking',
  'optOut',
  'apelidosPendentes',
  'apelidosOcultos',
  'contestacoesAbertas',
] as const;

const ESQUEMA_DOS_INDICADORES = {
  type: 'object',
  required: [...CAMPOS_DOS_INDICADORES],
  properties: Object.fromEntries(
    CAMPOS_DOS_INDICADORES.map((campo) => [campo, { type: 'integer' }]),
  ),
};

interface ConfiguracaoDto {
  rankingEnabled: boolean;
  challengesEnabled: boolean;
  achievementsEnabled: boolean;
  correctionLimitPoints: number | null;
}

const ESQUEMA_DA_CONFIGURACAO = {
  type: 'object',
  required: ['rankingEnabled', 'challengesEnabled', 'achievementsEnabled', 'correctionLimitPoints'],
  properties: {
    rankingEnabled: { type: 'boolean' },
    challengesEnabled: { type: 'boolean' },
    achievementsEnabled: { type: 'boolean' },
    correctionLimitPoints: { type: 'integer', nullable: true },
  },
};

/**
 * Painel -- flags e teto de correcao do engajamento (F35, ADR-049 Decisao 3).
 *
 * Flag e COLUNA no tenant, nao servico de flags e nao `if` no codigo: o
 * precedente e `BillingSettings.blockAnchor` -- "regra que vive dentro de um
 * `if` e regra que ninguem encontra depois".
 *
 * Desligar NAO apaga nada: o ledger continua, o snapshot continua, o aluno so
 * para de ver. Religar devolve tudo, porque nada foi destruido.
 */
@Controller('api/v1/engagement/configuracao')
export class EngagementConfiguracaoController {
  constructor(
    private readonly engajamento: EngagementService,
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('engagement.read')
  @ApiOkResponse({ schema: ESQUEMA_DA_CONFIGURACAO })
  async obter(): Promise<ConfiguracaoDto> {
    return this.engajamento.obterConfiguracao(this.contexto.require().tenantId);
  }

  /*
   * INDICADORES (`M5-FR-018`) -- o que a operacao precisa olhar e o que ainda
   * precisa fazer, num numero cada. Leitura pura: `engagement.read` basta.
   */
  @Get('indicadores')
  @RequirePermissions('engagement.read')
  @ApiOkResponse({ schema: ESQUEMA_DOS_INDICADORES })
  async indicadores(): Promise<IndicadoresDto> {
    return this.engajamento.indicadores(this.contexto.require().tenantId);
  }

  /*
   * `engagement.correct`: desligar uma capacidade retira o placar da parede e
   * o desafio da tela de TODA a academia, e mexer no teto muda o quanto uma
   * correcao pode valer. E ato de operacao, nao de leitura.
   */
  @Post()
  @RequirePermissions('engagement.correct')
  @ApiOkResponse({ schema: ESQUEMA_DA_CONFIGURACAO })
  async salvar(@Body() corpo: unknown): Promise<ConfiguracaoDto> {
    const entrada = esquemaDaConfiguracao.parse(corpo);

    // Monta o parcial campo a campo em vez de repassar o objeto do Zod:
    // `exactOptionalPropertyTypes` distingue "chave ausente" de "chave com
    // undefined", e o parse produz a segunda forma. Espalhar so o que veio
    // preserva a semantica de "grava so o que o operador mexeu".
    return this.engajamento.salvarConfiguracao(this.contexto.require().tenantId, {
      ...(entrada.rankingEnabled !== undefined ? { rankingEnabled: entrada.rankingEnabled } : {}),
      ...(entrada.challengesEnabled !== undefined
        ? { challengesEnabled: entrada.challengesEnabled }
        : {}),
      ...(entrada.achievementsEnabled !== undefined
        ? { achievementsEnabled: entrada.achievementsEnabled }
        : {}),
      ...(entrada.correctionLimitPoints !== undefined
        ? { correctionLimitPoints: entrada.correctionLimitPoints }
        : {}),
    });
  }
}
