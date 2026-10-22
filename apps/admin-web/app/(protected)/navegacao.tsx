'use client';

import { Icon, NavLink } from '@arenahub/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';

import estilos from './navegacao.module.css';

/**
 * Navegação principal — F46, issue #99; grupos recolhíveis desde 22/10/2026.
 *
 * `'use client'` num shell que é todo servidor precisa de justificativa, e a
 * daqui vem da documentação do Next: **ler o pathname no servidor não é
 * suportado**, e layout não re-renderiza na navegação. Passar a rota de cima
 * daria um valor congelado no primeiro carregamento — a sidebar marcaria a
 * tela de entrada para sempre, que é pior que não marcar nada.
 *
 * GRUPOS RECOLHÍVEIS — pedido do PI (22/10/2026): o menu crescia na vertical
 * a cada tela nova. Os itens soltos do topo (Dashboard, Operação, Eventos de
 * acesso) ficam sempre à vista: são as telas de quando a catraca dá problema.
 * Cada grupo abre e fecha; o da tela atual abre sozinho; o que a pessoa abrir
 * ou fechar fica lembrado neste navegador.
 */
interface Item {
  readonly href: string;
  readonly label: string;
  /**
   * Rótulo do grupo que COMEÇA neste item.
   *
   * Modelado no item e não numa lista aninhada de propósito: o layout filtra
   * por permissão e reancora o rótulo (`reancorarGrupos`) numa lista plana.
   * Aqui a lista vira seções só para desenhar.
   */
  readonly grupo?: string;
  /**
   * Capacidade que o usuario precisa ter para o item aparecer (F54).
   *
   * O FILTRO ACONTECE NO SERVIDOR, no layout -- este campo esta aqui so para
   * o tipo bater.
   */
  readonly exigePermissao?: string;
}

interface Secao {
  readonly grupo: string | null;
  readonly itens: readonly Item[];
}

/** Onde a escolha de cada grupo (aberto/fechado) fica lembrada. */
const CHAVE_DOS_GRUPOS = 'arenahub.menu.grupos';

/** Mesmo corte do `AppShell`: abaixo dele a sidebar vira faixa horizontal. */
const FAIXA_HORIZONTAL = '(max-width: 1279px)';

// Sem `matchMedia` (ambiente sem layout, como o jsdom) vale o caso do balcão: vertical.
function temMatchMedia(): boolean {
  return typeof window.matchMedia === 'function';
}

function emFaixaHorizontal(): boolean {
  return temMatchMedia() && window.matchMedia(FAIXA_HORIZONTAL).matches;
}

function assinarFaixa(aoMudar: () => void): () => void {
  if (!temMatchMedia()) return () => undefined;

  const consulta = window.matchMedia(FAIXA_HORIZONTAL);

  consulta.addEventListener('change', aoMudar);

  return () => consulta.removeEventListener('change', aoMudar);
}

function lerEscolhas(): Record<string, boolean> {
  try {
    const salvo = window.localStorage.getItem(CHAVE_DOS_GRUPOS);
    const lido: unknown = salvo === null ? {} : JSON.parse(salvo);

    return typeof lido === 'object' && lido !== null ? (lido as Record<string, boolean>) : {};
  } catch {
    // Armazenamento bloqueado ou corrompido: o menu segue com o padrão.
    return {};
  }
}

function gravarEscolhas(escolhas: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(CHAVE_DOS_GRUPOS, JSON.stringify(escolhas));
  } catch {
    // Sem armazenamento a escolha vale só nesta página — o menu funciona igual.
  }
}

/** A lista plana vira seções: itens antes do primeiro grupo ficam soltos. */
function emSecoes(itens: readonly Item[]): Secao[] {
  return itens.reduce<Secao[]>((secoes, item) => {
    const ultima = secoes.at(-1);

    if (item.grupo !== undefined || ultima === undefined) {
      return [...secoes, { grupo: item.grupo ?? null, itens: [item] }];
    }

    return [...secoes.slice(0, -1), { ...ultima, itens: [...ultima.itens, item] }];
  }, []);
}

