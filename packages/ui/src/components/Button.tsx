import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

import estilos from './Button.module.css';

type Variant = 'solid' | 'outline' | 'ghost' | 'destructive' | 'icon';

interface PropsBase extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Exclude<Variant, 'icon'>;
  /**
   * OBRIGATORIO, e nao herdado por spread: botao ou link sem conteudo e
   * anunciado pelo leitor de tela como um alvo sem nome -- quem navega por
   * audio ouve "link" e nada mais. `ButtonHTMLAttributes` traz `children`
   * opcional; aqui ele deixa de ser.
   *
   * Tambem e o que a `jsx-a11y/anchor-has-content` (issue #112) precisa
   * enxergar: com `children` no spread ela nao consegue provar que o `<a>`
   * tem conteudo, e acusa o componente sem que exista defeito. Explicito,
   * a regra le o que o tipo ja garante.
   */
  readonly children: ReactNode;
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
 * A variante `icon` EXIGE `aria-label`, e o tipo e quem garante isso.
 *
 * Icone sozinho nao tem nome acessivel: quem navega por audio ouve "link" e
 * nada mais. Documentar a exigencia num comentario nao impede o esquecimento
 * -- o tipo impede, e o erro aparece em `pnpm typecheck` em vez de numa
 * auditoria de acessibilidade seis meses depois.
 *
 * `data-acao` marca o icone que MUDA ESTADO (liberar catraca), em oposicao
 * ao que navega. So ele carrega a cor de acao -- accent e acao, carbono e
 * estrutura (DS-PAINEL §2.3).
 */
interface PropsDeIcone extends Omit<PropsBase, 'variant'> {
  readonly variant: 'icon';
  readonly 'aria-label': string;
  readonly 'data-acao'?: boolean;
}

type Props = PropsBase | PropsDeIcone;

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
export function Button({ variant = 'solid', type = 'button', href, children, ...resto }: Props) {
  /*
   * `type` NAO acompanha o `<a>`: em ancora o atributo significa "tipo MIME do
   * destino", nao "papel no formulario" -- um `type="button"` ali seria
   * invalido e enganaria quem lesse o HTML.
   */
  if (href !== undefined) {
    const props = resto as AnchorHTMLAttributes<HTMLAnchorElement>;

    return (
      <a {...props} href={href} data-variant={variant} className={estilos['botao']}>
        {children}
      </a>
    );
  }

  return (
    <button {...resto} type={type} data-variant={variant} className={estilos['botao']}>
      {children}
    </button>
  );
}
