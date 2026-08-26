'use client';

import { useEffect, useState } from 'react';

import {
  carregarAvaliacao,
  carregarAvaliacoes,
  carregarEvolucao,
  type AvaliacaoDoTotem,
  type EvolucaoDoTotem,
  type LinhaDeAvaliacao,
  type MetricaDoTotem,
  type SessaoDoAluno,
} from '../lib/kiosk-client';
import {
  deltaLegivel,
  mesDaMedicao,
  rotuloDeSegmento,
  rotuloDeTipo,
  valorLegivel,
} from '../lib/saude';

/**
 * As tres telas de saude do totem -- `DS-TOTEM.md` §5.3, §5.4 e §5.5.
 *
 * SOMENTE LEITURA. A medicao e feita e confirmada no painel da recepcao; o
 * totem exibe o que ja foi publicado, e nao edita, nao mede e nao confirma.
 *
 * NADA AQUI INTERPRETA. A pontuacao e o achado do aparelho aparecem como
 * ele os escreveu, atribuidos a ele -- sem cor por gravidade, sem ordem por
 * urgencia, sem recomendacao de conduta. A RDC 657/2022 isenta software que
 * so exibe dado de saude; interpretar enquadra como dispositivo medico
 * (ADR-035, e o precedente de `achado-do-ecg.tsx` no painel).
 */

/** Estado de carga comum às três — a rede da academia cai, e a tela precisa dizer. */
type Carga<T> = { fase: 'carregando' } | { fase: 'pronto'; dados: T } | { fase: 'falhou' };

function useCarga<T>(carregar: () => Promise<T | null>, deps: readonly unknown[]): Carga<T> {
  const [estado, setEstado] = useState<Carga<T>>({ fase: 'carregando' });

  useEffect(() => {
    let vivo = true;

    void carregar().then((dados) => {
      if (!vivo) return;

      setEstado(dados === null ? { fase: 'falhou' } : { fase: 'pronto', dados });
    });

    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `carregar` é recriada a cada render; as deps reais são as da chamada.
  }, deps);

  return estado;
}

function Moldura({
  titulo,
  aoVoltar,
  children,
}: {
  readonly titulo: string;
  readonly aoVoltar: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="telaInterna">
      <h1 className="tituloDeTela">{titulo}</h1>
      {children}
      <button type="button" className="botaoSecundario" onClick={aoVoltar}>
        Voltar
      </button>
    </div>
  );
}

function NaoCarregou() {
  return (
    <p className="corpo" data-testid="saude-falhou">
      Não foi possível carregar agora. Procure a recepção.
    </p>
  );
}

/** §5.3 — a avaliação do mês. */
export function AvaliacaoDoMes({
  sessao,
  aoVoltar,
}: {
  readonly sessao: SessaoDoAluno;
  readonly aoVoltar: () => void;
}) {
  const estado = useCarga<AvaliacaoDoTotem | 'sem-avaliacao'>(
    () => carregarAvaliacao(sessao.sessionId, sessao.token),
    [sessao.sessionId, sessao.token],
  );

  return (
    <Moldura titulo="Avaliação do mês" aoVoltar={aoVoltar}>
      {estado.fase === 'carregando' && <p className="corpo">Carregando…</p>}
      {estado.fase === 'falhou' && <NaoCarregou />}

      {/*
        "AINDA NAO TEM" e "NAO DEU PARA CARREGAR" sao telas DIFERENTES. O
        endpoint devolve corpo nulo no primeiro caso e a chamada falha no
        segundo; colapsar os dois faria a tela afirmar que o aluno nao tem
        avaliacao toda vez que a rede oscilasse -- para um aluno que tem.
      */}
      {estado.fase === 'pronto' && estado.dados === 'sem-avaliacao' && (
        <p className="corpo" data-testid="sem-avaliacao">
          Você ainda não tem avaliação registrada. Fale com a recepção para agendar a sua.
        </p>
      )}

      {estado.fase === 'pronto' && estado.dados !== 'sem-avaliacao' && (
        <>
          {/*
            ORIGEM DO NUMERO, sempre: numero na tela sem origem nao pode ser
            conferido pelo aluno nem contestado pelo avaliador
            (`M3-NFR-006`).
          */}
          <p className="metadado" data-testid="origem-da-medicao">
            Medida na recepção
            {estado.dados.aparelho === null ? '' : ` · ${estado.dados.aparelho}`} · somente leitura
          </p>

          <BlocoDeComposicao medidaEm={estado.dados.medidaEm} />
          <RelatorioDoAparelho relatorio={estado.dados.relatorioDoAparelho} />
          <GradeDeMetricas metricas={estado.dados.metricas} />
          <Segmentos segmentos={estado.dados.segmentos} />

          {/*
            REGRA DE ARQUITETURA No 8 -- o aviso e obrigatorio e nao se
            fecha: um aviso de saude que o operador fecha e um aviso que
            nao existe a partir do segundo uso.
          */}
          <p className="avisoDeSaude" data-testid="aviso-nao-diagnostico">
            A leitura completa fica no aplicativo. Não é diagnóstico médico.
          </p>
        </>
      )}
    </Moldura>
  );
}

