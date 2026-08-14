import { randomUUID } from 'node:crypto';

import { type ExternalEnrollId } from './facial-device.js';

/**
 * Geracao do identificador da pessoa no dispositivo.
 *
 * A Slice 0.2 exige, com todas as letras: `externalEnrollId` **nao derivado
 * do CPF**. O motivo nao e estetico.
 *
 * Derivar do CPF -- mesmo com hash -- transformaria o dispositivo num
 * oraculo: com a base de CPFs do Brasil e o mesmo algoritmo, qualquer um
 * confirma se um CPF esta cadastrado, ou reidentifica quem esta. Hash nao
 * resolve, porque o espaco de CPF e pequeno e enumeravel (10^11, e a maioria
 * invalida pelo digito verificador). Salt por pessoa tambem nao ajuda: o
 * salt teria de viajar junto, e ai nao e mais segredo.
 *
 * Identificador opaco e sem relacao com PII resolve por construcao: nao ha o
 * que derivar nem o que confirmar.
 */

/**
 * Comprimento maximo tipico de identificador em dispositivo de controle de
 * acesso. UUID sem hifen tem 32 caracteres e cabe com folga.
 *
 * O limite REAL do equipamento so se conhece com o SDK -- ate la, 32 e
 * conservador. Se o dispositivo aceitar menos, isto muda com o adapter real
 * e a mudanca quebra este teste, que e o comportamento desejado.
 */
const COMPRIMENTO = 32;

/** Gera um identificador opaco, sem relacao com dado da pessoa. */
export function gerarExternalEnrollId(): ExternalEnrollId {
  return randomUUID().replaceAll('-', '');
}

/** Formato aceito: 32 caracteres hexadecimais minusculos. */
const FORMATO = /^[0-9a-f]{32}$/;

export function ehExternalEnrollIdValido(valor: string): boolean {
  return valor.length === COMPRIMENTO && FORMATO.test(valor);
}

/**
 * Erro de quem tentou usar dado de pessoa como identificador.
 *
 * Existe para falhar ALTO na hora, e nao virar dado ruim no dispositivo --
 * de onde sair depois exige acesso fisico ou o SDK.
 */
export class ExternalEnrollIdInvalidoError extends Error {
  readonly code = 'EDGE_ENROLL_ID_INVALIDO';

  constructor(razao: string) {
    super(`externalEnrollId invalido: ${razao}`);
    this.name = 'ExternalEnrollIdInvalidoError';
  }
}

/** Sequencia de 11 digitos -- o formato de um CPF, com ou sem mascara. */
const PARECE_CPF = /(?:^|\D)(\d{11})(?:\D|$)/;
const PARECE_CPF_MASCARADO = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

/**
 * Valida antes de mandar para o dispositivo.
 *
 * A checagem de CPF e uma REDE DE SEGURANCA, nao a regra. A regra e usar
 * `gerarExternalEnrollId`. Isto existe porque a alternativa -- descobrir que
 * alguem passou CPF quando o dado ja esta no equipamento -- e cara demais.
 */
export function validarExternalEnrollId(valor: string): ExternalEnrollId {
  if (valor.length === 0) {
    throw new ExternalEnrollIdInvalidoError('vazio');
  }

  if (PARECE_CPF.test(valor) || PARECE_CPF_MASCARADO.test(valor)) {
    throw new ExternalEnrollIdInvalidoError(
      'parece um CPF. A Slice 0.2 proibe identificador derivado de CPF -- ' +
        'use gerarExternalEnrollId()',
    );
  }

  if (!ehExternalEnrollIdValido(valor)) {
    throw new ExternalEnrollIdInvalidoError(
      `esperado ${COMPRIMENTO} caracteres hexadecimais, recebido ${valor.length}`,
    );
  }

  return valor;
}
