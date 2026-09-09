import { describe, expect, it } from '@jest/globals';

import {
  TAMANHO_MAXIMO_DE_IDENTIDADE_BYTES,
  aceitarArquivoDeIdentidade,
  chaveDeIdentidadePertenceA,
  montarChaveDeIdentidade,
  svgTemConteudoExecutavel,
} from './identidade-visual.js';

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function png(tamanho = 64): Uint8Array {
  const buffer = new Uint8Array(tamanho);

  ASSINATURA_PNG.forEach((byte, indice) => {
    buffer[indice] = byte;
  });

  return buffer;
}

function svg(conteudo: string): Uint8Array {
  return new Uint8Array(Buffer.from(conteudo, 'utf-8'));
}

const SVG_LIMPO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

describe('svgTemConteudoExecutavel', () => {
  it('aceita vetor sem script', () => {
    expect(svgTemConteudoExecutavel(SVG_LIMPO)).toBe(false);
  });

  it('recusa <script>', () => {
    expect(svgTemConteudoExecutavel('<svg><script>alert(1)</script></svg>')).toBe(true);
  });

  /**
   * ESPACO ENTRE `<` E O NOME DA TAG e a evasao classica de filtro que so
   * procura a string literal. O navegador aceita; um filtro por `'<script'`
   * nao pega.
   */
  it('recusa <script> com espaco depois do sinal de menor', () => {
    expect(svgTemConteudoExecutavel('<svg>< script >alert(1)</script></svg>')).toBe(true);
  });

  it('recusa handler on*', () => {
    expect(svgTemConteudoExecutavel('<svg onload="alert(1)"></svg>')).toBe(true);
  });

  /**
   * `onload = ` com espaco antes do igual e XML valido, e ja foi usado para
   * escapar de filtro que exigia `on...=` grudado.
   */
  it('recusa handler on* com espaco antes do igual', () => {
    expect(svgTemConteudoExecutavel('<svg onload = "alert(1)"></svg>')).toBe(true);
  });

  it('recusa <foreignObject>', () => {
    expect(
      svgTemConteudoExecutavel('<svg><foreignObject><iframe src="x"/></foreignObject></svg>'),
    ).toBe(true);
  });

  it('recusa javascript: em href', () => {
    expect(svgTemConteudoExecutavel('<svg><a href="javascript:alert(1)">x</a></svg>')).toBe(true);
  });

  it('recusa <use> que puxa conteudo externo', () => {
    expect(svgTemConteudoExecutavel('<svg><use href="https://mau.example/x.svg#a"/></svg>')).toBe(
      true,
    );
  });

  /**
   * ATRIBUTO LEGITIMO NAO PODE CASAR com o padrao de handler. Sem este teste
   * o padrao `on[a-z]+=` poderia ser afrouxado ate recusar todo SVG que tem
   * `version=` ou `font-size=` -- e a recusa de tudo passa despercebida numa
   * suite que so testa payload malicioso.
   */
  it('nao confunde atributo comum com handler', () => {
    expect(
      svgTemConteudoExecutavel('<svg version="1.1" font-size="12" transform="none"></svg>'),
    ).toBe(false);
  });
});

