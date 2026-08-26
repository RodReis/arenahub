'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { encerrarSessao, estenderSessao, type SessaoDoAluno } from './kiosk-client';

/**
 * Limpeza de encerramento (`M4-FR-020`, `M4-BR-006`).
 *
 * O aceite da fatia mede exatamente isto: depois do encerramento, nada do
 * aluno permanece. `autocomplete="off"` nos campos e o que impede o autofill
 * de reoferecer o CPF do anterior -- vive no JSX, nao aqui.
 */
export function limparEstadoDaSessao(): void {
  sessionStorage.clear();
  localStorage.clear();

  // Clipboard e opcional no navegador; falhar nele nao pode travar o
  // encerramento, que precisa acontecer de qualquer jeito. `?.` cobre a
  // ausencia da API; o `catch` cobre a permissao negada -- sao dois modos de
  // falha diferentes, e so um deles seria pego pelo outro.
  void navigator.clipboard?.writeText('').catch(() => undefined);
}

export interface EstadoDaSessao {
  /** Segundos ate expirar, ja arredondados para exibicao. */
  readonly segundosRestantes: number;
  /** Fracao decorrida (0..1) para a barra do topo -- DS-TOTEM.md §3.18. */
  readonly fracaoRestante: number;
  readonly estender: () => void;
  readonly encerrar: () => void;
}

/**
 * Contagem regressiva da sessao e as duas acoes do rodape.
 *
 * A expiracao e SEMPRE decidida pelo `expiraEm` que o servidor devolveu, e
 * nunca por um contador local que so decrementa: o relogio do totem pode
 * derivar (o proprio heartbeat mede essa deriva), e um contador local
 * mostraria "42 s" numa sessao que o servidor ja recusa.
 */
export function useSessao(
  sessao: SessaoDoAluno,
  aoEncerrar: () => void,
  duracaoSegundos: number,
): EstadoDaSessao {
  const [expiraEm, setExpiraEm] = useState(() => Date.parse(sessao.expiraEm));
  const [agora, setAgora] = useState(() => Date.now());

  // `ref` e nao dependencia: `aoEncerrar` costuma ser uma closure nova a cada
  // render do pai, e coloca-la no array do efeito reiniciaria o intervalo a
  // cada segundo -- o contador nunca avancaria de forma estavel.
  const aoEncerrarRef = useRef(aoEncerrar);
  aoEncerrarRef.current = aoEncerrar;

  useEffect(() => {
    const intervalo = setInterval(() => {
      setAgora(Date.now());
    }, 1000);

    return () => {
      clearInterval(intervalo);
    };
  }, []);

  const restanteMs = Math.max(0, expiraEm - agora);
  const segundosRestantes = Math.ceil(restanteMs / 1000);

  const encerrar = useCallback(() => {
    // A sessao morre no SERVIDOR, nao so na tela: sem o DELETE, o token
    // continuaria valido ate expirar sozinho.
    void encerrarSessao(sessao.sessionId, sessao.token);
    limparEstadoDaSessao();
    aoEncerrarRef.current();
  }, [sessao.sessionId, sessao.token]);

  // Expiracao por tempo faz o MESMO caminho do encerramento manual -- inclusive
  // a limpeza. Um caminho que voltasse para a tela publica sem limpar deixaria
  // o dado do aluno anterior vivo justamente no cenario mais comum: ninguem
  // toca em "Encerrar", a pessoa simplesmente vai embora.
  useEffect(() => {
    if (restanteMs > 0) return;

    encerrar();
  }, [restanteMs, encerrar]);

  const estender = useCallback(() => {
    void estenderSessao(sessao.sessionId, sessao.token).then((novo) => {
      if (novo === null) return;

      setExpiraEm(Date.parse(novo));
    });
  }, [sessao.sessionId, sessao.token]);

  return {
    segundosRestantes,
    // A barra mede contra a duracao CONFIGURADA (ADR-042, Decisao 0), nao
    // contra 60 fixo: com `duracaoSegundos: 120` a barra tem de nascer cheia.
    fracaoRestante: Math.min(1, restanteMs / (duracaoSegundos * 1000)),
    estender,
    encerrar,
  };
}
