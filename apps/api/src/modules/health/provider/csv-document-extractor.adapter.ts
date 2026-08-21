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
 * Extrator de CSV -- parser HOMOLOGADO, nao dublê (Slice 3.3).
 *
 * Este e codigo de producao de verdade: o CSV e deterministico, entao nao ha
 * dublê a fazer. Ele ou le o arquivo, ou falha com motivo -- e por isso
 * `confidence` sai `null` em todo campo: o parser nao "acha" nada.
 *
 * ---------------------------------------------------------------------------
 * MESMO SENDO DETERMINISTICO, O RESULTADO PASSA POR REVISAO HUMANA.
 * ---------------------------------------------------------------------------
 *
 * Poderia parecer exagero: se o parser nao erra, por que exigir confirmacao?
 * Porque o que ele nao erra e a LEITURA -- ele le fielmente o que o arquivo
 * diz. Se a balanca exportou a coluna trocada, ou se alguem editou a planilha
 * a mao, o parser reproduz o erro com total fidelidade. A confirmacao humana
 * (INV-103) protege contra o dado errado, nao contra o parser errado.
 *
 * FORMATO ESPERADO -- cabecalho obrigatorio, colunas em qualquer ordem:
 *
 *     tipo,valor,unidade
 *     WEIGHT,90.5,kg
 *     BODY_FAT_PERCENT,24.1,percent
 *
 * Coluna `medido_em` opcional, ISO-8601, na primeira linha de dados.
 */
@Injectable()
export class CsvDocumentExtractorAdapter implements DocumentExtractor {
  extrair(pedido: PedidoDeExtracao): Promise<ResultadoDaExtracao> {
    if (pedido.tipo !== 'CSV') {
      return Promise.reject(
        new ErroDeExtracao(
          'EXTRACTOR_UNSUPPORTED_TYPE',
          false,
          `extrator de CSV nao le ${pedido.tipo}`,
        ),
      );
    }

    const texto = new TextDecoder('utf-8').decode(pedido.conteudo);
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
    const iMedidoEm = cabecalho.indexOf('medido_em');

    if (iTipo < 0 || iValor < 0) {
      throw new ErroDeExtracao(
        'EXTRACTOR_NO_CONTENT',
        false,
        'CSV sem as colunas obrigatorias `tipo` e `valor`',
      );
    }

    const campos: CampoProposto[] = [];
    let measuredAt: Date | null = null;

    for (const linha of linhas.slice(1)) {
      const celulas = linha.split(',').map((c) => c.trim());

      const tipo = celulas[iTipo]?.toUpperCase();
      const bruto = celulas[iValor]?.replace(',', '.');

      // Linha ilegivel e IGNORADA, nao derruba o arquivo: um CSV com dez
      // medidas e uma linha suja deve render nove propostas, e nao um erro
      // que obriga a recepcao a editar planilha.
      if (!tipo || !bruto) continue;
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
        // `null` e nao 1: o parser NAO mede confianca. Declarar 1 diria "tenho
        // certeza absoluta", e certeza sobre a leitura nao e certeza sobre o
        // dado.
        confidence: null,
        sourceLocation: `linha ${linhas.indexOf(linha) + 1}`,
      });

      if (measuredAt === null && iMedidoEm >= 0) {
        const data = celulas[iMedidoEm];

        if (data) {
          const instante = new Date(data);

          if (Number.isFinite(instante.getTime())) measuredAt = instante;
        }
      }
    }

    if (campos.length === 0) {
      throw new ErroDeExtracao(
        'EXTRACTOR_NO_CONTENT',
        false,
        'nenhuma linha do CSV produziu medida reconhecivel',
      );
    }

    return Promise.resolve({ campos, measuredAt, extractor: 'csv@1' });
  }
}

function ehTipoDeMedida(valor: string): valor is TipoDeMedida {
  return (TIPOS_DE_MEDIDA as readonly string[]).includes(valor);
}

function ehUnidade(valor: string): boolean {
  return (UNIDADES_DE_MEDIDA as readonly string[]).includes(valor);
}
