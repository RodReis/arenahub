import type { DispositivoHeartbeat } from '../cloud/heartbeat-client.js';
import type { FacialDeviceAdapter } from '../domain/facial-device.js';
import type { TurnstileAdapter } from '../domain/turnstile.js';

/**
 * Monta o `devices` do heartbeat HTTP (#461, #522).
 *
 * FACIAL: `serie` vem do `reg` do equipamento e bate com o `Device.serial`
 * cadastrado no painel. `null` antes do handshake (ou com o leitor
 * desconectado, #504) nao gera linha -- nunca um serial inventado, que
 * esconderia o alerta sem corrigi-lo (decisao da revisao F59 que abriu a #461).
 * O modelo e o que o leitor informou; antes ia `'Inner Fit'`, o da catraca, e
 * a nuvem sobrescrevia o modelo do leitor (#522).
 *
 * CATRACA (#522): a ponte EasyInner nao expoe numero de serie, entao o serial
 * vem do `.env` (`CATRACA_SERIAL`, o mesmo cadastrado no painel -- o que o
 * display da catraca mostra em "Serial"). Entra SO enquanto ela responde ao
 * `PingOnLine` do keep-alive (#470): parou de responder, sai do heartbeat e a
 * nuvem levanta `DEVICE_OFFLINE` de verdade. Antes ela nunca entrava, e o
 * alerta ficou aceso 29 dias com a catraca funcionando -- escondendo qualquer
 * queda real.
 */
export function montarDevicesDoHeartbeat(
  dispositivos: {
    facial: Pick<FacialDeviceAdapter, 'serie'> & { readonly modelo?: string | null };
    catraca?: Pick<TurnstileAdapter, 'respondendo'>;
  },
  catracaSerial?: string,
): readonly DispositivoHeartbeat[] {
  const devices: DispositivoHeartbeat[] = [];

  const serial = dispositivos.facial.serie;
  if (serial !== null) {
    devices.push({
      serial,
      model: dispositivos.facial.modelo ?? 'Leitor facial',
      status: 'ACTIVE',
    });
  }

  if (catracaSerial !== undefined && dispositivos.catraca?.respondendo === true) {
    devices.push({ serial: catracaSerial, model: 'Inner Fit', status: 'ACTIVE' });
  }

  return devices;
}
