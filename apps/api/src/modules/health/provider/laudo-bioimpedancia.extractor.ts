import { Injectable } from '@nestjs/common';

import { TIPOS_DE_MEDIDA, UNIDADES_DE_MEDIDA } from '../domain/medida.js';
import type { TipoDeMedida, UnidadeDeMedida } from '../domain/medida.js';
import {
  ErroDeExtracao,
  type CampoProposto,
  type DocumentExtractor,
  type PedidoDeExtracao,
  type ResultadoDaExtracao,
} from './document-extractor.port.js';

/**
 * Extrator dos laudos reais de bioimpedancia (CSV) e ECG textual (Slice
 * multiarquivo, Task 6).
 *
 * ---------------------------------------------------------------------------
 * ESTENDE O FORMATO DO `CsvDocumentExtractorAdapter`, NAO O SUBSTITUI.
 * ---------------------------------------------------------------------------
 *
 * Mesmo cabecalho `tipo,valor,unidade`, mais tres colunas OPCIONAIS que os
 * laudos de bioimpedancia trazem e o CSV generico nao precisa:
 *
 *     tipo,valor,unidade,faixa_min,faixa_max,percentual_padrao
 *     WEIGHT,88.40,kg,60.6,82.0,
 *     SEGMENTAL_FAT_MASS_TRUNK,10.40,kg,,,230.1
 *
 * Os segmentares nao vem com faixa min/max -- vem com `percentual_padrao`
 * (indice do fabricante). As medidas "planas" (peso, massa muscular) vem
 * com faixa e sem percentual. `confidence` fica `null` como no
 * `CsvDocumentExtractorAdapter`: parser deterministico nao estima confianca.
 *
 * ---------------------------------------------------------------------------
 * MESMO ARQUIVO TAMBEM LE O ECG TEXTUAL (`ADR-035` decisao 8).
 * ---------------------------------------------------------------------------
 *
 * O ECG real chega como PDF do OmronConnect, e o texto ja vem extraido da
 * camada de texto (`pdftotext`, custo zero). O `bpm` numerico vira
 * `CampoProposto` do tipo `HEART_RATE` -- e MEDIDA, entra no historico. O
 * achado ("Ritmo nao classificado", "Possivel fibrilacao atrial") e TEXTO
 * OPACO em `atributos.ecgFinding`: guardado e citado, nunca interpretado.
 * Nenhuma linha deste arquivo compara, mapeia severidade ou ramifica sobre
 * esse valor -- isso seria decidir clinicamente, e e a linha que a RDC
 * 657/2022 traca entre guardar dado de saude e ser dispositivo medico.
 *
 * ---------------------------------------------------------------------------
 * INDICE PROPRIETARIO DO FABRICANTE NUNCA VIRA MEDIDA (spec §4.4).
 * ---------------------------------------------------------------------------
 *
 * Idade corporal, pontuacao de saude, tipo corporal, peso ideal e "controles"
 * sugeridos pelo aparelho sao formula proprietaria que muda com firmware --
 * comparar no tempo produziria tendencia falsa. Por isso este extrator so
 * reconhece tipo presente em `TIPOS_DE_MEDIDA`; qualquer outra linha do CSV e
 * ignorada, exatamente como no `CsvDocumentExtractorAdapter`.
 */
@Injectable()
export class LaudoBioimpedanciaExtractor implements DocumentExtractor {
  async extrair(pedido: PedidoDeExtracao): Promise<ResultadoDaExtracao> {
    if (pedido.tipo === 'CSV') {
      return this.extrairCsv(pedido.conteudo);
    }

    if (pedido.tipo === 'PDF') {
      return this.extrairEcg(await textoDoPdf(pedido.conteudo));
    }

    return Promise.reject(
      new ErroDeExtracao(
        'EXTRACTOR_UNSUPPORTED_TYPE',
        false,
        `extrator de laudo de bioimpedancia nao le ${pedido.tipo}`,
      ),
    );
  }

