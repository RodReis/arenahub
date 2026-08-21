import type { AtributosDoAparelho } from './painel-de-analise';
import type { LinhaDeRevisao, PodeConfirmar } from './revisao-de-campos';

/**
 * Mapeamento puro da sessao de revisao -- Task 9, fix round 1.
 *
 * Vive em arquivo PROPRIO (sem `server-only` na cadeia de imports) para que
 * o teste possa importar so a logica, sem montar `page.tsx` inteiro (que
 * puxa `chamarApi`, e esse modulo lanca fora de um Server Component real).
 */

export interface ArquivoDaSessao {
  importId: string;
  sourceLabel: string;
  tipoDeLaudo: string;
  /**
   * `extracted_attributes` cru do arquivo, OPACO (ADR-035) -- carrega
   * `ecgFinding` quando o arquivo e um ECG. Nunca interpretado aqui, so
   * repassado para `PainelDeAnalise` citar como texto.
   */
  atributos: Record<string, unknown> | null;
}

export interface SessaoDeRevisao {
  sessionId: string;
  arquivos: ArquivoDaSessao[];
  linhas: LinhaDeRevisao[];
  podeConfirmar: PodeConfirmar;
}

/**
 * Resolve o `importId` dono de cada campo, casando `sourceLabel`.
 *
 * ponytail: `GET .../sessions/:id` devolve `arquivos[].sourceLabel` e
 * `linhas[].campos[].sourceLabel` separadamente, sem o par explicito --
 * casar pelo rotulo e a unica ponte disponivel sem tocar `apps/api`
 * (fora do escopo desta tarefa). Ceiling: dois arquivos com o MESMO rotulo
 * na mesma sessao ficam ambiguos, e o campo perde o `importId` (o formulario
 * ainda funciona para o vencedor; so o descarte do concorrente correspondente
 * fica pendente). Corrigir de verdade pede a API devolver o `importId` por
 * campo em `detalharSessao` (Task 5/`import.controller.ts`).
 */
function resolverImportId(
  sourceLabel: string | null,
  arquivos: readonly ArquivoDaSessao[],
): string | undefined {
  if (sourceLabel === null) return undefined;

  const candidatos = arquivos.filter((arquivo) => arquivo.sourceLabel === sourceLabel);

  return candidatos.length === 1 ? candidatos[0]!.importId : undefined;
}

export function comImportId(sessao: SessaoDeRevisao): LinhaDeRevisao[] {
  return sessao.linhas.map((linha) => ({
    ...linha,
    campos: linha.campos.map((campo) => ({
      ...campo,
      importId: resolverImportId(campo.sourceLabel, sessao.arquivos),
    })),
  }));
}

/**
 * Achado do ECG -- ADR-035: texto atribuido ao aparelho, nunca metrica
 * classificada. Vem em `arquivos[].atributos.ecgFinding` (OPACO -- so
 * verificamos PRESENCA, nunca lemos o conteudo para decidir nada). O
 * arquivo do tipo ECG e quem carrega o atributo; `sourceLabel` e so o nome
 * do aparelho/arquivo ("ECG 30s") e NUNCA deve ser usado como substituto do
 * achado -- os dois sao coisas diferentes que por acaso vivem no mesmo
 * objeto (bug real da Task 9, corrigido na revisao).
 */
export function atributosDoAparelho(sessao: SessaoDeRevisao): AtributosDoAparelho {
  for (const arquivo of sessao.arquivos) {
    const achado = arquivo.atributos?.['ecgFinding'];

    if (typeof achado === 'string' && achado !== '') {
      return { ecgFinding: achado };
    }
  }

  return {};
}
