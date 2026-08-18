import type { ReactNode, SelectHTMLAttributes } from 'react';

import estilos from './Field.module.css';

interface Props extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  /** Obrigatorio: e o que liga `<label htmlFor>` ao controle. */
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  /**
   * Frase de erro. Presente, liga `aria-invalid` e vira a descricao do campo.
   *
   * NAO limpa a selecao: §6 diz que formulario nunca perde dado em erro
   * recuperavel. Quem chama passa o `defaultValue` de volta.
   */
  readonly error?: string;
  /** Marca invalido SEM frase propria -- ver `Field`. */
  readonly invalid?: boolean;
  readonly children: ReactNode;
}

/**
 * Campo de selecao -- DS-PAINEL.md §6.
 *
 * O inventario do §9 nao listava `select`, e cinco dos seis formularios do
 * painel dependem dele. Cada tela remontava `<p><label><select>` por conta
 * propria, e o resultado media 19px de altura contra os 36px do contrato --
 * mais estreito que o alvo de toque de 24px do WCAG 2.2.
 *
 * `<select>` NATIVO, e nao combobox de biblioteca. Tres motivos, nesta ordem:
 * o teclado, o leitor de tela e o toque ja funcionam sem que ninguem os
 * reimplemente; o PRODUCT.md proibe "reinventar afordancia padrao para dar
 * sabor"; e o E2E le `<option>` para conferir que so transicoes validas
 * aparecem, o que um combobox de `<div>` quebraria.
 *
 * Reusa `Field.module.css` de proposito: rotulo, dica, erro e anel de foco sao
 * o mesmo contrato visual. Duplicar o CSS garantiria que os dois divergissem
 * na primeira correcao.
 */
export function SelectField({ id, label, hint, error, invalid, children, ...resto }: Props) {
  const invalido = Boolean(error) || Boolean(invalid);
  const idDaDica = `${id}-dica`;
  const idDoErro = `${id}-erro`;

  /** Erro vence a dica -- mesma regra do `Field`. */
  const descricao = error ? idDoErro : hint ? idDaDica : undefined;

  return (
    <div className={estilos['campo']}>
      <label className={estilos['rotulo']} htmlFor={id}>
        {label}
      </label>

      <div className={estilos['moldura']} data-erro={invalido ? 'true' : undefined}>
        <select
          {...resto}
          id={id}
          className={estilos['controle']}
          aria-invalid={invalido ? true : undefined}
          aria-describedby={descricao}
        >
          {children}
        </select>

        {/*
          Seta DECORATIVA, desenhada em CSS.
        
          Nao usa `Icon` porque o catalogo de icones e FECHADO e nao tem
          `chevron-down` -- e abrir o catalogo para uma seta de select seria
          promover decoracao a vocabulario semantico. `aria-hidden` porque quem
          usa leitor de tela ouve o proprio `<select>` se anunciar como
          combobox; a seta repetiria isso em ruido.
        */}
        <span className={estilos['seta']} aria-hidden="true" />
      </div>

      {hint && !error ? (
        <span className={estilos['dica']} id={idDaDica}>
          {hint}
        </span>
      ) : null}

      {error ? (
        <span className={estilos['erro']} id={idDoErro}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
