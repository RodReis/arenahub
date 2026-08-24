import { globSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * NENHUM CAMPO DE CARTAO NO PAINEL (INV-098).
 *
 * ESTRUTURAL, e nao comportamental, pela mesma razao da F14
 * (`apps/api/src/modules/billing/dado-de-cartao-nao-entra-no-backend.spec.ts`):
 * o defeito a prevenir nao e "a tela se comportou errado", e "alguem
 * acrescentou um input de cartao porque era mais rapido que o checkout
 * hospedado". Teste de comportamento so pegaria isso com um cenario que
 * ninguem lembra de escrever -- ler o codigo-fonte pega no dia em que a
 * linha for escrita.
 *
 * O aluno digita o cartao NO PROPRIO CELULAR, na pagina da Getnet
 * (ADR-043, Decisao 2). Nao ha campo para proteger porque nao ha campo --
 * e e exatamente essa ausencia que esta guarda defende.
 */
const PADROES_PROIBIDOS = [
  /card_?number/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /numero-?do-?cartao/i,
  /codigo-?de-?seguranca/i,
];

/**
 * `process.cwd()` do Vitest do admin-web e a raiz do proprio pacote
 * (`apps/admin-web`), nao a raiz do monorepo -- por isso `app/**\/*.tsx`
 * casa direto, sem prefixo `apps/admin-web/`.
 */
function arquivosDoApp(): string[] {
  return globSync('app/**/*.tsx', { cwd: process.cwd() });
}

describe('dados de cartao nao entram no painel', () => {
  it('nenhum arquivo do admin-web declara campo de cartao', () => {
    const acusados: string[] = [];

    for (const arquivo of arquivosDoApp()) {
      const fonte = readFileSync(arquivo, 'utf8');
      for (const padrao of PADROES_PROIBIDOS) {
        if (padrao.test(fonte)) acusados.push(`${arquivo} — ${String(padrao)}`);
      }
    }

    expect(acusados).toEqual([]);
  });

  /*
   * A GUARDA TEM DE VER ALGUMA COISA. Guarda que varre lista vazia passa
   * verde para sempre -- e um `cwd` errado ou um glob que nao casa produz
   * exatamente isso. Foi assim que uma guarda "verde" subcontou 17 arquivos
   * (issue #111). Imprime a contagem real para o relatorio de evidencia.
   */
  it('a varredura alcanca os arquivos da tela de cobranca', () => {
    const arquivos = arquivosDoApp();

    // eslint-disable-next-line no-console -- evidencia pedida no brief da task, nao debug esquecido
    console.log(`[guarda cartao] arquivos varridos: ${arquivos.length}`);

    expect(arquivos.length).toBeGreaterThan(20);
    expect(arquivos.some((a) => a.includes('billing'))).toBe(true);
  });
});
