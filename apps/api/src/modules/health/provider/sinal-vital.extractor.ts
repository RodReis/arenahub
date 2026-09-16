import { Injectable } from '@nestjs/common';

import type { TipoDeSinalVital } from '../domain/sinal-vital.js';
import { ErroDeExtracao } from './document-extractor.port.js';
import { textoDoPdf } from './texto-do-pdf.js';

/**
 * Extrator de PDF para `HealthMeasurement` (sinal vital avulso, card #345).
 *
 * ESCOPO DESTA ENTREGA: so FC de repouso, do MESMO formato de PDF de ECG
 * (AliveCor via OmronConnect) que `LaudoBioimpedanciaExtractor` ja le para
 * `BodyMeasurement`. Pressao e saturacao ficam SO MANUAIS -- sem PDF real de
 * exemplo, escrever parser de regex seria inventar formato (decisao do PI).
 *
 * Regex identica a `laudo-bioimpedancia.extractor.ts` de proposito: e o
 * MESMO aparelho, mesmo texto. Nao compartilha a funcao com aquele arquivo
 * porque o resultado tem forma DIFERENTE -- aqui vira `SinalVitalExtraido`,
 * atrelado a `HealthMeasurement`, nunca a `CampoProposto`/`BodyMeasurement`
 * (os dois fluxos sao standalone, ver comentario do model no schema).
 */
export interface SinalVitalExtraido {
  readonly type: TipoDeSinalVital;
  readonly value: number;
  readonly measuredAt: Date | null;
  /** Texto opaco do aparelho -- guardado e citado, nunca interpretado (ADR-035). */
  readonly deviceReport: Record<string, unknown>;
}

@Injectable()
export class SinalVitalExtractor {
  async extrairDePdf(conteudo: Uint8Array): Promise<SinalVitalExtraido> {
    const texto = await textoDoPdf(conteudo);

    const ehEcg = /Analise instantanea:/i.test(texto) || /Frequencia cardiaca:/i.test(texto);

    if (!ehEcg) {
      throw new ErroDeExtracao(
        'EXTRACTOR_NO_CONTENT',
        false,
        'texto nao contem marcadores de ECG reconhecidos',
      );
    }

    const bpm = capturar(texto, /Frequencia cardiaca:\s*(\d+(?:[.,]\d+)?)\s*BPM/i);

    if (!bpm) {
      throw new ErroDeExtracao(
        'EXTRACTOR_NO_CONTENT',
        false,
        'PDF de ECG sem frequencia cardiaca reconhecivel',
      );
    }

    const valor = Number(bpm.replace(',', '.'));

    if (!Number.isFinite(valor)) {
      throw new ErroDeExtracao('EXTRACTOR_NO_CONTENT', false, 'frequencia cardiaca ilegivel');
    }

    const achado = capturar(texto, /Analise instantanea:\s*(.+)/i);
    const linhaTags = capturar(texto, /Tags:\s*(.+)/i);
    const duracao = capturar(texto, /Duracao:\s*(\d+(?:[.,]\d+)?)\s*s/i);
    const gravadoEm = capturar(texto, /Gravado:\s*(.+)/i);
    const observacoes = capturar(texto, /Observacoes:\s*(.+)/i);

    const deviceReport: Record<string, unknown> = {};

    if (achado) deviceReport['ecgFinding'] = achado;
    if (linhaTags) deviceReport['ecgTags'] = linhaTags.split(',').map((tag) => tag.trim());
    if (duracao) deviceReport['ecgDurationSeconds'] = Number(duracao.replace(',', '.'));
    if (gravadoEm) deviceReport['ecgRecordedAt'] = gravadoEm;
    if (observacoes) deviceReport['ecgNotes'] = observacoes;

    return {
      type: 'RESTING_HEART_RATE',
      value: valor,
      // `Gravado: quarta-feira, 12 de agosto de 2026 as 09:03:34` nao e
      // formato que `Date` do JS analisa -- `null` obriga quem chama a
      // digitar o instante, mesmo raciocinio de `measuredAt: null` na F19:
      // melhor pedir a data do que assumir "agora" e errar a posicao no
      // historico. O texto bruto sobrevive em `deviceReport.ecgRecordedAt`.
      measuredAt: null,
      deviceReport,
    };
  }
}

function capturar(texto: string, expressao: RegExp): string | null {
  const resultado = expressao.exec(texto);

  return resultado?.[1]?.trim() ?? null;
}
