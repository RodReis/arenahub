import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

import estilos from './Button.module.css';

type Variant = 'solid' | 'outline' | 'ghost' | 'destructive';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  /**
   * Presente, o componente renderiza um `<a>` de verdade em vez de `<button>`.
   *
   * BOTAO QUE NAVEGA TEM DE SER LINK. Um `<button onClick={navegar}>` perde
   * abrir em nova aba, copiar endereco, arrastar para a barra de favoritos e
   * o anuncio de "link" do leitor de tela -- e nenhuma dessas coisas se
   * recupera com JavaScript.
   *
   * A alternativa era cada tela montar seu proprio `<a>` com a classe do
   * botao, que e o que "Cadastrar aluno", "Novo aluno" e o `EmptyState` ja
   * faziam de tres jeitos diferentes.
   */
  readonly href?: string;
}

/**
 * Botao do painel -- DS-PAINEL.md §6. Altura 36 px, raio 6 px.
 *
 * `type="button"` por padrao porque o default do HTML e `submit`: um
 * "Cancelar" dentro de `<form>` enviaria o formulario sem que ninguem tivesse
 * escrito `type`.
 *
 * O VERBO REAL do botao destrutivo ("Revogar biometria", nunca "OK") e
 * responsabilidade de quem chama -- o componente so garante que a variante
 * exista e pareca perigosa.
 */
export function Button({ variant = 'solid', type = 'button', href, ...resto }: Props) {
  /*
   * `type` NAO acompanha o `<a>`: em ancora o atributo significa "tipo MIME do
   * destino", nao "papel no formulario" -- um `type="button"` ali seria
   * invalido e enganaria quem lesse o HTML.
   */
  if (href !== undefined) {
    const props = resto as AnchorHTMLAttributes<HTMLAnchorElement>;

    return <a {...props} href={href} data-variant={variant} className={estilos['botao']} />;
  }

  return <button {...resto} type={type} data-variant={variant} className={estilos['botao']} />;
}
