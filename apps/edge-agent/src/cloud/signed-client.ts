import { randomBytes } from 'node:crypto';

import { CABECALHOS, assinar } from '@arenahub/api-contracts';

/**
 * Cliente HTTP assinado para falar com a nuvem.
 *
 * Usa `@arenahub/api-contracts` -- o MESMO modulo que a API usa para
 * verificar. Reimplementar a assinatura aqui produziria a divergencia que o
 * pacote compartilhado existe para impedir: uma normaliza a query, a outra
 * nao, e o sintoma em campo e um 401 que ninguem reproduz.
 */
export interface ConfigDoClienteAssinado {
  baseUrl: string;
  keyId: string;
  secret: string;
}

export interface RespostaDaNuvem<T> {
  ok: boolean;
  status: number;
  body: T | null;
  /** Codigo estavel quando a nuvem recusou. */
  errorCode: string | null;
}

export class SignedCloudClient {
  constructor(private readonly config: ConfigDoClienteAssinado) {}

  async get<T>(pathAndQuery: string): Promise<RespostaDaNuvem<T>> {
    return this.enviar<T>('GET', pathAndQuery, undefined);
  }

  async post<T>(
    pathAndQuery: string,
    corpo?: Record<string, unknown>,
  ): Promise<RespostaDaNuvem<T>> {
    return this.enviar<T>('POST', pathAndQuery, corpo);
  }

  private async enviar<T>(
    metodo: 'GET' | 'POST',
    pathAndQuery: string,
    corpo: Record<string, unknown> | undefined,
  ): Promise<RespostaDaNuvem<T>> {
    // Serializa UMA VEZ e usa a MESMA string para assinar e enviar.
    // Serializar duas vezes pode produzir textos diferentes (ordem de chave,
    // espacos) e a assinatura deixa de bater por motivo nenhum.
    const texto = corpo ? JSON.stringify(corpo) : '';

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(16).toString('base64url');

    const assinatura = assinar(
      {
        keyId: this.config.keyId,
        timestamp,
        nonce,
        method: metodo,
        pathAndQuery,
        body: texto,
      },
      this.config.secret,
    );

    const cabecalhos: Record<string, string> = {
      [CABECALHOS.keyId]: this.config.keyId,
      [CABECALHOS.timestamp]: String(timestamp),
      [CABECALHOS.nonce]: nonce,
      [CABECALHOS.signature]: assinatura,
    };

    if (corpo) cabecalhos['content-type'] = 'application/json';

    try {
      const resposta = await fetch(`${this.config.baseUrl}${pathAndQuery}`, {
        method: metodo,
        headers: cabecalhos,
        ...(corpo ? { body: texto } : {}),
        // Sem timeout, um leitor que nao responde pendura o poller para
        // sempre e o Edge para de buscar trabalho novo.
        signal: AbortSignal.timeout(15_000),
      });

      const corpoDaResposta: unknown = await resposta.json().catch(() => null);

      if (!resposta.ok) {
        const erro = corpoDaResposta as { code?: string } | null;

        return {
          ok: false,
          status: resposta.status,
          body: null,
          errorCode: erro?.code ?? `HTTP_${resposta.status}`,
        };
      }

      return {
        ok: true,
        status: resposta.status,
        body: corpoDaResposta as T,
        errorCode: null,
      };
    } catch (erro: unknown) {
      // Rede fora, DNS, timeout. Nao e erro de aplicacao: o poller tenta de
      // novo no proximo ciclo.
      const nome = erro instanceof Error ? erro.name : 'UNKNOWN';

      return {
        ok: false,
        status: 0,
        body: null,
        errorCode: nome === 'TimeoutError' ? 'CLOUD_TIMEOUT' : 'CLOUD_UNREACHABLE',
      };
    }
  }
}
