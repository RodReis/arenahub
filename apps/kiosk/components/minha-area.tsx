'use client';

import type { KioskConfig } from '@arenahub/api-contracts';

import { formatarDinheiro } from '../lib/dinheiro';
import type { SessaoDoAluno } from '../lib/kiosk-client';
import { IconeAtencao, IconeConfirmado } from './icones';

/**
 * Area interna -- DS-TOTEM.md §5.2.
 *
 * MAGRA DE PROPOSITO nesta fatia: saudacao, faixa de estado do plano e o
 * rodape de sessao (que vive na tela, nao aqui). A grade de seis modulos do
 * §5.2 fica VAZIA -- na F49 a config traz todos `false`, e modulo desligado
 * NAO aparece: nao aparece cinza, nao aparece desabilitado, nao existe
 * (ADR-042, Decisao 5). Quando a fatia dona de cada modulo entregar, ela
 * liga o dele na config e a grade nasce sozinha.
 *
 * A faixa de estado segue a receita unica do §2.1: borda 2 px em 40% da cor,
 * fundo em 10%, icone e titulo na cor cheia, corpo em branco.
 */
export function MinhaArea({
  sessao,
  config,
}: {
  readonly sessao: SessaoDoAluno;
  readonly config: KioskConfig;
}) {
  const pendencia = sessao.plano.pendenciaEmCentavos;

  const modulosLigados = Object.values(config.modulos).some(Boolean);

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
          // Centavos INTEIROS, formatados pelo helper compartilhado -- nunca
          // `valor / 100` a mao (M2-BR-001).
          corpo={`Fatura de ${formatarDinheiro(pendencia)} em aberto. Procure a recepção para regularizar.`}
        />
      )}

      {/*
        Nenhum modulo ligado na F49: a grade do §5.2 nao existe -- nao ha
        grade vazia, nem placeholder, nem "em breve" (ADR-042, Decisao 5).
        O que a tela diz no lugar fica JUNTO da faixa, e nao empurrado para o
        rodape por um `flex: 1`: a 1920 px isso deixava um vao de 1200 px
        entre a faixa e a frase, e a tela lia como se algo tivesse falhado ao
        carregar. Com a frase logo abaixo, o vazio fica embaixo do conteudo
        -- que e o lugar normal de sobra numa tela curta.
      */}
      {!modulosLigados && (
        <p className="metadado">
          Para pagamentos, avaliações e evolução, procure a recepção.
        </p>
      )}

      <span style={{ flex: 1 }} />
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
