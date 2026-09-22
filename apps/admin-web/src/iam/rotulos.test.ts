import { describe, expect, it } from 'vitest';

import { ordenarPerfis, rotuloDePerfil } from './rotulos';

describe('rótulos de perfil', () => {
  it('traduz os cinco perfis de sistema', () => {
    expect(rotuloDePerfil('OWNER')).toBe('Dono');
    expect(rotuloDePerfil('MANAGER')).toBe('Gerente');
    expect(rotuloDePerfil('FINANCE')).toBe('Financeiro');
    expect(rotuloDePerfil('RECEPTION')).toBe('Recepção');
    expect(rotuloDePerfil('TRAINER')).toBe('Professor');
  });

  it('devolve o código cru quando o papel é desconhecido', () => {
    // Papel herdado de antes da F80: mostrar o código é melhor que vazio.
    expect(rotuloDePerfil('SUPERVISOR')).toBe('SUPERVISOR');
  });
});

describe('ordem dos perfis no combo', () => {
  /**
   * A ORDEM DA API É ALFABÉTICA PELO CÓDIGO EM INGLÊS, e é justamente essa
   * que não serve: `GET /roles` faz `orderBy: { name: 'asc' }`, o que produz
   * FINANCE, MANAGER, OWNER, RECEPTION, TRAINER -- e deixa "Financeiro" como
   * padrão do combo.
   */
  const comoAApiDevolve = [
    { name: 'FINANCE' },
    { name: 'MANAGER' },
    { name: 'OWNER' },
    { name: 'RECEPTION' },
    { name: 'TRAINER' },
  ];

  it('vai do mais amplo ao mais estreito', () => {
    expect(ordenarPerfis(comoAApiDevolve).map((p) => p.name)).toEqual([
      'OWNER',
      'MANAGER',
      'FINANCE',
      'RECEPTION',
      'TRAINER',
    ]);
  });

  it('o primeiro é o Dono -- é ele que o combo pré-seleciona', () => {
    expect(ordenarPerfis(comoAApiDevolve)[0]?.name).toBe('OWNER');
  });

  it('papel desconhecido vai para o fim, nunca para o começo', () => {
    // Perfil herdado é exceção, não a primeira escolha de quem convida.
    const comHerdado = [{ name: 'SUPERVISOR' }, ...comoAApiDevolve];

    expect(ordenarPerfis(comHerdado).at(-1)?.name).toBe('SUPERVISOR');
  });

  it('não altera o array recebido', () => {
    const original = [...comoAApiDevolve];

    ordenarPerfis(comoAApiDevolve);

    expect(comoAApiDevolve).toEqual(original);
  });
});
