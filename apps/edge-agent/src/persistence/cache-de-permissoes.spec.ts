import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { CacheDePermissoes, type PermissaoEmCache } from './cache-de-permissoes.js';

const AGORA = new Date('2026-08-14T12:00:00.000Z');
const UM_DIA = 24 * 60 * 60 * 1000;

function permissao(id: string, validaAte: Date | null = null): PermissaoEmCache {
  return { externalEnrollId: id, validaAte, sincronizadoEm: AGORA };
}

describe('CacheDePermissoes', () => {
  let dir: string;
  let caminho: string;
  let cache: CacheDePermissoes;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arenahub-cache-'));
    caminho = join(dir, 'cache.sqlite');
    cache = new CacheDePermissoes(caminho);
  });

  afterEach(() => {
    cache.fechar();
    rmSync(dir, { recursive: true, force: true });
  });

  it('guarda e devolve permissao', () => {
    cache.substituirPor([permissao('100000000001')], AGORA);

    expect(cache.buscar('100000000001')?.externalEnrollId).toBe('100000000001');
    expect(cache.buscar('999999999999')).toBeNull();
  });

  it('substituir troca o cache inteiro, nao acumula', () => {
    // A nuvem manda o estado completo. Somar deixaria no cache quem a nuvem
    // ja removeu -- ou seja, permissao que nao existe mais.
    cache.substituirPor([permissao('100000000001'), permissao('100000000002')], AGORA);
    cache.substituirPor([permissao('100000000003')], AGORA);

    expect(cache.total).toBe(1);
    expect(cache.buscar('100000000001')).toBeNull();
  });

  it('preserva a validade individual da permissao', () => {
    const ate = new Date(AGORA.getTime() + UM_DIA);
    cache.substituirPor([permissao('100000000001', ate)], AGORA);

    expect(cache.buscar('100000000001')?.validaAte?.toISOString()).toBe(ate.toISOString());
  });

  it('ultimoAllowEm sobrevive ao reinicio — senao a anti-repique some', () => {
    // Sem isso, reiniciar o agente no meio de uma passagem permitiria a
    // segunda liberacao que a F3 barra.
    cache.substituirPor([permissao('100000000001')], AGORA);
    cache.registrarAllow('100000000001', AGORA);
    cache.fechar();

    const reaberto = new CacheDePermissoes(caminho);
    expect(reaberto.buscar('100000000001')?.ultimoAllowEm?.toISOString()).toBe(
      AGORA.toISOString(),
    );
    reaberto.fechar();
  });

  describe('validade do snapshot — o que impede permissao eterna', () => {
    it('cache nunca sincronizado NAO e valido', () => {
      // Agente que nunca falou com a nuvem nao tem base para liberar
      // ninguem.
      expect(cache.estaValido(AGORA, UM_DIA)).toBe(false);
    });

    it('vale dentro do prazo', () => {
      cache.substituirPor([permissao('100000000001')], AGORA);

      expect(cache.estaValido(new Date(AGORA.getTime() + UM_DIA / 2), UM_DIA)).toBe(true);
    });

    it('vence depois do prazo', () => {
      // ⚠️ O teste que importa. Sem prazo, um agente desconectado ha uma
      // semana continua liberando quem a nuvem ja bloqueou.
      cache.substituirPor([permissao('100000000001')], AGORA);

      expect(cache.estaValido(new Date(AGORA.getTime() + UM_DIA + 1), UM_DIA)).toBe(false);
    });

    it('vale no limite exato, nao um ms depois', () => {
      // A fronteira e onde erro de sinal se esconde.
      cache.substituirPor([permissao('100000000001')], AGORA);

      expect(cache.estaValido(new Date(AGORA.getTime() + UM_DIA), UM_DIA)).toBe(true);
      expect(cache.estaValido(new Date(AGORA.getTime() + UM_DIA + 1), UM_DIA)).toBe(false);
    });
  });

  it('sync que falha no meio nao deixa o cache pela metade', () => {
    // Sem a transacao, um erro no meio apagaria as permissoes antigas sem
    // gravar as novas -- e a catraca passaria a negar quem tem direito.
    cache.substituirPor([permissao('100000000001'), permissao('100000000002')], AGORA);

    expect(() =>
      cache.substituirPor(
        [
          permissao('100000000003'),
          // Duplicado: viola a PRIMARY KEY no meio da transacao.
          permissao('100000000003'),
        ],
        AGORA,
      ),
    ).toThrow();

    // O cache antigo continua inteiro.
    expect(cache.total).toBe(2);
    expect(cache.buscar('100000000001')).not.toBeNull();
  });
});
