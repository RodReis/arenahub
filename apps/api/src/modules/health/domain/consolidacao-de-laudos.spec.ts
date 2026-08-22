import { describe, expect, it } from '@jest/globals';

import {
  campoQueVirouMedida,
  consolidar,
  desempatarPorOrigem,
  equivalentes,
  toleranciaDe,
} from './consolidacao-de-laudos.js';
import type { CampoExtraido } from './revisao-de-importacao.js';
import type { ArquivoDaSessao } from './sessao-de-revisao.js';

function campo(over: Partial<CampoExtraido> & Pick<CampoExtraido, 'id' | 'type'>): CampoExtraido {
  return {
    extractedValue: null, extractedUnit: null, confidence: null,
    sourceLocation: null, state: 'PENDING', reviewedValue: null,
    reviewedUnit: null, sourceLabel: null, importId: null,
    referenceMin: null, referenceMax: null, standardPercent: null,
    ...over,
  };
}

/** A sessao tipica: uma balanca, um app de analise, um ECG. */
const ARQUIVOS: readonly ArquivoDaSessao[] = [
  { importId: 'i1', sourceLabel: 'CF610_G', tipoDeLaudo: 'BIOIMPEDANCE' },
  { importId: 'i2', sourceLabel: 'Unique Health', tipoDeLaudo: 'UNKNOWN' },
  { importId: 'i3', sourceLabel: 'ECG 30s', tipoDeLaudo: 'ECG' },
];

