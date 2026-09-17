import type { ArmazenamentoDeCredencial } from './armazenamento-de-credencial.js';
import { parear, trocarCodigoPorCredencial } from './pareamento.js';

export interface CredencialResolvida {
  keyId: string;
  secret: string;
}

export class CredencialAusenteError extends Error {
  readonly code = 'EDGE_CREDENCIAL_AUSENTE';

  constructor() {
    super(
      'Nenhuma credencial de Edge encontrada. Defina EDGE_PAIRING_CODE com um ' +
        'codigo de pareamento gerado no painel, ou CLOUD_EDGE_KEY_ID/CLOUD_EDGE_SECRET diretamente.',
    );
    this.name = 'CredencialAusenteError';
  }
}

/**
 * Resolve a credencial na ordem: env explicito > armazenamento (DPAPI) >
 * pareamento via codigo. Falha alto se nenhuma das tres existir -- nao ha
 * modo "sem credencial" para falar com a nuvem.
 */
export async function resolverCredencial(deps: {
  cloudApiUrl: string | undefined;
  keyIdDoEnv: string | undefined;
  secretDoEnv: string | undefined;
  codigoDePareamento: string | undefined;
  armazenamento: ArmazenamentoDeCredencial;
}): Promise<CredencialResolvida | null> {
  if (deps.keyIdDoEnv && deps.secretDoEnv) {
    return { keyId: deps.keyIdDoEnv, secret: deps.secretDoEnv };
  }

  const existente = await deps.armazenamento.carregar();
  if (existente) return existente;

  if (!deps.cloudApiUrl || !deps.codigoDePareamento) return null;

  return parear({
    cloudApiUrl: deps.cloudApiUrl,
    codigo: deps.codigoDePareamento,
    armazenamento: deps.armazenamento,
    trocarPorHttp: trocarCodigoPorCredencial,
  });
}