/**
 * O bloco de composicao do §5.3.
 *
 * PLACEHOLDER, e dito em tela. O DS desenha aqui uma imagem de composicao
 * corporal (`object-fit: cover`, selo do mes); esse asset NAO EXISTE no
 * repositorio -- nao ha imagem, nao ha gerador, nao ha dependencia 3D. A
 * moldura e o selo ficam reservados; a imagem entra quando o asset existir.
 *
 * Desenhar um corpo generico aqui seria pior que o vazio: o aluno leria
 * como sendo o corpo DELE, medido.
 */
function BlocoDeComposicao({ medidaEm }: { readonly medidaEm: string | null }) {
  const mes = mesDaMedicao(medidaEm);

  return (
    <div className="blocoDeComposicao" data-testid="bloco-de-composicao">
      <span className="seloDoMes">{mes === null ? 'COMPOSIÇÃO' : `COMPOSIÇÃO DE ${mes}`}</span>
      <p className="metadado">A visualização do corpo estará disponível em breve.</p>
    </div>
  );
}

/**
 * Indice e achado como o APARELHO os escreveu -- opacos.
 *
 * Le chave a chave, como texto, sem interpretar o conteudo: nem cor por
 * gravidade, nem ordem por urgencia, nem rotulo derivado da palavra. Mesma
 * disciplina de `achado-do-ecg.tsx` no painel (ADR-035).
 */
function RelatorioDoAparelho({ relatorio }: { readonly relatorio: Record<string, unknown> | null }) {
  const texto = (chave: string): string | null => {
    const valor = relatorio?.[chave];

    if (typeof valor === 'string' && valor !== '') return valor;
    if (typeof valor === 'number') return String(valor);

    return null;
  };

  const pontuacao = texto('score') ?? texto('bodyScore');
  const condicao = texto('bodyType') ?? texto('classification');
  const achado = texto('ecgFinding');

  if (pontuacao === null && condicao === null && achado === null) return null;

  return (
    <div className="relatorioDoAparelho" data-testid="relatorio-do-aparelho">
      {pontuacao !== null && (
        <p className="pontuacaoDoAparelho" data-testid="pontuacao">
          {pontuacao} pontos
        </p>
      )}

      {condicao !== null && <p className="corpo">{condicao}</p>}

      {achado !== null && (
        <p className="corpo" data-testid="achado-do-aparelho">
          Eletrocardiograma: {achado}
        </p>
      )}

      {/* A atribuicao e obrigatoria: o numero e do aparelho, nao nosso. */}
      <p className="metadado">Índice e leitura reportados pelo aparelho.</p>
    </div>
  );
}

