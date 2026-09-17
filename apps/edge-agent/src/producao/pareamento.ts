import type { ArmazenamentoDeCredencial } from './armazenamento-de-credencial.js';

export interface DepsPareamento {
  cloudApiUrl: string;
  codigo: string;
  armazenamento: ArmazenamentoDeCredencial;
  /** Injetavel para teste -- em producao, POST simples a /api/v1/edge/pair. */
  trocarPorHttp: (
    url: string,
    codigo: string,
  ) => Promise<{ ok: true; keyId: string; secret: string } | { ok: false }>;
}

/**
 * Troca o codigo por credencial e guarda no armazenamento (DPAPI em
 * producao). Idempotente por design: se ja ha credencial salva, nao troca
 * de novo -- o codigo de uso unico so serve na PRIMEIRA vez.
 */
export async function parear(
  deps: DepsPareamento,
): Promise<{ keyId: string; secret: string } | null> {
  const existente = await deps.armazenamento.carregar();
  if (existente) return existente;

  const resultado = await deps.trocarPorHttp(deps.cloudApiUrl, deps.codigo);

  if (!resultado.ok) return null;

  await deps.armazenamento.salvar(resultado.keyId, resultado.secret);

  return { keyId: resultado.keyId, secret: resultado.secret };
}

/** Implementacao real de `trocarPorHttp` -- sem assinatura HMAC (Task 8). */
export async function trocarCodigoPorCredencial(
  cloudApiUrl: string,
  codigo: string,
): Promise<{ ok: true; keyId: string; secret: string } | { ok: false }> {
  try {
    const resposta = await fetch(`${cloudApiUrl}/api/v1/edge/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: codigo }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resposta.ok) return { ok: false };

    const corpo = (await resposta.json()) as { keyId: string; secret: string };

    return { ok: true, keyId: corpo.keyId, secret: corpo.secret };
  } catch {
    return { ok: false };
  }
}
