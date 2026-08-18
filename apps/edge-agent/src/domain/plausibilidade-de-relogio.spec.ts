import { describe, expect, it } from '@jest/globals';

import {
  RAZAO_IMPLAUSIVEL,
  RastreadorDeRelogio,
  TOLERANCIA_FUTURO_MS,
  avaliarRelogio,
} from './plausibilidade-de-relogio.js';

const RECEBIDO = new Date('2026-08-17T18:47:28.000Z');

describe('avaliarRelogio — decisao 3 da SPEC-002', () => {
  it('aceita o horario do equipamento quando ele e plausivel', () => {
    const ocorridoEm = new Date(RECEBIDO.getTime() - 2_000);

    expect(avaliarRelogio(ocorridoEm, RECEBIDO, null)).toEqual({
      ordenarPor: ocorridoEm,
      implausivel: false,
    });
  });

  it('ordena pelo recebimento quando o equipamento manda data invalida', () => {
    // `interpretarDataHora` devolve NaN quando o formato foge do esperado.
    // Sem este ramo, o NaN entraria no ORDER BY e embaralharia a fila em
    // silencio.
    expect(avaliarRelogio(new Date(Number.NaN), RECEBIDO, null)).toEqual({
      ordenarPor: RECEBIDO,
      implausivel: true,
      razao: RAZAO_IMPLAUSIVEL.INVALIDO,
    });
  });

  it('ordena pelo recebimento quando o horario repete o ultimo visto', () => {
    // O caso medido em 17/08: `ocorridoEm` congelado em 15:47:28 em todos os
    // reconhecimentos. Repetido nao e "ao mesmo tempo", e relogio parado.
    const congelado = new Date('2026-08-17T15:47:28.000Z');

    expect(avaliarRelogio(congelado, RECEBIDO, congelado)).toEqual({
      ordenarPor: RECEBIDO,
      implausivel: true,
      razao: RAZAO_IMPLAUSIVEL.NAO_AVANCOU,
    });
  });

  it('ordena pelo recebimento quando o horario retrocede', () => {
    const ultimoVisto = new Date('2026-08-17T15:47:28.000Z');
    const retrocedido = new Date(ultimoVisto.getTime() - 1);

    expect(avaliarRelogio(retrocedido, RECEBIDO, ultimoVisto)).toEqual({
      ordenarPor: RECEBIDO,
      implausivel: true,
      razao: RAZAO_IMPLAUSIVEL.NAO_AVANCOU,
    });
  });

  it('aceita um milissegundo de avanco sobre o ultimo visto', () => {
    // A fronteira entre "nao avancou" e "avancou" e onde erro de sinal se
    // esconde: testar so "ontem" e "amanha" deixaria `>` e `>=` iguais.
    const ultimoVisto = new Date('2026-08-17T15:47:28.000Z');
    const avancou = new Date(ultimoVisto.getTime() + 1);

    expect(avaliarRelogio(avancou, RECEBIDO, ultimoVisto).implausivel).toBe(false);
  });

  it('ordena pelo recebimento quando o horario esta no futuro alem da tolerancia', () => {
    const futuro = new Date(RECEBIDO.getTime() + TOLERANCIA_FUTURO_MS + 1);

    expect(avaliarRelogio(futuro, RECEBIDO, null)).toEqual({
      ordenarPor: RECEBIDO,
      implausivel: true,
      razao: RAZAO_IMPLAUSIVEL.FUTURO,
    });
  });

  it('aceita o futuro dentro da tolerancia', () => {
    // Todo relogio desliza. Tratar 30 s de adiantamento como defeito
    // carimbaria fallback em bancada saudavel.
    const futuroTolerado = new Date(RECEBIDO.getTime() + TOLERANCIA_FUTURO_MS);

    expect(avaliarRelogio(futuroTolerado, RECEBIDO, null).implausivel).toBe(false);
  });

  it('nao usa o recebimento quando ele proprio e invalido', () => {
    // Fallback quebrado e pior que ausente: um NaN no ORDER BY nao aparece
    // como erro, aparece como fila fora de ordem.
    const ocorridoEm = new Date(Number.NaN);

    expect(() => avaliarRelogio(ocorridoEm, new Date(Number.NaN), null)).toThrow(TypeError);
  });
});

describe('RastreadorDeRelogio — memoria por dispositivo', () => {
  it('nao deixa um dispositivo contaminar a regua do outro', () => {
    // O motivo de a memoria ser por dispositivo. Dois leitores intercalando
    // eventos legitimos marcariam um ao outro como retrocesso se a regua
    // fosse global -- e o MVP 1 poe dois leitores na mesma unidade.
    const rastreador = new RastreadorDeRelogio();

    const leitorA = new Date('2026-08-17T15:00:10.000Z');
    const leitorB = new Date('2026-08-17T15:00:05.000Z');

    expect(rastreador.avaliar('leitor-a', leitorA, RECEBIDO).implausivel).toBe(false);
    expect(rastreador.avaliar('leitor-b', leitorB, RECEBIDO).implausivel).toBe(false);
  });

  it('avanca a regua so com horario plausivel', () => {
    // Aceitar o implausivel envenenaria a regua: um timestamp de 2099 faria
    // todo evento seguinte parecer retrocesso.
    const rastreador = new RastreadorDeRelogio();

    const bom = new Date('2026-08-17T15:00:10.000Z');
    const futuroAbsurdo = new Date('2099-01-01T00:00:00.000Z');
    const seguinte = new Date('2026-08-17T15:00:11.000Z');

    rastreador.avaliar('leitor-a', bom, RECEBIDO);
    rastreador.avaliar('leitor-a', futuroAbsurdo, RECEBIDO);

    expect(rastreador.avaliar('leitor-a', seguinte, RECEBIDO).implausivel).toBe(false);
  });

  it('trata o congelamento medido em 17/08 do segundo evento em diante', () => {
    // O primeiro evento nao tem com o que comparar: e plausivel por falta de
    // regua, nao por acerto. O congelamento so se revela no segundo.
    const rastreador = new RastreadorDeRelogio();
    const congelado = new Date('2026-08-17T15:47:28.000Z');

    expect(rastreador.avaliar('facial', congelado, RECEBIDO).implausivel).toBe(false);

    const segundo = rastreador.avaliar('facial', congelado, new Date(RECEBIDO.getTime() + 60_000));

    expect(segundo).toEqual({
      ordenarPor: new Date(RECEBIDO.getTime() + 60_000),
      implausivel: true,
      razao: RAZAO_IMPLAUSIVEL.NAO_AVANCOU,
    });
  });
});
