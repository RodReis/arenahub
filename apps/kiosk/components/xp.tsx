'use client';

import { useEffect, useState } from 'react';

import {
  carregarXp,
  type ConquistaDoTotem,
  type ConsistenciaDoTotem,
  type ExtratoDeXp,
  type MovimentoDeXp,
  type SemanaDeConsistencia,
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
          <Consistencia consistencia={carga.dados.consistencia} />
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

/**
 * Consistencia semanal -- F32, Slice 5.3.
 *
 * §13 do PRD: NAO usar linguagem de culpa ao romper streak. Nao ha "voce
 * perdeu", "voce falhou" nem contagem regressiva; a semana que passou abaixo
 * da meta aparece com o numero de dias que teve, e ponto. O que a tela diz
 * com enfase e o que o aluno CONSEGUIU.
 *
 * `M5-BR-005`: a unidade e a SEMANA. Nao ha "dias seguidos" em lugar nenhum
 * desta tela -- exibir isso ensinaria a meta errada mesmo com o backend
 * contando semanas.
 */
function Consistencia({ consistencia }: { readonly consistencia: ConsistenciaDoTotem }) {
  return (
    <div className="cardDeMetrica" data-testid="consistencia">
      <span className="metadado">Semanas seguidas na meta</span>
      <span className="valorDaMetrica" data-testid="streak-atual">
        {consistencia.atual}
      </span>

      <span className="metadado">
        Meta: {consistencia.diasPorSemana} dias por semana
        {/*
          O recorde so aparece quando SUPERA o atual. Mostrar "recorde 4"
          embaixo de "atual 4" seria repetir o mesmo numero duas vezes; e
          mostrar um recorde maior logo depois de romper viraria a comparacao
          num lembrete da queda, que e a linguagem de culpa do §13.
        */}
        {consistencia.recorde > consistencia.atual && (
          <span data-testid="streak-recorde"> · seu recorde: {consistencia.recorde}</span>
        )}
      </span>

      <Semanas semanas={consistencia.semanas} />
    </div>
  );
}

/** O que cada semana diz ao aluno. Frase curta, sem culpa. */
const ROTULO_DA_SEMANA: Record<SemanaDeConsistencia['status'], string> = {
  QUALIFICADA: 'Meta batida',
  EM_ANDAMENTO: 'Semana em andamento',
  // `M5-FR-009`: a pausa e transparente e NAO conta contra o aluno -- a tela
  // diz isso com todas as letras, senao a semana neutra parece uma falha.
  PAUSADA: 'Assinatura pausada · não conta contra você',
  // Sem "voce perdeu": so o fato. O numero de dias fica na propria linha.
  PERDIDA: 'Abaixo da meta',
};

function Semanas({ semanas }: { readonly semanas: readonly SemanaDeConsistencia[] }) {
  if (semanas.length === 0) {
    return (
      <p className="corpo" data-testid="sem-semanas">
        Sua primeira semana começa no seu próximo treino.
      </p>
    );
  }

  return (
    <div className="listaDeSemanas" data-testid="lista-de-semanas">
      {semanas.map((semana) => (
        <div
          // `inicio` E a identidade da semana -- nao ha duas com a mesma
          // segunda-feira, entao nao precisa de indice no key.
          key={semana.inicio}
          className="semana"
          data-testid="semana"
          data-status={semana.status}
        >
          <span className="corpo">{intervaloDaSemana(semana)}</span>
          <span className="metadado">{ROTULO_DA_SEMANA[semana.status]}</span>
          <span className="diasDaSemana">{semana.diasTreinados}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * `24/08 a 30/08` -- dia e mes, sem ano.
 *
 * Recorte de texto, nao `Date`: `inicio` e `fim` ja sao dias locais da
 * unidade em `AAAA-MM-DD`. Passar por `new Date()` reconverteria o fuso e
 * poderia mostrar o dia anterior num navegador a oeste (o mesmo motivo pelo
 * qual o backend nunca aceita `Date` no dominio de streak).
 */
function intervaloDaSemana(semana: SemanaDeConsistencia): string {
  return `${diaEMes(semana.inicio)} a ${diaEMes(semana.fim)}`;
}

function diaEMes(dataLocal: string): string {
  const [, mes, dia] = dataLocal.split('-') as [string, string, string];
  return `${dia}/${mes}`;
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
          <span className="pontosDoMovimento">+{movimento.pontos}</span>
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
          className={conquista.revertida ? 'conquistaRevertida' : 'segmento'}
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
