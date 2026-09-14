import { nomeParaExibir } from './nome.js';

describe('nomeParaExibir', () => {
  it('tira o cadastro da caixa alta e mantem as particulas minusculas', () => {
    expect(nomeParaExibir('ANA FLAVIA DA SILVA DOS SANTOS')).toBe('Ana Flavia da Silva dos Santos');
  });

  it('preserva acento e nao mexe na primeira palavra mesmo se for particula', () => {
    expect(nomeParaExibir('  ÉRICA   DE  sá ')).toBe('Érica de Sá');
    expect(nomeParaExibir('DA')).toBe('Da');
  });
});
