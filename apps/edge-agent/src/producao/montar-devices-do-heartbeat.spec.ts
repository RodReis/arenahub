import { describe, expect, it } from '@jest/globals';

import { montarDevicesDoHeartbeat } from './montar-devices-do-heartbeat.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';

describe('montarDevicesDoHeartbeat', () => {
  it('manda o serial real do facial, nunca inventado (#461)', () => {
    const devices = montarDevicesDoHeartbeat({ facial: new FacialSimulator() });

    expect(devices).toEqual([
      { serial: 'SIMULADOR-FACIAL', model: 'Inner Fit', status: 'ACTIVE' },
    ]);
  });

  it('nao manda device nenhum antes do handshake do facial (serie null)', () => {
    const devices = montarDevicesDoHeartbeat({ facial: { serie: null } });

    expect(devices).toEqual([]);
  });
});