describe('aceitarArquivoDeIdentidade', () => {
  it('aceita SVG limpo', () => {
    expect(
      aceitarArquivoDeIdentidade({ conteudo: svg(SVG_LIMPO), contentType: 'image/svg+xml' }),
    ).toEqual({ aceito: true });
  });

  it('aceita PNG', () => {
    expect(aceitarArquivoDeIdentidade({ conteudo: png(), contentType: 'image/png' })).toEqual({
      aceito: true,
    });
  });

  /** O aceite da issue #285, em uma linha. */
  it('recusa SVG com <script>', () => {
    expect(
      aceitarArquivoDeIdentidade({
        conteudo: svg('<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/roubo")</script></svg>'),
        contentType: 'image/svg+xml',
      }),
    ).toEqual({ aceito: false, motivo: 'SVG_UNSAFE_CONTENT' });
  });

  /**
   * O CAMINHO DE FUGA OBVIO: declarar `image/png` e enviar o SVG com script.
   * Sem a checagem de assinatura, o arquivo pularia a sanitizacao inteira --
   * e seria servido depois com o `content-type` gravado, que e o declarado.
   */
  it('recusa SVG disfarcado de PNG', () => {
    expect(
      aceitarArquivoDeIdentidade({
        conteudo: svg('<svg><script>alert(1)</script></svg>'),
        contentType: 'image/png',
      }),
    ).toEqual({ aceito: false, motivo: 'FILE_SIGNATURE_MISMATCH' });
  });

  it('recusa PNG disfarcado de SVG', () => {
    expect(
      aceitarArquivoDeIdentidade({ conteudo: png(), contentType: 'image/svg+xml' }),
    ).toEqual({ aceito: false, motivo: 'FILE_SIGNATURE_MISMATCH' });
  });

  it('recusa tipo fora da lista', () => {
    expect(
      aceitarArquivoDeIdentidade({ conteudo: png(), contentType: 'image/webp' }),
    ).toEqual({ aceito: false, motivo: 'FILE_TYPE_NOT_ALLOWED' });
  });

  it('recusa arquivo vazio', () => {
    expect(
      aceitarArquivoDeIdentidade({ conteudo: new Uint8Array(0), contentType: 'image/png' }),
    ).toEqual({ aceito: false, motivo: 'FILE_EMPTY' });
  });

  it('recusa acima do teto', () => {
    expect(
      aceitarArquivoDeIdentidade({
        conteudo: png(TAMANHO_MAXIMO_DE_IDENTIDADE_BYTES + 1),
        contentType: 'image/png',
      }),
    ).toEqual({ aceito: false, motivo: 'FILE_TOO_LARGE' });
  });

  it('aceita exatamente no teto', () => {
    expect(
      aceitarArquivoDeIdentidade({
        conteudo: png(TAMANHO_MAXIMO_DE_IDENTIDADE_BYTES),
        contentType: 'image/png',
      }),
    ).toEqual({ aceito: true });
  });

  /**
   * O `<script>` NA ULTIMA LINHA e o motivo de a funcao receber o conteudo
   * inteiro, e nao so o cabecalho como o logotipo do patrocinador. Uma
   * checagem de N primeiros bytes deixaria passar exatamente este arquivo.
   */
  it('recusa script depois de muito conteudo limpo', () => {
    const enchimento = '<path d="M0 0h1v1H0z"/>'.repeat(2000);

    expect(
      aceitarArquivoDeIdentidade({
        conteudo: svg(`<svg xmlns="http://www.w3.org/2000/svg">${enchimento}<script>alert(1)</script></svg>`),
        contentType: 'image/svg+xml',
      }),
    ).toEqual({ aceito: false, motivo: 'SVG_UNSAFE_CONTENT' });
  });
});

describe('montarChaveDeIdentidade', () => {
  it('poe a peca e a extensao sob o prefixo do tenant', () => {
    expect(montarChaveDeIdentidade('t1', 'icon', 'image/svg+xml')).toBe(
      'tenants/t1/branding/icon.svg',
    );
    expect(montarChaveDeIdentidade('t1', 'logo', 'image/png')).toBe(
      'tenants/t1/branding/logo.png',
    );
  });

  it('reconhece a propria chave como pertencente ao tenant', () => {
    expect(chaveDeIdentidadePertenceA(montarChaveDeIdentidade('t1', 'logo', 'image/png'), 't1')).toBe(
      true,
    );
  });

  /**
   * A checagem de pertencimento e o que impede servir a BIOMETRIA de um aluno
   * por esta rota publica -- ela mora sob `tenants/{id}/biometrics/`, no mesmo
   * bucket. Sem ela, bastaria a coluna do tenant guardar aquela chave.
   */
  it('recusa chave de outro diretorio do mesmo tenant', () => {
    expect(chaveDeIdentidadePertenceA('tenants/t1/biometrics/aluno/enrollment', 't1')).toBe(false);
  });

  it('recusa chave de outro tenant', () => {
    expect(chaveDeIdentidadePertenceA('tenants/t2/branding/logo.png', 't1')).toBe(false);
  });

  /**
   * Sem a barra final no prefixo, `tenants/t1/branding` casaria com
   * `tenants/t1/branding-antigo` -- e o "diretorio" deixaria de ser diretorio.
   */
  it('recusa diretorio vizinho de nome parecido', () => {
    expect(chaveDeIdentidadePertenceA('tenants/t1/branding-antigo/logo.png', 't1')).toBe(false);
  });
});
