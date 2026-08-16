import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../common/security/public.decorator.js';
import { OBJECT_STORAGE } from '../common/storage/object-storage.port.js';
import type { S3ObjectStorageAdapter } from '../common/storage/s3-object-storage.adapter.js';

import { lerVersaoDaApi } from '../version.js';
import { VerificadorDeBanco } from './verificador-de-banco.js';
import { VerificadorDeRedis } from './verificador-de-redis.js';

/**
 * `live` e `ready` respondem perguntas diferentes, e confundi-las causa dano
 * oposto ao pretendido:
 *
 * - `live` -- o processo respira? Nao toca no banco. Se dependesse dele, uma
 *   queda do Postgres faria o orquestrador reiniciar a API, que reiniciar nao
 *   conserta;
 * - `ready` -- da para mandar trafego? Ai sim consulta a dependencia.
 */
/**
 * Dependencias fora do ar, por nome, com codigo estavel.
 *
 * Chaves opcionais e fixas (nao `Record<string, string>`): so estas tres
 * existem, e o compilador cobra quando uma quarta dependencia entrar sem
 * codigo proprio.
 */
interface QuedasDeDependencia {
  database?: 'HEALTH_DATABASE_UNAVAILABLE';
  redis?: 'HEALTH_REDIS_UNAVAILABLE';
  objectStorage?: 'HEALTH_OBJECT_STORAGE_UNAVAILABLE';
}

/** Sonda atendida (200) ou dependencia fora (503) -- nunca as duas formas. */
type RespostaDeReadiness =
  | { status: 'ready'; dependencies: Record<string, 'up'> }
  | { status: 'unavailable'; code: string; unavailable: QuedasDeDependencia };

// Sonda de orquestrador nao tem credencial -- e nao deve precisar de uma.
@Public()
@Controller()
export class HealthController {
  constructor(
    private readonly banco: VerificadorDeBanco,
    private readonly redis: VerificadorDeRedis,
    @Inject(OBJECT_STORAGE) private readonly storage: S3ObjectStorageAdapter,
  ) {}

  @Get('health/live')
  live(): { status: 'live' } {
    return { status: 'live' };
  }

  /**
   * Cada dependencia e reportada em SEPARADO.
   *
   * Um `ready: false` sem dizer qual dependencia caiu obriga quem esta de
   * plantao a adivinhar entre Postgres, Redis e storage. O codigo e estavel;
   * o detalhe (host, credencial, string de conexao) nunca sai daqui.
   *
   * ESCREVE A RESPOSTA DIRETO, sem lancar excecao. O `ProblemDetailsFilter`
   * normaliza para RFC 9457 e -- corretamente -- descarta campo que nao
   * pertence ao formato, o que apagaria justamente o `unavailable`. Afrouxar
   * o filtro para caber uma sonda seria trocar a garantia de "nada vaza" por
   * conveniencia; readiness nao e erro de aplicacao, e uma sonda de
   * infraestrutura com corpo proprio.
   */
  @Get('health/ready')
  async ready(
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<RespostaDeReadiness> {
    // Em paralelo: tres sondas sequenciais somariam tres timeouts no pior
    // caso, e a sonda do orquestrador desiste antes disso.
    const [bancoDisponivel, redisDisponivel, storageDisponivel] = await Promise.all([
      this.banco.verificar(),
      this.redis.verificar(),
      this.storage.verificar(),
    ]);

    const quedas: QuedasDeDependencia = {
      ...(bancoDisponivel ? {} : { database: 'HEALTH_DATABASE_UNAVAILABLE' as const }),
      ...(redisDisponivel ? {} : { redis: 'HEALTH_REDIS_UNAVAILABLE' as const }),
      ...(storageDisponivel
        ? {}
        : { objectStorage: 'HEALTH_OBJECT_STORAGE_UNAVAILABLE' as const }),
    };

    // Ordem fixa, e nao `Object.values`: com chaves opcionais o `values`
    // devolve `any`, e a ordem passaria a depender da insercao.
    const codigos = [quedas.database, quedas.redis, quedas.objectStorage].filter(
      (codigo): codigo is NonNullable<typeof codigo> => codigo !== undefined,
    );

    const primeiro = codigos[0];

    if (primeiro !== undefined) {
      resposta.status(HttpStatus.SERVICE_UNAVAILABLE);

      return {
        status: 'unavailable',
        // `code` continua sendo o do banco quando ele cai: contrato ja
        // consumido pela suite da F6, e quebra-lo sem motivo nao paga.
        code: quedas.database ?? primeiro,
        unavailable: quedas,
      };
    }

    return {
      status: 'ready',
      dependencies: { database: 'up', redis: 'up', objectStorage: 'up' },
    };
  }

  @Get('version')
  version(): { version: string } {
    return { version: lerVersaoDaApi() };
  }
}
