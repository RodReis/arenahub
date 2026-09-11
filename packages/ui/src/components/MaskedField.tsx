'use client';

import { useState } from 'react';

import { Field } from './Field.js';

type PropsDeField = Parameters<typeof Field>[0];

interface Props extends Omit<PropsDeField, 'value' | 'onChange' | 'defaultValue'> {
  /**
   * A funcao de mascara -- pura, recebe o que foi digitado e devolve o que
   * deve aparecer. Vem de `lib/mascaras` do painel; o design system nao
   * conhece CPF nem CNPJ, so sabe aplicar a funcao a cada tecla.
   */
  readonly mascara: (valor: string) => string;
  readonly defaultValue?: string;
}

/**
 * Campo de texto com MASCARA DE DIGITACAO -- CNPJ, dinheiro, porcentagem.
 *
 * A MASCARA RODA A CADA TECLA, nunca no `blur`: campo que so se formata ao
 * sair deixa quem digita sem saber se ja pos os catorze digitos, e o erro
 * aparece um campo tarde demais.
 *
 * CONTROLADO POR DENTRO, com `name` intacto: o valor mascarado e o que vai no
 * `FormData`, e a Server Action ja limpa pontuacao (todas as tres limpam --
 * CNPJ, dinheiro e indice). Deixar a tela enviar o texto cru e o que permite
 * ao servidor recusar `12.345.678/0001-95` e `12345678000195` do mesmo jeito.
 *
 * O VALOR INICIAL PASSA PELA MASCARA uma vez: ele vem do banco, e pode ter
 * sido gravado sem pontuacao por uma versao anterior da tela. Sem isso, abrir
 * o cadastro de um cliente antigo mostraria o documento cru dentro de um campo
 * que promete formatar.
 */
export function MaskedField({ mascara, defaultValue = '', ...resto }: Props) {
  const [valor, setValor] = useState(() => mascara(defaultValue));

  return (
    <Field
      {...resto}
      value={valor}
      onChange={(evento) => setValor(mascara(evento.target.value))}
    />
  );
}
