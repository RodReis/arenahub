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
  altoContraste,
  aoAlternarContraste,
}: {
  readonly config: KioskConfig;
  readonly aoEntrar: () => void;
  readonly altoContraste: boolean;
  readonly aoAlternarContraste: () => void;
}) {
  const { marca } = config;
  const { kicker, headline } = partirSlogan(marca.slogan, marca.nomeDaAcademia);

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
        <div style={{ flex: 1 }}>
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
            {/*
              A UNIDADE, sempre -- nao o slogan. O slogan agora alimenta o
              hero logo abaixo; repeti-lo aqui mostraria a mesma frase duas
              vezes na mesma tela. `nomeDaUnidade` e obrigatorio no contrato.
            */}
            {marca.nomeDaUnidade}
          </div>
        </div>

        {/*
          Interruptor de alto contraste -- DS-TOTEM.md §3.2 o coloca a direita
          do cabecalho. `aria-pressed` e nao `aria-label` mutante: o leitor de
          tela anuncia o ESTADO do botao, em vez de o rotulo trocar debaixo do
          foco.
        */}
        <button
          type="button"
          className="botaoDeContraste"
          aria-pressed={altoContraste}
          data-testid="alternar-contraste"
          onClick={aoAlternarContraste}
        >
          Alto contraste
        </button>
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
        {/*
          O HERO VEM DA CONFIG (ADR-042, Decisao 0).
          Ate o fix da revisao, o kicker e a headline traziam a copy do cliente
          inaugural literal -- "MUSCULACAO · SAUDE · PERFORMANCE" e "Disciplina
          hoje. / Resultados sempre." -- num SaaS multi-tenant, trinta linhas
          abaixo do comentario que dizia "nunca literal". A segunda academia a
          ligar o totem herdaria o slogan da primeira.

          `marca.slogan` sozinho alimenta os dois: a PRIMEIRA frase vira kicker
          e o RESTO vira headline, com a ultima frase no gradiente do §3.3. Um
          slogan de uma frase so vira headline, sem kicker. E o §4 exige que a
          tela nao quebre sem os opcionais, entao slogan vazio cai no nome da
          academia -- que sempre existe no contrato.
        */}
        {kicker !== null && (
          <div className="kicker" style={{ marginBottom: 12 }}>
            {kicker}
          </div>
        )}
        <h1 className="hero">
          {headline.map((frase, indice) => (
            <span key={frase}>
              {indice > 0 && <br />}
              {indice === headline.length - 1 ? (
                <span className="heroDestaque">{frase}</span>
              ) : (
                frase
              )}
            </span>
          ))}
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

/**
 * Reparte o slogan configurado em kicker + headline.
 *
 * PURA: entra texto, sai texto -- sem DOM, sem config, sem relogio. E o que a
 * torna testavel sem montar a tela.
 *
 * Duas frases ou mais: a primeira e o kicker (maiuscula, tracking largo do
 * §2.2) e o resto e a headline. Uma frase so: headline sem kicker -- forcar um
 * kicker exigiria inventar texto que a academia nao escreveu.
 *
 * Slogan vazio cai no nome da academia: o §4 diz que a tela nao quebra sem os
 * blocos opcionais, e um hero em branco e exatamente quebrar.
 */
export function partirSlogan(
  slogan: string,
  nomeDaAcademia: string,
): { kicker: string | null; headline: readonly string[] } {
  const frases = slogan
    .split(/(?<=[.!?])\s+/)
    .map((frase) => frase.trim())
    .filter((frase) => frase !== '');

  if (frases.length === 0) return { kicker: null, headline: [nomeDaAcademia] };
  if (frases.length === 1) return { kicker: null, headline: frases };

  return { kicker: frases[0]?.toUpperCase() ?? null, headline: frases.slice(1) };
}
