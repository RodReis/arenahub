import type { InputHTMLAttributes, ReactNode } from 'react';

import { Icon, type IconName } from './Icon.js';
import estilos from './Field.module.css';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Obrigatorio: e o que liga `<label htmlFor>` ao controle. */
  readonly id: string;
  readonly label: string;
  /**
   * Icone DECORATIVO dentro do campo. O rotulo ja diz o que o campo e -- o
   * icone so ajuda a achar a linha de relance, entao vai `aria-hidden`.
   */
  readonly icon?: IconName;
  /**
   * Controle ancorado a direita, dentro da borda do campo (ex.: revelar
   * senha). Fica como slot para o `Field` seguir Server Component: quem
   * precisa de estado passa um filho `'use client'`.
   */
  readonly trailing?: ReactNode;
  /**
   * Unidade de medida -- renderizada AO LADO do rotulo, nunca no placeholder
   * (DS-PAINEL.md §6).
   */
  readonly unit?: string;
  readonly hint?: string;
  /**
   * Frase de erro. Presente, liga `aria-invalid` e vira a descricao do campo.
   *
   * O componente NAO limpa o valor: §6 diz que formulario nunca perde dado em
   * erro recuperavel. Quem chama passa o `defaultValue` de volta.
   */
  readonly error?: string;
  /**
   * Marca o campo como invalido SEM frase propria -- para formulario cujo erro
   * e unico e ja esta anunciado num `role="alert"` acima (o login e o caso).
   * Repetir a frase em cada campo faria o leitor de tela le-la tres vezes.
   */
  readonly invalid?: boolean;
}

/**
 * Campo de formulario -- DS-PAINEL.md §6.
 *
 * Existe como componente porque a associacao rotulo/controle/erro e o que mais
 * se perde quando cada tela remonta o mesmo `<div><label><input>`: o
 * `aria-describedby` some, e o erro deixa de ser lido junto do campo que o
 * causou.
 */
export function Field({ id, label, unit, hint, error, invalid, icon, trailing, ...resto }: Props) {
  const invalido = Boolean(error) || Boolean(invalid);
  const idDaDica = `${id}-dica`;
  const idDoErro = `${id}-erro`;

  /**
   * Erro vence a dica: quem errou precisa ouvir o que corrigir, nao a
   * instrucao que ja nao serviu.
   */
  const descricao = error ? idDoErro : hint ? idDaDica : undefined;

  return (
    <div className={estilos['campo']}>
      <label className={estilos['rotulo']} htmlFor={id}>
        {label}
        {unit ? <span className={estilos['unidade']}>{unit}</span> : null}
      </label>

      <div className={estilos['moldura']} data-erro={invalido ? 'true' : undefined}>
        {icon ? (
          <span className={estilos['adorno']}>
            <Icon name={icon} />
          </span>
        ) : null}

        <input
          {...resto}
          id={id}
          className={estilos['controle']}
          aria-invalid={invalido ? true : undefined}
          aria-describedby={descricao}
        />

        {trailing}
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
