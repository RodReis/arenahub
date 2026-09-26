import type { ArmazenamentoDeCredencial } from './armazenamento-de-credencial.js';

/**
 * Por que a troca falhou.
 *
 * `RECUSADO` e `REDE` pedem acoes OPOSTAS de quem instala: gerar outro
 * codigo no painel versus conferir `CLOUD_API_URL` e a rede da academia.
 * Colapsar os dois num `{ ok: false }` foi o que fez a instalacao real da
 * Arena Positiva perder tempo procurando erro de digitacao no `.env`
 * enquanto o problema era o TTL de 10 minutos (issue #406).
 */
export type FalhaDaTroca =
  | { ok: false; motivo: 'RECUSADO'; status: number }
  | { ok: false; motivo: 'REDE'; detalhe: string };

export type ResultadoDaTroca = { ok: true; keyId: string; secret: string } | FalhaDaTroca;

/**
 * A nuvem recusou o codigo (tipicamente 409: expirado, ja usado ou
 * inexistente -- o ADR-011 nao distingue os tres de proposito, para nao
 * virar oraculo de quem tenta codigos ao acaso).
 *
 * Distinto de `CredencialAusenteError`: la a variavel faltava; aqui ela
 * estava presente e foi rejeitada.
 */
export class PareamentoRecusadoError extends Error {
  readonly code = 'EDGE_PAREAMENTO_RECUSADO';

  constructor(status: number) {
    super(
      `A nuvem recusou o codigo de pareamento (HTTP ${status}). O codigo expira em ` +
        '10 minutos e morre no primeiro uso. Gere outro no painel, em Operacao -> Parear, ' +
        'e use-o em EDGE_PAIRING_CODE dentro desse prazo.',
    );
    this.name = 'PareamentoRecusadoError';
  }
}

/** A nuvem nao foi alcancada -- problema de rede, URL ou TLS, nao de codigo. */
export class PareamentoSemRedeError extends Error {
  readonly code = 'EDGE_PAREAMENTO_SEM_REDE';

  constructor(cloudApiUrl: string, detalhe: string) {
    super(
      `Nao foi possivel alcancar a nuvem em ${cloudApiUrl} para trocar o codigo de ` +
        `pareamento (${detalhe}). Confira CLOUD_API_URL e a conexao da academia -- o ` +
        'codigo nao foi consumido, entao ele continua valido ate expirar.',
    );
    this.name = 'PareamentoSemRedeError';
  }
}

export interface DepsPareamento {
  cloudApiUrl: string;
  codigo: string;
  armazenamento: ArmazenamentoDeCredencial;
  /** Injetavel para teste -- em producao, POST simples a /api/v1/edge/pair. */
  trocarPorHttp: (url: string, codigo: string) => Promise<ResultadoDaTroca>;
}

/**
 * Troca o codigo por credencial e guarda no armazenamento (DPAPI em
 * producao). Idempotente por design: se ja ha credencial salva, nao troca
 * de novo -- o codigo de uso unico so serve na PRIMEIRA vez.
 *
 * LANCA em vez de devolver `null` quando a troca falha: `null` significaria
 * "nao havia o que trocar", e quem chama traduziria isso em "configure
 * EDGE_PAIRING_CODE" -- conselho errado para um codigo que foi recusado.
 */
export async function parear(
  deps: DepsPareamento,
): Promise<{ keyId: string; secret: string } | null> {
  const existente = await deps.armazenamento.carregar();
  if (existente) return existente;

  const resultado = await deps.trocarPorHttp(deps.cloudApiUrl, deps.codigo);

  if (!resultado.ok) {
    throw resultado.motivo === 'RECUSADO'
      ? new PareamentoRecusadoError(resultado.status)
      : new PareamentoSemRedeError(deps.cloudApiUrl, resultado.detalhe);
  }

  await deps.armazenamento.salvar(resultado.keyId, resultado.secret);

  return { keyId: resultado.keyId, secret: resultado.secret };
}

/** Implementacao real de `trocarPorHttp` -- sem assinatura HMAC (Task 8). */
export async function trocarCodigoPorCredencial(
  cloudApiUrl: string,
  codigo: string,
): Promise<ResultadoDaTroca> {
  let resposta: Response;

  try {
    resposta = await fetch(`${cloudApiUrl}/api/v1/edge/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: codigo }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (erro: unknown) {
    /*
     * So o NOME e a mensagem do erro, nunca o objeto inteiro: o corpo da
     * requisicao (que carrega o codigo) pode aparecer em erro de fetch de
     * algumas runtimes, e o codigo e segredo (`env.ts` -> CAMPOS_SECRETOS).
     */
    const detalhe = erro instanceof Error ? erro.message : 'erro desconhecido';

    return { ok: false, motivo: 'REDE', detalhe };
  }

  if (!resposta.ok) return { ok: false, motivo: 'RECUSADO', status: resposta.status };

  const corpo = (await resposta.json()) as { keyId: string; secret: string };

  return { ok: true, keyId: corpo.keyId, secret: corpo.secret };
}
