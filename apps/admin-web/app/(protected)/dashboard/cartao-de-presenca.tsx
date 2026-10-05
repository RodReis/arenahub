import Link from 'next/link';

import { Icon, TenantDateTime, iniciaisDe, stateLabel } from '@arenahub/ui';

import type { EventoDoFeed } from '../../actions/dashboard';
import { doisNomes } from './dois-nomes';
import { tempoDesde } from './permanencia';
import estilos from './dashboard.module.css';

/** Até aqui a passagem ainda é "acabou de chegar": o ponto do avatar pulsa. */
const RECENTE_MS = 2 * 60_000;

interface Props {
  readonly evento: EventoDoFeed;
  readonly agora: number;
  readonly timeZone: string;
}

/**
 * Uma passagem na catraca como cartão de pessoa -- pedido do PI, 03/10/2026
 * (referência: cartão de perfil com faixa no topo e avatar sobreposto).
 *
 * Pouca informação de propósito: QUEM (foto e nome), COMO FOI (faixa no tom da
 * razão, com ícone e texto) e QUANDO (horário e há quanto tempo). O resto está a
 * um clique, na ficha.
 *
 * O cartão inteiro leva à ficha: o `::after` do link cobre o cartão, então o
 * alvo é grande sem aninhar elemento interativo.
 */
export function CartaoDePresenca({ evento, agora, timeZone }: Props) {
  const rotulo = stateLabel('accessReason', evento.reason);
  const liberado = evento.outcome === 'ALLOW';
  const tom = rotulo?.tone ?? (liberado ? 'success' : 'danger');
  const nome = evento.student
    ? doisNomes(evento.student.fullName)
    : (evento.externalUserId ?? 'Não identificado');
  const recente = agora - Date.parse(evento.occurredAt) < RECENTE_MS;
  const razao = rotulo?.label ?? (liberado ? 'Liberado' : 'Recusado');
  const avatar = (
    <>
      <span className={estilos['avatarDePresenca']}>
        {evento.student?.temFoto ? (
          <img src={`/fotos-de-aluno/${evento.student.id}`} alt="" loading="lazy" />
        ) : (
          iniciaisDe(evento.student?.fullName ?? nome)
        )}
      </span>
      <span className={estilos['pontoDePresenca']} />
    </>
  );

  return (
    <li className={estilos['cartaoDePresenca']} data-tom={tom} data-recente={recente}>
      <span className={estilos['faixaDePresenca']}>
        <Icon name={rotulo?.icon ?? (liberado ? 'check-circle' : 'x-circle')} />
        <span className={estilos['rotuloDaFaixa']} title={razao}>
          {razao}
        </span>
      </span>

      {/*
        A foto também leva à ficha. `tabIndex={-1}` e `aria-hidden`: o link do
        nome já é a parada de teclado e o nome acessível -- um segundo link
        para o mesmo destino só repetiria a leitura.
      */}
      {evento.student ? (
        <Link
          className={estilos['molduraDoAvatar']}
          href={`/students/${evento.student.id}`}
          tabIndex={-1}
          aria-hidden="true"
        >
          {avatar}
        </Link>
      ) : (
        <span className={estilos['molduraDoAvatar']} aria-hidden="true">
          {avatar}
        </span>
      )}

      <span className={estilos['nomeDePresenca']}>
        {evento.student ? (
          <Link className={estilos['linkDoCartao']} href={`/students/${evento.student.id}`}>
            {nome}
          </Link>
        ) : (
          nome
        )}
      </span>

      <dl className={estilos['rodapeDePresenca']}>
        <div>
          <dt>{liberado ? 'Entrada' : 'Tentativa'}</dt>
          <dd>
            <TenantDateTime iso={evento.occurredAt} timeZone={timeZone} format="time" />
          </dd>
        </div>
        <div>
          <dt>Há</dt>
          <dd>{tempoDesde(evento.occurredAt, agora)}</dd>
        </div>
      </dl>
    </li>
  );
}
