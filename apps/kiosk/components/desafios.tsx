'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  carregarDesafios,
  entrarNoDesafio,
  marcarAvisosComoLidos,
  sairDoDesafio,
  type AvisoDeDesafio,
  type DesafioDoTotem,
  type DesafiosDoTotem,
  type SessaoDoAluno,
} from '../lib/kiosk-client';

/**
 * Desafios do aluno -- F34, Slice 5.5, ADR-048.
 *
 * ---------------------------------------------------------------------------
 * OPT-IN, E A TELA PRECISA DEIXAR ISSO OBVIO.
 * ---------------------------------------------------------------------------
 *
 * `M5-BR-001`: nenhuma participacao vem habilitada. Diferente da tela de
 * preferencias (ranking), onde o interruptor NASCE LIGADO porque o regime e
 * opt-out, aqui o aluno comeca de fora e o botao diz "Participar".
 *
 * Um interruptor ja marcado nesta tela seria inscricao que o aluno nao pediu
 * -- meta que ele nao escolheu, e depois "voce nao bateu a meta".
 *
 * ---------------------------------------------------------------------------
 * OS AVISOS NAO SAO NOTIFICACAO ENVIADA.
 * ---------------------------------------------------------------------------
 *
 * Nao ha canal externo nesta fatia (ADR-048, Decisao 3): o aviso e escrito
 * quando o fato acontece e LIDO quando o aluno chega ao totem. Por isso nao
 * ha "quiet hours" nem preferencia de canal nesta tela -- nao existe hora
 * errada quando e o aluno que chega.
 */

type Carga =
  | { fase: 'carregando' }
  | { fase: 'pronto'; dados: DesafiosDoTotem }
  | { fase: 'falhou' };

export function Desafios({
  sessao,
  aoVoltar,
}: {
  readonly sessao: SessaoDoAluno;
  readonly aoVoltar: () => void;
}) {
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async (): Promise<DesafiosDoTotem | null> => {
    const dados = await carregarDesafios(sessao.sessionId, sessao.token);

    setCarga(dados === null ? { fase: 'falhou' } : { fase: 'pronto', dados });

    return dados;
  }, [sessao.sessionId, sessao.token]);

  useEffect(() => {
    let vivo = true;

    void carregar().then(() => {
      if (!vivo) return;
    });

    return () => {
      vivo = false;
    };
  }, [carregar]);

  /*
   * Marca os avisos como lidos DEPOIS de exibir -- e o `useRef` guarda o que
   * ja foi marcado nesta sessao para nao repetir a chamada a cada re-render.
   *
   * Marcar junto do carregamento faria o aviso sumir de um aluno que apenas
   * passou pela tela; marcar sem a trava dispararia POST a cada troca de
   * estado da propria tela.
   */
  const jaMarcados = useRef(new Set<string>());

  useEffect(() => {
    if (carga.fase !== 'pronto') return;

    const naoLidos = carga.dados.avisos
      .filter((a) => !a.lido && !jaMarcados.current.has(a.id))
      .map((a) => a.id);

    if (naoLidos.length === 0) return;

    naoLidos.forEach((id) => jaMarcados.current.add(id));
    void marcarAvisosComoLidos(sessao.sessionId, sessao.token, naoLidos);
  }, [carga, sessao.sessionId, sessao.token]);

  async function alternar(desafio: DesafioDoTotem): Promise<void> {
    setOcupado(desafio.id);

    const acao = desafio.inscrito ? sairDoDesafio : entrarNoDesafio;
    await acao(sessao.sessionId, sessao.token, desafio.id);

    // Recarrega em vez de mexer no estado local: o progresso vem do servidor,
    // e adivinha-lo aqui faria a tela mostrar um numero que o banco nao tem.
    await carregar();
    setOcupado(null);
  }

  return (
    <div className="telaInterna">
      <h1 className="tituloDeTela">Desafios</h1>

      {carga.fase === 'carregando' && <p className="corpo">Carregando…</p>}

      {carga.fase === 'falhou' && (
        <p className="corpo" data-testid="desafios-falhou">
          Não foi possível carregar agora. Procure a recepção.
        </p>
      )}

      {carga.fase === 'pronto' && (
        <>
          <Avisos avisos={carga.dados.avisos} />

          {carga.dados.desafios.length === 0 ? (
            <p className="corpo" data-testid="sem-desafios">
              Nenhum desafio aberto agora. Quando a academia abrir um, ele aparece aqui.
            </p>
          ) : (
            carga.dados.desafios.map((desafio) => (
              <CardDeDesafio
                key={desafio.id}
                desafio={desafio}
                ocupado={ocupado === desafio.id}
                aoAlternar={() => void alternar(desafio)}
              />
            ))
          )}
        </>
      )}

      <span style={{ flex: 1 }} />

      <button type="button" className="botaoSecundario" onClick={aoVoltar}>
        Voltar
      </button>
    </div>
  );
}

/** Um desafio: meta, progresso de quem entrou, e o botao de aderir ou sair. */
function CardDeDesafio({
  desafio,
  ocupado,
  aoAlternar,
}: {
  readonly desafio: DesafioDoTotem;
  readonly ocupado: boolean;
  readonly aoAlternar: () => void;
}) {
  return (
    <div className="cardDeMetrica" data-testid={`desafio-${desafio.id}`}>
      <span className="metadado">{desafio.title}</span>

      {desafio.inscrito ? (
        <>
          <span className="valorDaMetrica">
            {desafio.progresso} de {desafio.meta}
          </span>
          <span className="metadado" data-testid={`progresso-${desafio.id}`}>
            {desafio.progresso >= desafio.meta
              ? 'Meta batida!'
              : `Faltam ${desafio.meta - desafio.progresso} treino(s)`}
          </span>
        </>
      ) : (
        /*
         * Quem NAO entrou ve a meta, nao um progresso zerado: "0 de 8"
         * sugeriria que ele ja esta participando e vai mal.
         */
        <span className="valorDaMetrica" data-testid={`meta-${desafio.id}`}>
          Meta: {desafio.meta} treinos
        </span>
      )}

      <button
        type="button"
        className={desafio.inscrito ? 'botaoSecundario' : 'ctaPrimario'}
        disabled={ocupado}
        onClick={aoAlternar}
        data-testid={`alternar-${desafio.id}`}
      >
        {ocupado ? 'Aguarde…' : desafio.inscrito ? 'Sair do desafio' : 'Participar'}
      </button>
    </div>
  );
}

const TEXTO_DO_AVISO: Record<AvisoDeDesafio['kind'], (titulo: string) => string> = {
  DISPONIVEL: (titulo) => `Novo desafio: ${titulo}`,
  CONCLUIDO: (titulo) => `Você concluiu o desafio ${titulo}!`,
  ENCERRADO_SEM_META: (titulo) => `O desafio ${titulo} terminou. Na próxima!`,
};

/** Avisos do aluno -- exibidos aqui, nunca enviados (ADR-048, Decisao 3). */
function Avisos({ avisos }: { readonly avisos: readonly AvisoDeDesafio[] }) {
  if (avisos.length === 0) return null;

  return (
    <div data-testid="avisos-de-desafio">
      {avisos.map((aviso) => (
        <p key={aviso.id} className="corpo">
          {TEXTO_DO_AVISO[aviso.kind](aviso.challengeTitle)}
        </p>
      ))}
    </div>
  );
}