describe('consolidar laudos da mesma medicao', () => {
  it('funde campo concordante numa linha so, citando as duas origens', () => {
    const linhas = consolidar([
      campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg', sourceLabel: 'CF610_G' }),
      campo({ id: 'b', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg', sourceLabel: 'Unique Health' }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.concordante).toBe(true);
    expect(linhas[0]!.origens).toEqual(['CF610_G', 'Unique Health']);
  });

  it('trata arredondamento diferente como o MESMO valor', () => {
    // 92,25 e 92,3 sao o mesmo peso escrito com precisao diferente.
    expect(
      equivalentes(
        campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg' }),
        campo({ id: 'b', type: 'WEIGHT', extractedValue: 92.3, extractedUnit: 'kg' }),
      ),
    ).toBe(true);
  });

  it('NAO funde divergencia real: duas linhas, para o humano escolher', () => {
    const linhas = consolidar([
      campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg', sourceLabel: 'CF610_G' }),
      campo({ id: 'b', type: 'WEIGHT', extractedValue: 88.10, extractedUnit: 'kg', sourceLabel: 'Unique Health' }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.concordante).toBe(false);
    expect(linhas[0]!.campos).toHaveLength(2);
  });

  it('NAO funde bpm de aparelhos diferentes -- sao medicoes distintas', () => {
    const linhas = consolidar([
      campo({ id: 'a', type: 'HEART_RATE', extractedValue: 89, extractedUnit: null, sourceLabel: 'Unique Health' }),
      campo({ id: 'b', type: 'HEART_RATE', extractedValue: 99, extractedUnit: null, sourceLabel: 'ECG 30s' }),
    ]);

    expect(linhas[0]!.concordante).toBe(false);
  });

  it('converte antes de comparar: 92,25 kg e 92250 g sao o mesmo peso', () => {
    expect(
      equivalentes(
        campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg' }),
        campo({ id: 'b', type: 'WEIGHT', extractedValue: 92_250, extractedUnit: 'g' }),
      ),
    ).toBe(true);
  });

  it('valor ausente NUNCA e zero e nunca equivale a outro (INV-104)', () => {
    expect(
      equivalentes(
        campo({ id: 'a', type: 'WEIGHT', extractedValue: null, extractedUnit: 'kg' }),
        campo({ id: 'b', type: 'WEIGHT', extractedValue: 0, extractedUnit: 'kg' }),
      ),
    ).toBe(false);
  });

  it('percentual tem tolerancia mais apertada que massa', () => {
    expect(toleranciaDe('BODY_FAT_PERCENT')).toBeLessThan(toleranciaDe('WEIGHT'));
  });

  it('valor implausivel contra valor normal NAO e equivalente, e NAO propaga o throw', () => {
    // 5000 kg esta fora de FAIXA_PLAUSIVEL (WEIGHT: 2 a 500) -- converterParaCanonica
    // lancaria MedidaInvalidaError. Essa divergencia e exatamente o que o humano
    // precisa ver, entao equivalentes() tem que devolver false, nunca propagar o throw.
    expect(
      equivalentes(
        campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg' }),
        campo({ id: 'b', type: 'WEIGHT', extractedValue: 5000, extractedUnit: 'kg' }),
      ),
    ).toBe(false);
  });

  it('preserva a ordem de primeira aparicao entre tipos diferentes', () => {
    // consolidar() agrupa por Map, cuja ordem de iteracao e a de insercao --
    // mas isso e detalhe de implementacao ate um teste travar o contrato.
    // Sem essa garantia, a tela de revisao poderia reordenar as linhas entre
    // recarregamentos sem nenhum dado ter mudado.
    const linhas = consolidar([
      campo({ id: 'a', type: 'WEIGHT', extractedValue: 92.25, extractedUnit: 'kg' }),
      campo({ id: 'b', type: 'BODY_FAT_PERCENT', extractedValue: 18.5, extractedUnit: 'percent' }),
    ]);

    expect(linhas.map((linha) => linha.type)).toEqual(['WEIGHT', 'BODY_FAT_PERCENT']);
  });
});

describe('desempate por origem -- so o bpm tem regra', () => {
  /**
   * O caso real que travou a publicacao automatica na primeira execucao ao
   * vivo: o app da balanca reporta 84 bpm de repouso e o ECG mede 92 em
   * trinta segundos. Sao medicoes diferentes do mesmo numero, e sem humano
   * para escolher (ADR-039) a confirmacao morria com "mais de um valor
   * aceito para HEART_RATE".
   *
   * Decisao do PI: o ECG vence. E o aparelho feito para medir coracao.
   */
  it('bpm: o ECG vence a balanca', () => {
    const [linha] = consolidar([
      campo({
        id: 'balanca',
        importId: 'i2',
        type: 'HEART_RATE',
        extractedValue: 84,
        state: 'CONFIRMED',
        sourceLabel: 'Unique Health',
      }),
      campo({
        id: 'ecg',
        importId: 'i3',
        type: 'HEART_RATE',
        extractedValue: 92,
        state: 'CONFIRMED',
        sourceLabel: 'ECG 30s',
      }),
    ]);

    expect(desempatarPorOrigem(linha!, ARQUIVOS)?.id).toBe('ecg');
  });

  /**
   * O criterio e o TIPO DE LAUDO da sessao, nunca o prefixo do nome do
   * arquivo. A versao anterior casava `sourceLabel` por prefixo (`'ECG'`),
   * e um arquivo chamado `ecg-agosto.pdf` que na verdade era a exportacao
   * da balanca venceria o ECG de verdade -- o nome do arquivo e escolhido
   * por quem anexa, e nao e evidencia de nada.
   */
  it('bpm: o vencedor sai do tipo do laudo, nao do nome do arquivo', () => {
    const arquivos: readonly ArquivoDaSessao[] = [
      { importId: 'i1', sourceLabel: 'ecg-agosto', tipoDeLaudo: 'BIOIMPEDANCE' },
      { importId: 'i2', sourceLabel: 'aparelho', tipoDeLaudo: 'ECG' },
    ];
    const [linha] = consolidar([
      campo({ id: 'a', importId: 'i1', type: 'HEART_RATE', extractedValue: 84, sourceLabel: 'ecg-agosto' }),
      campo({ id: 'b', importId: 'i2', type: 'HEART_RATE', extractedValue: 92, sourceLabel: 'aparelho' }),
    ]);

    expect(desempatarPorOrigem(linha!, arquivos)?.id).toBe('b');
  });

  /**
   * ADR-041: fora do bpm, a BALANCA vence. Antes desta decisao a funcao
   * devolvia `null` aqui e a confirmacao morria com
   * `MedidaDuplicadaNaSessaoError` -- o que era correto quando um humano
   * escolhia, e virou beco sem saida quando a publicacao passou a ser
   * automatica: ninguem esta ali para desempatar.
   *
   * O caso real da tela do PI: gordura 22,5 kg na balanca contra 20,0 kg no
   * app de analise. A balanca MEDIU; o app DERIVOU. Publica o que mediu.
   */
  it('peso divergente entre balanca e app: a balanca vence', () => {
    const [linha] = consolidar([
      campo({ id: 'balanca', importId: 'i1', type: 'WEIGHT', extractedValue: 92.1, extractedUnit: 'kg', sourceLabel: 'CF610_G' }),
      campo({ id: 'app', importId: 'i2', type: 'WEIGHT', extractedValue: 88.4, extractedUnit: 'kg', sourceLabel: 'Unique Health' }),
    ]);

    expect(desempatarPorOrigem(linha!, ARQUIVOS)?.id).toBe('balanca');
  });

  it('gordura divergente: publica o valor que a balanca mediu', () => {
    const [linha] = consolidar([
      campo({ id: 'balanca', importId: 'i1', type: 'BODY_FAT_MASS', extractedValue: 22.5, extractedUnit: 'kg', sourceLabel: 'CF610_G' }),
      campo({ id: 'app', importId: 'i2', type: 'BODY_FAT_MASS', extractedValue: 20.0, extractedUnit: 'kg', sourceLabel: 'Unique Health' }),
    ]);

    expect(desempatarPorOrigem(linha!, ARQUIVOS)?.id).toBe('balanca');
  });

  /**
   * A regra e por TIPO DE LAUDO, nunca por nome de arquivo: dois laudos de
   * bioimpedancia discordando e sinal de problema no aparelho, e escolher um
   * lado esconderia o defeito. Aqui nao ha balanca UNICA a favorecer.
   */
  it('dois laudos de bioimpedancia divergentes NAO se resolvem', () => {
    const doisBio: readonly ArquivoDaSessao[] = [
      { importId: 'i1', sourceLabel: 'CF610_G', tipoDeLaudo: 'BIOIMPEDANCE' },
      { importId: 'i2', sourceLabel: 'CF610_G bis', tipoDeLaudo: 'BIOIMPEDANCE' },
    ];
    const [linha] = consolidar([
      campo({ id: 'a', importId: 'i1', type: 'WEIGHT', extractedValue: 88.4, extractedUnit: 'kg', sourceLabel: 'CF610_G' }),
      campo({ id: 'b', importId: 'i2', type: 'WEIGHT', extractedValue: 92.1, extractedUnit: 'kg', sourceLabel: 'CF610_G bis' }),
    ]);

    expect(desempatarPorOrigem(linha!, doisBio)).toBeNull();
  });

  /**
   * Sem arquivo de bioimpedancia na sessao nao ha quem vencer -- e o
   * `sessaoPodeConfirmar` ja barra a sessao antes disso
   * (`BIOIMPEDANCE_REQUIRED`). O teste fixa que a funcao nao inventa um
   * vencedor quando a premissa dela nao vale.
   */
  it('sem balanca na sessao, nao ha desempate', () => {
    const soEcg: readonly ArquivoDaSessao[] = [
      { importId: 'i2', sourceLabel: 'ECG 30s', tipoDeLaudo: 'ECG' },
    ];
    const [linha] = consolidar([
      campo({ id: 'a', importId: 'i2', type: 'WEIGHT', extractedValue: 88.4, extractedUnit: 'kg', sourceLabel: 'ECG 30s' }),
      campo({ id: 'b', importId: 'i9', type: 'WEIGHT', extractedValue: 92.1, extractedUnit: 'kg', sourceLabel: 'outro' }),
    ]);

    expect(desempatarPorOrigem(linha!, soEcg)).toBeNull();
  });

  it('dois bpm do MESMO aparelho nao se resolvem -- o conflito e real', () => {
    const [linha] = consolidar([
      campo({ id: 'a', importId: 'i3', type: 'HEART_RATE', extractedValue: 84, sourceLabel: 'ECG 30s' }),
      campo({ id: 'b', importId: 'i3', type: 'HEART_RATE', extractedValue: 92, sourceLabel: 'ECG 30s' }),
    ]);

    expect(desempatarPorOrigem(linha!, ARQUIVOS)).toBeNull();
  });
});

/**
 * `campoQueVirouMedida` -- a fonte UNICA de "qual campo virou a medida".
 *
 * Existe porque a primeira versao respondia a mesma pergunta em dois lugares
 * com predicados diferentes (achado de revisao adversarial): o servico
 * contava campos ACEITOS e o controller contava campos BRUTOS. Estes testes
 * fixam o caso que os separava.
 */
describe('campoQueVirouMedida -- tela e banco respondem igual', () => {
  /**
   * O CASO QUE QUEBRAVA.
   *
   * Balanca le o bpm; o ECG nao consegue ler aquele campo (`null`). A linha
   * fica DIVERGENTE com dois campos, mas so UM aceito depois que a
   * publicacao automatica descarta o nulo.
   *
   * Pelo predicado antigo do controller (`campos.length === 2`) havia
   * desempate, e `laudoQueVence('HEART_RATE')` elegia o ECG -- um campo
   * DESCARTADO e vazio. O banco, contando aceitos, gravava o da balanca. A
   * tela apontava para um campo que o historico nao guardou.
   */
  it('campo descartado NAO vence, mesmo sendo do laudo com precedencia', () => {
    const [linha] = consolidar([
      campo({
        id: 'balanca',
        importId: 'i1',
        type: 'HEART_RATE',
        extractedValue: 65,
        state: 'CONFIRMED',
        sourceLabel: 'CF610_G',
      }),
      campo({
        id: 'ecg-ilegivel',
        importId: 'i3',
        type: 'HEART_RATE',
        extractedValue: null,
        state: 'DISCARDED',
        sourceLabel: 'ECG 30s',
      }),
    ]);

    expect(campoQueVirouMedida(linha!, ARQUIVOS)?.id).toBe('balanca');
  });

  it('com os DOIS aceitos, o bpm continua indo para o ECG', () => {
    const [linha] = consolidar([
      campo({
        id: 'balanca',
        importId: 'i1',
        type: 'HEART_RATE',
        extractedValue: 65,
        state: 'CONFIRMED',
        sourceLabel: 'CF610_G',
      }),
      campo({
        id: 'ecg',
        importId: 'i3',
        type: 'HEART_RATE',
        extractedValue: 92,
        state: 'CONFIRMED',
        sourceLabel: 'ECG 30s',
      }),
    ]);

    expect(campoQueVirouMedida(linha!, ARQUIVOS)?.id).toBe('ecg');
  });

  it('com os DOIS aceitos fora do bpm, a balanca vence', () => {
    const [linha] = consolidar([
      campo({
        id: 'balanca',
        importId: 'i1',
        type: 'BODY_FAT_MASS',
        extractedValue: 22.5,
        extractedUnit: 'kg',
        state: 'CONFIRMED',
        sourceLabel: 'CF610_G',
      }),
      campo({
        id: 'app',
        importId: 'i2',
        type: 'BODY_FAT_MASS',
        extractedValue: 20.0,
        extractedUnit: 'kg',
        state: 'CONFIRMED',
        sourceLabel: 'Unique Health',
      }),
    ]);

    expect(campoQueVirouMedida(linha!, ARQUIVOS)?.id).toBe('balanca');
  });

  /** Nenhum campo aceito -- a linha inteira fica fora da avaliacao. */
  it('sem campo aceito, nao ha medida', () => {
    const [linha] = consolidar([
      campo({ id: 'a', importId: 'i1', type: 'WEIGHT', extractedValue: null, state: 'DISCARDED' }),
    ]);

    expect(campoQueVirouMedida(linha!, ARQUIVOS)).toBeNull();
  });

  /**
   * Dois laudos do MESMO tipo, ambos aceitos e discordando: defeito de
   * aparelho. Nao ha vencedor, e o conflito precisa subir -- e o que faz o
   * servico lancar `MedidaDuplicadaNaSessaoError` e a tela avisar que o
   * campo ficou de fora.
   */
  it('dois laudos do mesmo tipo, ambos aceitos: sem vencedor', () => {
    const doisBio: readonly ArquivoDaSessao[] = [
      { importId: 'i1', sourceLabel: 'CF610_G', tipoDeLaudo: 'BIOIMPEDANCE' },
      { importId: 'i2', sourceLabel: 'CF610_G bis', tipoDeLaudo: 'BIOIMPEDANCE' },
    ];
    const [linha] = consolidar([
      campo({
        id: 'a',
        importId: 'i1',
        type: 'WEIGHT',
        extractedValue: 88.4,
        extractedUnit: 'kg',
        state: 'CONFIRMED',
      }),
      campo({
        id: 'b',
        importId: 'i2',
        type: 'WEIGHT',
        extractedValue: 92.1,
        extractedUnit: 'kg',
        state: 'CONFIRMED',
      }),
    ]);

    expect(campoQueVirouMedida(linha!, doisBio)).toBeNull();
  });
});

/**
 * A ordem das linhas e CANONICA, nunca a ordem em que os campos chegaram.
 *
 * Regressao observada ao vivo: sem ordenacao explicita, a tela seguia a
 * ordem fisica das linhas do Postgres. "Peso" aparecia na 1a linha num
 * carregamento e na 10a no seguinte -- so porque a publicacao automatica
 * reescreveu o `state` dos campos e o Postgres moveu as tuplas.
 */
describe('ordem das linhas consolidadas', () => {
  it('segue TIPOS_DE_MEDIDA, nao a ordem de entrada', () => {
    const linhas = consolidar([
      campo({ id: 'a', type: 'VISCERAL_FAT_LEVEL', extractedValue: 8 }),
      campo({ id: 'b', type: 'WEIGHT', extractedValue: 88.4, extractedUnit: 'kg' }),
      campo({ id: 'c', type: 'SKELETAL_MUSCLE_MASS', extractedValue: 37.2, extractedUnit: 'kg' }),
      campo({ id: 'd', type: 'HEIGHT', extractedValue: 180, extractedUnit: 'cm' }),
    ]);

    // Peso e altura primeiro -- e o que quem confere procura no topo do laudo.
    expect(linhas.map((linha) => linha.type)).toEqual([
      'WEIGHT',
      'HEIGHT',
      'SKELETAL_MUSCLE_MASS',
      'VISCERAL_FAT_LEVEL',
    ]);
  });

  it('a ordem nao depende da ordem de entrada -- entradas invertidas, mesma saida', () => {
    const direta = consolidar([
      campo({ id: 'a', type: 'WEIGHT', extractedValue: 88.4, extractedUnit: 'kg' }),
      campo({ id: 'b', type: 'BODY_FAT_PERCENT', extractedValue: 20, extractedUnit: 'percent' }),
    ]);
    const invertida = consolidar([
      campo({ id: 'b', type: 'BODY_FAT_PERCENT', extractedValue: 20, extractedUnit: 'percent' }),
      campo({ id: 'a', type: 'WEIGHT', extractedValue: 88.4, extractedUnit: 'kg' }),
    ]);

    expect(invertida.map((l) => l.type)).toEqual(direta.map((l) => l.type));
  });
});
