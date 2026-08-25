'use client';

import type { KioskConfig } from '@arenahub/api-contracts';

import { IconeEntrar, IconeMarca } from './icones';

/**
 * Tela publica -- DS-TOTEM.md §4.
 *
 * REGRA QUE NAO SE NEGOCIA: nenhum dado de aluno aparece aqui. Nem nome, nem
 * foto, nem ranking. Esta tela e vista por quem passa na recepcao, e o
 * componente inteiro so recebe `config` -- nao ha prop por onde um dado de
 * aluno entrasse mesmo que alguem quisesse.
 *
 * Nasce SEM os quatro blocos opcionais (reel, eventos, informacoes ao vivo,
 * patrocinio): eles sao a F51. O §4 ja cobre este estado -- "se todos os
 * blocos opcionais estiverem desligados, hero e CTA se distribuem com o
 * espaco restante". O `flex: 1` entre hero e CTA e essa distribuicao.
 *
 * A tela INTEIRA e tocavel e leva a identificacao (§4), nao so o botao: a
 * 80 cm, mirar um retangulo especifico e trabalho desnecessario.
 */
export function Atrator({
  config,
  aoEntrar,
}: {
  readonly config: KioskConfig;
  readonly aoEntrar: () => void;
}) {
  const { marca } = config;

  return (
    <div
      className="tela"
      style={{ padding: 'var(--tt-padding-publico)', gap: 'var(--tt-gap-bloco)' }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 24, flexShrink: 0 }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 84,
            height: 84,
            flexShrink: 0,
            borderRadius: 22,
            border: 'var(--tt-borda) solid var(--ah-totem-brand-500)',
            background: 'var(--ah-totem-bg-surface)',
            color: 'var(--ah-totem-brand-300)',
          }}
        >
          <IconeMarca tamanho={52} />
        </span>
        <div>
          {/* Vem da CONFIG desde o primeiro commit (ADR-042, Decisao 0) --
              nunca literal, mesmo que hoje so exista o padrao do seed. */}
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.01em' }}>
            {marca.nomeDaAcademia}
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              marginTop: 2,
              letterSpacing: '0.04em',
              color: 'var(--ah-totem-brand-200)',
            }}
          >
            {/* Slogan pode vir vazio; a unidade e o que sempre existe. */}
            {marca.slogan === '' ? marca.nomeDaUnidade : marca.slogan}
          </div>
        </div>
      </header>

      {/*
        A DISTRIBUICAO do §4: sem os quatro blocos opcionais (F51), o espaco
        sobra. Ele e repartido em DOIS -- um antes do hero, um depois -- e nao
        empilhado inteiro embaixo dele: com um `flex: 1` so, o hero fica
        grudado no cabecalho e a tela parece truncada no meio. Com dois, o
        hero flutua no terco superior e o CTA no inferior, que e a leitura que
        o §4 descreve ("hero e CTA se distribuem com o espaco restante").
        Quando a F51 ligar os blocos, eles entram entre estes dois vaos e o
        `flex: 1` some sozinho -- sem mexer neste arquivo.
      */}
      <span style={{ flex: 1 }} />

      <div style={{ flexShrink: 0 }}>
        <div className="kicker" style={{ marginBottom: 12 }}>
          MUSCULAÇÃO · SAÚDE · PERFORMANCE
        </div>
        <h1 className="hero">
          Disciplina hoje.
          <br />
          <span className="heroDestaque">Resultados sempre.</span>
        </h1>
      </div>

      <span style={{ flex: 1.4 }} />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          flexShrink: 0,
        }}
      >
        <button type="button" className="ctaPrimario" onClick={aoEntrar}>
          <IconeEntrar tamanho={34} />
          Entrar na minha área
        </button>
        <p className="metadado" style={{ color: 'var(--ah-totem-brand-200)' }}>
          Consulte seu plano e acompanhe sua evolução
        </p>
      </div>

      {/* Assinatura ArenaHub -- DS-TOTEM.md §11.10. Nao configuravel. */}
      <p
        style={{
          flexShrink: 0,
          textAlign: 'center',
          fontSize: 'var(--tt-minimo)',
          color: 'var(--ah-totem-text-secondary)',
        }}
      >
        tecnologia <strong>arenahub</strong>
      </p>
    </div>
  );
}
