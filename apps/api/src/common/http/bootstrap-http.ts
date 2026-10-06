import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';

import { guardarCorpoCru } from './raw-body.middleware.js';

/**
 * Substitui o parser de corpo padrao por um que guarda o corpo cru.
 *
 * Chamado no `main.ts` E no setup de teste: a verificacao de assinatura do
 * Edge depende do corpo cru, e um ambiente que nao aplica isto passa a
 * recusar todo Edge com `EDGE_SIGNATURE_INVALID` -- falha que aparece so em
 * runtime, com codigo que parece correto.
 *
 * Fica numa funcao, e nao inline no `main.ts`, exatamente para que o teste
 * possa montar a aplicacao do mesmo jeito que producao.
 */
/**
 * Diz ao Express quantos proxies confiar -- issue #605. `0` e o padrao do
 * Express e nao muda nada. Com `N > 0`, `req.ip` passa a ser o IP do cliente
 * lido do `X-Forwarded-For`, e e ele que o throttle por IP e a auditoria usam.
 */
export function aplicarTrustProxy(app: INestApplication, saltos: number): void {
  if (saltos <= 0) return;

  (app.getHttpAdapter().getInstance() as { set: (chave: string, valor: number) => void }).set(
    'trust proxy',
    saltos,
  );
}

export function aplicarParserComCorpoCru(app: INestApplication): void {
  app.use(json({ limit: '1mb', verify: guardarCorpoCru }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
}
