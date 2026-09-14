import { useCallback, useEffect, useRef, useState } from 'react';

import { useSessao } from '../auth/sessao.js';

export type EstadoDoRecurso<T> =
  | { readonly tipo: 'CARREGANDO' }
  | { readonly tipo: 'PRONTO'; readonly dados: T }
  /**
   * Falhou -- e a tela mostra a AUSENCIA, nunca o dado anterior (`M4-NFR-002`).
   * Por isso a falha descarta o que havia: um plano de ontem exibido como de
   * hoje e pior que a tela dizendo que nao conseguiu atualizar.
   */
  | { readonly tipo: 'INDISPONIVEL' };

/**
 * Leitura de um recurso do BFF do app -- App Mobile v2.
 *
 * Existe porque as cinco abas repetiam o mesmo `useState` + `useEffect` +
 * `try/catch` que cada rota da F24-F29 escrevia a mao. O comportamento e o
 * mesmo daquelas rotas, agora num lugar so:
 *
 * - so carrega com sessao AUTENTICADA (a guarda de rota decide o resto);
 * - trocar o `caminho` (periodo, por exemplo) mantem o dado atual NA TELA ate
 *   a resposta chegar -- piscar o carregando a cada toque de pilula faria o
 *   grafico sumir e voltar;
 * - resposta atrasada de um caminho antigo e descartada: sem isso, tocar
 *   `30D` e depois `1A` rapido podia terminar mostrando o `30D`.
 */
export function usarRecurso<T>(caminho: string | null) {
  const { estado: sessao, cliente } = useSessao();
  const [estado, setEstado] = useState<EstadoDoRecurso<T>>({ tipo: 'CARREGANDO' });
  const pedidoAtual = useRef(0);

  const carregar = useCallback(async () => {
    if (caminho === null) return;

    const pedido = ++pedidoAtual.current;

    try {
      const dados = (await cliente.get(caminho)) as T;
      if (pedido === pedidoAtual.current) setEstado({ tipo: 'PRONTO', dados });
    } catch {
      if (pedido === pedidoAtual.current) setEstado({ tipo: 'INDISPONIVEL' });
    }
  }, [cliente, caminho]);

  useEffect(() => {
    if (sessao.tipo === 'AUTENTICADO') void carregar();
  }, [sessao.tipo, carregar]);

  /** Troca o dado sem ir ao servidor -- depois de uma escrita que ja o devolveu. */
  const definir = useCallback((dados: T) => setEstado({ tipo: 'PRONTO', dados }), []);

  return { estado, recarregar: carregar, definir };
}
