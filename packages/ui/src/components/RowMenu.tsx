'use client';

import { useId, useRef, type ReactNode } from 'react';

import { Icon, type IconName } from './Icon.js';
import estilos from './RowMenu.module.css';

export interface ItemDeMenu {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** Presente, o item e um link de verdade -- abre em nova aba, copia endereco. */
  readonly href?: string;
  readonly onSelect?: () => void;
  /** Ultimo do menu, separado por regua e em tom de perigo. */
  readonly perigo?: boolean;
}

interface Props {
  /** Nome acessivel do gatilho. Ex.: "Acoes de Arena Positiva". */
  readonly label: string;
  readonly itens: readonly ItemDeMenu[];
  readonly testId?: string;
}

/** Sobra minima entre o menu e a borda da janela, para ele nunca colar. */
const MARGEM = 8;

/**
 * Menu de acoes de uma linha de tabela.
 *
 * POPOVER NATIVO, e a escolha e tecnica: a `.rolagem` do `DataTable` e
 * `overflow-x: auto`, e qualquer menu posicionado dentro dela seria cortado
 * na linha proxima da borda. A camada superior do navegador escapa do
 * recorte, e traz Esc, clique-fora e fechamento mutuo de graca -- tres
 * comportamentos que um menu artesanal erra um por um.
 *
 * QUATRO ACOES NUMA LINHA NAO CABEM ABERTAS. A 1280px (o monitor do balcao),
 * "Contratos", "Faturas", "Editar" e "Inativar" lado a lado reservam mais de
 * 400px e empurram as colunas de numero para fora da tela -- e sao justamente
 * os numeros que o dono do SaaS abre a lista para ver.
 */
export function RowMenu({ label, itens, testId }: Props) {
  const id = useId().replace(/:/g, '');
  const gatilho = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  /**
   * Ancora o menu ao gatilho no instante da abertura.
   *
   * Medir no `toggle` e nao antes: a linha pode ter rolado desde a montagem, e
   * coordenada guardada cedo demais abre o menu onde a linha ESTAVA.
   */
  const ancorar = (evento: React.ToggleEvent<HTMLDivElement>): void => {
    if (evento.newState !== 'open') return;

    const botao = gatilho.current;
    const caixa = menu.current;

    if (botao === null || caixa === null) return;

    const alvo = botao.getBoundingClientRect();
    const largura = caixa.offsetWidth;
    const altura = caixa.offsetHeight;

    /*
      ALINHADO A DIREITA do gatilho, que fica na ultima coluna: alinhar a
      esquerda jogaria o menu inteiro para fora da janela.
    */
    const esquerda = Math.max(MARGEM, Math.min(alvo.right - largura, window.innerWidth - largura - MARGEM));

    /*
      VIRA PARA CIMA quando nao ha espaco abaixo -- na ultima linha da tabela o
      menu ficaria metade fora da janela, e a acao destrutiva e justamente a
      que fica no fim dele.
    */
    const cabeAbaixo = alvo.bottom + altura + MARGEM <= window.innerHeight;
    const topo = cabeAbaixo ? alvo.bottom + 4 : Math.max(MARGEM, alvo.top - altura - 4);

    caixa.style.left = `${esquerda}px`;
    caixa.style.top = `${topo}px`;
  };

  const fechar = (): void => {
    menu.current?.hidePopover();
  };

  return (
    <>
      <button
        ref={gatilho}
        type="button"
        popoverTarget={id}
        className={estilos['gatilho']}
        aria-label={label}
        data-testid={testId}
      >
        <Icon name="more-vertical" />
      </button>

      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        className={estilos['menu']}
        onToggle={ancorar}
      >
        {itens.map((item, indice) => {
          const anterior = itens[indice - 1];
          const abreSecao = item.perigo === true && anterior?.perigo !== true && indice > 0;

          const conteudo: ReactNode = (
            <>
              <Icon name={item.icon} />
              {item.label}
            </>
          );

          return (
            <div key={item.id}>
              {/*
                `<hr>` E NAO `<div role="separator">`: o div vazio nao e
                exposto na arvore de acessibilidade -- ele nao tem conteudo, e
                o papel sozinho nao basta. O `<hr>` ja carrega `separator`
                nativamente, e entra na arvore.
              */}
              {abreSecao ? <hr className={estilos['regua']} /> : null}

              {item.href !== undefined ? (
                <a
                  href={item.href}
                  role="menuitem"
                  className={estilos['item']}
                  data-perigo={item.perigo === true ? 'true' : undefined}
                  data-testid={`menu-${item.id}`}
                >
                  {conteudo}
                </a>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={estilos['item']}
                  data-perigo={item.perigo === true ? 'true' : undefined}
                  onClick={() => {
                    /*
                      FECHA ANTES de agir: a acao costuma abrir um dialogo ou
                      navegar, e um popover aberto por cima de um dialogo
                      rouba o foco que o dialogo acabou de tomar.
                    */
                    fechar();
                    item.onSelect?.();
                  }}
                  data-testid={`menu-${item.id}`}
                >
                  {conteudo}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
