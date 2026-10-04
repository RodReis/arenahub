'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition, type ReactNode } from 'react';

import { Button, Icon } from '@arenahub/ui';

import estilos from './operations.module.css';

/**
 * Trinta segundos: o ciclo de avaliacao de alertas no servidor. Ler mais
 * rapido que isso so repetiria a mesma resposta; ler mais devagar deixaria a
 * recepcao olhando um alarme que ja foi resolvido.
 */
export const INTERVALO_DE_RECARGA_MS = 30_000;

interface Props {
  /** O carimbo "Atualizado as HH:mm", ja formatado no servidor no fuso da unidade. */
  readonly children?: ReactNode;
}

/**
 * Mantem o painel de operacao vivo: recarrega os dados do SERVIDOR a cada 30 s.
 *
 * `router.refresh()` e nao `fetch` no cliente: a pagina continua sendo Server
 * Component (sem token no navegador) e o React preserva o estado dos
 * formularios abertos -- o codigo de pareamento mostrado uma unica vez nao some
 * no meio da leitura.
 *
 * A recarga PARA com a aba oculta, e isso nao e otimizacao: um painel esquecido
 * aberto num turno de 12 h dispararia ~1.400 leituras por aba contra a mesma
 * API que atende a catraca. Ao voltar, le uma vez na hora -- senao a tela
 * mostraria por ate 30 s o estado de quando foi escondida (mesma regra do feed
 * do dashboard).
 */
export function AtualizarAoVivo({ children }: Props) {
  const roteador = useRouter();
  const [pendente, iniciar] = useTransition();
  const [pausado, setPausado] = useState(false);

  const atualizar = useCallback(() => {
    iniciar(() => roteador.refresh());
  }, [roteador]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const parar = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const comecar = () => {
      parar();
      timer = setInterval(atualizar, INTERVALO_DE_RECARGA_MS);
    };

    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'hidden') {
        setPausado(true);
        parar();
        return;
      }

      setPausado(false);
      atualizar();
      comecar();
    };

    document.addEventListener('visibilitychange', aoMudarVisibilidade);

    if (document.visibilityState === 'visible') comecar();
    else setPausado(true);

    return () => {
      parar();
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    };
  }, [atualizar]);

  return (
    <div className={estilos['aoVivo']}>
      {/* So o selo e regiao viva: o carimbo muda a cada 30 s e nao deve ser anunciado. */}
      <span
        className={estilos['selinho']}
        data-pausado={pausado}
        data-testid="estado-da-operacao"
        role="status"
      >
        <span className={estilos['pulso']} aria-hidden="true" />
        {pausado ? 'pausado' : 'ao vivo'}
      </span>

      {children !== undefined ? (
        <span className={estilos['carimbo']} data-testid="carimbo-da-operacao">
          {children}
        </span>
      ) : null}

      <span className={estilos['recarregar']} data-pendente={pendente}>
        <Button
          variant="icon"
          aria-label="Atualizar agora"
          title="Atualizar agora"
          disabled={pendente}
          onClick={atualizar}
          data-testid="atualizar-agora"
        >
          <Icon name="refresh-cw" />
        </Button>
      </span>
    </div>
  );
}
