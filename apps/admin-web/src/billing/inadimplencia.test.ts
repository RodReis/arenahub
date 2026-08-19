import { describe, expect, it } from 'vitest';

import { linkDeCobranca, situacaoVisivel } from './inadimplencia';

describe('situacaoVisivel', () => {
  it('mostra a situacao real quando nao ha liberacao', () => {
    expect(
      situacaoVisivel({ studentName: 'Marina', situacao: 'BLOQUEADO', liberadoAte: null }),
    ).toBe('BLOQUEADO');
  });

  it('LIBERACAO VENCE BLOQUEIO no badge de acesso', () => {
    /**
     * A pergunta que traz a recepcao a esta tela e "este aluno entra agora?".
     * Mostrar "Bloqueado" a quem tem liberacao viva faria a recepcao barrar
     * quem tem passagem autorizada -- o oposto do que a liberacao permite.
     *
     * A divida continua visivel nas outras colunas: valor, vencimento e dias
     * de atraso nao mudam.
     */
    expect(
      situacaoVisivel({
        studentName: 'Carlos',
        situacao: 'BLOQUEADO',
        liberadoAte: '2026-08-22T00:00:00.000Z',
      }),
    ).toBe('LIBERADO');
  });

  it('tambem cobre quem esta em carencia com liberacao', () => {
    expect(
      situacaoVisivel({
        studentName: 'Renata',
        situacao: 'EM_CARENCIA',
        liberadoAte: '2026-08-22T00:00:00.000Z',
      }),
    ).toBe('LIBERADO');
  });
});

describe('linkDeCobranca', () => {
  it('acrescenta o DDI do Brasil a um celular de 11 digitos', () => {
    /**
     * Sem o `55` o `wa.me` abre conversa com numero invalido -- falha
     * silenciosa, que a recepcao so descobre com o cliente esperando.
     */
    const link = linkDeCobranca('(41) 99876-5432', 'Marina Lopes', 8221);

    expect(link).toContain('https://wa.me/5541998765432');
  });

  it('aceita fixo de 10 digitos', () => {
    const link = linkDeCobranca('41 3333-4444', 'Carlos Menezes', 8190);

    expect(link).toContain('https://wa.me/554133334444');
  });

  it('NAO duplica o DDI quando o numero ja o traz', () => {
    const link = linkDeCobranca('+55 41 99876-5432', 'Marina Lopes', 8221);

    expect(link).toContain('https://wa.me/5541998765432');
    expect(link).not.toContain('5555');
  });

  it('usa o PRIMEIRO nome, nao o nome inteiro', () => {
    const link = linkDeCobranca('41998765432', 'Marina Lopes da Silva', 8221);

    expect(decodeURIComponent(link)).toContain('Ola, Marina!');
    expect(decodeURIComponent(link)).not.toContain('Marina Lopes da Silva');
  });

  it('cita o numero da fatura, para a pessoa saber qual e', () => {
    const link = linkDeCobranca('41998765432', 'Marina', 8221);

    expect(decodeURIComponent(link)).toContain('fatura 8221');
  });

  it('NAO cita valor em reais', () => {
    /**
     * Deliberado: uma cobranca automatica com numero pode chegar errada se o
     * aluno acabou de pagar e o webhook ainda nao entrou. A recepcao completa
     * o texto antes de enviar.
     */
    const link = decodeURIComponent(linkDeCobranca('41998765432', 'Marina', 8221));

    expect(link).not.toContain('R$');
  });

  it('escapa a mensagem, para nome com acento nao quebrar a URL', () => {
    const link = linkDeCobranca('41998765432', 'Thiago Almeida', 8248);

    expect(link).not.toContain(' ');
    expect(decodeURIComponent(link)).toContain('Thiago');
  });

  it('nome vazio nao quebra o link', () => {
    const link = linkDeCobranca('41998765432', '   ', 8221);

    expect(link).toContain('https://wa.me/5541998765432');
  });
});
