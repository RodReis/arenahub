'use client';

import { useState } from 'react';

import type { KioskConfig } from '@arenahub/api-contracts';

import type { SessaoDoAluno } from '../lib/kiosk-client';
import { modulosVisiveis, type CardDeModulo } from '../lib/modulos';
import { HistoricoDePagamentos } from './historico-de-pagamentos';
import { IconeAtencao, IconeConfirmado } from './icones';
import { Pagamento } from './pagamento';
import { Preferencias } from './preferencias';
import { AvaliacaoDoMes, Evolucao, HistoricoDeAvaliacoes } from './saude';
import { Xp } from './xp';
import { Desafios } from './desafios';

/**
 * Area interna -- DS-TOTEM.md §5.2.
 *
 * A F49 entregou saudacao e faixa de estado; a F52 acrescenta a GRADE DE
 * MODULOS. Modulo desligado NAO aparece: nao aparece cinza, nao aparece
 * desabilitado, nao existe (ADR-042, Decisao 5). O que a grade mostra vem
 * inteiro de `config.modulos` -- e o servidor recusa o endpoint do modulo
 * desligado de qualquer jeito (trava 1), entao esconder aqui e conveniencia
 * de tela, nao o mecanismo de seguranca.
 *
 * A faixa de estado segue a receita unica do §2.1: borda 2 px em 40% da cor,
 * fundo em 10%, icone e titulo na cor cheia, corpo em branco.
 *
 * PENDENCIA SEM VALOR NESTA TELA. A faixa diz QUE ha pendencia e o que
 * fazer; o valor e o detalhe da fatura so aparecem na etapa de pagamento,
 * depois de acao deliberada do aluno (`DS-TOTEM.md` §9.1, e a issue da F52).
 * A recepcao tem fila atras -- quem esta na fila le a tela de quem esta na
 * frente.
 */
