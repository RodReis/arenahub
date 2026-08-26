import { describe, expect, it, vi } from 'vitest';

import { tocarAvisoDeRecusa } from './aviso-sonoro.js';

/**
 * Dublê de `AudioContext`. Grava o que foi agendado para que o teste asserte o
 * ATO (dois osciladores, com as frequencias certas, iniciados e parados), e nao
 * apenas que a funcao devolveu sem erro -- um dublê que aceita tudo calado
 * provaria o mesmo com a implementacao vazia.
 */
function contextoFalso() {
  const osciladores: { hz: number; iniciouEm: number; parouEm: number }[] = [];

  const contexto = {
    currentTime: 0,
    destination: {},
    createOscillator: () => {
      const registro = { hz: 0, iniciouEm: -1, parouEm: -1 };
      osciladores.push(registro);

      return {
        frequency: {
          get value() {
            return registro.hz;
          },
          set value(hz: number) {
            registro.hz = hz;
          },
        },
        connect: vi.fn(),
        start: (t: number) => {
          registro.iniciouEm = t;
        },
        stop: (t: number) => {
          registro.parouEm = t;
        },
      };
    },
    createGain: () => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    }),
  };

  return { contexto, osciladores };
}

describe('aviso sonoro na recusa (F44 -- fecha a flag sem consumidor da F50)', () => {
  /**
   * O caso que motiva a fatia: ate aqui a caixa marcada no painel nao produzia
   * som nenhum. Se este teste passar com a implementacao vazia, a fatia nao
   * entregou nada.
   */
  it('LIGADO toca os dois tons descendentes', () => {
    const { contexto, osciladores } = contextoFalso();

    tocarAvisoDeRecusa(true, () => contexto as unknown as AudioContext);

    expect(osciladores).toHaveLength(2);
    expect(osciladores[0]?.hz).toBe(440);
    expect(osciladores[1]?.hz).toBe(330);
  });

  it('o segundo tom comeca quando o primeiro termina, sem sobrepor', () => {
    const { contexto, osciladores } = contextoFalso();

    tocarAvisoDeRecusa(true, () => contexto as unknown as AudioContext);

    expect(osciladores[0]?.parouEm).toBe(osciladores[1]?.iniciouEm);
    // Cada tom tem duracao real -- `start === stop` seria silencio agendado.
    expect(osciladores[0]?.parouEm).toBeGreaterThan(osciladores[0]?.iniciouEm ?? 0);
  });

  /**
   * DESLIGADO nao pode apenas deixar de tocar: nao pode nem CRIAR o contexto.
   * Instanciar `AudioContext` acorda a saida de audio do aparelho, e a unidade
   * que desmarcou a caixa pediu justamente para o totem nao mexer nisso.
   */
  it('DESLIGADO nao instancia o contexto de audio', () => {
    const fabrica = vi.fn();

    tocarAvisoDeRecusa(false, fabrica);

    expect(fabrica).not.toHaveBeenCalled();
  });

  /**
   * Aparelho sem saida de audio, navegador antigo, permissao negada. A recusa
   * ja esta na tela pelo Toast; derrubar o totem por causa do som seria trocar
   * um aviso perdido por uma tela morta.
   */
  it('contexto que explode nao derruba a tela', () => {
    expect(() => {
      tocarAvisoDeRecusa(true, () => {
        throw new Error('sem saida de audio');
      });
    }).not.toThrow();
  });
});
