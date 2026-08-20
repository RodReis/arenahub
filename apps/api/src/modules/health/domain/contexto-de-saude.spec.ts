import { describe, expect, it } from '@jest/globals';

import {
  FATORES,
  type FatorDeContexto,
  analiseBloqueada,
  avisosSuprimidos,
  suprime,
} from './contexto-de-saude.js';

/**
 * ADR-037: cada fator SUPRIME um aviso especifico, de forma deterministica.
 *
 * O PRD e explicito: "fator novo entra por PR **com o teste que prova o que
 * ele suprime**. Sem teste, nao entra." Este arquivo e esse teste, e o ultimo
 * bloco falha quando alguem acrescenta fator sem cobrir o efeito.
 */
describe('suprime', () => {
  it('creatina suprime agua intracelular alta, e so ela', () => {
    expect(suprime(['SUPLEMENTACAO_CREATINA'], 'INTRACELLULAR_WATER_HIGH')).toBe(true);
    expect(suprime(['SUPLEMENTACAO_CREATINA'], 'LEAN_BODY_MASS_HIGH')).toBe(false);
  });

  it('composicao atipica suprime compartimento ABSOLUTO e mantem RAZAO', () => {
    // O caso real do laudo de 03/08/2026: 69,7 kg de massa livre de gordura
    // contra faixa de 52,0-64,8 do aparelho. Seis campos saem "acima" e
    // nenhum significa o que o aparelho sugere.
    expect(suprime(['COMPOSICAO_ATIPICA'], 'LEAN_BODY_MASS_HIGH')).toBe(true);
    expect(suprime(['COMPOSICAO_ATIPICA'], 'TOTAL_BODY_WATER_HIGH')).toBe(true);
    expect(suprime(['COMPOSICAO_ATIPICA'], 'PROTEIN_MASS_HIGH')).toBe(true);
    expect(suprime(['COMPOSICAO_ATIPICA'], 'MINERAL_MASS_HIGH')).toBe(true);

    // Razao entre compartimentos continua valendo: e justamente ela que
    // sobrevive quando o tamanho absoluto e atipico.
    expect(suprime(['COMPOSICAO_ATIPICA'], 'WATER_RATIO_ABNORMAL')).toBe(false);
  });

  it('edema e diuretico invalidam a leitura de agua, e nao mexem no resto', () => {
    for (const fator of ['EDEMA_RELATADO', 'USO_DE_DIURETICO'] as const) {
      expect(suprime([fator], 'TOTAL_BODY_WATER_HIGH')).toBe(true);
      expect(suprime([fator], 'INTRACELLULAR_WATER_HIGH')).toBe(true);
      expect(suprime([fator], 'EXTRACELLULAR_WATER_HIGH')).toBe(true);
      expect(suprime([fator], 'WATER_RATIO_ABNORMAL')).toBe(true);

      expect(suprime([fator], 'BODY_FAT_PERCENT_HIGH')).toBe(false);
      expect(suprime([fator], 'LEAN_BODY_MASS_HIGH')).toBe(false);
    }
  });

  it('atleta suprime comparacao com faixa populacional e mantem a com o proprio historico', () => {
    expect(suprime(['ATLETA_COMPETITIVO'], 'POPULATION_RANGE_COMPARISON')).toBe(true);
    expect(suprime(['ATLETA_COMPETITIVO'], 'PERSONAL_HISTORY_COMPARISON')).toBe(false);
  });

  it('gestante nao suprime aviso -- ela bloqueia a analise inteira', () => {
    expect(suprime(['GESTANTE_OU_POS_PARTO'], 'BODY_FAT_PERCENT_HIGH')).toBe(false);
  });

  it('acumula supressao de fatores simultaneos', () => {
    const fatores: FatorDeContexto[] = ['SUPLEMENTACAO_CREATINA', 'ATLETA_COMPETITIVO'];

    expect(suprime(fatores, 'INTRACELLULAR_WATER_HIGH')).toBe(true);
    expect(suprime(fatores, 'POPULATION_RANGE_COMPARISON')).toBe(true);
    expect(suprime(fatores, 'BODY_FAT_PERCENT_HIGH')).toBe(false);
  });

  it('sem fator, nada e suprimido', () => {
    expect(suprime([], 'INTRACELLULAR_WATER_HIGH')).toBe(false);
    expect(avisosSuprimidos([])).toEqual([]);
  });
});

describe('analiseBloqueada', () => {
  it('gestante ou pos-parto bloqueia: a avaliacao e registrada, nao interpretada', () => {
    expect(analiseBloqueada(['GESTANTE_OU_POS_PARTO'])).toBe(true);
    expect(analiseBloqueada(['COMPOSICAO_ATIPICA', 'GESTANTE_OU_POS_PARTO'])).toBe(true);
  });

  it('nenhum outro fator bloqueia', () => {
    expect(analiseBloqueada(['COMPOSICAO_ATIPICA', 'ATLETA_COMPETITIVO'])).toBe(false);
    expect(analiseBloqueada([])).toBe(false);
  });
});

/**
 * A guarda que faz o "sem teste, nao entra" do ADR-037 valer sozinho.
 *
 * Fator novo no enum sem efeito declarado reprova aqui -- e nao ha como
 * satisfazer esta guarda sem escrever o efeito, nem o teste dele.
 */
describe('cobertura do ADR-037', () => {
  it('todo fator declara efeito -- supressao ou bloqueio', () => {
    for (const fator of FATORES) {
      const temEfeito = avisosSuprimidos([fator]).length > 0 || analiseBloqueada([fator]);

      expect(temEfeito).toBe(true);
    }
  });

  it('a lista fechada e exatamente a do ADR-037', () => {
    expect([...FATORES].sort()).toEqual(
      [
        'ATLETA_COMPETITIVO',
        'COMPOSICAO_ATIPICA',
        'EDEMA_RELATADO',
        'GESTANTE_OU_POS_PARTO',
        'SUPLEMENTACAO_CREATINA',
        'USO_DE_DIURETICO',
      ].sort(),
    );
  });
});
