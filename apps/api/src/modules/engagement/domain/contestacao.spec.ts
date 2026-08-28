import { describe, expect, it } from '@jest/globals';

import { abrirContestacao, resolverContestacao, DESCRICAO_MAX, DESCRICAO_MIN } from './contestacao.js';

const ABERTA = {
  status: 'ABERTA' as const,
};

describe('abrirContestacao', () => {
  it('abre com assunto e descricao validos', () => {
    const nova = abrirContestacao({ subject: 'XP', descricao: 'Treinei terca e nao pontuou.' });
    expect(nova.status).toBe('ABERTA');
    expect(nova.descricao).toBe('Treinei terca e nao pontuou.');
  });

  it('normaliza espaco em volta da descricao', () => {
    const nova = abrirContestacao({ subject: 'XP', descricao: '   faltou ponto   ' });
    expect(nova.descricao).toBe('faltou ponto');
  });

  it('recusa descricao vazia ou so espaco', () => {
    // Contestacao sem texto e uma linha na fila que ninguem sabe resolver.
    expect(() => abrirContestacao({ subject: 'XP', descricao: '' })).toThrow(
      'CONTESTACAO_DESCRICAO_OBRIGATORIA',
    );
    expect(() => abrirContestacao({ subject: 'XP', descricao: '     ' })).toThrow(
      'CONTESTACAO_DESCRICAO_OBRIGATORIA',
    );
  });

  it('recusa descricao curta demais para ser acionavel', () => {
    expect(() => abrirContestacao({ subject: 'XP', descricao: 'ue' })).toThrow(
      'CONTESTACAO_DESCRICAO_CURTA',
    );
  });

  it('mede o tamanho DEPOIS de aparar, nao antes', () => {
    // O canario: validar o bruto deixaria passar uma descricao feita so de
    // espacos com um caractere no meio, e a fila receberia lixo com tamanho
    // "valido".
    const soEspacoEmVolta = ' '.repeat(DESCRICAO_MIN) + 'ab' + ' '.repeat(10);
    expect(() => abrirContestacao({ subject: 'XP', descricao: soEspacoEmVolta })).toThrow(
      'CONTESTACAO_DESCRICAO_CURTA',
    );
  });

  it('recusa descricao longa demais', () => {
    expect(() =>
      abrirContestacao({ subject: 'XP', descricao: 'a'.repeat(DESCRICAO_MAX + 1) }),
    ).toThrow('CONTESTACAO_DESCRICAO_LONGA');
  });
});

describe('resolverContestacao', () => {
  it('resolve como CORRIGIDA quando houve correcao', () => {
    const desfecho = resolverContestacao(ABERTA, {
      desfecho: 'CORRIGIDA',
      resolucao: 'Sessao de terca nao sincronizou. Devolvidos 10 pontos.',
    });
    expect(desfecho.status).toBe('CORRIGIDA');
  });

  it('resolve como IMPROCEDENTE com explicacao', () => {
    const desfecho = resolverContestacao(ABERTA, {
      desfecho: 'IMPROCEDENTE',
      resolucao: 'A catraca nao registrou passagem naquele dia.',
    });
    expect(desfecho.status).toBe('IMPROCEDENTE');
  });

  it('exige resolucao NOS DOIS desfechos -- improcedente sem explicacao e silencio com carimbo', () => {
    expect(() =>
      resolverContestacao(ABERTA, { desfecho: 'IMPROCEDENTE', resolucao: '' }),
    ).toThrow('CONTESTACAO_RESOLUCAO_OBRIGATORIA');
    expect(() =>
      resolverContestacao(ABERTA, { desfecho: 'CORRIGIDA', resolucao: '   ' }),
    ).toThrow('CONTESTACAO_RESOLUCAO_OBRIGATORIA');
  });

  it('recusa resolver o que ja foi resolvido -- nos DOIS desfechos', () => {
    // Resolver de novo sobrescreveria ator e instante da primeira decisao.
    // A trilha e o produto aqui; perde-la e pior que recusar o clique.
    for (const status of ['CORRIGIDA', 'IMPROCEDENTE'] as const) {
      expect(() =>
        resolverContestacao({ status }, { desfecho: 'CORRIGIDA', resolucao: 'de novo' }),
      ).toThrow('CONTESTACAO_JA_RESOLVIDA');
    }
  });
});
