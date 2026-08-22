import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { LaudoBioimpedanciaExtractor } from './laudo-bioimpedancia.extractor.js';

const diretorioAtual = dirname(fileURLToPath(import.meta.url));

/**
 * Fixtures ficam em `test/fixtures/health` (fora de `src`, fora do
 * `testMatch` do jest) porque sao dado, nao codigo de teste -- mesma
 * convencao que os demais dublês de arquivo do modulo `health`.
 *
 * O FIXTURE DE ECG E UM PDF DE VERDADE, e isso importa.
 *
 * Ate aqui era um `.txt` com o texto ja extraido -- ou seja, o fixture ERA o
 * resultado do passo que o extrator nao executava. A suite passava provando
 * a metade que existia, enquanto o ECG real (PDF do OmronConnect) falhava em
 * producao com `EXTRACTOR_NO_CONTENT`: os bytes comprimidos do PDF eram
 * decodificados como UTF-8 e viravam lixo.
 *
 * Com o PDF, o teste exercita a cadeia inteira: camada de texto -> regex ->
 * campo. Dublê que ja entrega o resultado do passo sob teste nao testa nada.
 */
function lerFixture(nome: string): Uint8Array {
  const caminho = join(diretorioAtual, '..', '..', '..', '..', 'test', 'fixtures', 'health', nome);

  return new Uint8Array(readFileSync(caminho));
}

/**
 * PDF 1.4 minimo com camada de texto, montado a mao.
 *
 * Existe para o teste do laudo ACENTUADO, que precisa de conteudo diferente
 * do fixture. Sem compressao e sem lib: o objetivo e provar que a camada de
 * texto e lida, nao exercitar o compressor do PDF.
 */
