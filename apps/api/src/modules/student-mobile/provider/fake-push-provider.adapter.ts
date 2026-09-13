import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  ErroDePush,
  type EnvioDePush,
  type PushProvider,
  type ReciboDePush,
} from './push-provider.port.js';

/**
 * Dublê de push -- vale enquanto nao houver credencial do OneSignal.
 *
 * NAO e so um stub de teste: e o que roda em desenvolvimento e em qualquer
 * ambiente sem credencial, pelo mesmo criterio do `FakeAiProviderAdapter` e
 * do `FakePaymentProvider`. Sem ele, a API morreria no arranque por falta de
 * uma chave de terceiro que nao trava nenhuma outra funcionalidade.
 *
 * GUARDA OS ENVIOS para o teste afirmar o ATO, nao o retorno: um dublê que so
 * devolve `receiptId` deixa passar o codigo que nunca chamou o provedor --
 * ou que chamou com o token errado. O teste le `enviados` e confere o que
 * chegou aqui.
 */
@Injectable()
export class FakePushProviderAdapter implements PushProvider {
  private readonly recebidos: EnvioDePush[] = [];

  private falhaProgramada: ErroDePush | null = null;

  /** O que o codigo sob teste realmente mandou entregar. */
  get enviados(): readonly EnvioDePush[] {
    return this.recebidos;
  }

  programarFalha(erro: ErroDePush): void {
    this.falhaProgramada = erro;
  }

  /**
   * A instancia e COMPARTILHADA na suite: modo de falha ligado num bloco e
   * esquecido contamina o proximo, e envio acumulado faz um teste contar o
   * que outro mandou. Os testes chamam isto em `afterEach`.
   */
  resetar(): void {
    this.falhaProgramada = null;
    this.recebidos.length = 0;
  }

  enviar(envio: EnvioDePush): Promise<ReciboDePush> {
    if (this.falhaProgramada) {
      return Promise.reject(this.falhaProgramada);
    }

    this.recebidos.push(envio);

    return Promise.resolve({ receiptId: `fake-push-${randomUUID()}` });
  }
}
