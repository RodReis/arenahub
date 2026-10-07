import { describe, expect, it } from '@jest/globals';

import { exigirConfirmacaoDoBanco, rotuloDoBanco } from './seguranca.js';

describe('rotuloDoBanco', () => {
  it('devolve host:porta/banco sem usuario nem senha', () => {
    const r = rotuloDoBanco({ DATABASE_URL: 'postgresql://admin:S3nh4%40x@db.exemplo.test:5488/arenahub?schema=public' });

    expect(r).toBe('db.exemplo.test:5488/arenahub');
    expect(r).not.toMatch(/admin|S3nh4|@/);
  });

  it('RUNTIME_DATABASE_URL tem prioridade; vazia cai em DATABASE_URL (como o PrismaService)', () => {
    const rt = 'postgresql://u:p@localhost:5442/runtime';
    const prod = 'postgresql://u:p@prod.test:5432/railway';

    expect(rotuloDoBanco({ RUNTIME_DATABASE_URL: rt, DATABASE_URL: prod })).toBe('localhost:5442/runtime');
    expect(rotuloDoBanco({ RUNTIME_DATABASE_URL: '', DATABASE_URL: prod })).toBe('prod.test:5432/railway');
  });

  it('porta ausente vira 5432', () => {
    expect(rotuloDoBanco({ DATABASE_URL: 'postgresql://u:p@h.test/db' })).toBe('h.test:5432/db');
  });

  it('URL invalida, vazia ou sem banco e ilegivel (null), sem vazar a senha', () => {
    expect(rotuloDoBanco({ DATABASE_URL: 'isto-nao-e-url-SEGREDO' })).toBeNull();
    expect(rotuloDoBanco({})).toBeNull();
    expect(rotuloDoBanco({ DATABASE_URL: 'postgresql://u:p@h.test:5432' })).toBeNull();
  });
});

describe('exigirConfirmacaoDoBanco', () => {
  const rotulo = 'h.test:5432/db';

  it('dry-run nao exige confirmacao', () => {
    expect(() => exigirConfirmacaoDoBanco(false, rotulo, undefined)).not.toThrow();
  });

  it('--gravar com a confirmacao certa passa', () => {
    expect(() => exigirConfirmacaoDoBanco(true, rotulo, rotulo)).not.toThrow();
  });

  it('--gravar sem confirmacao ou com outra recusa e mostra o valor esperado', () => {
    expect(() => exigirConfirmacaoDoBanco(true, rotulo, undefined)).toThrow(`PADRONIZAR_CONFIRMA_BANCO=${rotulo}`);
    expect(() => exigirConfirmacaoDoBanco(true, rotulo, 'outro.test:5432/db')).toThrow(/valor diferente/);
  });
});