  private extrairCsv(conteudo: Uint8Array): ResultadoDaExtracao {
    const texto = new TextDecoder('utf-8').decode(conteudo);
    const linhas = texto
      .split(/\r?\n/)
      .map((linha) => linha.trim())
      .filter((linha) => linha !== '');

    if (linhas.length < 2) {
      throw new ErroDeExtracao(
        'EXTRACTOR_NO_CONTENT',
        false,
        'CSV sem cabecalho ou sem linha de dados',
      );
    }

    const cabecalho = linhas[0]!.split(',').map((c) => c.trim().toLowerCase());
    const iTipo = cabecalho.indexOf('tipo');
    const iValor = cabecalho.indexOf('valor');
    const iUnidade = cabecalho.indexOf('unidade');
    const iFaixaMin = cabecalho.indexOf('faixa_min');
    const iFaixaMax = cabecalho.indexOf('faixa_max');
    const iPercentualPadrao = cabecalho.indexOf('percentual_padrao');

    if (iTipo < 0 || iValor < 0) {
      throw new ErroDeExtracao(
        'EXTRACTOR_NO_CONTENT',
        false,
        'CSV sem as colunas obrigatorias `tipo` e `valor`',
      );
    }

    const campos: CampoProposto[] = [];
    // Recomendacoes do aparelho (INV-151): guardadas como ATRIBUTO, nunca
    // como medida. Ver `RECOMENDACAO_DO_APARELHO` para o porque.
    const recomendacoes: Record<string, unknown> = {};

    for (const linha of linhas.slice(1)) {
      const celulas = linha.split(',').map((c) => c.trim());

      const tipo = celulas[iTipo]?.toUpperCase();
      const bruto = celulas[iValor]?.replace(',', '.');

      // Linha ilegivel ou tipo do fabricante (idade corporal, pontuacao,
      // peso ideal) e IGNORADA, nao derruba o arquivo -- mesma regra do
      // `CsvDocumentExtractorAdapter`.
      if (!tipo || !bruto) continue;

      // ANTES da guarda de `ehTipoDeMedida`: as recomendacoes NAO estao em
      // `TIPOS_DE_MEDIDA` de proposito (INV-151), entao a guarda as
      // descartaria. Aqui elas saem da linha do CSV para `atributos`, sem
      // nunca virar `CampoProposto`.
      const recomendacao = RECOMENDACAO_DO_APARELHO[tipo];

      if (recomendacao !== undefined) {
        const valor = Number(bruto);

        // Valor ilegivel nao vira `0` (INV-104): a chave simplesmente nao
        // entra, e a tela mostra ausencia em vez de um zero inventado.
        if (Number.isFinite(valor)) {
          recomendacoes[recomendacao] = valor;
        }

        continue;
      }

      if (!ehTipoDeMedida(tipo)) continue;

      const valor = Number(bruto);

      if (!Number.isFinite(valor)) continue;

      const unidadeBruta = iUnidade >= 0 ? celulas[iUnidade]?.toLowerCase() : undefined;
      const unidade =
        unidadeBruta && ehUnidade(unidadeBruta) ? (unidadeBruta as UnidadeDeMedida) : null;

      campos.push({
        type: tipo,
        value: valor,
        unit: unidade,
        confidence: null,
        sourceLocation: `linha ${linhas.indexOf(linha) + 1}`,
        referenceMin: lerNumeroOpcional(celulas, iFaixaMin),
        referenceMax: lerNumeroOpcional(celulas, iFaixaMax),
        standardPercent: lerNumeroOpcional(celulas, iPercentualPadrao),
      });
    }

    if (campos.length === 0) {
      throw new ErroDeExtracao(
        'EXTRACTOR_NO_CONTENT',
        false,
        'nenhuma linha do CSV produziu medida reconhecivel',
      );
    }

    const sourceLabel = detectarOrigemCsv(cabecalho, campos);

    return {
      campos,
      measuredAt: null,
      extractor: 'laudo-bioimpedancia@1',
      tipoDeLaudo: temComposicaoCorporal(campos) ? 'BIOIMPEDANCE' : 'UNKNOWN',
      // `exactOptionalPropertyTypes`: so inclui a chave quando ha valor --
      // `sourceLabel: undefined` explicito nao e a mesma coisa que omitir.
      ...(sourceLabel !== undefined ? { sourceLabel } : {}),
      // Laudo sem nenhuma recomendacao nao grava `atributos: {}` -- ausencia
      // de recomendacao e diferente de recomendacao vazia.
      ...(Object.keys(recomendacoes).length > 0 ? { atributos: recomendacoes } : {}),
    };
  }

