import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { StudentSessionGuard } from '../student-identity/student-session.guard.js';
import { MobileEngajamentoService } from './mobile-engajamento.service.js';

const esquemaDaPreferencia = z.object({ participa: z.boolean() }).strict();

/** Mesmo intervalo das outras chaves de idempotencia da API (`exports`, `health-progress`). */
const esquemaDaChave = z.string().min(8).max(120);

const ESQUEMA_DA_PREFERENCIA = {
  type: 'object',
  properties: {
    participa: { type: 'boolean' },
    nomeExibido: { type: 'string' },
  },
  required: ['participa', 'nomeExibido'],
};

const ESQUEMA_DO_ENGAJAMENTO = {
  type: 'object',
  properties: {
    asOf: { type: 'string' },
    status: { type: 'string', enum: ['AVAILABLE'] },
    mes: { type: 'string' },
    unidade: {
      type: 'object',
      properties: { nome: { type: 'string' } },
      required: ['nome'],
    },
    xp: {
      type: 'object',
      properties: {
        saldoDoMes: { type: 'number' },
        conquistas: {
          type: 'array',
          nullable: true,
          items: {
            type: 'object',
            properties: {
              titulo: { type: 'string' },
              desbloqueadaEm: { type: 'string' },
              revertida: { type: 'boolean' },
            },
            required: ['titulo', 'desbloqueadaEm', 'revertida'],
          },
        },
      },
      required: ['saldoDoMes', 'conquistas'],
    },
    consistencia: {
      type: 'object',
      properties: {
        atual: { type: 'number' },
        recorde: { type: 'number' },
        diasPorSemana: { type: 'number' },
      },
      required: ['atual', 'recorde', 'diasPorSemana'],
    },
    ranking: {
      type: 'object',
      nullable: true,
      properties: {
        participa: { type: 'boolean' },
        nomeExibido: { type: 'string' },
        minhaPosicao: {
          type: 'object',
          nullable: true,
          properties: { posicao: { type: 'number' }, pontos: { type: 'number' } },
          required: ['posicao', 'pontos'],
        },
        placar: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              posicao: { type: 'number' },
              nome: { type: 'string' },
              pontos: { type: 'number' },
              souEu: { type: 'boolean' },
            },
            required: ['posicao', 'nome', 'pontos', 'souEu'],
          },
        },
      },
      required: ['participa', 'nomeExibido', 'minhaPosicao', 'placar'],
    },
    desafios: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          titulo: { type: 'string' },
          meta: { type: 'number' },
          progresso: { type: 'number' },
          inscrito: { type: 'boolean' },
          inicio: { type: 'string' },
          fim: { type: 'string' },
        },
        required: ['id', 'titulo', 'meta', 'progresso', 'inscrito', 'inicio', 'fim'],
      },
    },
  },
  required: ['asOf', 'status', 'mes', 'unidade', 'xp', 'consistencia', 'ranking', 'desafios'],
};

/**
 * Engajamento do aluno no app -- XP, consistencia, placar e desafios.
 *
 * SEM PARAMETRO DE ALUNO, mesmo motivo de `MobileFrequenciaController`: o
 * `studentId` sai da sessao. Com id na rota, qualquer sessao valida ligaria
 * ou desligaria o ranking de outro aluno trocando um UUID.
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile/engajamento')
export class MobileEngajamentoController {
  constructor(private readonly engajamento: MobileEngajamentoService) {}

  @Get()
  @ApiOkResponse({ description: 'Engajamento do aluno.', schema: ESQUEMA_DO_ENGAJAMENTO })
  async obter(@Req() requisicao: Request) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    return this.engajamento.montar(ctx, new Date());
  }

  /**
   * `200`, e nao o `201` padrao do Nest para POST: nada e criado do ponto de
   * vista do app -- a resposta e o ESTADO da preferencia depois da decisao,
   * igual ao `PUT` de consentimentos. Por baixo a prova e append-only
   * (`consent_records`), mas isso e detalhe do modulo de engajamento.
   *
   * `Idempotency-Key` e HEADER opcional: o toque duplo no botao nao grava
   * duas decisoes quando o app manda a chave (dedupe de 24 h do repositorio).
   * Sem ela a chamada continua valida -- a decisao repetida da o mesmo estado.
   */
  @Post('ranking')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Chave de 8 a 120 caracteres.' })
  @ApiOkResponse({ description: 'Preferencia de ranking apos a decisao.', schema: ESQUEMA_DA_PREFERENCIA })
  async atualizarRanking(
    @Req() requisicao: Request,
    @Body() corpo: unknown,
    @Headers('idempotency-key') chave?: string,
  ) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    const dados = esquemaDaPreferencia.safeParse(corpo);
    const chaveValida = chave === undefined ? undefined : esquemaDaChave.safeParse(chave);

    /*
     * Codigo PROPRIO, e nao o 400 generico do Zod: o app decide o texto do
     * toast pelo `code`, e um erro de validacao sem nome obrigaria a tela a
     * adivinhar se o problema foi o corpo ou a chave.
     */
    if (!dados.success || (chaveValida !== undefined && !chaveValida.success)) {
      throw new BadRequestException({
        code: 'MOBILE_INVALID_RANKING_PREFERENCE',
        detail: 'corpo deve ser { participa: boolean }; Idempotency-Key, quando enviada, tem de 8 a 120 caracteres',
      });
    }

    return this.engajamento.atualizarRanking(ctx, dados.data.participa, chaveValida?.data, new Date());
  }
}
