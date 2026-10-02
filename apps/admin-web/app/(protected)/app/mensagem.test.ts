import { describe, expect, it } from 'vitest';

import { MENSAGEM_PADRAO, linkDoWhatsApp, montarMensagem, normalizarQuebras } from './mensagem';

const DADOS = { link: 'https://arenahub.up.railway.app/baixar/arena', academia: 'Arena Positiva' };

describe('montarMensagem (#538)', () => {
  it('sem texto proprio usa o padrao, com link e academia trocados', () => {
    const mensagem = montarMensagem(null, DADOS);

    expect(mensagem).toContain('Arena Positiva');
    expect(mensagem).toContain(DADOS.link);
    expect(mensagem).not.toMatch(/\{link\}|\{academia\}/);
  });

  it('o padrao explica os tres passos: baixar, permitir e entrar com CPF', () => {
    expect(MENSAGEM_PADRAO).toMatch(/permit/i);
    expect(MENSAGEM_PADRAO).toMatch(/CPF/);
  });

  it('troca TODAS as ocorrencias dos marcadores no texto proprio', () => {
    expect(montarMensagem('{academia}: {link} -- {link}', DADOS)).toBe(
      `Arena Positiva: ${DADOS.link} -- ${DADOS.link}`,
    );
  });

  it('texto proprio vazio ou so com espacos volta ao padrao', () => {
    expect(montarMensagem('   ', DADOS)).toBe(montarMensagem(null, DADOS));
  });

  it('texto sem {link} ganha o link no fim -- mensagem sem link nao serve', () => {
    expect(montarMensagem('Baixe o app da {academia}!', DADOS)).toBe(
      `Baixe o app da Arena Positiva!\n\n${DADOS.link}`,
    );
  });
});

describe('linkDoWhatsApp', () => {
  it('codifica a mensagem inteira no wa.me', () => {
    const url = new URL(linkDoWhatsApp('Olá & bem-vindo\nlinha 2'));

    expect(url.origin).toBe('https://wa.me');
    expect(url.searchParams.get('text')).toBe('Olá & bem-vindo\nlinha 2');
  });
});

describe('normalizarQuebras (#538, revisao)', () => {
  it('o \r\n que o navegador manda no textarea vira \n', () => {
    expect(normalizarQuebras('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('o padrao enviado pelo formulario (com \r\n) e reconhecido como padrao', () => {
    expect(normalizarQuebras(MENSAGEM_PADRAO.replaceAll('\n', '\r\n'))).toBe(MENSAGEM_PADRAO);
  });
});
