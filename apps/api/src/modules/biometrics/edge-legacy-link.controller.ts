import { Body, Controller, HttpCode, NotFoundException, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { DeviceRepository } from '../devices/device.repository.js';
import { DeviceReaderNumberRepository } from '../devices/device-reader-number.repository.js';
import { EdgeRoute } from '../edge-auth/edge-route.decorator.js';
import { ImportarFotoDoLeitorUseCase } from './importar-foto-do-leitor.use-case.js';
import {
  VincularCadastroLegadoUseCase,
  type ResultadoDoVinculoLegado,
} from './vincular-cadastro-legado.use-case.js';

/**
 * O Edge informa os numeros que o leitor tem -- #468.
 *
 * `.strict()` pelo mesmo motivo das outras rotas do Edge: `tenantId` ou
 * `gymUnitId` no corpo sao RECUSADOS, a identidade vem da assinatura HMAC
 * (regra de arquitetura no 2).
 *
 * Teto de 1.000 numeros por chamada: o leitor comporta 5.000 usuarios e o
 * Edge fatia. Um corpo sem teto seria um jeito de prender a API.
 */
const esquemaDoVinculo = z
  .object({
    deviceSerial: z.string().min(1).max(64),
    externalUserIds: z.array(z.string().min(1).max(64)).min(1).max(1000),
  })
  .strict();

const esquemaDosPendentes = z.object({ deviceSerial: z.string().min(1).max(64) }).strict();

/**
 * Foto do leitor -- #503. UMA por chamada: o corpo JSON da API tem teto de
 * 1 MB (`bootstrap-http.ts`), e a foto de cadastro do leitor fica na casa
 * das dezenas de KB. 900.000 caracteres de Base64 sao ~660 KB de imagem.
 *
 * Aceita o prefixo `data:image/...;base64,` que alguns firmwares poem.
 */
const esquemaDaFoto = z
  .object({
    deviceSerial: z.string().min(1).max(64),
    externalUserId: z.string().min(1).max(64),
    imageBase64: z.string().min(1).max(900_000),
  })
  .strict();

/**
 * Nome que o leitor guarda para cada numero (`getuserinfo`) -- so para a
 * recepcao reconhecer um cadastro sem aluno. Teto de 500 por chamada.
 */
const esquemaDosNomes = z
  .object({
    deviceSerial: z.string().min(1).max(64),
    names: z
      .array(
        z
          .object({ externalUserId: z.string().min(1).max(64), name: z.string().min(1).max(100) })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

const listaDeNumeros = { type: 'array', items: { type: 'string' } };

const ESQUEMA_DO_RESULTADO = {
  type: 'object',
  properties: {
    linked: { type: 'integer' },
    alreadyLinked: { type: 'integer' },
    withoutStudent: listaDeNumeros,
    ambiguous: listaDeNumeros,
    studentAlreadyLinked: listaDeNumeros,
    withoutConsentDocument: listaDeNumeros,
    refusedOrRevoked: listaDeNumeros,
  },
  required: [
    'linked',
    'alreadyLinked',
    'withoutStudent',
    'ambiguous',
    'studentAlreadyLinked',
    'withoutConsentDocument',
    'refusedOrRevoked',
  ],
};

@Controller('api/v1/edge/device-users')
export class EdgeLegacyLinkController {
  constructor(
    private readonly vincular: VincularCadastroLegadoUseCase,
    private readonly fotos: ImportarFotoDoLeitorUseCase,
    private readonly dispositivos: DeviceRepository,
    private readonly numerosDoLeitor: DeviceReaderNumberRepository,
  ) {}

  @Post('legacy-links')
  @EdgeRoute()
  @ApiCreatedResponse({ schema: ESQUEMA_DO_RESULTADO })
  async vincularLegado(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<ResultadoDoVinculoLegado> {
    const dados = esquemaDoVinculo.parse(corpo);

    // Garantido pelo guard: rota marcada sem contexto nao chega aqui.
    const edge = requisicao.edgeContext!;

    return this.vincular.executar(
      edge,
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
      new Date(),
    );
  }

  /** Numeros deste leitor cujo aluno ainda nao tem foto -- #503. */
  @Post('photos/pending')
  @HttpCode(200)
  @EdgeRoute()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { externalUserIds: listaDeNumeros },
      required: ['externalUserIds'],
    },
  })
  async fotosPendentes(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ externalUserIds: string[] }> {
    const dados = esquemaDosPendentes.parse(corpo);

    return {
      externalUserIds: await this.fotos.pendentes(requisicao.edgeContext!, dados.deviceSerial),
    };
  }

  /** A foto de UM numero do leitor -- #503. Nunca sobrescreve a do aluno. */
  @Post('photos')
  @HttpCode(200)
  @EdgeRoute()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { result: { type: 'string', enum: ['IMPORTED', 'ALREADY_HAS_PHOTO'] } },
      required: ['result'],
    },
  })
  async importarFoto(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ result: 'IMPORTED' | 'ALREADY_HAS_PHOTO' }> {
    const dados = esquemaDaFoto.parse(corpo);
    const base64 = dados.imageBase64.replace(/^data:[^,]*,/, '');

    const result = await this.fotos.importar(requisicao.edgeContext!, {
      deviceSerial: dados.deviceSerial,
      externalUserId: dados.externalUserId,
      conteudo: Buffer.from(base64, 'base64'),
    });

    return { result };
  }

  /** Nome que o leitor guarda -- so de numero que ele ja informou. */
  @Post('reader-names')
  @HttpCode(200)
  @EdgeRoute()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { updated: { type: 'integer' } },
      required: ['updated'],
    },
  })
  async nomesDoLeitor(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ updated: number }> {
    const dados = esquemaDosNomes.parse(corpo);
    const edge = requisicao.edgeContext!;
    const leitor = await this.dispositivos.resolverDoEdgePorSerial(edge, dados.deviceSerial);

    if (!leitor) throw new NotFoundException({ code: 'DEVICE_NOT_IN_SCOPE' });

    const updated = await this.numerosDoLeitor.registrarNomes(
      edge.tenantId,
      leitor.id,
      dados.names,
    );

    return { updated };
  }
}
