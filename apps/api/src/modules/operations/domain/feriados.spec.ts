import { describe, expect, it } from '@jest/globals';

import { feriadosDoMes, feriadosNacionais, type FeriadoDoCalendario } from './feriados.js';

describe('feriadosNacionais', () => {
  it('traz os feriados de lei do ano', () => {
    const datas = feriadosNacionais(2026).map((f) => f.data);

    expect(datas).toContain('2026-01-01'); // Ano Novo
    expect(datas).toContain('2026-09-07'); // Independencia
    expect(datas).toContain('2026-12-25'); // Natal
  });

  /*
   * Carnaval e Corpus Christi sao `bank` na biblioteca, nao `public`. Filtrar
   * so por `public` -- que e o que se faz por reflexo -- deixaria de fora
   * justamente os dias em que a recepcao mais recebe a pergunta.
   */
  it('inclui Carnaval e Corpus Christi, que a biblioteca marca como bancarios', () => {
    const datas = feriadosNacionais(2026).map((f) => f.data);

    expect(datas).toContain('2026-02-16'); // Carnaval, segunda
    expect(datas).toContain('2026-02-17'); // Carnaval, terca
    expect(datas).toContain('2026-06-04'); // Corpus Christi
  });

  /*
   * Dia de Eleicao vem como `public`, igual ao Natal, e academia abre nesse
   * dia. So existe em ano PAR -- entao um filtro errado passa despercebido
   * metade dos anos.
   */
  it('exclui Dia de Eleicao, que e publico mas nao fecha academia', () => {
    const nomes = feriadosNacionais(2026).map((f) => f.nome);

    expect(nomes.some((nome) => /elei/i.test(nome))).toBe(false);
  });

  it('nao traz data comemorativa: Dia das Maes e dos Namorados nao fecham nada', () => {
    const nomes = feriadosNacionais(2026).map((f) => f.nome);

    expect(nomes.some((nome) => /M[ãa]es|Namorados|P[áa]scoa/i.test(nome))).toBe(false);
  });

  it('devolve em ordem de data', () => {
    const datas = feriadosNacionais(2026).map((f) => f.data);

    expect(datas).toEqual([...datas].sort());
  });

  it('resolve as datas moveis por ano -- Carnaval nao cai no mesmo dia', () => {
    const carnavalDe = (ano: number): string | undefined =>
      feriadosNacionais(ano).find((f) => /carnaval/i.test(f.nome))?.data;

    expect(carnavalDe(2026)).not.toBe(carnavalDe(2027));
    expect(carnavalDe(2027)).toBeDefined();
  });
});

describe('feriadosDoMes', () => {
  const municipal = (data: string, nome: string): FeriadoDoCalendario => ({
    data,
    nome,
    origem: 'MUNICIPAL',
  });

  it('junta nacional e municipal do mes, em ordem', () => {
    const lista = feriadosDoMes('2026-12', [municipal('2026-12-08', 'Aniversario da cidade')]);

    expect(lista.map((f) => f.data)).toEqual(['2026-12-08', '2026-12-25']);
    expect(lista.map((f) => f.origem)).toEqual(['MUNICIPAL', 'NACIONAL']);
  });

  it('ignora municipal de outro mes', () => {
    const lista = feriadosDoMes('2026-12', [municipal('2026-11-30', 'Fora do mes')]);

    expect(lista.map((f) => f.data)).toEqual(['2026-12-25']);
  });

  it('municipal na mesma data vence o nacional, sem duplicar o dia', () => {
    const lista = feriadosDoMes('2026-12', [municipal('2026-12-25', 'Natal -- fechado o dia todo')]);

    expect(lista).toHaveLength(1);
    expect(lista[0]?.origem).toBe('MUNICIPAL');
    expect(lista[0]?.nome).toBe('Natal -- fechado o dia todo');
  });

  it('mes sem municipal cadastrado devolve so os nacionais', () => {
    expect(feriadosDoMes('2026-09', []).map((f) => f.data)).toEqual(['2026-09-07']);
  });

  it('mes sem feriado nenhum devolve lista vazia', () => {
    expect(feriadosDoMes('2026-08', [])).toEqual([]);
  });
});