  private extrairEcg(texto: string): ResultadoDaExtracao {
    const bpm = capturar(texto, /Frequencia cardiaca:\s*(\d+(?:[.,]\d+)?)\s*BPM/i);
    const achado = capturar(texto, /Analise instantanea:\s*(.+)/i);
    const linhaTags = capturar(texto, /Tags:\s*(.+)/i);
    const duracao = capturar(texto, /Duracao:\s*(\d+(?:[.,]\d+)?)\s*s/i);
    const gravadoEm = capturar(texto, /Gravado:\s*(.+)/i);
    // Texto que QUEM OPEROU o aparelho digitou. Opaco como o achado: exibido
    // verbatim, nunca interpretado nem usado para decidir nada (ADR-035).
    const observacoes = capturar(texto, /Observacoes:\s*(.+)/i);

    const ehEcg = /Analise instantanea:/i.test(texto) || /Frequencia cardiaca:/i.test(texto);

    if (!ehEcg) {
      throw new ErroDeExtracao(
        'EXTRACTOR_NO_CONTENT',
        false,
        'texto nao contem marcadores de ECG reconhecidos',
      );
    }

    const campos: CampoProposto[] = [];

    if (bpm) {
      const valor = Number(bpm.replace(',', '.'));

      if (Number.isFinite(valor)) {
        campos.push({
          type: 'HEART_RATE',
          value: valor,
          unit: null,
          confidence: null,
          sourceLocation: null,
        });
      }
    }

    // `atributos` guarda o achado como TEXTO OPACO -- nenhuma linha deste
    // metodo le `ecgFinding` para decidir nada (ADR-035).
    const atributos: Record<string, unknown> = {};

    if (achado) atributos['ecgFinding'] = achado;
    if (linhaTags) atributos['ecgTags'] = linhaTags.split(',').map((tag) => tag.trim());
    if (duracao) atributos['ecgDurationSeconds'] = Number(duracao.replace(',', '.'));
    if (gravadoEm) atributos['ecgRecordedAt'] = gravadoEm;
    if (observacoes) atributos['ecgNotes'] = observacoes;

    // O bpm vai nos DOIS lugares de proposito: como `HEART_RATE` ele e medida
    // comparavel mes a mes; aqui e o numero que o laudo imprimiu, exibido
    // junto do resto do que o aparelho reportou. Nao e duplicacao -- sao
    // papeis diferentes do mesmo numero.
    const bpmNumerico = bpm ? Number(bpm.replace(',', '.')) : Number.NaN;

    if (Number.isFinite(bpmNumerico)) atributos['ecgHeartRate'] = bpmNumerico;

    return {
      campos,
      measuredAt: null,
      extractor: 'laudo-bioimpedancia@1',
      tipoDeLaudo: 'ECG',
      atributos,
    };
  }
}

/**
 * As "Recomendacoes de condicao fisica" do laudo -> chave em `atributos`.
 *
 * ---------------------------------------------------------------------------
 * ISTO NAO E MEDIDA, E POR ISSO NAO ESTA EM `TIPOS_DE_MEDIDA` (INV-151).
 * ---------------------------------------------------------------------------
 *
 * Peso padrao, os tres "controles" e a ingestao recomendada sao FORMULA
 * PROPRIETARIA do fabricante, nao grandeza medida. O criterio da INV-151:
 * vira medida o que e medido e comparavel entre aparelhos; vira atributo o
 * que e indice do fabricante, que muda num firmware novo e produziria
 * tendencia falsa comparado mes a mes. ADR-038 diz o mesmo, e o proprio
 * laudo carimba "nao e recomendado como base para dados medicos".
 *
 * Consequencia pratica: estes cinco valores sao EXIBIDOS (card "Metas e
 * controle") e nada mais -- nao entram no grafico de evolucao, nao viram
 * `BodyMeasurement`, e nenhuma linha do sistema decide nada em cima deles.
 * Meta oficial de aluno e a da F20 (`HealthGoal`), que tem baseline, alvo e
 * responsavel -- coisa diferente de sugestao de balanca.
 *
 * A chave carrega o prefixo `device` para deixar a origem obvia em
 * `deviceReport`, onde convive com `ecgFinding` e afins.
 */
const RECOMENDACAO_DO_APARELHO: Readonly<Record<string, string>> = {
  STANDARD_WEIGHT: 'deviceStandardWeightKg',
  WEIGHT_CONTROL: 'deviceWeightControlKg',
  FAT_CONTROL: 'deviceFatControlKg',
  MUSCLE_CONTROL: 'deviceMuscleControlKg',
  RECOMMENDED_INTAKE: 'deviceRecommendedIntakeKcal',
};

/**
 * A CAMADA DE TEXTO do PDF -- o passo que faltava (ADR-035 decisao 8).
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTAVA ERRADO.
 * ---------------------------------------------------------------------------
 *
 * `extrairEcg` recebia os BYTES do PDF e fazia
 * `new TextDecoder('utf-8').decode(...)` neles. Num PDF de verdade o texto
 * vive comprimido em streams `FlateDecode`: decodificar os bytes crus como
 * UTF-8 devolve lixo binario, nenhum regex casa, e o arquivo termina em
 * `EXTRACTOR_NO_CONTENT`. Ou seja, o ECG NUNCA funcionou em producao -- e o
 * comentario do `import.service.ts` ja tratava isso como fato consumado ("o
 * ECG e um PDF de tracado, sem texto extraivel").
 *
 * O defeito sobreviveu porque o fixture de teste e um `.txt` com o texto ja
 * extraido: ele E o resultado do passo que nao existia. A suite provava a
 * metade que existia.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `unpdf`, E NAO OCR.
 * ---------------------------------------------------------------------------
 *
 * O ADR-035 e explicito: mandar para OCR um arquivo que JA TRAZ o texto e
 * "pagar para introduzir erro". O Omron imprime frequencia, duracao e achado
 * como texto de verdade; so o TRACADO e imagem, e o tracado nao vira medida.
 *
 * `unpdf` roda em Node puro, sem binario nativo e sem dependencia externa --
 * ao contrario do `pdftotext`, que exigiria o poppler instalado no host e no
 * container de CI.
 *
 * NORMALIZA ACENTO porque o laudo real e pt-BR ("Frequência cardíaca") e os
 * padroes deste arquivo sao escritos sem acento. Sem isso o extrator leria o
 * PDF corretamente e ainda assim nao casaria nada -- falha identica a de
 * antes, com causa diferente.
 */
