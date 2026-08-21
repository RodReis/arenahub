import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { LaudoBioimpedanciaExtractor } from './laudo-bioimpedancia.extractor.js';

const diretorioAtual = dirname(fileURLToPath(import.meta.url));

/**
 * Fixtures ficam em `test/fixtures/health` (fora de `src`, fora do
 * `testMatch` do jest) porque sao dado, nao codigo de teste -- mesma
 * convencao que os demais dublês de arquivo do modulo `health`.
 *
 * `tipo: 'PDF'` no teste de ECG segue a Ruling 1 do task-6-brief: o ECG real
 * chega como PDF (OmronConnect), nunca `TXT` -- `TipoDeArquivo` nao ganha um
 * valor novo por causa de um fixture de teste. O `.txt` do fixture representa
 * o texto ja extraido da camada de texto do PDF (`pdftotext`, ADR-035 decisao
 * 8), nao um upload de verdade.
 */
function lerFixture(nome: string): Uint8Array {
  const caminho = join(diretorioAtual, '..', '..', '..', '..', 'test', 'fixtures', 'health', nome);

  return new Uint8Array(readFileSync(caminho));
}

describe('extrator de laudo de bioimpedancia', () => {
  const extrator = new LaudoBioimpedanciaExtractor();

  it('le os segmentares com faixa e percentual do padrao', async () => {
    const r = await extrator.extrair({
      tipo: 'CSV',
      conteudo: lerFixture('laudo-cf610g-sintetico.csv'),
    });
    const tronco = r.campos.find((c) => c.type === 'SEGMENTAL_FAT_MASS_TRUNK');

    expect(tronco?.value).toBeCloseTo(10.4, 2);
    expect(tronco?.standardPercent).toBeCloseTo(230.1, 1);
  });

  it('guarda faixa de referencia junto do campo', async () => {
    const r = await extrator.extrair({
      tipo: 'CSV',
      conteudo: lerFixture('laudo-cf610g-sintetico.csv'),
    });
    const peso = r.campos.find((c) => c.type === 'WEIGHT');

    expect(peso?.referenceMin).toBeCloseTo(60.6, 1);
    expect(peso?.referenceMax).toBeCloseTo(82.0, 1);
  });

  it('classifica o laudo e rotula a origem', async () => {
    const r = await extrator.extrair({
      tipo: 'CSV',
      conteudo: lerFixture('laudo-cf610g-sintetico.csv'),
    });

    expect(r.tipoDeLaudo).toBe('BIOIMPEDANCE');
    expect(r.sourceLabel).toBe('CF610_G');
  });

  it('le bpm do ECG como MEDIDA e o achado como ATRIBUTO', async () => {
    const r = await extrator.extrair({
      tipo: 'PDF',
      conteudo: lerFixture('ecg-omron-sintetico.txt'),
    });

    expect(r.campos.find((c) => c.type === 'HEART_RATE')?.value).toBe(92);
    expect(r.atributos?.['ecgFinding']).toBe('Ritmo nao classificado');
    expect(r.atributos?.['ecgTags']).toEqual(['Atividade:Alta']);
    expect(r.tipoDeLaudo).toBe('ECG');
  });

  it('NAO transforma indice do fabricante em medida', async () => {
    const r = await extrator.extrair({
      tipo: 'CSV',
      conteudo: lerFixture('laudo-unique-health-sintetico.csv'),
    });

    // Idade corporal, pontuacao e peso ideal sao atributos (spec §4.4):
    // formula proprietaria muda com firmware e produziria tendencia falsa.
    expect(r.campos.some((c) => String(c.type).includes('BODY_AGE'))).toBe(false);
  });
});