/** As seis métricas do §5.3, cada uma com o delta contra a anterior. */
function GradeDeMetricas({ metricas }: { readonly metricas: readonly MetricaDoTotem[] }) {
  return (
    <div className="gradeDeMetricas" data-testid="grade-de-metricas">
      {metricas.map((metrica) => {
        const delta = deltaLegivel(metrica.deltaAbsoluto, metrica.unidade, metrica.razaoDaAusencia);

        return (
          <div key={metrica.tipo} className="cardDeMetrica" data-testid={`metrica-${metrica.tipo}`}>
            <span className="metadado">{rotuloDeTipo(metrica.tipo)}</span>
            <span className="valorDaMetrica">{valorLegivel(metrica.valor, metrica.unidade)}</span>
            {delta !== null && <span className="metadado">{delta}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** As três linhas do §5.3: braços, tronco, pernas. */
function Segmentos({ segmentos }: { readonly segmentos: AvaliacaoDoTotem['segmentos'] }) {
  return (
    <div className="listaDeSegmentos" data-testid="lista-de-segmentos">
      {segmentos.map((s) => (
        <div key={s.segmento} className="segmento" data-testid={`segmento-${s.segmento}`}>
          <span className="corpo">{rotuloDeSegmento(s.segmento)}</span>
          <span className="metadado">
            Gordura {valorLegivel(s.gorduraKg, 'KG')} · Músculo {valorLegivel(s.musculoKg, 'KG')}
          </span>
        </div>
      ))}
    </div>
  );
}

/** §5.4 — evolução, com a análise assistiva quando existir. */
export function Evolucao({
  sessao,
  aoVoltar,
}: {
  readonly sessao: SessaoDoAluno;
  readonly aoVoltar: () => void;
}) {
  const estado = useCarga<EvolucaoDoTotem>(
    () => carregarEvolucao(sessao.sessionId, sessao.token),
    [sessao.sessionId, sessao.token],
  );

  return (
    <Moldura titulo="Minha evolução" aoVoltar={aoVoltar}>
      {estado.fase === 'carregando' && <p className="corpo">Carregando…</p>}
      {estado.fase === 'falhou' && <NaoCarregou />}

      {estado.fase === 'pronto' && estado.dados.months.length === 0 && (
        <p className="corpo" data-testid="sem-evolucao">
          Ainda não há medições suficientes para mostrar sua evolução.
        </p>
      )}

      {estado.fase === 'pronto' && estado.dados.months.length > 0 && (
        <>
          <BlocoDeComposicao medidaEm={estado.dados.months.at(-1)?.assessedAtLocal ?? null} />

          <div className="listaDeMeses" data-testid="lista-de-meses">
            {estado.dados.months.map((mes) => (
              <div key={mes.assessedAtLocal} className="mesDaEvolucao">
                <span className="metadado">{mesDaMedicao(mes.assessedAtLocal) ?? '—'}</span>
                {mes.metrics.map((m) => (
                  <span key={m.type} className="corpo">
                    {rotuloDeTipo(m.type)}: {valorLegivel(m.value, m.unit)}
                  </span>
                ))}
              </div>
            ))}
          </div>

          {estado.dados.latestAnalysis !== null && (
            <AnaliseAssistiva analise={estado.dados.latestAnalysis} />
          )}

          <p className="avisoDeSaude">
            Gerado a partir das suas avaliações. Os números são os medidos na balança.
          </p>
        </>
      )}
    </Moldura>
  );
}

/**
 * A analise assistiva, com o aviso que a regra de arquitetura no 8 exige.
 *
 * `disclaimerCode` vem do servidor e e sempre `NOT_MEDICAL_DIAGNOSIS` -- o
 * proprio dominio rejeita saida de IA que nao o traga. O aviso e
 * PERSISTENTE e nao tem botao de fechar.
 */
function AnaliseAssistiva({
  analise,
}: {
  readonly analise: NonNullable<EvolucaoDoTotem['latestAnalysis']>;
}) {
  return (
    <div className="analiseAssistiva" data-testid="analise-assistiva">
      {analise.positivePoints.map((ponto) => (
        <p key={ponto} className="corpo">
          {ponto}
        </p>
      ))}

      {analise.attentionPoints.map((ponto) => (
        <p key={ponto} className="corpo">
          {ponto}
        </p>
      ))}

      <p className="avisoDeSaude" data-testid="disclaimer-da-ia">
        Análise gerada por inteligência artificial. Não é diagnóstico médico.
      </p>
    </div>
  );
}

/** §5.5 — uma linha por mês medido. */
export function HistoricoDeAvaliacoes({
  sessao,
  aoVoltar,
}: {
  readonly sessao: SessaoDoAluno;
  readonly aoVoltar: () => void;
}) {
  const estado = useCarga<readonly LinhaDeAvaliacao[]>(
    () => carregarAvaliacoes(sessao.sessionId, sessao.token),
    [sessao.sessionId, sessao.token],
  );

  return (
    <Moldura titulo="Histórico de avaliações" aoVoltar={aoVoltar}>
      {estado.fase === 'carregando' && <p className="corpo">Carregando…</p>}
      {estado.fase === 'falhou' && <NaoCarregou />}

      {estado.fase === 'pronto' && estado.dados.length === 0 && (
        <p className="corpo" data-testid="sem-avaliacoes">
          Você ainda não tem avaliação registrada.
        </p>
      )}

      {estado.fase === 'pronto' && estado.dados.length > 0 && (
        <>
          <div className="listaDeAvaliacoes" data-testid="lista-de-avaliacoes">
            {estado.dados.map((linha) => (
              <div key={linha.assessmentId} className="linhaDeAvaliacao">
                <span className="corpo">{mesDaMedicao(linha.medidaEm) ?? '—'}</span>

                {linha.metricas.map((m) => (
                  <span key={m.tipo} className="metadado">
                    {rotuloDeTipo(m.tipo)}: {valorLegivel(m.valor, m.unidade)}
                  </span>
                ))}
              </div>
            ))}
          </div>

          <p className="avisoDeSaude">
            Somente leitura no totem. Laudo completo e gráficos no aplicativo.
          </p>
        </>
      )}
    </Moldura>
  );
}