async function textoDoPdf(conteudo: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');

  let texto: string;

  try {
    const pdf = await getDocumentProxy(conteudo);
    const extraido = await extractText(pdf, { mergePages: true });

    texto = Array.isArray(extraido.text) ? extraido.text.join('\n') : extraido.text;
  } catch (erro) {
    // PDF corrompido ou protegido por senha nao e falha do sistema: e um
    // arquivo que nao da para ler. `false` em `recuperavel` -- tentar de novo
    // com o mesmo arquivo daria o mesmo resultado.
    throw new ErroDeExtracao(
      'EXTRACTOR_NO_CONTENT',
      false,
      `PDF ilegivel: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
    );
  }

  // `NFD` separa a letra do acento; a faixa combina os acentos soltos e some
  // com eles. "Frequência" vira "Frequencia", que e como os padroes acima
  // estao escritos.
  return texto.normalize('NFD').replace(new RegExp('[\u0300-\u036f]', 'gu'), '');
}

function ehTipoDeMedida(valor: string): valor is TipoDeMedida {
  return (TIPOS_DE_MEDIDA as readonly string[]).includes(valor);
}

/**
 * Um laudo e de bioimpedancia quando traz QUALQUER medida de composicao
 * corporal. A regra estreita (so segmentar ou massa esqueletica) recusava o
 * relatorio da Unique Health, que traz massa ossea, massa celular e relacao
 * cintura-quadril sem nenhum segmentar -- e a sessao inteira seria bloqueada
 * por falta de bioimpedancia (Task 4, `sessaoPodeConfirmar`). So o ECG
 * produz `HEART_RATE` sozinho; qualquer outro tipo veio de um aparelho de
 * bioimpedancia, seja qual for o subconjunto de campos que ele imprime.
 */
function temComposicaoCorporal(campos: readonly CampoProposto[]): boolean {
  return campos.some((campo) => campo.type !== 'HEART_RATE');
}

function ehUnidade(valor: string): boolean {
  return (UNIDADES_DE_MEDIDA as readonly string[]).includes(valor);
}

/** Le uma celula numerica opcional. Ausente ou em branco vira `null`, nunca `0` (INV-104). */
function lerNumeroOpcional(celulas: readonly string[], indice: number): number | null {
  if (indice < 0) return null;

  const bruto = celulas[indice]?.replace(',', '.');

  if (!bruto) return null;

  const valor = Number(bruto);

  return Number.isFinite(valor) ? valor : null;
}

function capturar(texto: string, expressao: RegExp): string | null {
  const resultado = expressao.exec(texto);

  return resultado?.[1]?.trim() ?? null;
}

/**
 * Rotulo da origem do laudo, pelas colunas que so um dos dois formatos traz.
 *
 * `percentual_padrao` e exclusivo do `CF610_G` (indice do fabricante nos
 * segmentares). Os campos exclusivos do `UNIQUE_HEALTH` (`BONE_MASS`,
 * `BODY_CELL_MASS`, `WAIST_HIP_RATIO`) sao o outro sinal. Sem nenhum dos
 * dois, o rotulo fica indefinido -- nao se inventa fabricante.
 */
function detectarOrigemCsv(
  cabecalho: readonly string[],
  campos: readonly CampoProposto[],
): string | undefined {
  if (cabecalho.includes('percentual_padrao') && campos.some((c) => c.standardPercent !== null)) {
    return 'CF610_G';
  }

  const temCampoExclusivoUniqueHealth = campos.some((campo) =>
    (['BONE_MASS', 'BODY_CELL_MASS', 'WAIST_HIP_RATIO'] as const).includes(
      campo.type as 'BONE_MASS' | 'BODY_CELL_MASS' | 'WAIST_HIP_RATIO',
    ),
  );

  if (temCampoExclusivoUniqueHealth) return 'UNIQUE_HEALTH';

  return undefined;
}
