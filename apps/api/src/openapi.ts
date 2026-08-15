import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

import { lerVersaoDaApi } from './version.js';

/**
 * Monta o documento OpenAPI a partir das rotas REAIS registradas.
 *
 * Gerado do runtime, e nao escrito a mao: contrato escrito a mao diverge do
 * codigo na primeira rota que alguem muda sem lembrar do arquivo -- e quem
 * consome descobre em producao.
 */
export function montarOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('ArenaHub API')
    .setDescription('API do ArenaHub — modulo Academia')
    .setVersion(lerVersaoDaApi())
    .addCookieAuth('arenahub_access')
    .build();

  return SwaggerModule.createDocument(app, config);
}
