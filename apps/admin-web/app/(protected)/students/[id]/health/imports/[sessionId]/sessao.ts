import type { LinhaDeRevisao } from './valores-da-avaliacao';

export interface AtributosDoAparelho {
  readonly ecgFinding?: string | null;
}

/**
 * Mapeamento puro da sessao de revisao.
 *
 * Vive em arquivo PROPRIO (sem `server-only` na cadeia de imports) para que
 * o teste possa importar so a logica, sem montar `page.tsx` inteiro (que
 * puxa `chamarApi`, e esse modulo lanca fora de um Server Component real).
 */

export interface ArquivoDaSessao {
  importId: string;
  sourceLabel: string;
  tipoDeLaudo: string;
  /** `EXTRACTED`, `FAILED`, `CONFIRMED`… — o status real do import. */
  status?: string;
  /** Por que o extrator não conseguiu ler, quando não conseguiu. */
  failureReason?: string | null;
  /**
   * `extracted_attributes` cru do arquivo, OPACO (ADR-035) -- carrega
   * `ecgFinding` quando o arquivo e um ECG. Nunca interpretado aqui, so
   * repassado para a tela citar como texto.
   */
  atributos: Record<string, unknown> | null;
}

export interface SessaoDeRevisao {
  sessionId: string;
  arquivos: ArquivoDaSessao[];
  linhas: LinhaDeRevisao[];
  podeConfirmar: { pronta: boolean; motivo?: string };
}

/**
 * Achado do ECG -- ADR-035: texto atribuido ao aparelho, nunca metrica
 * classificada. Vem em `arquivos[].atributos.ecgFinding` (OPACO -- so
 * verificamos PRESENCA, nunca lemos o conteudo para decidir nada). O
 * arquivo do tipo ECG e quem carrega o atributo; `sourceLabel` e so o nome
 * do aparelho/arquivo ("ECG 30s") e NUNCA deve ser usado como substituto do
 * achado -- os dois sao coisas diferentes que por acaso vivem no mesmo
 * objeto.
 */
export function atributosDoAparelho(
  sessao: SessaoDeRevisao,
): Record<string, unknown> | null {
  const doEcg = sessao.arquivos.find((arquivo) => arquivo.atributos?.['ecgFinding'] !== undefined);

  return doEcg?.atributos ?? null;
}

/** As chaves que o extrator de bioimpedancia grava para o card "Metas e controle". */
const CHAVES_DE_RECOMENDACAO = [
  'deviceStandardWeightKg',
  'deviceWeightControlKg',
  'deviceFatControlKg',
  'deviceMuscleControlKg',
  'deviceRecommendedIntakeKcal',
] as const;

/**
 * Recomendacoes do aparelho (INV-151) -- peso padrao, controles e ingestao.
 *
 * PROCURA POR CHAVE, nao pelo arquivo de bioimpedancia. Dois motivos:
 *
 *   1. Uma sessao tem DOIS laudos de bioimpedancia (balanca e analise), e
 *      qual deles traz as recomendacoes depende do modelo do aparelho --
 *      fixar "o primeiro BIOIMPEDANCE" acertaria hoje e erraria no proximo
 *      laudo que imprimisse as recomendacoes no outro arquivo.
 *   2. E o mesmo criterio de `atributosDoAparelho`, que acha o ECG pela
 *      presenca de `ecgFinding` e nao pelo tipo declarado.
 *
 * Junta as chaves de TODOS os arquivos: se dois laudos trouxerem partes
 * diferentes, a tela mostra a uniao em vez de escolher um e perder o resto.
 * Colisao de chave e resolvida pelo ultimo arquivo, mesma regra do
 * `deviceReport` no servidor (`import.service.ts`).
 */
export function recomendacoesDoAparelho(
  sessao: SessaoDeRevisao,
): Record<string, unknown> | null {
  const encontradas: Record<string, unknown> = {};

  for (const arquivo of sessao.arquivos) {
    for (const chave of CHAVES_DE_RECOMENDACAO) {
      const valor = arquivo.atributos?.[chave];

      if (typeof valor === 'number') encontradas[chave] = valor;
    }
  }

  return Object.keys(encontradas).length === 0 ? null : encontradas;
}

export interface CartaoDeArquivo {
  readonly importId: string;
  readonly sourceLabel: string;
  readonly tipoDeLaudo: string;
  readonly totalDeCampos: number;
  /**
   * O que a tela mostra sobre este laudo.
   *
   * `FAILED` é um estado próprio, não "pendente de revisão": o extrator não
   * conseguiu ler o arquivo, e não há revisão que resolva isso — pedir uma
   * ação inexistente é pior que dizer que falhou.
   */
  readonly estado: 'EXTRACTED' | 'PENDING_REVIEW' | 'FAILED';
  /** Por que falhou, para o cartão explicar em vez de só sinalizar. */
  readonly motivoDaFalha: string | null;
  /**
   * URL assinada do arquivo original, de vida curta.
   *
   * `null` quando o arquivo já foi expurgado após a publicação (retenção
   * curta, `MVP-03` §15) -- ausência real, não falha de carregamento.
   */
  readonly url: string | null;
  /** `image/png`, `application/pdf`… `null` junto com `url`. */
  readonly contentType: string | null;
}

/**
 * Um cartao por arquivo enviado.
 *
 * A contagem de campos casa por `importId` -- o vinculo REAL gravado no
 * banco. A versao anterior casava por `sourceLabel`, e isso nunca funcionou
 * no caso real: o rotulo do CAMPO vem do nome do arquivo enviado
 * (`WhatsApp Image 2026-08-04 at 08.21.31`) e o do ARQUIVO vem do conteudo
 * extraido (`CF610_G`), entao os dois textos raramente coincidiam e a
 * contagem saia zerada.
 */
export function cartoesDeArquivo(
  arquivos: readonly ArquivoDaSessao[],
  linhas: readonly LinhaDeRevisao[],
  urls: ReadonlyMap<string, { url: string | null; contentType: string | null }> = new Map(),
): CartaoDeArquivo[] {
  const todosOsCampos = linhas.flatMap((linha) => linha.campos);

  return arquivos.map((arquivo) => {
    const camposDoArquivo = todosOsCampos.filter((campo) => campo.importId === arquivo.importId);
    const assinada = urls.get(arquivo.importId);

    const estado: CartaoDeArquivo['estado'] =
      arquivo.status === 'FAILED'
        ? 'FAILED'
        : camposDoArquivo.length > 0 && camposDoArquivo.every((campo) => campo.state !== 'PENDING')
          ? 'EXTRACTED'
          : 'PENDING_REVIEW';

    return {
      importId: arquivo.importId,
      sourceLabel: arquivo.sourceLabel,
      tipoDeLaudo: arquivo.tipoDeLaudo,
      totalDeCampos: camposDoArquivo.length,
      estado,
      motivoDaFalha: arquivo.failureReason ?? null,
      url: assinada?.url ?? null,
      contentType: assinada?.contentType ?? null,
    };
  });
}
