import { randomInt } from 'node:crypto';

import { type ExternalEnrollId } from './facial-device.js';

/**
 * Identificador da pessoa NO DISPOSITIVO.
 *
 * O FORMATO VEM DO EQUIPAMENTO, NAO DA NOSSA CONVENIENCIA. O manual e
 * explicito: "Corresponde ao identificador do usuario. Obrigatorio que o
 * valor deve estar compreendido entre 1 e 999.999.999.999" -- numerico, 12
 * digitos. Ver docs/vendor/topdata/PROTOCOLO-FACIAL.md.
 *
 * A primeira versao usava UUID hexadecimal de 32 caracteres, escrita antes
 * de a documentacao chegar. Nao cabia. O erro so apareceria na bancada, com
 * o leitor recusando todo cadastro -- e por isso a correcao veio antes do
 * adapter real existir.
 *
 * ⚠️ CONFIGURACAO DE BANCADA: o leitor precisa estar em "18 digitos" no
 * menu (Usuarios -> Op. de inscricao -> Formato de ID de usuario) para
 * aceitar os 12 digitos do SDK. Em 9 digitos, o cadastro falha.
 *
 * A REGRA QUE NAO MUDOU: nao derivar de CPF.
 *
 * Derivar -- mesmo com hash -- transformaria o dispositivo num oraculo: o
 * espaco de CPF e pequeno e enumeravel, entao qualquer um com a base e o
 * mesmo algoritmo confirma quem esta cadastrado. Agora o risco e MAIOR que
 * antes: 11 digitos de CPF cabem folgadamente nos 12 do enrollid, entao a
 * tentacao de usar CPF direto e real.
 */

/** Limite do equipamento: 999.999.999.999 (12 digitos). */
export const ENROLL_ID_MAXIMO = 999_999_999_999;

/**
 * Piso da faixa que usamos: 100.000.000.000.
 *
 * Fixar 12 digitos exatos tem duas vantagens praticas -- todo id tem o mesmo
 * tamanho no log e na tela do equipamento, e nenhum id gerado por nos colide
 * com os numeros baixos que o software de fabrica usa (a bancada tem
 * usuarios em `enrollid` 1, 2, 3...).
 */
export const ENROLL_ID_MINIMO = 100_000_000_000;

/**
 * Gera um identificador opaco dentro da faixa do equipamento.
 *
 * `randomInt` do node:crypto, nao Math.random: identificador previsivel num
 * sistema de controle de acesso e problema, nao detalhe.
 *
 * A faixa tem 9 * 10^11 valores. Com 5.000 usuarios -- a capacidade maxima
 * do leitor, segundo a especificacao tecnica -- a chance de colisao e da
 * ordem de 10^-5. O indice unico do banco pega o resto, e o teste do
 * repositorio prova.
 */
export function gerarExternalEnrollId(): ExternalEnrollId {
  return String(randomInt(ENROLL_ID_MINIMO, ENROLL_ID_MAXIMO + 1));
}

export function ehExternalEnrollIdValido(valor: string): boolean {
  if (!/^\d+$/.test(valor)) return false;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= 1 && numero <= ENROLL_ID_MAXIMO;
}

export class ExternalEnrollIdInvalidoError extends Error {
  readonly code = 'EDGE_ENROLL_ID_INVALIDO';

  constructor(razao: string) {
    super(`externalEnrollId invalido: ${razao}`);
    this.name = 'ExternalEnrollIdInvalidoError';
  }
}

/**
 * CPF cru: exatamente 11 digitos.
 *
 * Aqui a checagem importa MAIS que na versao anterior. Antes, o formato do
 * id era hexadecimal e um CPF ja destoaria; agora o id e numerico e um CPF
 * de 11 digitos passa no formato sem esforco. A rede de seguranca virou a
 * unica barreira.
 */
const E_CPF_CRU = /^\d{11}$/;

/** CPF mascarado: 000.000.000-00, com separadores de verdade. */
const E_CPF_MASCARADO = /^\d{3}[.\s]\d{3}[.\s]\d{3}[-\s]\d{2}$/;

/** CPF com rotulo: `user-12345678901`, `cpf:...`. */
const E_CPF_ROTULADO = /^[a-z_-]{1,12}[:_-]?\d{11}$/i;

/**
 * Valida antes de mandar para o dispositivo.
 *
 * A checagem de CPF e REDE DE SEGURANCA, nao a regra. A regra e usar
 * `gerarExternalEnrollId`. Isto existe porque descobrir que alguem passou
 * CPF depois de o dado estar no equipamento e caro demais.
 */
export function validarExternalEnrollId(valor: string): ExternalEnrollId {
  if (valor.length === 0) {
    throw new ExternalEnrollIdInvalidoError('vazio');
  }

  if (E_CPF_CRU.test(valor) || E_CPF_MASCARADO.test(valor) || E_CPF_ROTULADO.test(valor)) {
    throw new ExternalEnrollIdInvalidoError(
      'parece um CPF. A Slice 0.2 proibe identificador derivado de CPF -- ' +
        'use gerarExternalEnrollId()',
    );
  }

  if (!ehExternalEnrollIdValido(valor)) {
    throw new ExternalEnrollIdInvalidoError(
      `o equipamento aceita numero de 1 a ${ENROLL_ID_MAXIMO} (12 digitos); ` +
        `recebido ${JSON.stringify(valor)}`,
    );
  }

  return valor;
}
