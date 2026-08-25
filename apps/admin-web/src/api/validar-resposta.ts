import type { ZodType } from 'zod';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  correlationId: string;
}

/**
 * Codigo estavel de divergencia de contrato.
 *
 * Nao e erro da API nem do usuario: e a resposta que chegou com forma
 * diferente da declarada (deploy parcial, rollback, campo renomeado, build
 * defasado em dev). Merece codigo proprio para nao se confundir com o
 * `UNEXPECTED` de corpo ilegivel.
 */
export const CODIGO_DE_CONTRATO = 'RESPONSE_CONTRACT_MISMATCH';

/**
 * Valida o corpo de RESPOSTA contra o schema declarado pelo chamador.
 *
 * O generico de `chamarApi` e assercao, nao validacao: com ele, uma resposta
 * divergente passa calada pelo compilador e explode na arvore de render, no
 * formato mais dificil de ler (issue #167). Aqui a mesma divergencia vira
 * `ProblemDetails`, que toda tela ja sabe renderizar.
 *
 * O `correlationId` vem de fora porque quem o conhece e a camada que fez a
 * requisicao -- esta funcao e pura de proposito, para ser testavel sem
 * `fetch` nem `cookies()`.
 */
export function validarResposta<T>(
  esquema: ZodType<T>,
  corpo: unknown,
  contexto: { caminho: string; correlationId: string },
): { ok: true; dados: T } | { ok: false; erro: ProblemDetails } {
  const resultado = esquema.safeParse(corpo);

  if (resultado.success) {
    return { ok: true, dados: resultado.data };
  }

  return {
    ok: false,
    erro: {
      type: 'about:blank',
      // O caminho do campo entra no titulo porque e a unica informacao que
      // encurta o diagnostico: "prices ausente em /api/v1/plans" resolve, e
      // "resposta invalida" manda abrir o DevTools.
      title: `Resposta fora do contrato em ${contexto.caminho}: ${descreverFalhas(resultado.error.issues)}.`,
      status: 502,
      code: CODIGO_DE_CONTRATO,
      correlationId: contexto.correlationId,
    },
  };
}

/** Primeiras falhas, com o caminho do campo. Nunca o VALOR recebido -- ele pode ser PII. */
function descreverFalhas(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const LIMITE = 3;

  const descritas = issues
    .slice(0, LIMITE)
    .map((issue) => {
      const campo = issue.path.length > 0 ? issue.path.join('.') : '(raiz)';

      return `${campo}: ${issue.message}`;
    })
    .join('; ');

  return issues.length > LIMITE ? `${descritas} (+${issues.length - LIMITE})` : descritas;
}
