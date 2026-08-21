import type { CampoDaLinha, LinhaDeRevisao, PodeConfirmar } from './revisao-de-campos';

export interface AtributosDoAparelho {
  readonly ecgFinding?: string | null;
}

/**
 * Mapeamento puro da sessao de revisao -- Task 9, rebuild multiarquivo.
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
export function atributosDoAparelho(
  sessao: SessaoDeRevisao,
): Record<string, unknown> | null {
  // O arquivo de ECG e o que carrega `ecgFinding`. A PRESENCA da chave e o
  // criterio -- nunca o conteudo dela, que ninguem le para decidir nada.
  const doEcg = sessao.arquivos.find((arquivo) => arquivo.atributos?.['ecgFinding'] !== undefined);

  return doEcg?.atributos ?? null;
}

export interface CartaoDeArquivo {
  readonly importId: string;
  readonly sourceLabel: string;
  readonly tipoDeLaudo: string;
  readonly totalDeCampos: number;
  /** `null` quando nenhum campo do arquivo trouxe confianca (extrator deterministico). */
  readonly confidenceMedia: number | null;
  /** Extraído quando todo campo do arquivo já saiu do estado `PENDING`; Revisar caso contrário. */
  readonly estado: 'EXTRACTED' | 'PENDING_REVIEW';
}

/**
 * Um cartao por arquivo enviado -- mock do PI, item "Três file cards".
 *
 * A contagem de campos e a confianca media SO CONSIDERAM os campos cujo
 * `importId` resolveu para este arquivo (`comImportId` acima) -- um campo
 * sem import resolvido (rotulo ambiguo) nao pode ser atribuido a um cartao
 * especifico sem mentir sobre a origem.
 */
export function cartoesDeArquivo(
  arquivos: readonly ArquivoDaSessao[],
  linhasComImportId: readonly LinhaDeRevisao[],
): CartaoDeArquivo[] {
  const todosOsCampos: CampoDaLinha[] = linhasComImportId.flatMap((linha) => linha.campos);

  return arquivos.map((arquivo) => {
    const camposDoArquivo = todosOsCampos.filter((campo) => campo.importId === arquivo.importId);
    const comConfidence = camposDoArquivo.filter(
      (campo): campo is CampoDaLinha & { confidence: number } => campo.confidence !== null,
    );

    const confidenceMedia =
      comConfidence.length === 0
        ? null
        : comConfidence.reduce((soma, campo) => soma + campo.confidence, 0) / comConfidence.length;

    const estado: CartaoDeArquivo['estado'] =
      camposDoArquivo.length > 0 && camposDoArquivo.every((campo) => campo.state !== 'PENDING')
        ? 'EXTRACTED'
        : 'PENDING_REVIEW';

    return {
      importId: arquivo.importId,
      sourceLabel: arquivo.sourceLabel,
      tipoDeLaudo: arquivo.tipoDeLaudo,
      totalDeCampos: camposDoArquivo.length,
      confidenceMedia,
      estado,
    };
  });
}
