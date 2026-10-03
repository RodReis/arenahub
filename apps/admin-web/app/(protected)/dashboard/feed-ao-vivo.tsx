'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon } from '@arenahub/ui';

import { lerFeedDeAcessos, type EventoDoFeed } from '../../actions/dashboard';
import { CartaoDePresenca } from './cartao-de-presenca';
import { CartaoDeBloqueados, type SituacaoDoDashboard } from './cartao-de-bloqueados';
import { JANELA_DE_PERMANENCIA_MIN, naJanelaDePermanencia } from './permanencia';
import { recusadosDoDia } from './recusados';
import estilos from './dashboard.module.css';

/** Decisão do PI: cinco segundos. */
const INTERVALO_MS = 5_000;

interface Props {
  readonly gymUnitId: string;
  readonly timeZone: string;
  /** Primeira página, vinda do servidor — a tela não nasce vazia. */
  readonly inicial: readonly EventoDoFeed[];
  /** Início do dia da unidade: o feed mostra o DIA, não as últimas 24 h. */
  readonly desde?: string;
  /**
   * Com isto, o feed também desenha o cartão "Bloqueados e suspensos", com
   * quem a catraca recusou hoje tirado da MESMA leitura -- pedido do PI,
   * 02/10/2026. Um segundo ciclo de consulta só para as recusas dobraria a
   * carga na API que atende a catraca.
   */
  readonly situacoes?: readonly SituacaoDoDashboard[];
}

/**
 * Feed de acessos em tempo real — F57, bloco 3.
 *
 * A ÚNICA parte cliente do dashboard. O resto é Server Component: o painel lê
 * no servidor e chega pronto.
 *
 * ## A recarga PARA com a aba oculta, e isso não é otimização
 *
 * Um painel esquecido aberto num turno de 12 h faz ~8.600 requisições
 * sozinho; três recepções fazem 26 mil — contra a MESMA API que atende a
 * catraca. Uma aba minimizada não pode disputar fila com quem está parado na
 * porta. Então o ciclo para em `visibilitychange` e retoma ao voltar, com uma
 * leitura imediata na volta (senão a tela mostraria por até 5 s o estado de
 * quando foi escondida, que pode ser de horas atrás).
 */
export function FeedAoVivo({ gymUnitId, timeZone, inicial, desde, situacoes }: Props) {
  const [eventos, setEventos] = useState<readonly EventoDoFeed[]>(inicial);
  const [pausado, setPausado] = useState(false);
  /** Relógio da janela de permanência: avança a cada leitura, não a cada render. */
  const [agora, setAgora] = useState(() => Date.now());

  /*
   * `useRef` para o estado de "ainda montado": a resposta de uma leitura em
   * voo chega DEPOIS da desmontagem quando alguém navega, e escrever estado
   * ali derruba o React com aviso de atualização em componente desmontado.
   */
  const montado = useRef(true);

  const atualizar = useCallback(async () => {
    const resposta = await lerFeedDeAcessos(gymUnitId, desde);

    // Falha de rede mantém a lista anterior. Zerar o feed porque uma leitura
    // falhou diria "ninguém passou na catraca", que é o oposto do que houve.
    if (!montado.current) return;

    // O relógio anda mesmo se a leitura falhou: a lista antiga continua na
    // tela, mas quem passou da janela de permanência sai dela.
    setAgora(Date.now());
    if (resposta.erro === undefined) setEventos(resposta.eventos);
  }, [gymUnitId, desde]);

  useEffect(() => {
    montado.current = true;

    let timer: ReturnType<typeof setInterval> | undefined;

    const parar = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const comecar = () => {
      parar();
      timer = setInterval(() => void atualizar(), INTERVALO_MS);
    };

    const aoMudarVisibilidade = () => {
      const oculta = document.visibilityState === 'hidden';
      setPausado(oculta);

      if (oculta) {
        parar();
        return;
      }

      // Leitura imediata na volta, ANTES de religar o ciclo: sem ela a tela
      // mostraria por até 5 s o estado de quando foi escondida.
      void atualizar();
      comecar();
    };

    document.addEventListener('visibilitychange', aoMudarVisibilidade);

    if (document.visibilityState === 'visible') comecar();
    else setPausado(true);

    return () => {
      montado.current = false;
      parar();
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    };
  }, [atualizar]);

  // A lista mostra quem provavelmente ainda está na academia; o cartão de
  // bloqueados segue lendo o DIA inteiro (`eventos`).
  const naAcademia = naJanelaDePermanencia(eventos, agora);

  return (
    <>
      <details className={estilos['cartao']} open>
        <summary className={estilos['cabecalhoDoCartao']}>
          <h2 className={estilos['tituloDoCartao']}>Acessos em tempo real</h2>
          <span className={estilos['acoesDoCabecalho']}>
            <span className={estilos['janelaDoFeed']} data-testid="janela-do-feed">
              últimos {JANELA_DE_PERMANENCIA_MIN} min
            </span>
            <span
              className={estilos['aoVivo']}
              data-pausado={pausado}
              data-testid="estado-do-feed"
              role="status"
            >
              <span className={estilos['pulso']} aria-hidden="true" />
              {pausado ? 'pausado' : 'ao vivo'}
            </span>
            <Icon name="chevron-down" />
          </span>
        </summary>

        <div className={estilos['conteudoDoCartao']}>
          {naAcademia.length === 0 ? (
            <div className={estilos['vazio']}>
              <span className={estilos['iconeDoVazio']}>
                <Icon name="clock" />
              </span>
              <span className={estilos['textoDoVazio']}>
                Ninguém passou na catraca nos últimos {JANELA_DE_PERMANENCIA_MIN} min.
                <span className={estilos['saidaDoVazio']}>
                  A lista se preenche sozinha quando alguém passar na catraca.
                </span>
              </span>
            </div>
          ) : (
            <ul className={estilos['gradeDePresenca']} data-testid="feed-de-acessos">
              {/*
                `key` é o id do evento, e é o que faz a animação de entrada
                funcionar: com índice o React reusaria o mesmo cartão e só
                trocaria o texto, sem nada indicar que alguém acabou de passar.
              */}
              {naAcademia.map((evento) => (
                <CartaoDePresenca key={evento.id} evento={evento} agora={agora} timeZone={timeZone} />
              ))}
            </ul>
          )}
        </div>
      </details>

      {situacoes === undefined ? null : (
        <CartaoDeBloqueados
          situacoes={situacoes}
          recusados={recusadosDoDia(eventos)}
          timeZone={timeZone}
        />
      )}
    </>
  );
}
