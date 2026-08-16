import type { IncomingMessage } from 'node:http';

declare module 'express' {
  interface Request {
    /**
     * Corpo CRU, byte a byte. Preenchido so nas rotas de Edge.
     *
     * O `body` parseado nao serve para verificar assinatura: `JSON.parse`
     * seguido de `JSON.stringify` reordena chaves, normaliza espacos e
     * perde a forma exata que o Edge assinou -- o hash deixa de bater por
     * motivo nenhum.
     */
    rawBody?: string;
  }
}

/** Prefixo das rotas que precisam do corpo cru. */
const PREFIXO_DE_EDGE = '/api/v1/edge';

/**
 * `verify` do body-parser: guarda o corpo cru das rotas de Edge.
 *
 * PRECISA SER INSTALADO NO PARSER GLOBAL, no `main.ts` -- e nao como
 * middleware de rota.
 *
 * O motivo custou um teste pendurado: o Nest instala o `body-parser` no
 * bootstrap, antes de qualquer middleware de modulo, e ele CONSOME o stream.
 * Um middleware de rota que tentasse ler o corpo depois encontraria o stream
 * drenado -- `on('end')` nunca dispara, `next()` nunca e chamado, e a
 * requisicao fica pendurada ate o timeout. Instalar um segundo parser de
 * rota tem o mesmo problema: o `rawBody` chega vazio porque o primeiro ja
 * levou os bytes.
 *
 * O `verify` roda DENTRO do parse global, com o buffer na mao. E o unico
 * ponto onde o corpo cru ainda existe.
 *
 * Guarda so nas rotas de Edge: reter o corpo cru de toda requisicao seria
 * memoria e superficie sem motivo.
 */
export function guardarCorpoCru(
  requisicao: IncomingMessage,
  _resposta: unknown,
  buffer: Buffer,
): void {
  if (!requisicao.url?.startsWith(PREFIXO_DE_EDGE)) return;

  (requisicao as { rawBody?: string }).rawBody = buffer.toString('utf8');
}
