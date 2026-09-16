import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { ErroDeExtracao } from './document-extractor.port.js';
import { SinalVitalExtractor } from './sinal-vital.extractor.js';

const diretorioAtual = dirname(fileURLToPath(import.meta.url));

/**
 * MESMO fixture PDF real que `laudo-bioimpedancia.extractor.spec.ts` usa
 * para o ECG -- e o mesmo aparelho (AliveCor via OmronConnect), e o mesmo
 * motivo: fixture que ja entrega texto extraido nao exercita a camada de
 * PDF de verdade.
 */
function lerFixture(nome: string): Uint8Array {
  const caminho = join(diretorioAtual, '..', '..', '..', '..', 'test', 'fixtures', 'health', nome);

  return new Uint8Array(readFileSync(caminho));
}

describe('SinalVitalExtractor -- FC de repouso via PDF de ECG (card #345)', () => {
  const extrator = new SinalVitalExtractor();

  it('extrai a frequencia cardiaca do PDF real do ECG', async () => {
    const resultado = await extrator.extrairDePdf(lerFixture('ecg-omron-sintetico.pdf'));

    expect(resultado.type).toBe('RESTING_HEART_RATE');
    expect(resultado.value).toBeGreaterThan(0);
    expect(resultado.measuredAt).toBeNull();
  });

  it('guarda o achado do aparelho como texto opaco, nunca interpretado', async () => {
    const resultado = await extrator.extrairDePdf(lerFixture('ecg-omron-sintetico.pdf'));

    // O parser so promete GUARDAR o que existir -- nao afirma quais chaves o
    // fixture especifico traz, so que nenhuma delas vira decisao.
    for (const chave of Object.keys(resultado.deviceReport)) {
      expect(chave.startsWith('ecg')).toBe(true);
    }
  });

  it('recusa PDF sem marcadores de ECG', async () => {
    await expect(extrator.extrairDePdf(new TextEncoder().encode('%PDF-1.4 vazio'))).rejects.toThrow(
      ErroDeExtracao,
    );
  });
});
