import { describe, expect, it } from '@jest/globals';

import type { DadosDoRelatorioImpresso } from './dados-do-relatorio.js';
import { gerarPdfDoRelatorio } from './pdf-do-relatorio.js';

/** PNG 1x1 válido. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const academia = {
  nome: 'Arena Positiva',
  razaoSocial: 'Complexo Arena Positiva LTDA',
  cnpj: '12345678000195',
  endereco: 'Rua A, 10, Curitiba - PR',
  telefone: '4133334444',
  fuso: 'America/Sao_Paulo',
  logo: null,
} as const;

function dados(n: number, extra: Partial<DadosDoRelatorioImpresso> = {}): DadosDoRelatorioImpresso {
  return {
    academia,
    filtros: ['Situação: Ativo'],
    geradoEm: new Date('2026-10-10T17:32:00.000Z'),
    total: n,
    linhas: Array.from({ length: n }, (_, i) => ({
      studentId: `id-${i}`,
      deviceIds: i % 3 === 0 ? [String(1000 + i)] : [],
      fullName: `Aluno de Teste Número ${i} com um nome bem comprido para forçar a reticência`,
      cpf: i % 2 === 0 ? '11144477735' : null,
      phone: i % 2 === 0 ? '41999990000' : null,
      planLabel: i % 5 === 0 ? null : 'Mensal Fit',
    })),
    ...extra,
  };
}

const paginas = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

describe('gerarPdfDoRelatorio', () => {
  it('gera um PDF válido', async () => {
    const pdf = await gerarPdfDoRelatorio(dados(3));

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  it('lista vazia gera uma página só (cabeçalho + títulos)', async () => {
    expect(paginas(await gerarPdfDoRelatorio(dados(0)))).toBe(1);
  });

  it('muita linha pagina: 300 alunos ocupam mais de uma página, 5 cabem em uma', async () => {
    expect(paginas(await gerarPdfDoRelatorio(dados(5)))).toBe(1);
    expect(paginas(await gerarPdfDoRelatorio(dados(300)))).toBeGreaterThan(1);
  });

  it('logo PNG entra; o PDF com logo é maior que o sem logo', async () => {
    const sem = await gerarPdfDoRelatorio(dados(3));
    const com = await gerarPdfDoRelatorio(
      dados(3, { academia: { ...academia, logo: { body: PNG_1X1, contentType: 'image/png' } } }),
    );

    expect(com.length).toBeGreaterThan(sem.length);
  });

  it('logo SVG, PNG corrompido ou tipo estranho NÃO derrubam: cai no cabeçalho de texto', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const lixo = Buffer.from('isto nao e um png');

    for (const logo of [
      { body: svg, contentType: 'image/svg+xml' },
      { body: lixo, contentType: 'image/png' },
      { body: lixo, contentType: 'application/zip' },
    ]) {
      const pdf = await gerarPdfDoRelatorio(dados(3, { academia: { ...academia, logo } }));

      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    }
  });

  it('academia sem CNPJ, endereço e telefone gera normalmente', async () => {
    const pdf = await gerarPdfDoRelatorio(
      dados(3, { academia: { ...academia, cnpj: null, endereco: null, telefone: null } }),
    );

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('volume do teto (20.000) termina em tempo razoável', async () => {
    const inicio = Date.now();
    const pdf = await gerarPdfDoRelatorio(dados(20_000));

    expect(Date.now() - inicio).toBeLessThan(30_000);
    expect(paginas(pdf)).toBeGreaterThan(500);
  }, 60_000);
});
