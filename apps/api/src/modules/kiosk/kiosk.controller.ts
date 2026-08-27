import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';
import { aliasPublicoSchema, preferenciasSchema, type IndicadoresDaUnidade } from '@arenahub/api-contracts';

import { KioskRoute } from '../kiosk-auth/kiosk-route.decorator.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';
import { KioskAreaDoAlunoService } from './kiosk-area-do-aluno.service.js';
import { KioskConfigService, type ConfiguracaoResolvida } from './kiosk-config.service.js';
import { KioskEngajamentoService } from './kiosk-engajamento.service.js';
import { KioskMediaLinkService } from './kiosk-media-link.service.js';
import { KioskPagamentoService, type CobrancaDoTotem } from './kiosk-pagamento.service.js';
import { KioskSaudeService } from './kiosk-saude.service.js';
import { KioskSessionService, type SessaoAberta } from './kiosk-session.service.js';
import { KioskXpService } from './kiosk-xp.service.js';

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
    private readonly area: KioskAreaDoAlunoService,
    private readonly pagamento: KioskPagamentoService,
    private readonly saude: KioskSaudeService,
    private readonly engajamento: KioskEngajamentoService,
    private readonly xp: KioskXpService,
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
          required: ['checkinsDeHoje', 'treinandoAgora', 'placar'],
          properties: {
            checkinsDeHoje: { type: 'integer' },
            treinandoAgora: { type: 'integer' },
            placar: {
              type: 'array',
              description: 'Vazio quando o modulo xp esta desligado ou o placar esta retido/nao publicado.',
              items: {
                type: 'object',
                required: ['position', 'nomeExibido', 'points'],
                properties: {
                  position: { type: 'integer' },
                  nomeExibido: { type: 'string' },
                  points: { type: 'integer' },
                },
              },
            },
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

    const { version, config } = await this.config.resolverParaDispositivo(contexto);

    await this.config.registrarHeartbeat(contexto, dados, agora);

    // Os indicadores da tela publica (F51) e o placar de XP (F31, Task 9)
    // pegam CARONA aqui, e nao numa rota propria: `M3.5-FR-005` proibe a
    // tela publica depender da rede, e uma requisicao a mais so para o
    // contador seria essa dependencia.
    const indicadores = await this.config.contarIndicadores(contexto, config, agora);

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

  /*
   * ---------------------------------------------------------------------
   * AREA DO ALUNO (F52) -- `DS-TOTEM.md` §5.2 a §5.7.
   *
   * Todos passam por `area.resolver(...)`, que faz as tres checagens numa
   * chamada: modulo ligado (404 se nao), sessao viva, e o `studentId` DA
   * SESSAO. Nenhum destes endpoints aceita id de aluno nem de fatura -- e a
   * ausencia desses parametros que impede uma sessao valida de ler o dado de
   * outro aluno trocando um UUID.
   * ---------------------------------------------------------------------
   */

  @Post('sessions/:id/payments/pix')
  @HttpCode(201)
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['paymentAttemptId', 'forma', 'qrCodeDataUri', 'expiraEm', 'valorEmCentavos', 'moeda'],
      properties: {
        paymentAttemptId: { type: 'string', format: 'uuid' },
        forma: { type: 'string', enum: ['PIX', 'CARD'] },
        qrCodeDataUri: { type: 'string' },
        copiaECola: { type: 'string', nullable: true, description: 'EMV do PIX; nulo no cartão.' },
        checkoutUrl: { type: 'string', nullable: true, description: 'Checkout hospedado; nulo no PIX.' },
        expiraEm: { type: 'string', format: 'date-time' },
        valorEmCentavos: { type: 'integer' },
        moeda: { type: 'string' },
      },
    },
  })
  async cobrarPorPix(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
  ): Promise<CobrancaDoTotem> {
    const agora = new Date();
    const aluno = await this.area.resolver(
      this.contexto(requisicao),
      sessionId,
      this.token(token),
      'pagamento',
      agora,
    );

    return this.pagamento.cobrarPorPix(
      aluno,
      agora,
      requisicao.correlationId ?? 'sem-correlacao',
    );
  }

  @Post('sessions/:id/payments/card-checkout')
  @HttpCode(201)
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['paymentAttemptId', 'forma', 'qrCodeDataUri', 'expiraEm', 'valorEmCentavos', 'moeda'],
      properties: {
        paymentAttemptId: { type: 'string', format: 'uuid' },
        forma: { type: 'string', enum: ['PIX', 'CARD'] },
        qrCodeDataUri: { type: 'string' },
        copiaECola: { type: 'string', nullable: true, description: 'EMV do PIX; nulo no cartão.' },
        checkoutUrl: { type: 'string', nullable: true, description: 'Checkout hospedado; nulo no PIX.' },
        expiraEm: { type: 'string', format: 'date-time' },
        valorEmCentavos: { type: 'integer' },
        moeda: { type: 'string' },
      },
    },
  })
  async cobrarPorCartao(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
  ): Promise<CobrancaDoTotem> {
    const agora = new Date();
    const aluno = await this.area.resolver(
      this.contexto(requisicao),
      sessionId,
      this.token(token),
      'pagamento',
      agora,
    );

    return this.pagamento.cobrarPorCartao(
      aluno,
      agora,
      requisicao.correlationId ?? 'sem-correlacao',
    );
  }

  /**
   * O LACO da tela enquanto o QR esta aberto.
   *
   * `M4-BR-001`: isto NAO confirma pagamento -- le o que o webhook ja
   * confirmou. A cadeia que restaura o entitlement e a do MVP 2, sem bypass
   * local nenhum (regra de arquitetura no 1).
   */
  @Get('sessions/:id/payments/:attemptId')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['status', 'statusDaFatura', 'pagoEm'],
      properties: {
        status: { type: 'string' },
        statusDaFatura: { type: 'string' },
        pagoEm: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  async observarPagamento(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Param('attemptId') attemptId: string,
    @Headers('x-session-token') token: string | undefined,
  ) {
    const aluno = await this.area.resolver(
      this.contexto(requisicao),
      sessionId,
      this.token(token),
      'pagamento',
      new Date(),
    );

    return this.pagamento.observar(aluno, attemptId);
  }

  @Get('sessions/:id/payments')
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        required: ['invoiceId', 'status', 'vencimentoEm', 'valorEmCentavos', 'moeda', 'emAberto'],
        properties: {
          invoiceId: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          vencimentoEm: { type: 'string', format: 'date-time' },
          pagoEm: { type: 'string', format: 'date-time', nullable: true },
          valorEmCentavos: { type: 'integer' },
          moeda: { type: 'string' },
          emAberto: { type: 'boolean' },
        },
      },
    },
  })
  async historicoDePagamentos(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
  ) {
    const agora = new Date();
    const aluno = await this.area.resolver(
      this.contexto(requisicao),
      sessionId,
      this.token(token),
      'historicoDePagamentos',
      agora,
    );

    return this.pagamento.historico(aluno, agora);
  }

  @Get('sessions/:id/assessment')
  @ApiOkResponse({
    schema: {
      type: 'object',
      nullable: true,
      required: ['medidaEm', 'aparelho', 'metricas', 'segmentos', 'relatorioDoAparelho'],
      properties: {
        medidaEm: { type: 'string', format: 'date-time', nullable: true },
        aparelho: { type: 'string', nullable: true },
        metricas: {
            type: 'array',
            items: {
              type: 'object',
              required: ['tipo', 'valor', 'unidade', 'deltaAbsoluto', 'razaoDaAusencia'],
              properties: {
                tipo: { type: 'string' },
                valor: { type: 'number', nullable: true },
                unidade: { type: 'string', nullable: true },
                deltaAbsoluto: { type: 'number', nullable: true },
                razaoDaAusencia: { type: 'string', nullable: true },
              },
            },
          },
        segmentos: {
          type: 'array',
          items: {
            type: 'object',
            required: ['segmento', 'gorduraKg', 'musculoKg'],
            properties: {
              segmento: { type: 'string', enum: ['ARMS', 'TRUNK', 'LEGS'] },
              gorduraKg: { type: 'number', nullable: true },
              musculoKg: { type: 'number', nullable: true },
            },
          },
        },
        relatorioDoAparelho: {
          type: 'object',
          nullable: true,
          additionalProperties: true,
          description: 'Índice e achado como o aparelho os escreveu. Opaco: nunca interpretado.',
        },
      },
    },
    description: 'Nulo quando o aluno ainda não tem avaliação publicada.',
  })
  async avaliacaoDoMes(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
  ) {
    const agora = new Date();
    const aluno = await this.area.resolver(
      this.contexto(requisicao),
      sessionId,
      this.token(token),
      'avaliacao',
      agora,
    );

    return this.saude.avaliacaoDoMes(aluno, agora);
  }

  @Get('sessions/:id/evolution')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['months', 'latestAnalysis'],
      properties: {
        months: { type: 'array', items: { type: 'object', additionalProperties: true } },
        latestAnalysis: {
          type: 'object',
          nullable: true,
          required: ['positivePoints', 'attentionPoints', 'disclaimerCode'],
          properties: {
            positivePoints: { type: 'array', items: { type: 'string' } },
            attentionPoints: { type: 'array', items: { type: 'string' } },
            disclaimerCode: { type: 'string', enum: ['NOT_MEDICAL_DIAGNOSIS'] },
          },
        },
      },
    },
  })
  async evolucao(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
  ) {
    const agora = new Date();
    const aluno = await this.area.resolver(
      this.contexto(requisicao),
      sessionId,
      this.token(token),
      'evolucao',
      agora,
    );

    return this.saude.evolucao(aluno, agora);
  }

  @Get('sessions/:id/assessments')
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        required: ['assessmentId', 'medidaEm', 'metricas'],
        properties: {
          assessmentId: { type: 'string', format: 'uuid' },
          medidaEm: { type: 'string', format: 'date-time' },
          metricas: {
            type: 'array',
            items: {
              type: 'object',
              required: ['tipo', 'valor', 'unidade', 'deltaAbsoluto', 'razaoDaAusencia'],
              properties: {
                tipo: { type: 'string' },
                valor: { type: 'number', nullable: true },
                unidade: { type: 'string', nullable: true },
                deltaAbsoluto: { type: 'number', nullable: true },
                razaoDaAusencia: { type: 'string', nullable: true },
              },
            },
          },
        },
      },
    },
  })
  async historicoDeAvaliacoes(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
  ) {
    const agora = new Date();
    const aluno = await this.area.resolver(
      this.contexto(requisicao),
      sessionId,
      this.token(token),
      'historicoDeAvaliacoes',
      agora,
    );

    return this.saude.historicoDeAvaliacoes(aluno, agora);
  }

  /**
   * §5.8 -- preferencia de engajamento (F30).
   *
   * So `RANKING` existe nesta fatia -- `preferenciasSchema` recusa qualquer
   * outra finalidade antes de chegar aqui (400, boundary Zod).
   */
  @Get('sessions/:id/engajamento/preferencias')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['finalidades', 'perfil', 'nomeExibido'],
      properties: {
        finalidades: { type: 'object', additionalProperties: { type: 'boolean' } },
        perfil: { type: 'object', nullable: true, additionalProperties: true },
        nomeExibido: { type: 'string' },
      },
    },
  })
  async obterPreferenciasDeEngajamento(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
  ) {
    const aluno = await this.area.resolver(
      this.contexto(requisicao),
      sessionId,
      this.token(token),
      'ranking',
      new Date(),
    );

    return this.engajamento.obterPreferencias(aluno);
  }

  @Patch('sessions/:id/engajamento/preferencias')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['finalidades', 'perfil', 'nomeExibido'],
      properties: {
        finalidades: { type: 'object', additionalProperties: { type: 'boolean' } },
        perfil: { type: 'object', nullable: true, additionalProperties: true },
        nomeExibido: { type: 'string' },
      },
    },
  })
  async atualizarPreferenciaDeEngajamento(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
    @Body() corpo: unknown,
  ) {
    const agora = new Date();
    const aluno = await this.area.resolver(
      this.contexto(requisicao),
      sessionId,
      this.token(token),
      'ranking',
      agora,
    );

    const dados = preferenciasSchema.parse(corpo);

    return this.engajamento.atualizarPreferencia(aluno, dados.participa, dados.idempotencyKey, agora);
  }

  @Patch('sessions/:id/engajamento/perfil-publico')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['id', 'identityChoice', 'alias', 'status', 'version'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        identityChoice: { type: 'string', enum: ['PRIMEIRO_NOME', 'APELIDO', 'ANONIMO'] },
        alias: { type: 'string', nullable: true },
        status: { type: 'string' },
        version: { type: 'integer' },
      },
    },
  })
  async definirPerfilPublico(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
    @Body() corpo: unknown,
  ) {
    const agora = new Date();
    const aluno = await this.area.resolver(
      this.contexto(requisicao),
      sessionId,
      this.token(token),
      'ranking',
      agora,
    );

    const dados = aliasPublicoSchema.parse(corpo);

    return this.engajamento.definirAliasPublico(
      aluno,
      dados.identityChoice,
      dados.alias,
      dados.version,
      agora,
    );
  }

  /**
   * XP, movimentos explicaveis, conquistas (incluindo revertidas) e posicao
   * no placar -- SO do aluno daquela sessao (F31, Task 9).
   *
   * `movimentos[].regra` e o `code` da regra para GRANT, ou o motivo
   * gravado para ADJUSTMENT/REVERSAL (`M5-FR-004`, §13 do PRD: sempre
   * mostrar POR QUE o aluno recebeu). `posicao` e `null` quando o aluno nao
   * aparece no placar publicado (nao publicado, retido, opt-out ou
   * inativo).
   */
  @Get('sessions/:id/engajamento/xp')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['saldoDoMes', 'mes', 'movimentos', 'conquistas', 'posicao'],
      properties: {
        saldoDoMes: { type: 'integer' },
        mes: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
        movimentos: {
          type: 'array',
          items: {
            type: 'object',
            required: ['pontos', 'regra', 'quando'],
            properties: {
              pontos: { type: 'integer' },
              regra: { type: 'string' },
              quando: { type: 'string', format: 'date-time' },
            },
          },
        },
        conquistas: {
          type: 'array',
          items: {
            type: 'object',
            required: ['titulo', 'desbloqueadaEm', 'revertida', 'motivo'],
            properties: {
              titulo: { type: 'string' },
              desbloqueadaEm: { type: 'string', format: 'date-time' },
              revertida: { type: 'boolean' },
              motivo: { type: 'string', nullable: true },
            },
          },
        },
        posicao: { type: 'integer', nullable: true },
      },
    },
  })
  async obterExtratoDeXp(
    @Req() requisicao: Request,
    @Param('id') sessionId: string,
    @Headers('x-session-token') token: string | undefined,
  ) {
    const agora = new Date();
    const aluno = await this.area.resolver(
      this.contexto(requisicao),
      sessionId,
      this.token(token),
      'xp',
      agora,
    );

    return this.xp.obterExtrato(aluno, agora);
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
