import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

/**
 * INV-098 -- tokenizacao HOSPEDADA. PAN, CVV e trilha nunca passam pelo
 * backend. `M2-FR-011`: "tokenizar cartao fora da infraestrutura ArenaHub".
 *
 * POR QUE ESTE TESTE E ESTRUTURAL, e nao um caso de uso montando cenario: o
 * defeito que ele previne nao e "o dado vazou" -- e "alguem chamou o endpoint
 * errado do provedor". A Getnet expoe DOIS caminhos de tokenizacao (ADR-032):
 *
 *   - `POST /v1/tokens/card` chamado pelo BACKEND, que recebe `card_number`
 *     cru -- e joga o `apps/api` inteiro para dentro do escopo do PCI DSS;
 *   - Get Checkout / iframe / SDK no CLIENTE, em que o dado vai do navegador
 *     do aluno direto para o provedor e o backend recebe so o token.
 *
 * O primeiro e mais FACIL de implementar -- uma chamada HTTP, sem front. E
 * por isso que ele e o risco real: nao se chega nele por descuido, chega-se
 * por atalho. Um teste de comportamento so pegaria depois que o dado ja
 * estivesse trafegando; ler o codigo-fonte pega no dia em que a linha for
 * escrita.
 *
 * QUANDO ESTE TESTE FALHAR, a correcao quase nunca e edita-lo: e tirar o dado
 * de cartao do backend. Se algum dia houver motivo real para o contrario, ele
 * exige ADR novo aprovado pelo PI e certificacao PCI DSS de verdade -- nao um
 * `eslint-disable` e um commit de sexta-feira.
 */

const RAIZ_DO_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Identificadores que so existem quando dado de cartao entrou no processo.
 *
 * `numeroDoCartao` e `cardNumber` cobrem os dois idiomas do repositorio
 * (dominio em ingles, mas nem todo autor acerta de primeira). `pan` esta
 * ancorado para nao casar `panel`, `expandir` ou `company` -- regra que casa
 * palavra comum vira ruido, e ruido faz o time desligar a guarda.
 */
const BLOCO_DE_COMENTARIO = new RegExp(String.raw`/\*[\s\S]*?\*/`, 'g');
const LINHA_DE_COMENTARIO = new RegExp(String.raw`//.*`, "g");

const PROIBIDOS: ReadonlyArray<{ nome: string; padrao: RegExp }> = [
  { nome: 'cardNumber', padrao: /\bcard_?[Nn]umber\b/ },
  { nome: 'numeroDoCartao', padrao: /\bnumeroDoCartao\b/ },
  { nome: 'PAN', padrao: /\b[Pp][Aa][Nn]\b/ },
  { nome: 'CVV', padrao: /\b[Cc][Vv][Vv]\b/ },
  { nome: 'CVC', padrao: /\b[Cc][Vv][Cc]\b/ },
  { nome: 'securityCode', padrao: /\bsecurity_?[Cc]ode\b/ },
  { nome: 'cardHolder', padrao: /\bcard_?[Hh]older\b/ },
];

/**
 * Todo arquivo de PRODUCAO do `apps/api`, recursivamente.
 *
 * O escopo e a API inteira, nao so o modulo de billing: o dia em que alguem
 * receber cartao num controller de outro modulo, a guarda tem de pegar. Os
 * `.spec.ts` ficam de fora porque ESTE arquivo cita os termos proibidos --
 * incluir a si mesmo faria a guarda falhar sempre.
 */
/**
 * Remove comentarios antes de procurar os termos.
 *
 * DESCOBERTO ESCREVENDO ESTA GUARDA: sem isto ela acusa o proprio
 * `payment-provider.port.ts`, cujo comentario diz "PAN e CVV nunca chegam
 * aqui" -- ou seja, reprova a DOCUMENTACAO da regra que ela existe para
 * defender. O efeito pratico seria pior que inutil: para calar a guarda,
 * alguem apagaria justamente a frase que ensina a proxima pessoa a nao
 * receber dado de cartao.
 *
 * O que importa e o CODIGO. Um identificador chamado `cardNumber` recebe
 * dado; a palavra "PAN" numa frase em portugues nao recebe nada.
 */
function semComentarios(conteudo: string): string {
  const semBlocos = conteudo.replace(BLOCO_DE_COMENTARIO, ' ');
  return semBlocos.replace(LINHA_DE_COMENTARIO, ' ');
}

function arquivosDeProducao(pasta: string = RAIZ_DO_SRC): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);

    if (entrada.isDirectory()) {
      return entrada.name === 'generated' ? [] : arquivosDeProducao(caminho);
    }

    return entrada.name.endsWith('.ts') && !entrada.name.endsWith('.spec.ts') ? [caminho] : [];
  });
}

describe('INV-098 -- dado de cartao nao entra no backend', () => {
  it('encontra arquivos de producao para inspecionar', () => {
    /**
     * Sem esta assercao, uma pasta renomeada faria os casos abaixo passarem
     * por VACUIDADE -- verde por nao ter olhado nada, que e a pior forma de
     * uma guarda falhar.
     */
    expect(arquivosDeProducao().length).toBeGreaterThan(50);
  });

  it.each(PROIBIDOS)('nenhum arquivo do apps/api menciona $nome', ({ padrao }) => {
    const ofensores = arquivosDeProducao().filter((caminho) =>
      padrao.test(semComentarios(readFileSync(caminho, 'utf8'))),
    );

    expect(ofensores).toEqual([]);
  });

  it('a guarda REPROVA de fato quando o termo aparece', () => {
    /**
     * Testa o teste. Uma guarda que nunca foi vista falhando e
     * indistinguivel de uma guarda quebrada -- foi assim que o relatorio de
     * evidencia subcontou 17 arquivos com o self-check verde (issue #111).
     */
    const trecho = 'const cardNumber = requisicao.body.cardNumber;';

    expect(PROIBIDOS.some(({ padrao }) => padrao.test(trecho))).toBe(true);
  });

  it('nao acusa o comentario que ENSINA a regra', () => {
    /**
     * O `payment-provider.port.ts` diz, em comentario: "PAN e CVV nunca
     * chegam aqui". Acusar essa frase faria a saida mais barata ser apagar a
     * documentacao da regra -- exatamente o contrario do que a guarda quer.
     */
    const soComentario = '/** Token da tokenizacao HOSPEDADA. PAN e CVV nunca chegam aqui. */';

    expect(PROIBIDOS.every(({ padrao }) => !padrao.test(semComentarios(soComentario)))).toBe(true);
  });

  it('mas acusa o mesmo termo quando ele e CODIGO na linha seguinte', () => {
    const codigoDepoisDoComentario = [
      '// PAN nunca chega aqui',
      'const cardNumber = requisicao.body.cardNumber;',
    ].join(String.fromCharCode(10));

    expect(
      PROIBIDOS.some(({ padrao }) => padrao.test(semComentarios(codigoDepoisDoComentario))),
    ).toBe(true);
  });

  it('nao acusa palavra comum que apenas contem os termos', () => {
    /**
     * `panel`, `expandir` e `company` contem "pan"; `cvcSomething` nao
     * existe, mas `Panel` aparece em nome de componente. Guarda que grita
     * com falso positivo e desligada pelo time -- e ai nao guarda nada.
     */
    const inocente = 'const painel = expandirCompany(panelDeControle);';

    expect(PROIBIDOS.every(({ padrao }) => !padrao.test(inocente))).toBe(true);
  });
});
