import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';
import type { IndicadoresDaUnidade } from '@arenahub/api-contracts';

import { KioskRoute } from '../kiosk-auth/kiosk-route.decorator.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';
import { KioskConfigService, type ConfiguracaoResolvida } from './kiosk-config.service.js';
import { KioskMediaLinkService } from './kiosk-media-link.service.js';
import { KioskSessionService, type SessaoAberta } from './kiosk-session.service.js';

const heartbeatSchema = z.object({
  agentVersion: z.string().min(1),
  /** Relogio local do totem em ms, para medir a deriva. */
  localTimeMs: z.number().int(),
});

/** Login e CPF sozinho, sem segundo fator -- decisao do PI, risco aceito. */
const abrirSessaoSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/),
});

/**
 * Endpoints do totem. Substitui o controller minimo da Task 3 (F49) --
 * aquele so provava o `KioskAuthGuard`; este entrega a superficie real.
 */
@Controller('api/v1/kiosk')
@KioskRoute()
export class KioskController {
  constructor(
    private readonly config: KioskConfigService,
    private readonly midia: KioskMediaLinkService,
    private readonly sessions: KioskSessionService,
  ) {}

  @Post('heartbeat')
  @HttpCode(200)
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['configVersion', 'serverTime', 'indicadores'],
      properties: {
        configVersion: { type: 'integer' },
        serverTime: { type: 'string', format: 'date-time' },
        indicadores: {
          type: 'object',
          required: ['checkinsDeHoje', 'treinandoAgora'],
          properties: {
            checkinsDeHoje: { type: 'integer' },
            treinandoAgora: { type: 'integer' },
          },
        },
      },
    },
  })
  async heartbeat(
    @Req() requisicao: Request,
    @Body() corpo: unknown,
  ): Promise<{
    configVersion: number;
    serverTime: string;
    indicadores: IndicadoresDaUnidade;
  }> {
    const contexto = this.contexto(requisicao);
    const dados = heartbeatSchema.parse(corpo);
    const agora = new Date();

    const { version } = await this.config.resolverParaDispositivo(contexto);

    await this.config.registrarHeartbeat(contexto, dados, agora);

    // Os indicadores da tela publica (F51) pegam CARONA aqui, e nao numa rota
    // propria: `M3.5-FR-005` proibe a tela publica depender da rede, e uma
    // requisicao a mais so para o contador seria essa dependencia.
    const indicadores = await this.config.contarIndicadores(contexto, agora);

    // `configVersion` nasce AQUI, na F49: a F50 declara este endpoint como
    // pre-existente e compara este numero com o do boot (ADR-042, Decisao 3).
    return { configVersion: version, serverTime: agora.toISOString(), indicadores };
  }

  @Get('config')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['version', 'config'],
      properties: {
        version: { type: 'integer' },
        config: {
          type: 'object',
          required: ['marca', 'aparencia', 'sessao', 'identificacao', 'modulos'],
          properties: {
            marca: { type: 'object' },
            aparencia: { type: 'object' },
            sessao: { type: 'object' },
            identificacao: { type: 'object' },
            modulos: { type: 'object' },
          },
        },
      },
    },
  })
  async obterConfig(@Req() requisicao: Request): Promise<ConfiguracaoResolvida> {
    const contexto = this.contexto(requisicao);
    const resolvida = await this.config.resolverParaDispositivo(contexto);

    // As URLs de midia sao assinadas AQUI, no boot -- nunca pela tela. E o
    // que sustenta `M3.5-FR-005`: o totem recebe endereco pronto, baixa uma
    // vez e serve do cache; a tela publica em si nunca fala com a rede.
    return this.midia.resolverMidias(contexto, resolvida);
  }

  @Post('sessions')
  @HttpCode(201)
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['sessionId', 'token', 'nome', 'plano', 'expiraEm'],
      properties: {
        sessionId: { type: 'string' },
        token: { type: 'string' },
        nome: { type: 'string' },
        plano: {
          type: 'object',
          required: ['ativo', 'pendenciaEmCentavos'],
          properties: {
            ativo: { type: 'boolean' },
            pendenciaEmCentavos: { type: 'integer', nullable: true },
          },
        },
        expiraEm: { type: 'string', format: 'date-time' },
      },
    },
  })
  async abrirSessao(
    @Req() requisicao: Request,
    @Body() corpo: unknown,
  ): Promise<SessaoAberta> {
    const contexto = this.contexto(requisicao);
    const dados = abrirSessaoSchema.parse(corpo);

    return this.sessions.abrir(contexto, dados.cpf, new Date());
  }

  @Post('sessions/:id/extend')
  @HttpCode(200)
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['expiraEm'],
      properties: { expiraEm: { type: 'string', format: 'date-time' } },
    },
  })
  async estenderSessao(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
  ): Promise<{ expiraEm: string }> {
    const contexto = this.contexto(requisicao);

    return this.sessions.estenderSessao(contexto, sessionId, this.token(token), new Date());
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  // 204 nao tem corpo -- e a resposta certa para encerrar. O schema vazio
  // declara isso EXPLICITAMENTE: a guarda de contrato (FIX #163) existe para
  // pegar rota que nao descreve corpo nenhum por esquecimento, e "sem corpo,
  // de proposito" precisa ser dito, nao omitido.
  @ApiNoContentResponse({
    schema: { type: 'object', nullable: true, description: 'Sem corpo.' },
  })
  async encerrarSessao(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
  ): Promise<void> {
    const contexto = this.contexto(requisicao);

    await this.sessions.encerrar(contexto, sessionId, this.token(token), 'MANUAL', new Date());
  }

  /**
   * O token do ALUNO -- credencial da sessao, distinta da credencial HMAC do
   * dispositivo. Sem ele, `sessionId` da URL sozinho autorizaria qualquer um
   * que adivinhasse o UUID a estender ou encerrar a sessao de outro aluno.
   */
  private token(valor: string | undefined): string {
    if (!valor) {
      throw new BadRequestException({ code: 'KIOSK_SESSION_TOKEN_MISSING' });
    }

    return valor;
  }

  private contexto(requisicao: Request): ContextoDoKiosk {
    const contexto = requisicao.kioskContext;

    if (!contexto) {
      throw new Error('Rota de kiosk sem contexto -- o guard nao rodou.');
    }

    return contexto;
  }
}
