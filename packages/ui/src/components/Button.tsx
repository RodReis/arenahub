import type { ButtonHTMLAttributes } from 'react';

import estilos from './Button.module.css';

type Variant = 'solid' | 'outline' | 'ghost' | 'destructive';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
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
export function Button({ variant = 'solid', type = 'button', ...resto }: Props) {
  return <button {...resto} type={type} data-variant={variant} className={estilos['botao']} />;
}
