import type { DispositivoHeartbeat } from '../cloud/heartbeat-client.js';
import type { FacialDeviceAdapter } from '../domain/facial-device.js';

/**
 * Monta o `devices` do heartbeat HTTP (#461).
 *
 * So o FACIAL entra: `serie` vem do `reg` do equipamento e bate com o
 * `Device.serial` cadastrado no painel. `null` antes do handshake nao gera
 * linha -- nunca um serial inventado, que esconderia o alerta sem corrigi-lo
 * (decisao da revisao F59 que abriu a #461).
 *
 * A CATRACA fica de fora: a ponte EasyInner nao expoe numero de serie (so o
 * webserver de admin, canal que a producao nao usa). Threading de um serial
 * sintetico ate aqui bateria errado com o painel -- decisao de como associar
 * o Edge a catraca sem esse dado e do PI.
 */
export function montarDevicesDoHeartbeat(dispositivos: {
  facial: Pick<FacialDeviceAdapter, 'serie'>;
}): readonly DispositivoHeartbeat[] {
  const serial = dispositivos.facial.serie;
  if (serial === null) return [];

  return [{ serial, model: 'Inner Fit', status: 'ACTIVE' }];
}
