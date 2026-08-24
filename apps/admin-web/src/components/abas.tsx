'use client';

import { useState, type ReactNode } from 'react';

import estilos from './abas.module.css';

export interface Aba {
  readonly id: string;
  readonly rotulo: string;
  readonly conteudo: ReactNode;
}

interface Props {
  readonly abas: readonly Aba[];
  /** Rótulo do `tablist` para leitor de tela. Ex.: "Seções da ficha". */
  readonly rotulo: string;
}

/**
 * Abas de tela — compartilhadas entre a ficha do aluno e a tela de planos.
 *
 * CLIENT porque troca de aba é estado; o conteúdo continua vindo pronto do
 * Server Component, passado por prop. Nada aqui busca dado.
 *
 * TODAS AS ABAS FICAM MONTADAS, escondidas por `hidden`. Duas razões, e a
 * segunda é a que morde:
 *
 *   1. Trocar de aba não remonta formulário nem perde o que foi digitado.
 *   2. Um `<input>` desmontado NÃO ENTRA NO `FormData`. Com renderização
 *      condicional, um formulário que abrange mais de uma aba enviaria os
 *      campos da aba escondida vazios -- e a API, que substitui o registro
 *      inteiro, os apagaria.
 */
export function Abas({ abas, rotulo }: Props) {
  const [ativa, setAtiva] = useState(abas[0]?.id ?? '');

  return (
    <>
      <div className={estilos['abas']} role="tablist" aria-label={rotulo}>
        {abas.map((aba) => (
          <button
            key={aba.id}
            type="button"
            role="tab"
            id={`aba-${aba.id}`}
            aria-selected={ativa === aba.id}
            aria-controls={`painel-${aba.id}`}
            className={`${estilos['aba']} ${ativa === aba.id ? estilos['abaAtiva'] : ''}`}
            onClick={() => setAtiva(aba.id)}
            data-testid={`aba-${aba.id}`}
          >
            {aba.rotulo}
          </button>
        ))}
      </div>

      {abas.map((aba) => (
        <div
          key={aba.id}
          role="tabpanel"
          id={`painel-${aba.id}`}
          aria-labelledby={`aba-${aba.id}`}
          hidden={ativa !== aba.id}
        >
          {aba.conteudo}
        </div>
      ))}
    </>
  );
}
