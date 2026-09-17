import type { SignedCloudClient } from '../cloud/signed-client.js';
import { enviarHeartbeat, type HeartbeatHttp } from '../cloud/heartbeat-client.js';

export interface DepsLacoDeHeartbeat {
  cliente: SignedCloudClient;
  montarCorpo: () => HeartbeatHttp;
  intervaloMs: number;
  aoFalhar?: (erro: string) => void;
}

/**
 * Laco de heartbeat HTTP -- mesmo padrao do `command-poller` (F8):
 * `setTimeout` recursivo com `unref`, falha de rede nunca derruba o laco
 * (F11/AC-8 depende do heartbeat continuar tentando quando a rede volta).
 */
export function iniciarLacoDeHeartbeat(deps: DepsLacoDeHeartbeat): () => void {
  let ativo = true;
  let temporizador: NodeJS.Timeout | undefined;

  const agendar = (): void => {
    if (!ativo) return;

    temporizador = setTimeout(() => {
      void (async () => {
        try {
          const resposta = await enviarHeartbeat(deps.cliente, deps.montarCorpo());
          if (!resposta) deps.aoFalhar?.('CLOUD_UNREACHABLE');
        } catch (erro: unknown) {
          deps.aoFalhar?.(erro instanceof Error ? erro.message : 'ERRO_DESCONHECIDO');
        } finally {
          agendar();
        }
      })();
    }, deps.intervaloMs);

    temporizador.unref?.();
  };

  agendar();

  return () => {
    ativo = false;
    if (temporizador) clearTimeout(temporizador);
  };
}
