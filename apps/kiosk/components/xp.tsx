'use client';

import { useEffect, useState } from 'react';

import {
  carregarXp,
  type ConquistaDoTotem,
  type ExtratoDeXp,
  type MovimentoDeXp,
  type SessaoDoAluno,
} from '../lib/kiosk-client';
import { mesDaMedicao } from '../lib/saude';

/**
 * Tela de XP, conquistas e posicao no placar -- F31, Task 10.
 *
 * `M5-FR-004` e §13 do PRD: sempre mostrar POR QUE o aluno recebeu XP. Saldo
 * sem procedencia e numero magico -- cada movimento aparece com a regra que
 * o gerou e a data, nunca so o total.
 *
 * `M5-FR-007`: revogacao e movimento compensatorio auditado, NAO exclusao.
 * A conquista revertida continua na lista -- ela mostra que foi revertida e
 * por que, e nunca desaparece como se o desbloqueio nao tivesse acontecido.
 *
 * `M5-BR-010`: XP nao tem valor financeiro e nao se transfere. Nao ha "R$",
 * "saldo em conta", "resgatar" ou "trocar por" nesta tela -- palavra de
 * dinheiro sugeriria o contrario.
 */

type Carga =
  | { fase: 'carregando' }
  | { fase: 'pronto'; dados: ExtratoDeXp }
  | { fase: 'falhou' };

export function Xp({
  sessao,
  aoVoltar,
}: {
  readonly sessao: SessaoDoAluno;
  readonly aoVoltar: () => void;
}) {
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });

  useEffect(() => {
    let vivo = true;

    void carregarXp(sessao.sessionId, sessao.token).then((dados) => {
      if (!vivo) return;

      setCarga(dados === null ? { fase: 'falhou' } : { fase: 'pronto', dados });
    });

    return () => {
      vivo = false;
    };
  }, [sessao.sessionId, sessao.token]);

  return (
    <div className="telaInterna">
      <h1 className="tituloDeTela">Meus pontos</h1>

      {carga.fase === 'carregando' && <p className="corpo">Carregando…</p>}

      {carga.fase === 'falhou' && (
        <p className="corpo" data-testid="xp-falhou">
          Não foi possível carregar agora. Procure a recepção.
        </p>
      )}

      {carga.fase === 'pronto' && (
        <>
          <SaldoDoMes dados={carga.dados} />
          <Movimentos movimentos={carga.dados.movimentos} />
          <Conquistas conquistas={carga.dados.conquistas} />
        </>
      )}

      <span style={{ flex: 1 }} />

      <button type="button" className="botaoSecundario" onClick={aoVoltar}>
        Voltar
      </button>
    </div>
  );
}

/** O saldo do mes e a posicao no placar, quando houver. */
function SaldoDoMes({ dados }: { readonly dados: ExtratoDeXp }) {
  return (
    <div className="cardDeMetrica" data-testid="saldo-de-xp">
      <span className="metadado">Pontos em {mesDaMedicao(`${dados.mes}-01`) ?? dados.mes}</span>
      <span className="valorDaMetrica">{dados.saldoDoMes}</span>

      {/*
        SEM POSICAO, A TELA NAO PROMETE LUGAR NENHUM. `posicao: null` cobre
        placar nao publicado, aluno retido, opt-out ou inatividade -- nenhum
        desses casos e erro, entao nao ha frase de "nao foi possivel".
      */}
      {dados.posicao !== null && (
        <span className="metadado" data-testid="posicao-no-placar">
          {dados.posicao}º lugar no ranking do mês
        </span>
      )}
    </div>
  );
}

/** De onde veio cada ponto -- regra e data, sempre juntas ao valor. */
function Movimentos({ movimentos }: { readonly movimentos: readonly MovimentoDeXp[] }) {
  if (movimentos.length === 0) {
    return (
      <p className="corpo" data-testid="sem-movimentos">
        Nenhum ponto registrado neste mês ainda.
      </p>
    );
  }

  return (
    <div className="listaDeSegmentos" data-testid="lista-de-movimentos">
      {movimentos.map((movimento, indice) => (
        <div
          // Movimento nao tem id proprio no extrato -- regra+data+indice
          // e estavel o bastante para uma lista que so cresce por mes.
          key={`${movimento.quando}-${movimento.regra}-${indice}`}
          className="segmento"
          data-testid="movimento-de-xp"
        >
          <span className="corpo">{movimento.regra}</span>
          <span className="metadado">{mesDaMedicao(movimento.quando) ?? '—'}</span>
          <span className="valorDoPagamento">+{movimento.pontos}</span>
        </div>
      ))}
    </div>
  );
}

/** Conquistas, incluindo as revertidas -- o desbloqueio nao some. */
function Conquistas({ conquistas }: { readonly conquistas: readonly ConquistaDoTotem[] }) {
  if (conquistas.length === 0) {
    return (
      <p className="corpo" data-testid="sem-conquistas">
        Nenhuma conquista desbloqueada ainda.
      </p>
    );
  }

  return (
    <div className="listaDeSegmentos" data-testid="lista-de-conquistas">
      {conquistas.map((conquista) => (
        <div
          key={`${conquista.titulo}-${conquista.desbloqueadaEm}`}
          className={conquista.revertida ? 'pagamentoEmAberto' : 'segmento'}
          data-testid="conquista"
        >
          <span className="corpo">{conquista.titulo}</span>
          <span className="metadado">{mesDaMedicao(conquista.desbloqueadaEm) ?? '—'}</span>

          {/*
            `M5-FR-007`: revogacao e movimento compensatorio auditado. A
            conquista fica na lista com o motivo -- nunca some, como se o
            desbloqueio nao tivesse acontecido.

            `motivo` e OPCIONAL (ver `lib/kiosk-client.ts`): o endpoint da
            Task 9 ainda nao o envia. Sem ele, a tela ainda diz "Revertida"
            -- nunca inventa um motivo que o servidor nao mandou.
          */}
          {conquista.revertida && (
            <span className="metadado" data-testid="conquista-revertida">
              Revertida{conquista.motivo ? ` · ${conquista.motivo}` : ''}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
