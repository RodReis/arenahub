import { describe, expect, it } from '@jest/globals';

import { montarDevicesDoHeartbeat } from './montar-devices-do-heartbeat.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';

describe('montarDevicesDoHeartbeat', () => {
  it('manda o serial real do facial, nunca inventado (#461)', () => {
    const devices = montarDevicesDoHeartbeat({ facial: new FacialSimulator() });

    expect(devices).toEqual([
      { serial: 'SIMULADOR-FACIAL', model: 'Leitor facial', status: 'ACTIVE' },
    ]);
  });

  it('nao manda device nenhum antes do handshake do facial (serie null)', () => {
    const devices = montarDevicesDoHeartbeat({ facial: { serie: null } });

    expect(devices).toEqual([]);
  });

  /**
   * #522 -- o heartbeat mandava `model: 'Inner Fit'` (o modelo da CATRACA)
   * para o leitor facial, e a nuvem sobrescrevia o modelo do `Device`.
   */
  it('usa o modelo que o leitor informou no registro', () => {
    const devices = montarDevicesDoHeartbeat({
      facial: { serie: 'AYTI11108174', modelo: 'AiFace' },
    });

    expect(devices).toEqual([{ serial: 'AYTI11108174', model: 'AiFace', status: 'ACTIVE' }]);
  });

  /**
   * #522 -- a catraca nunca entrava no heartbeat, e o DEVICE_OFFLINE dela
   * ficou aceso 29 dias com ela funcionando (Arena Positiva, 02/10/2026).
   */
  describe('catraca', () => {
    const facial = { serie: null };

    it('entra com o serial do painel enquanto responde ao ping', () => {
      const devices = montarDevicesDoHeartbeat(
        { facial, catraca: { respondendo: true } },
        '247000797',
      );

      expect(devices).toEqual([{ serial: '247000797', model: 'Inner Fit', status: 'ACTIVE' }]);
    });

    it('sai do heartbeat quando para de responder -- a nuvem alerta de verdade', () => {
      const devices = montarDevicesDoHeartbeat(
        { facial, catraca: { respondendo: false } },
        '247000797',
      );

      expect(devices).toEqual([]);
    });

    it('sem serial configurado nao entra -- nunca um serial inventado', () => {
      const devices = montarDevicesDoHeartbeat({ facial, catraca: { respondendo: true } });

      expect(devices).toEqual([]);
    });
  });
});