export function Navegacao({ itens }: { readonly itens: readonly Item[] }) {
  const rota = usePathname();
  const atual = itemAtual(rota, itens);
  const secoes = emSecoes(itens);
  const grupoAtual =
    secoes.find((secao) => secao.itens.some((item) => item.href === atual))?.grupo ?? null;

  /*
    Na faixa horizontal tudo fica aberto: recolher itens lado a lado esconderia
    telas sem economizar o espaço que o recolher existe para poupar. No
    servidor a resposta é "vertical" -- é o caso do balcão a 1280px.
  */
  const horizontal = useSyncExternalStore(assinarFaixa, emFaixaHorizontal, () => false);
  const [escolhas, setEscolhas] = useState<Record<string, boolean>>({});

  // O que ficou lembrado só existe no navegador: lê depois de montar.
  useEffect(() => {
    setEscolhas(lerEscolhas());
  }, []);

  /*
    Entrar numa tela abre o grupo dela, mesmo que a pessoa o tenha fechado
    antes -- o item marcado nunca fica escondido dentro de um grupo fechado.
  */
  useEffect(() => {
    if (grupoAtual === null) return;

    setEscolhas((anteriores) =>
      anteriores[grupoAtual] === true ? anteriores : { ...anteriores, [grupoAtual]: true },
    );
  }, [grupoAtual]);

  function alternar(grupo: string, aberto: boolean): void {
    setEscolhas((anteriores) => {
      const proximas = { ...anteriores, [grupo]: !aberto };

      gravarEscolhas(proximas);

      return proximas;
    });
  }

  return (
    <>
      {secoes.map((secao) =>
        secao.grupo === null ? (
          secao.itens.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} current={item.href === atual} />
          ))
        ) : (
          <Grupo
            key={secao.grupo}
            titulo={secao.grupo}
            itens={secao.itens}
            atual={atual}
            aberto={horizontal || (escolhas[secao.grupo] ?? secao.grupo === grupoAtual)}
            recolhivel={!horizontal}
            contemAtual={secao.grupo === grupoAtual}
            aoAlternar={alternar}
          />
        ),
      )}
    </>
  );
}

interface PropsDoGrupo {
  readonly titulo: string;
  readonly itens: readonly Item[];
  readonly atual: string | null;
  readonly aberto: boolean;
  readonly recolhivel: boolean;
  readonly contemAtual: boolean;
  readonly aoAlternar: (grupo: string, aberto: boolean) => void;
}

/**
 * Um grupo do menu: cabeçalho que abre e fecha, e os links dele.
 *
 * O rótulo continua `<h2>` — quem navega por cabeçalho no leitor de tela pula
 * direto à seção — com um botão dentro (padrão de disclosure: `aria-expanded`
 * e `aria-controls`). Fechado, o painel fica `inert`: os links saem da ordem
 * de tabulação em vez de receber foco invisível.
 */
function Grupo({ titulo, itens, atual, aberto, recolhivel, contemAtual, aoAlternar }: PropsDoGrupo) {
  const idDoPainel = useId();
  const idDoRotulo = useId();

  return (
    // `div` e não `section`: o painel tem regra global de `section` como cartão.
    <div
      role="group"
      aria-labelledby={idDoRotulo}
      className={estilos['grupo']}
      data-aberto={aberto ? 'true' : undefined}
    >
      <h2 className={estilos['cabecalho']} id={idDoRotulo}>
        {recolhivel ? (
          <button
            type="button"
            className={estilos['alternar']}
            aria-expanded={aberto}
            aria-controls={idDoPainel}
            onClick={() => aoAlternar(titulo, aberto)}
          >
            <span className={estilos['rotulo']}>{titulo}</span>
            {/*
              Fechado e com a tela atual dentro: o ponto diz "você está aqui",
              e o texto acessível diz o mesmo -- cor nunca é canal único.
            */}
            {!aberto && contemAtual ? (
              <span className={estilos['aqui']}>
                <span className={estilos['oculto']}>(tela atual)</span>
              </span>
            ) : null}
            <span className={estilos['seta']} aria-hidden="true">
              <Icon name="chevron-down" />
            </span>
          </button>
        ) : (
          <span className={estilos['rotulo']}>{titulo}</span>
        )}
      </h2>
      <div id={idDoPainel} className={estilos['painel']} inert={!aberto}>
        <div className={estilos['itens']}>
          {itens.map((item, indice) => (
            <span
              key={item.href}
              className={estilos['item']}
              style={{ '--ordem': indice } as React.CSSProperties}
            >
              <NavLink href={item.href} label={item.label} current={item.href === atual} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Qual item marcar como atual — **um só**.
 *
 * Casa por prefixo, e não por igualdade: a ficha do aluno é `/students/<id>` e
 * precisa acender "Alunos". Mas prefixo sozinho acenderia DOIS itens em
 * `/operations/devices`; o mais específico vence. O `/` no fim do prefixo
 * impede que `/access-events` acenda `/access` por acaso de string.
 */
function itemAtual(rota: string, itens: readonly Item[]): string | null {
  const candidatos = itens.filter(
    (item) => rota === item.href || rota.startsWith(`${item.href}/`),
  );

  if (candidatos.length === 0) return null;

  return candidatos.reduce((maisEspecifico, item) =>
    item.href.length > maisEspecifico.href.length ? item : maisEspecifico,
  ).href;
}