export function MinhaArea({
  sessao,
  config,
}: {
  readonly sessao: SessaoDoAluno;
  readonly config: KioskConfig;
}) {
  const pendencia = sessao.plano.pendenciaEmCentavos;

  /*
   * Deriva dos cards VISIVEIS, nunca de `Object.values(config.modulos)`.
   *
   * A razao original era `ranking` ligado sem card -- a grade acendia vazia.
   * A F30 entregou o card, entao esse caso especifico morreu; a derivacao
   * continua porque a assimetria pode voltar: todo modulo novo nasce no
   * contrato (`KioskConfig`) antes de ter tela, e contar flag em vez de card
   * acenderia a grade cedo demais outra vez.
   */
  const cards = modulosVisiveis(config);
  const modulosLigados = cards.length > 0;

  /*
   * NAVEGACAO POR ESTADO, NAO POR ROTA. O totem roda em quiosque e o
   * historico do navegador sobrevive ao encerramento da sessao: com rota,
   * o botao "voltar" reabriria a tela do aluno ANTERIOR. O mesmo motivo
   * que `page.tsx` ja documenta para a maquina de etapas de la.
   */
  const [aberto, setAberto] = useState<CardDeModulo['campo'] | null>(null);
  const voltar = () => setAberto(null);

  if (aberto === 'pagamento') return <Pagamento sessao={sessao} aoVoltar={voltar} />;
  if (aberto === 'avaliacao') return <AvaliacaoDoMes sessao={sessao} aoVoltar={voltar} />;
  if (aberto === 'evolucao') return <Evolucao sessao={sessao} aoVoltar={voltar} />;
  if (aberto === 'historicoDeAvaliacoes')
    return <HistoricoDeAvaliacoes sessao={sessao} aoVoltar={voltar} />;

  if (aberto === 'ranking') return <Preferencias sessao={sessao} aoVoltar={voltar} />;
  if (aberto === 'xp') return <Xp sessao={sessao} aoVoltar={voltar} />;
  if (aberto === 'desafios') return <Desafios sessao={sessao} aoVoltar={voltar} />;

  if (aberto === 'historicoDePagamentos')
    return (
      <HistoricoDePagamentos
        sessao={sessao}
        // O CTA de pagar so existe se o modulo de pagamento estiver ligado:
        // oferecer um caminho que o servidor recusaria com 404 seria pior
        // que nao oferece-lo.
        aoPagar={config.modulos.pagamento ? () => setAberto('pagamento') : undefined}
        aoVoltar={voltar}
      />
    );

  return (
    <div
      style={{
        flex: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--tt-gap-bloco)',
        padding: 'var(--tt-padding-interno) var(--tt-padding-interno) 24px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p
          className="corpo"
          data-testid="saudacao"
          style={{ fontSize: 'var(--tt-card-titulo)' }}
        >
          {/* Primeiro nome so: o nome inteiro num totem de recepcao e mais
              dado exposto do que a saudacao precisa. */}
          Olá, {sessao.nome.split(' ')[0] ?? sessao.nome}
        </p>
        <h1 className="tituloDeTela">Minha área</h1>
      </div>

      {pendencia === null ? (
        <FaixaDeEstado
          tom="var(--ah-totem-state-success)"
          icone={<IconeConfirmado tamanho={48} />}
          titulo="Plano ativo"
          corpo={`Sem pendências em ${config.marca.nomeDaUnidade}. Bom treino!`}
        />
      ) : (
        <FaixaDeEstado
          tom="var(--ah-totem-state-warning)"
          icone={<IconeAtencao tamanho={48} />}
          titulo="Pendência em aberto"
          // SEM VALOR: o quanto so aparece na etapa de pagamento, depois de
          // acao deliberada. Ver o cabecalho deste arquivo.
          corpo={
            config.modulos.pagamento
              ? 'Você tem uma fatura em aberto. Toque em Pagamento para regularizar agora.'
              : 'Você tem uma fatura em aberto. Procure a recepção para regularizar.'
          }
        />
      )}

      {modulosLigados ? (
        <GradeDeModulos cards={cards} aoAbrir={setAberto} />
      ) : (
        /*
          Nenhum modulo ligado: a grade do §5.2 nao existe -- nao ha grade
          vazia, nem placeholder, nem "em breve" (ADR-042, Decisao 5). O que
          a tela diz no lugar fica JUNTO da faixa, e nao empurrado para o
          rodape por um `flex: 1`: a 1920 px isso deixava um vao de 1200 px
          entre a faixa e a frase, e a tela lia como se algo tivesse falhado
          ao carregar.
        */
        <p className="metadado">
          Para pagamentos, avaliações e evolução, procure a recepção.
        </p>
      )}

      {/* A sobra fica embaixo do conteudo, nunca no meio dele. */}
      <span style={{ flex: 1 }} />
    </div>
  );
}

/**
 * Grade de card-modulo -- DS-TOTEM.md §3.10 e §5.2.
 *
 * `<button>` nativo, nao `<div onClick>`: teclado, leitor de tela e estado
 * de foco ja funcionam sem reimplementar nada -- e o totem tem teclado
 * virtual e leitor por exigencia de acessibilidade (`M3.5-BR-002`).
 *
 * Alvo minimo de 88 px (`--tt-alvo-secundario`) e o piso NAO CONFIGURAVEL do
 * ADR-042, Decisao 6.
 */
function GradeDeModulos({
  cards,
  aoAbrir,
}: {
  readonly cards: readonly CardDeModulo[];
  readonly aoAbrir?: (campo: CardDeModulo['campo']) => void;
}) {
  return (
    <div
      data-testid="grade-de-modulos"
      style={{
        /*
         * A GRADE FICA LOGO ABAIXO DA FAIXA, e a sobra vai para o fim.
         *
         * Duas tentativas erradas antes desta, e as duas vistas na tela do
         * totem, nao deduzidas: `gridAutoRows: 1fr` esticou os cartoes para
         * 419 px com o titulo boiando no meio; `alignContent: center` abriu
         * um vao de 470 px ENTRE a faixa e a grade, e a tela passou a ler
         * como se o miolo tivesse sumido.
         *
         * Altura natural, encostada no conteudo de cima: sobra embaixo de
         * uma tela curta e o lugar normal de sobra.
         */
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: 20,
      }}
    >
      {cards.map((card, indice) => (
        <button
          key={card.campo}
          type="button"
          data-testid={`modulo-${card.campo}`}
          onClick={() => aoAbrir?.(card.campo)}
          style={{
            /*
             * O ULTIMO CARD DE CONTAGEM IMPAR ATRAVESSA a linha inteira. Com
             * cinco modulos em duas colunas ele ficava sozinho na terceira
             * fileira, com um buraco do tamanho de um card ao lado -- lido
             * como card que faltou carregar, nao como fim da lista.
             */
            ...(indice === cards.length - 1 && cards.length % 2 === 1
              ? { gridColumn: '1 / -1' }
              : {}),
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'center',
            gap: 6,
            minHeight: 'var(--tt-alvo-secundario)',
            padding: '28px 32px',
            textAlign: 'left',
            borderRadius: 'var(--tt-raio-card)',
            border: `var(--tt-borda) solid ${
              card.natureza === 'transacao'
                ? 'var(--ah-totem-brand-500)'
                : 'var(--ah-totem-border-default)'
            }`,
            background:
              card.natureza === 'transacao'
                ? 'color-mix(in srgb, var(--ah-totem-brand-500) 10%, var(--ah-totem-bg-base))'
                : 'var(--ah-totem-bg-surface)',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 'var(--tt-card-titulo)', fontWeight: 700 }}>{card.titulo}</span>
          <span className="metadado">{card.destino}</span>
        </button>
      ))}
    </div>
  );
}

/** Faixa de estado -- DS-TOTEM.md §3.11. */
function FaixaDeEstado({
  tom,
  icone,
  titulo,
  corpo,
}: {
  readonly tom: string;
  readonly icone: React.ReactNode;
  readonly titulo: string;
  readonly corpo: string;
}) {
  return (
    <div
      data-testid="faixa-de-plano"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        flexShrink: 0,
        padding: '32px 36px',
        borderRadius: 'var(--tt-raio-card)',
        border: `var(--tt-borda) solid color-mix(in srgb, ${tom} 40%, transparent)`,
        background: `color-mix(in srgb, ${tom} 10%, var(--ah-totem-bg-base))`,
      }}
    >
      {/* Estado NUNCA comunicado so por cor -- icone e titulo textual sempre
          acompanham (checklist §8, acessibilidade). */}
      <span style={{ color: tom, flexShrink: 0 }}>{icone}</span>
      <div>
        <div style={{ fontSize: 30, fontWeight: 700, color: tom }}>{titulo}</div>
        <p style={{ marginTop: 6, fontSize: 23, lineHeight: '32px' }}>{corpo}</p>
      </div>
    </div>
  );
}
