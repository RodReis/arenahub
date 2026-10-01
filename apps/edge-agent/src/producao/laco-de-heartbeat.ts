import type { SignedCloudClient } from '../cloud/signed-client.js';
import { enviarHeartbeat, type HeartbeatHttp } from '../cloud/heartbeat-client.js';

export interface DepsLacoDeHeartbeat {
  cliente: SignedCloudClient;
  montarCorpo: () => HeartbeatHttp;
  intervaloMs: number;
  aoFalhar?: (erro: string) => void;
  /**
   * Heartbeat aceito pela nuvem. Sem isto, so a FALHA vira log, e um agente
   * mudo e indistinguivel de um agente morto (#406).
   */
  aoEnviar?: () => void;
}

/**
 * Laco de heartbeat HTTP -- `setTimeout` recursivo, falha de rede nunca
 * derruba o laco (F11/AC-8 depende do heartbeat continuar tentando quando a
 * rede volta).
 *
 * SEM `unref`, ao contrario do `command-poller` de onde este laco foi
 * copiado. Timer `unref`ado nao segura o event loop sozinho -- o Node dava
 * o processo por terminado logo apos "edge-agent pronto", com codigo 0, sem
 * erro e sem nunca mandar um heartbeat (#406, Arena Positiva). O painel
 * mostrava "Sem resposta / nunca" para um agente que tinha "subido com
 * sucesso". (O `command-poller` passou a rodar em producao desde #469 --
 * ele e `unref`ado porque, com o heartbeat ativo, ja existe outro timer
 * segurando o processo; antes disso o unico handle era este.)
 *
 * Quem para o laco e o `parar()` devolvido daqui, chamado no SIGINT/SIGTERM
 * do `main.ts` -- nao o coletor de handles do Node.
 */
export function iniciarLacoDeHeartbeat(deps: DepsLacoDeHeartbeat): () => void {
  let ativo = true;
  let temporizador: NodeJS.Timeout | undefined;

  const enviarEReagendar = async (): Promise<void> => {
    try {
      const resposta = await enviarHeartbeat(deps.cliente, deps.montarCorpo());

      if (resposta) deps.aoEnviar?.();
      else deps.aoFalhar?.('CLOUD_UNREACHABLE');
    } catch (erro: unknown) {
      deps.aoFalhar?.(erro instanceof Error ? erro.message : 'ERRO_DESCONHECIDO');
    } finally {
      agendar();
    }
  };

  const agendar = (): void => {
    if (!ativo) return;

    temporizador = setTimeout(() => void enviarEReagendar(), deps.intervaloMs);
  };

  /*
   * O PRIMEIRO envio sai agora, nao daqui a `intervaloMs`. Sem isso, todo
   * reinicio do servico deixa o painel mostrando "Sem resposta" por meio
   * minuto, e nao da para distinguir "ainda nao mandou" de "morreu antes de
   * mandar" -- exatamente o que confundiu o diagnostico em campo (#406).
   */
  void enviarEReagendar();

  return () => {
    ativo = false;
    if (temporizador) clearTimeout(temporizador);
  };
}
