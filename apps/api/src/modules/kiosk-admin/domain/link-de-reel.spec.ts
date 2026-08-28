import { describe, expect, it } from '@jest/globals';

import { aceitarLinkDeReel } from './link-de-reel.js';

describe('aceitarLinkDeReel', () => {
  it('aceita um reel e devolve a URL CANONICA, sem query', () => {
    // O link que o gerente cola vem do botao "copiar link" do app, cheio de
    // parametro de rastreamento. Guardar a URL crua faria o mesmo reel
    // parecer dois links diferentes conforme de onde foi copiado.
    const resultado = aceitarLinkDeReel(
      'https://www.instagram.com/reel/DbtoWkFR6l6/?utm_source=ig_web_copy_link&igsi=MzRl',
    );

    expect(resultado).toEqual({
      aceito: true,
      url: 'https://www.instagram.com/reel/DbtoWkFR6l6/',
      codigo: 'DbtoWkFR6l6',
    });
  });

  it('aceita link sem barra final', () => {
    expect(aceitarLinkDeReel('https://www.instagram.com/reel/DbtoWkFR6l6')).toMatchObject({
      aceito: true,
      codigo: 'DbtoWkFR6l6',
    });
  });

  it('aceita `/p/` e `/tv/` -- o Instagram serve o mesmo post por tres caminhos', () => {
    for (const caminho of ['p', 'tv', 'reels']) {
      expect(
        aceitarLinkDeReel(`https://www.instagram.com/${caminho}/DbtoWkFR6l6/`),
      ).toMatchObject({ aceito: true, codigo: 'DbtoWkFR6l6' });
    }
  });

  it('aceita sem `www`', () => {
    expect(aceitarLinkDeReel('https://instagram.com/reel/DbtoWkFR6l6/')).toMatchObject({
      aceito: true,
      codigo: 'DbtoWkFR6l6',
    });
  });

  it('normaliza para `www` -- duas formas do mesmo reel viram uma chave so', () => {
    const com = aceitarLinkDeReel('https://www.instagram.com/reel/DbtoWkFR6l6/');
    const sem = aceitarLinkDeReel('https://instagram.com/reel/DbtoWkFR6l6/');

    expect(com).toEqual(sem);
  });

  it('recusa host que nao e do Instagram', () => {
    // A URL vai para um processo que BAIXA o que ela apontar. Aceitar host
    // arbitrario transformaria o campo num buscador de URL do servidor
    // (SSRF): rede interna, metadados de nuvem, qualquer coisa alcancavel.
    expect(aceitarLinkDeReel('https://exemplo.com/reel/DbtoWkFR6l6/')).toEqual({
      aceito: false,
      motivo: 'LINK_NAO_E_DO_INSTAGRAM',
    });
  });

  it('recusa host que apenas TERMINA em instagram.com', () => {
    // `evil-instagram.com` e `instagram.com.attacker.net` passariam num
    // `includes`/`endsWith` ingenuo. A comparacao e do host INTEIRO.
    for (const host of [
      'evil-instagram.com',
      'instagram.com.attacker.net',
      'notinstagram.com',
    ]) {
      expect(aceitarLinkDeReel(`https://${host}/reel/DbtoWkFR6l6/`)).toEqual({
        aceito: false,
        motivo: 'LINK_NAO_E_DO_INSTAGRAM',
      });
    }
  });

  it('recusa esquema que nao e https', () => {
    // `file:` leria disco do servidor; `http:` desceria para texto claro.
    for (const url of [
      'http://www.instagram.com/reel/DbtoWkFR6l6/',
      'file:///etc/passwd',
      'ftp://www.instagram.com/reel/DbtoWkFR6l6/',
    ]) {
      expect(aceitarLinkDeReel(url).aceito).toBe(false);
    }
  });

  it('recusa `javascript:` sem explodir', () => {
    expect(aceitarLinkDeReel('javascript:alert(1)').aceito).toBe(false);
  });

  it('recusa URL do Instagram que nao aponta para um post', () => {
    for (const url of [
      'https://www.instagram.com/',
      'https://www.instagram.com/clinicadamusculacao/',
      'https://www.instagram.com/accounts/login/',
    ]) {
      expect(aceitarLinkDeReel(url)).toEqual({
        aceito: false,
        motivo: 'LINK_NAO_APONTA_PARA_POST',
      });
    }
  });

  it('recusa codigo com caractere fora do alfabeto do Instagram', () => {
    // O codigo vira argumento de processo externo. Restringir a
    // `[A-Za-z0-9_-]` fecha a porta para qualquer coisa que um shell ou o
    // proprio yt-dlp pudesse interpretar.
    for (const codigo of ['../../etc', 'abc;rm -rf', 'a b', '$(whoami)', 'a/b']) {
      expect(
        aceitarLinkDeReel(`https://www.instagram.com/reel/${encodeURIComponent(codigo)}/`).aceito,
      ).toBe(false);
    }
  });

  it('recusa texto que nem e URL', () => {
    for (const texto of ['', '   ', 'nao é url', 'DbtoWkFR6l6']) {
      expect(aceitarLinkDeReel(texto).aceito).toBe(false);
    }
  });

  it('ignora espaco em volta -- colar do app costuma trazer', () => {
    expect(
      aceitarLinkDeReel('  https://www.instagram.com/reel/DbtoWkFR6l6/  '),
    ).toMatchObject({ aceito: true, codigo: 'DbtoWkFR6l6' });
  });

  it('recusa credencial embutida no host', () => {
    // `https://user:senha@instagram.com@evil.com/` engana leitura humana e
    // alguns parsers. O host efetivo aqui nao e o Instagram.
    expect(
      aceitarLinkDeReel('https://www.instagram.com@evil.com/reel/DbtoWkFR6l6/').aceito,
    ).toBe(false);
  });
});
