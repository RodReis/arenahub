'use client';

import { useState, type ChangeEvent, type TextareaHTMLAttributes } from 'react';

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
  const { maxLength, defaultValue, value, onChange } = resto;

  /*
   * CONTADOR AO VIVO quando ha `maxLength` -- issue do PI em 11/09/2026.
   *
   * O `maxLength` do HTML so barra DIGITACAO: texto que ja veio do servidor
   * maior que o teto entra inteiro no campo, e o navegador nao reclama. Numa
   * `textarea` de 4 linhas com rolagem, quem abre le as duas primeiras linhas
   * e nao tem como saber que existem 500 caracteres abaixo -- o excesso so
   * aparecia ao salvar, num toast que some, sem dizer quanto sobra cortar.
   *
   * Estado inicial a partir do valor RENDERIZADO, controlado ou nao: sem isto
   * o campo ja carregado abriria marcando zero.
   */
  const inicial = String(value ?? defaultValue ?? '');
  const [usados, setUsados] = useState(inicial.length);

  /*
   * `value` manda quando ha: num campo controlado o pai e a verdade, e o
   * estado local so serve ao caso nao controlado (`defaultValue`), que e o que
   * os formularios de Server Action deste painel usam.
   */
  const total = value === undefined ? usados : String(value).length;
  const excedido = maxLength !== undefined && total > maxLength;
  const invalido = Boolean(error) || Boolean(invalid) || excedido;

  const idDaDica = `${id}-dica`;
  const idDoErro = `${id}-erro`;
  const idDoContador = `${id}-contador`;

  /** Erro vence a dica -- mesma regra do `Field`. */
  const descricaoBase = error ? idDoErro : hint ? idDaDica : undefined;

  /*
   * O contador entra na descricao ACESSIVEL do campo, e nao so na tela: quem
   * usa leitor de tela ouve "480 de 500" ao entrar no campo em vez de
   * descobrir o teto ao ser recusado.
   */
  const descricao =
    maxLength === undefined
      ? descricaoBase
      : [descricaoBase, idDoContador].filter(Boolean).join(' ');

  function aoMudar(evento: ChangeEvent<HTMLTextAreaElement>) {
    setUsados(evento.target.value.length);
    onChange?.(evento);
  }

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
          onChange={aoMudar}
        />
      </div>

      <div className={estilos['rodape-do-campo']}>
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

        {/*
          NUMERO E TETO, nunca so o quanto falta: "480 de 500" diz de uma vez
          onde esta e onde e o limite. "20 restantes" obriga a somar para
          descobrir se o texto cabe em outro campo.

          `aria-live` fica FORA daqui de proposito -- anunciar a cada tecla
          digitada tornaria o campo inutilizavel no leitor de tela. O numero
          e lido por `aria-describedby`, que anuncia ao entrar no campo, e o
          excesso tem a borda vermelha e a frase de erro como canal.
        */}
        {maxLength === undefined ? null : (
          <span
            className={estilos['contador']}
            id={idDoContador}
            data-excedido={excedido ? 'true' : undefined}
            data-testid={`${id}-contador`}
          >
            {excedido
              ? `${total - maxLength} caracteres a mais que o limite de ${maxLength}`
              : `${total} de ${maxLength}`}
          </span>
        )}
      </div>
    </div>
  );
}
