import type { SignedCloudClient } from './signed-client.js';

export interface DispositivoHeartbeat {
  serial: string;
  model: string;
  firmware?: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';
  lastSyncAt?: string;
}

export interface HeartbeatHttp {
  agentVersion: string;
  localTimeMs: number;
  queueDepth: number;
  devices: readonly DispositivoHeartbeat[];
}

export interface RespostaDeHeartbeatHttp {
  serverTime: string;
  clockOffsetMs: number;
  acknowledgedDevices: number;
}

/**
 * Envia o heartbeat para `POST /api/v1/edge/heartbeat` (F11). Sem isso, o
 * alerta "Edge offline" do painel (ADR-011, AC-8) nunca dispara -- o
 * heartbeat que so ia para o log (health-check.ts) nao alcancava a nuvem.
 *
 * `null` em falha de rede: quem chama decide se tenta de novo no proximo
 * ciclo. Nao lanca -- erro de rede aqui nao pode derrubar o processo
 * (mesma regra do `command-poller`).
 */
export async function enviarHeartbeat(
  cliente: SignedCloudClient,
  corpo: HeartbeatHttp,
): Promise<RespostaDeHeartbeatHttp | null> {
  const resposta = await cliente.post<RespostaDeHeartbeatHttp>('/api/v1/edge/heartbeat', {
    agentVersion: corpo.agentVersion,
    localTimeMs: corpo.localTimeMs,
    queueDepth: corpo.queueDepth,
    devices: corpo.devices,
  });

  return resposta.ok ? resposta.body : null;
}
