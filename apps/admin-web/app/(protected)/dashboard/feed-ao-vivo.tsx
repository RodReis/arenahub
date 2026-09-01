'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon, StateBadge, TenantDateTime } from '@arenahub/ui';

import { lerFeedDeAcessos, type EventoDoFeed } from '../../actions/dashboard';
import { doisNomes } from './dois-nomes';
import estilos from './dashboard.module.css';

/** Decisão do PI: cinco segundos. */
const INTERVALO_MS = 5_000;

interface Props {
  readonly gymUnitId: string;
  readonly timeZone: string;
  /** Primeira página, vinda do servidor — a tela não nasce vazia. */
  readonly inicial: readonly EventoDoFeed[];
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
export function FeedAoVivo({ gymUnitId, timeZone, inicial }: Props) {
  const [eventos, setEventos] = useState<readonly EventoDoFeed[]>(inicial);
  const [pausado, setPausado] = useState(false);

  /*
   * `useRef` para o estado de "ainda montado": a resposta de uma leitura em
   * voo chega DEPOIS da desmontagem quando alguém navega, e escrever estado
   * ali derruba o React com aviso de atualização em componente desmontado.
   */
  const montado = useRef(true);

  const atualizar = useCallback(async () => {
    const resposta = await lerFeedDeAcessos(gymUnitId);

    // Falha de rede mantém a lista anterior. Zerar o feed porque uma leitura
    // falhou diria "ninguém passou na catraca", que é o oposto do que houve.
    if (montado.current && resposta.erro === undefined) {
      setEventos(resposta.eventos);
    }
  }, [gymUnitId]);

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

  return (
    <section className={estilos['cartao']} aria-labelledby="titulo-do-feed">
      <header className={estilos['cabecalhoDoCartao']}>
        <h2 className={estilos['tituloDoCartao']} id="titulo-do-feed">
          Acessos em tempo real
        </h2>
        <span
          className={estilos['aoVivo']}
          data-pausado={pausado}
          data-testid="estado-do-feed"
          role="status"
        >
          <span className={estilos['pulso']} aria-hidden="true" />
          {pausado ? 'pausado' : 'ao vivo'}
        </span>
      </header>

      <div className={estilos['conteudoDoCartao']}>
        {eventos.length === 0 ? (
          <div className={estilos['vazio']}>
            <span className={estilos['iconeDoVazio']}>
              <Icon name="clock" />
            </span>
            <span className={estilos['textoDoVazio']}>
              Nenhum acesso ainda hoje.
              <span className={estilos['saidaDoVazio']}>
                A lista se preenche sozinha quando alguém passar na catraca.
              </span>
            </span>
          </div>
        ) : (
          <ul className={estilos['lista']} data-testid="feed-de-acessos">
            {eventos.map((evento) => (
              /*
                `key` é o id do evento, e é o que faz a animação de entrada
                funcionar: com índice o React reusaria a mesma linha do DOM e
                só trocaria o texto — a lista mudaria de conteúdo em silêncio,
                sem nada indicar que alguém acabou de passar na catraca.
              */
              <li className={`${estilos['linha']} ${estilos['linhaDoFeed']}`} key={evento.id}>
                <span className={estilos['linhaTexto']}>
                  <span className={estilos['horaDoFeed']}>
                    <TenantDateTime iso={evento.occurredAt} timeZone={timeZone} format="time" />
                  </span>
                  {/*
                    DOIS NOMES, não o inteiro: a linha divide espaço com a
                    hora e o badge, e "Bruna Barbara Militao Vi…" truncado
                    esconde justamente o que diferencia duas Brunas.
                  */}
                  <span className={estilos['nomeDoFeed']}>
                    {evento.student
                      ? doisNomes(evento.student.fullName)
                      : (evento.externalUserId ?? 'Não identificado')}
                  </span>
                </span>
                {/*
                  `accessReason` e não `outcome`: a mesma máquina que a tela de
                  eventos já usa, para "Negado" dizer POR QUE foi negado em vez
                  de repetir a coluna ao lado.
                */}
                <StateBadge machine="accessReason" state={evento.reason} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
