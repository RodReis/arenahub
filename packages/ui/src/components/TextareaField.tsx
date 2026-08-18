import type { TextareaHTMLAttributes } from 'react';

import estilos from './Field.module.css';

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  /** Obrigatorio: e o que liga `<label htmlFor>` ao controle. */
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  /**
   * Frase de erro. Presente, liga `aria-invalid` e vira a descricao do campo.
   *
   * NAO limpa o texto: §6 diz que formulario nunca perde dado em erro
   * recuperavel -- e aqui isso pesa mais que em qualquer outro campo. O motivo
   * de uma liberacao manual tem minimo de dez caracteres e vai ser lido numa
   * auditoria; perde-lo por erro de validacao faria a recepcao redigir tudo de
   * novo com a pessoa esperando.
   */
  readonly error?: string;
  /** Marca invalido SEM frase propria -- ver `Field`. */
  readonly invalid?: boolean;
}

/**
 * Campo de texto longo -- DS-PAINEL.md §6.
 *
 * O inventario do §9 nao listava `textarea`, e tres formularios do painel
 * dependem dele: motivo de liberacao manual, motivo de atribuicao de plano e
 * descricao de plano. Todos remontavam `<p><label><textarea>` sem estilo.
 *
 * Reusa `Field.module.css` -- rotulo, dica, erro e anel de foco sao o mesmo
 * contrato. O que muda e a altura: a moldura do `Field` e fixa em 36px, e
 * texto de varias linhas precisa crescer.
 */
export function TextareaField({ id, label, hint, error, invalid, rows = 3, ...resto }: Props) {
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

      <div
        className={`${estilos['moldura']} ${estilos['moldura-alta']}`}
        data-erro={invalido ? 'true' : undefined}
      >
        <textarea
          {...resto}
          id={id}
          rows={rows}
          className={`${estilos['controle']} ${estilos['controle-alto']}`}
          aria-invalid={invalido ? true : undefined}
          aria-describedby={descricao}
        />
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
