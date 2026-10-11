import { describe, expect, it } from '@jest/globals';

import { montarCsvDoRelatorio } from './csv-do-relatorio.js';
import type { DadosDoRelatorioImpresso } from './dados-do-relatorio.js';

const BASE: DadosDoRelatorioImpresso = {
  academia: {
    nome: 'Arena Positiva',
    razaoSocial: 'Complexo Arena Positiva LTDA',
    cnpj: '12345678000195',
    endereco: 'Rua A, 10, Curitiba - PR, CEP 80000000',
    telefone: '4133334444',
    fuso: 'America/Sao_Paulo',
    logo: null,
  },
  filtros: ['Situação: Ativo'],
  geradoEm: new Date('2026-10-10T17:32:00.000Z'),
  total: 2,
  linhas: [
    {
      studentId: 'a',
      deviceIds: ['1042', '1043'],
      fullName: 'Maria da Silva',
      cpf: '11144477735',
      phone: '41999990000',
      planLabel: 'Mensal Fit',
    },
    {
      studentId: 'b',
      deviceIds: [],
      fullName: '=HYPERLINK("http://x")',
      cpf: null,
      phone: null,
      planLabel: null,
    },
  ],
};

const texto = (dados = BASE): string => montarCsvDoRelatorio(dados).toString('utf8');
const linhasDe = (dados = BASE): string[] => texto(dados).slice(1).split('\r\n');

describe('montarCsvDoRelatorio', () => {
  it('começa com BOM UTF-8 (o Excel abre os acentos certos)', () => {
    const bytes = montarCsvDoRelatorio(BASE);

    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('usa ";" e \\r\\n, com os dados da academia no topo', () => {
    expect(linhasDe().slice(0, 9)).toEqual([
      'Relatório de Alunos',
      'Arena Positiva',
      'Razão social;Complexo Arena Positiva LTDA',
      'CNPJ;12.345.678/0001-95',
      'Endereço;Rua A, 10, Curitiba - PR, CEP 80000000',
      'Telefone;(41) 3333-4444',
      'Gerado em;10/10/2026 14:32',
      'Filtros;Situação: Ativo',
      'Total de alunos;2',
    ]);
  });

  it('linha em branco, depois colunas e alunos formatados', () => {
    const linhas = linhasDe();

    expect(linhas[9]).toBe('');
    expect(linhas[10]).toBe('Catraca;Nome;CPF;Contato;Plano');
    expect(linhas[11]).toBe('1042, 1043;Maria da Silva;111.444.777-35;(41) 99999-0000;Mensal Fit');
  });

  it('aluno sem CPF, contato, plano e catraca: células vazias, nunca "null"', () => {
    // Célula com aspas internas vai entre aspas, com as internas duplicadas (RFC 4180);
    // o `'` na frente é a neutralização de fórmula.
    expect(linhasDe()[12]).toBe(`;"'=HYPERLINK(""http://x"")";;;`);
    expect(texto()).not.toMatch(/null|undefined/);
  });

  it('nome que parece fórmula é neutralizado com aspa simples', () => {
    expect(texto()).toContain(`'=HYPERLINK(`);
  });

  it('sem filtro escreve "Nenhum"; sem CNPJ/endereço/telefone deixa o valor vazio', () => {
    const sem = texto({
      ...BASE,
      filtros: [],
      academia: { ...BASE.academia, cnpj: null, endereco: null, telefone: null },
    });

    expect(sem).toContain('Filtros;Nenhum');
    expect(sem).toContain('CNPJ;\r\n');
    expect(sem).toContain('Endereço;\r\n');
    expect(sem).toContain('Telefone;\r\n');
  });
});
