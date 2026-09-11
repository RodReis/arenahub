'use client';

import { useId, useRef, useState, type ReactNode } from 'react';

import { Icon, type IconName } from './Icon.js';
import estilos from './Tabs.module.css';

export interface Aba {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Numero ao lado do rotulo -- quantos itens a aba fechada guarda. */
  readonly contador?: number;
  readonly content: ReactNode;
}

interface Props {
  readonly abas: readonly Aba[];
  /** Rotulo do grupo para leitor de tela. Ex.: "Secoes do cliente". */
  readonly label: string;
  readonly defaultId?: string;
  readonly testId?: string;
}

/**
 * Abas -- o que substitui o scroll de quatro assuntos empilhados.
 *
 * TODOS OS PAINEIS FICAM MONTADOS, e so o inativo recebe `hidden`. Desmontar
 * seria o desenho obvio e esta errado por dois motivos que aparecem na tela:
 *
 *   1. O formulario perde o que foi digitado ao trocar de aba e voltar --
 *      exatamente o que o §10 item 3 proibe ("formulario nunca perde dado").
 *   2. Um `<form>` desmontado nao existe no DOM, entao um envio disparado por
 *      Enter noutra aba nao encontraria os campos dela.
 *
 * `hidden` tambem tira o painel inativo da ordem de tabulacao e da arvore de
 * acessibilidade -- e o que impede o Tab de cair num campo invisivel.
 *
 * TECLADO COMPLETO (WAI-ARIA Tabs): setas navegam, Home e End vao aos
 * extremos, e so a aba ativa fica na ordem de tabulacao (`tabindex="-1"` nas
 * outras) -- senao percorrer um grupo de quatro abas custa quatro Tabs antes
 * de chegar ao conteudo.
 */
export function Tabs({ abas, label, defaultId, testId }: Props) {
  const primeira = abas[0]?.id ?? '';
  const [ativa, setAtiva] = useState(defaultId ?? primeira);
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  /** Move a selecao E o foco -- numa lista de abas os dois andam juntos. */
  const irPara = (indice: number): void => {
    const destino = abas[(indice + abas.length) % abas.length];

    if (destino === undefined) return;

    setAtiva(destino.id);
    refs.current[destino.id]?.focus();
  };

  const aoTeclar = (evento: React.KeyboardEvent, indice: number): void => {
    const acoes: Record<string, () => void> = {
      ArrowRight: () => irPara(indice + 1),
      ArrowLeft: () => irPara(indice - 1),
      Home: () => irPara(0),
      End: () => irPara(abas.length - 1),
    };

    const acao = acoes[evento.key];

    if (acao === undefined) return;

    evento.preventDefault();
    acao();
  };

  return (
    <div data-testid={testId}>
      <div role="tablist" aria-label={label} className={estilos['lista']}>
        {abas.map((aba, indice) => {
          const selecionada = aba.id === ativa;

          return (
            <button
              key={aba.id}
              ref={(elemento) => {
                refs.current[aba.id] = elemento;
              }}
              type="button"
              role="tab"
              id={`${base}-${aba.id}-aba`}
              aria-controls={`${base}-${aba.id}-painel`}
              aria-selected={selecionada}
              tabIndex={selecionada ? 0 : -1}
              className={estilos['aba']}
              onClick={() => setAtiva(aba.id)}
              onKeyDown={(evento) => aoTeclar(evento, indice)}
              data-testid={`aba-${aba.id}`}
            >
              {aba.icon !== undefined ? <Icon name={aba.icon} /> : null}
              {aba.label}
              {aba.contador !== undefined ? (
                <span className={estilos['contador']}>{aba.contador}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {abas.map((aba) => (
        <div
          key={aba.id}
          role="tabpanel"
          id={`${base}-${aba.id}-painel`}
          aria-labelledby={`${base}-${aba.id}-aba`}
          hidden={aba.id !== ativa}
          className={estilos['painel']}
          data-testid={`painel-${aba.id}`}
        >
          {aba.content}
        </div>
      ))}
    </div>
  );
}
