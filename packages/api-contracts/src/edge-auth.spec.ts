import { describe, expect, it } from '@jest/globals';

import {
  assinar,
  assinaturaConfere,
  calcularHashDoCorpo,
  montarTextoCanonico,
  normalizarCaminhoEQuery,
  timestampEstaNaJanela,
  type RequisicaoAssinavel,
} from './edge-auth.js';

/**
 * GOLDEN VECTOR do contrato de assinatura.
 *
 * Estes valores sao a verdade compartilhada entre API e Edge. Se um deles
 * mudar, todo Edge instalado passa a levar 401 -- por isso a assinatura
 * esperada esta escrita literalmente, e nao recalculada pelo proprio codigo
 * que ela deveria verificar.
 */
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao';

const REQUISICAO: RequisicaoAssinavel = {
  keyId: 'edge-key-01',
  timestamp: 1_755_000_000,
  nonce: 'bm9uY2UtZGUtdGVzdGU',
  method: 'POST',
  pathAndQuery: '/api/v1/edge/sync-results/batch',
  body: '{"results":[]}',
};

describe('texto canonico', () => {
  it('tem sete linhas, na ordem congelada', () => {
    const linhas = montarTextoCanonico(REQUISICAO).split('\n');

    expect(linhas).toEqual([
      'ARENAHUB-HMAC-SHA256',
      'edge-key-01',
      '1755000000',
      'bm9uY2UtZGUtdGVzdGU',
      'POST',
      '/api/v1/edge/sync-results/batch',
      calcularHashDoCorpo('{"results":[]}'),
    ]);
  });

  it('maiuscuza o metodo', () => {
    const canonico = montarTextoCanonico({ ...REQUISICAO, method: 'post' });

    expect(canonico.split('\n')[4]).toBe('POST');
  });

  it('inclui hash do corpo vazio em vez de linha em branco', () => {
    const canonico = montarTextoCanonico({ ...REQUISICAO, body: '' });

    // Linha em branco permitiria trocar GET sem corpo por POST com corpo
    // mantendo a assinatura.
    expect(canonico.split('\n')[6]).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('normalizarCaminhoEQuery', () => {
  it('mantem caminho sem query intacto', () => {
    expect(normalizarCaminhoEQuery('/api/v1/edge/commands')).toBe('/api/v1/edge/commands');
  });

  it('ordena parametros por chave', () => {
    // Sem ordenacao, a mesma requisicao montada em ordem diferente levaria
    // 401 -- e ninguem reproduziria.
    expect(normalizarCaminhoEQuery('/x?b=2&a=1')).toBe('/x?a=1&b=2');
  });

  it('produz o mesmo resultado para qualquer ordem de entrada', () => {
    expect(normalizarCaminhoEQuery('/x?limit=50&after=3')).toBe(
      normalizarCaminhoEQuery('/x?after=3&limit=50'),
    );
  });

  it('ordena por valor quando a chave repete', () => {
    expect(normalizarCaminhoEQuery('/x?id=2&id=1')).toBe('/x?id=1&id=2');
  });

  it('preserva parametro sem valor', () => {
    expect(normalizarCaminhoEQuery('/x?flag')).toBe('/x?flag=');
  });

  it('trata query vazia', () => {
    expect(normalizarCaminhoEQuery('/x?')).toBe('/x');
  });
});

describe('assinar', () => {
  it('produz a assinatura do golden vector', () => {
    // Valor literal: recalcular aqui testaria o codigo contra ele mesmo.
    // Este hex E o contrato -- muda-lo quebra todo Edge instalado.
    expect(assinar(REQUISICAO, SEGREDO)).toBe(
      '66aab0cc410676d7fa907f6b7650f2c101e3bc4f83ceea027f2b22aa662a52e1',
    );
  });

  it('e deterministica', () => {
    expect(assinar(REQUISICAO, SEGREDO)).toBe(assinar(REQUISICAO, SEGREDO));
  });

  it('muda quando o corpo muda', () => {
    const adulterada = assinar({ ...REQUISICAO, body: '{"results":[1]}' }, SEGREDO);

    expect(adulterada).not.toBe(assinar(REQUISICAO, SEGREDO));
  });

  it('muda quando o metodo muda', () => {
    expect(assinar({ ...REQUISICAO, method: 'DELETE' }, SEGREDO)).not.toBe(
      assinar(REQUISICAO, SEGREDO),
    );
  });

  it('muda quando o caminho muda', () => {
    expect(assinar({ ...REQUISICAO, pathAndQuery: '/api/v1/edge/commands' }, SEGREDO)).not.toBe(
      assinar(REQUISICAO, SEGREDO),
    );
  });

  it('muda quando o nonce muda', () => {
    expect(assinar({ ...REQUISICAO, nonce: 'b3V0cm8tbm9uY2U' }, SEGREDO)).not.toBe(
      assinar(REQUISICAO, SEGREDO),
    );
  });

  it('muda quando o segredo muda', () => {
    expect(assinar(REQUISICAO, 'outro-segredo')).not.toBe(assinar(REQUISICAO, SEGREDO));
  });

  it('ignora a ordem dos parametros da query', () => {
    const umaOrdem = assinar({ ...REQUISICAO, pathAndQuery: '/x?a=1&b=2' }, SEGREDO);
    const outraOrdem = assinar({ ...REQUISICAO, pathAndQuery: '/x?b=2&a=1' }, SEGREDO);

    expect(umaOrdem).toBe(outraOrdem);
  });
});

describe('assinaturaConfere', () => {
  it('aceita assinatura igual', () => {
    const assinatura = assinar(REQUISICAO, SEGREDO);

    expect(assinaturaConfere(assinatura, assinatura)).toBe(true);
  });

  it('recusa assinatura diferente', () => {
    expect(assinaturaConfere(assinar(REQUISICAO, SEGREDO), 'a'.repeat(64))).toBe(false);
  });

  it('recusa tamanho diferente sem estourar', () => {
    // `timingSafeEqual` lanca com buffers de tamanhos distintos; a checagem
    // de comprimento antes e o que evita transformar 401 em 500.
    expect(assinaturaConfere('abc', 'abcd')).toBe(false);
  });
});

describe('timestampEstaNaJanela', () => {
  const agora = 1_755_000_000;

  it('aceita o instante exato', () => {
    expect(timestampEstaNaJanela(agora, agora)).toBe(true);
  });

  it('aceita atraso dentro da janela', () => {
    expect(timestampEstaNaJanela(agora - 299, agora)).toBe(true);
  });

  it('recusa atraso fora da janela', () => {
    expect(timestampEstaNaJanela(agora - 301, agora)).toBe(false);
  });

  it('recusa relogio adiantado fora da janela', () => {
    // Aceitar futuro permitiria pre-assinar requisicoes para usar depois.
    expect(timestampEstaNaJanela(agora + 301, agora)).toBe(false);
  });
});