function gerarPdfDeTexto(texto: string): string {
  const escapar = (linha: string) => linha.replace(/[\\()]/g, (c) => `\\${c}`);
  const fluxo = `BT /F1 12 Tf 50 750 Td 14 TL\n${texto
    .split('\n')
    .map((linha) => `(${escapar(linha)}) Tj T*`)
    .join('\n')}\nET`;

  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${String(fluxo.length)} >>\nstream\n${fluxo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const posicoes: number[] = [];

  for (const [indice, objeto] of objetos.entries()) {
    posicoes.push(pdf.length);
    pdf += `${String(indice + 1)} 0 obj\n${objeto}\nendobj\n`;
  }

  const inicioXref = pdf.length;

  pdf += `xref\n0 ${String(objetos.length + 1)}\n0000000000 65535 f \n`;
  for (const posicao of posicoes) {
    pdf += `${String(posicao).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${String(objetos.length + 1)} /Root 1 0 R >>\nstartxref\n${String(inicioXref)}\n%%EOF\n`;

  return pdf;
}

describe('extrator de laudo de bioimpedancia', () => {
  const extrator = new LaudoBioimpedanciaExtractor();

  it('le os segmentares com faixa e percentual do padrao', async () => {
    const r = await extrator.extrair({
      tipo: 'CSV',
      conteudo: lerFixture('laudo-cf610g-sintetico.csv'),
    });
    const tronco = r.campos.find((c) => c.type === 'SEGMENTAL_FAT_MASS_TRUNK');

    expect(tronco?.value).toBeCloseTo(10.4, 2);
    expect(tronco?.standardPercent).toBeCloseTo(230.1, 1);
  });

  it('guarda faixa de referencia junto do campo', async () => {
    const r = await extrator.extrair({
      tipo: 'CSV',
      conteudo: lerFixture('laudo-cf610g-sintetico.csv'),
    });
    const peso = r.campos.find((c) => c.type === 'WEIGHT');

    expect(peso?.referenceMin).toBeCloseTo(60.6, 1);
    expect(peso?.referenceMax).toBeCloseTo(82.0, 1);
  });

  it('classifica o laudo e rotula a origem', async () => {
    const r = await extrator.extrair({
      tipo: 'CSV',
      conteudo: lerFixture('laudo-cf610g-sintetico.csv'),
    });

    expect(r.tipoDeLaudo).toBe('BIOIMPEDANCE');
    expect(r.sourceLabel).toBe('CF610_G');
  });

  it('classifica o laudo da Unique Health como BIOIMPEDANCE mesmo sem segmentar', async () => {
    // Fix round 1: a regra estreita (so segmentar ou SKELETAL_MUSCLE_MASS)
    // recusava este laudo -- ele traz massa ossea, massa celular e relacao
    // cintura-quadril, sem nenhum segmentar. Sessao com so este arquivo
    // seria bloqueada por falta de bioimpedancia (Task 4).
    const r = await extrator.extrair({
      tipo: 'CSV',
      conteudo: lerFixture('laudo-unique-health-sintetico.csv'),
    });

    expect(r.tipoDeLaudo).toBe('BIOIMPEDANCE');
  });

  it('NAO classifica como BIOIMPEDANCE um CSV so com HEART_RATE (formato do ECG)', async () => {
    const extrator2 = new LaudoBioimpedanciaExtractor();
    const csvSoFrequencia = 'tipo,valor,unidade\nHEART_RATE,84,\n';

    const r = await extrator2.extrair({
      tipo: 'CSV',
      conteudo: new TextEncoder().encode(csvSoFrequencia),
    });

    expect(r.tipoDeLaudo).toBe('UNKNOWN');
  });

  it('le bpm do ECG como MEDIDA e o achado como ATRIBUTO', async () => {
    const r = await extrator.extrair({
      tipo: 'PDF',
      conteudo: lerFixture('ecg-omron-sintetico.pdf'),
    });

    expect(r.campos.find((c) => c.type === 'HEART_RATE')?.value).toBe(92);
    expect(r.atributos?.['ecgFinding']).toBe('Ritmo nao classificado');
    expect(r.atributos?.['ecgTags']).toEqual(['Atividade:Alta']);
    expect(r.tipoDeLaudo).toBe('ECG');
  });

  /**
   * O LAUDO REAL E EM PT-BR, COM ACENTO -- e os padroes daqui nao tem.
   *
   * O Omron imprime "Frequência cardíaca" e "Análise instantânea"; os regex
   * deste extrator sao escritos sem acento. Sem a normalizacao `NFD`, o PDF
   * seria lido CORRETAMENTE e ainda assim nenhum campo casaria -- falha
   * identica a de antes, com causa diferente e muito mais dificil de achar.
   *
   * Testado sobre o TEXTO, nao sobre um PDF gerado aqui: a `Helvetica` de um
   * PDF sintetico usa StandardEncoding, que mapeia byte acentuado para glifo
   * errado ("Frequˆ“ncia"). O laudo de verdade carrega o encoding da
   * propria fonte e sai acentuado; um PDF montado a mao provaria o contrario
   * do que interessa.
   */
  it('normaliza acento antes de casar os padroes', async () => {
    const semAcento = 'Frequência cardíaca: 78 BPM\nAnálise instantânea: Ritmo não classificado'
      .normalize('NFD')
      .replace(new RegExp('[̀-ͯ]', 'gu'), '');

    expect(semAcento).toContain('Frequencia cardiaca: 78 BPM');
    expect(semAcento).toContain('Analise instantanea: Ritmo nao classificado');

    // E o extrator lê esse texto normalizado sem tropeço.
    const r = await extrator.extrair({
      tipo: 'PDF',
      conteudo: new TextEncoder().encode(gerarPdfDeTexto(semAcento)),
    });

    expect(r.campos.find((c) => c.type === 'HEART_RATE')?.value).toBe(78);
    expect(r.atributos?.['ecgFinding']).toBe('Ritmo nao classificado');
  });

  /**
   * PDF ilegivel falha com CODIGO DE DOMINIO, nao com estouro do parser.
   *
   * Arquivo corrompido, protegido por senha ou que so tem tracado (sem camada
   * de texto) e o caso COMUM nesta tela. A sessao inteira nao pode cair por
   * causa dele -- `import.service.ts` conta com `EXTRACTOR_NO_CONTENT` para
   * publicar a bioimpedancia mesmo assim.
   */
  it('PDF ilegivel vira EXTRACTOR_NO_CONTENT, nao excecao crua', async () => {
    await expect(
      extrator.extrair({
        tipo: 'PDF',
        conteudo: new TextEncoder().encode('isto nao e um PDF'),
      }),
    ).rejects.toMatchObject({ codigo: 'EXTRACTOR_NO_CONTENT' });
  });

  it('NAO transforma indice do fabricante em medida', async () => {
    const r = await extrator.extrair({
      tipo: 'CSV',
      conteudo: lerFixture('laudo-unique-health-sintetico.csv'),
    });

    // Idade corporal, pontuacao e peso ideal sao atributos (spec §4.4):
    // formula proprietaria muda com firmware e produziria tendencia falsa.
    expect(r.campos.some((c) => String(c.type).includes('BODY_AGE'))).toBe(false);
  });

  it('guarda as recomendacoes do aparelho como atributo, nunca como medida', async () => {
    const r = await extrator.extrair({
      tipo: 'CSV',
      conteudo: lerFixture('laudo-unique-health-sintetico.csv'),
    });

    // INV-151: as cinco recomendacoes viram `deviceReport`, nao medida.
    expect(r.atributos).toMatchObject({
      deviceStandardWeightKg: 82.1,
      deviceWeightControlKg: -10.1,
      deviceFatControlKg: -10.1,
      deviceMuscleControlKg: 0,
      deviceRecommendedIntakeKcal: 2437,
    });

    // O OUTRO LADO DA MESMA REGRA -- o que o teste acima nao pega.
    //
    // Guardar como atributo so respeita a INV-151 se elas tambem NAO
    // entrarem em `campos`: um tipo que caisse nos dois lugares apareceria
    // no grafico de evolucao, que e exatamente o que a invariante impede.
    const tiposMedidos = r.campos.map((c) => String(c.type));

    for (const proibido of [
      'STANDARD_WEIGHT',
      'WEIGHT_CONTROL',
      'FAT_CONTROL',
      'MUSCLE_CONTROL',
      'RECOMMENDED_INTAKE',
    ]) {
      expect(tiposMedidos).not.toContain(proibido);
    }

    // Indice puro (idade corporal, pontuacao) nao vira NEM medida nem
    // atributo -- so as cinco recomendacoes que a tela exibe sao captadas.
    expect(r.atributos?.['BODY_AGE']).toBeUndefined();
    expect(r.atributos?.['HEALTH_SCORE']).toBeUndefined();

    // E o laudo continua produzindo as medidas de verdade.
    expect(tiposMedidos).toContain('WEIGHT');
  });

  it('nao inventa zero quando a recomendacao vem ilegivel (INV-104)', async () => {
    const r = await extrator.extrair({
      tipo: 'CSV',
      conteudo: new TextEncoder().encode(
        ['tipo,valor,unidade', 'WEIGHT,88.4,kg', 'STANDARD_WEIGHT,--,kg'].join('\n'),
      ),
    });

    // Ausencia NAO E ZERO: a chave some, e a tela mostra "sem valor" em vez
    // de um `0 kg` que o laudo nunca disse.
    expect(r.atributos?.['deviceStandardWeightKg']).toBeUndefined();
  });
});
