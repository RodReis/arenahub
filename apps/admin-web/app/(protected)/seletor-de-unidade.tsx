'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useTransition } from 'react';

import estilos from './seletor-de-unidade.module.css';

interface Unidade {
  readonly id: string;
  readonly name: string;
}

interface Props {
  readonly unidades: readonly Unidade[];
  /** Rótulo de fallback quando não há o que selecionar. */
  readonly vazio: string;
}

/**
 * Seletor de unidade da topbar — F57.
 *
 * Era um indicador ESTÁTICO até 01/09/2026: mostrava o nome quando havia uma
 * unidade e "2 unidades" quando havia mais, porque a troca dependia de decisão
 * de produto sobre persistência e escopo de sessão. O dashboard forçou a
 * decisão — sem unidade escolhida não existe "hoje", e "hoje" é o bloco 2.
 *
 * ## A escolha vive na URL, não em cookie nem em estado
 *
 * Três razões, nesta ordem:
 *
 * 1. **Compartilhável.** O gerente manda "olha a filial hoje" colando o link.
 *    Estado em memória não se manda por WhatsApp.
 * 2. **Sobrevive ao recarregamento**, que numa recepção acontece o dia todo.
 * 3. **O servidor lê antes de renderizar.** Cookie exigiria uma segunda
 *    passada; `searchParams` chega junto com a requisição.
 *
 * Com UMA unidade ativa não há o que selecionar: ela É o contexto, e o
 * componente vira rótulo — um `<select>` de uma opção só é um botão que não
 * faz nada.
 */
export function SeletorDeUnidade({ unidades, vazio }: Props) {
  const router = useRouter();
  const caminho = usePathname();
  const parametros = useSearchParams();
  const id = useId();
  const [navegando, iniciarNavegacao] = useTransition();

  if (unidades.length === 0) {
    return (
      <span className={estilos['rotulo']} data-testid="unidade-ativa">
        {vazio}
      </span>
    );
  }

  if (unidades.length === 1) {
    return (
      <span className={estilos['rotulo']} data-testid="unidade-ativa">
        {unidades[0]?.name ?? vazio}
      </span>
    );
  }

  /*
   * SEM PADRÃO SILENCIOSO. Com duas unidades e nenhuma na URL, cair na
   * primeira faria o seletor exibi-la como escolhida enquanto o dashboard diz
   * "escolha uma unidade" — dois estados contraditórios na mesma tela. Pior:
   * escolher justamente aquela não dispararia `onChange` (o valor não muda) e
   * a pessoa ficaria presa, clicando na opção certa sem efeito.
   *
   * A opção vazia é a saída: ela EXISTE enquanto ninguém escolheu, e some
   * assim que alguém escolhe — um placeholder permanente na lista seria um
   * item que não leva a lugar nenhum.
   */
  const atual = parametros.get('unidade') ?? '';

  const trocar = (proximaUnidade: string) => {
    const proximos = new URLSearchParams(parametros.toString());
    proximos.set('unidade', proximaUnidade);

    iniciarNavegacao(() => {
      router.push(`${caminho}?${proximos.toString()}`);
    });
  };

  return (
    <span className={estilos['caixa']} data-navegando={navegando}>
      {/*
        Rótulo visualmente escondido e não `aria-label`: leitor de tela
        anuncia os dois igual, mas o rótulo real sobrevive a tradução
        automática de página, que descarta atributo.
      */}
      <label className={estilos['acessivel']} htmlFor={id}>
        Unidade
      </label>

      {/*
        `<select>` NATIVO, e não combobox: a lista tem duas ou três unidades,
        e o DS reserva combobox para lista longa. Nativo também é o que o E2E
        opera com `selectOption`, e o que funciona no teclado sem uma linha de
        JS de nossa parte.
      */}
      <select
        className={estilos['select']}
        data-testid="unidade-ativa"
        id={id}
        onChange={(evento) => trocar(evento.target.value)}
        value={atual}
      >
        {atual === '' ? (
          <option disabled value="">
            Selecione a unidade
          </option>
        ) : null}
        {unidades.map((unidade) => (
          <option key={unidade.id} value={unidade.id}>
            {unidade.name}
          </option>
        ))}
      </select>
    </span>
  );
}
