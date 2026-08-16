import { Injectable, type OnModuleDestroy } from '@nestjs/common';
// `ioredis` e CommonJS: sob `verbatimModuleSyntax`, o default nao e
// construtor. `Redis` (named) e a classe; o alias mantem a leitura habitual.
import { Redis as ClienteRedis } from 'ioredis';

import { carregarConfig } from '../config/env.js';

/**
 * O Redis atende agora?
 *
 * A fila de sync (BullMQ) vive nele. Redis fora significa cadastro
 * biometrico aceito na API e nunca entregue ao leitor -- por isso entra no
 * readiness, e nao so no log.
 */
@Injectable()
export class VerificadorDeRedis implements OnModuleDestroy {
  private readonly cliente: ClienteRedis;

  constructor() {
    const config = carregarConfig();

    this.cliente = new ClienteRedis(config.redis.url, {
      // Sem retry infinito no readiness: a sonda quer resposta rapida, nao
      // um cliente que fica tentando reconectar enquanto a requisicao pendura.
      maxRetriesPerRequest: 1,
      // `lazyConnect`: nao conecta no construtor. Assim subir a API com Redis
      // fora nao derruba o processo -- readiness reporta, liveness segue.
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    // Sem handler, um erro de conexao vira `unhandled error event` e derruba
    // o processo. Readiness ja reporta o estado; aqui so evitamos o crash.
    this.cliente.on('error', () => undefined);
  }

  async verificar(): Promise<boolean> {
    try {
      if (this.cliente.status !== 'ready') {
        await this.cliente.connect();
      }

      const resposta = await this.cliente.ping();
      return resposta === 'PONG';
    } catch {
      return false;
    }
  }

  onModuleDestroy(): void {
    // Sem isto, o Jest fecha a suite com handle aberto e o processo pendura.
    // `disconnect()` e sincrono -- fecha o socket sem esperar comando em voo,
    // que e o que se quer no encerramento.
    this.cliente.disconnect();
  }
}
