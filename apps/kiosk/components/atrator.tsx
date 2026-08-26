'use client';

import type { IndicadoresDaUnidade, KioskConfig } from '@arenahub/api-contracts';

import { blocosVisiveis } from '../lib/rodizio';
import { BlocosPublicos } from './blocos-publicos';
import { IconeEntrar, IconeMarca } from './icones';

/**
 * Tela publica -- DS-TOTEM.md §4.
 *
 * REGRA QUE NAO SE NEGOCIA: nenhum dado de aluno aparece aqui. Nem nome, nem
 * foto, nem ranking. Esta tela e vista por quem passa na recepcao, e as unicas
 * props sao `config` e dois INTEIROS agregados da unidade -- nao ha prop por
 * onde um nome, um valor de pendencia ou um id entrasse (`M3.5-BR-001`).
 *
 * Os blocos opcionais e a faixa de patrocinadores chegaram na F51 e vivem em
 * `BlocosPublicos`. O §4 continua valendo quando nao ha nenhum ligado -- "se
 * todos os blocos opcionais estiverem desligados, hero e CTA se distribuem
 * com o espaco restante": os dois `flex` abaixo sao essa distribuicao, e o
 * componente nao renderiza nada quando a lista esta vazia.
 *
 * A tela INTEIRA e tocavel e leva a identificacao (§4), nao so o botao: a
 * 80 cm, mirar um retangulo especifico e trabalho desnecessario.
 */
export function Atrator({
  config,
  indicadores,
  aoEntrar,
  altoContraste,
  aoAlternarContraste,
}: {
  readonly config: KioskConfig;
  /** Dois inteiros da unidade. `null` ate o primeiro heartbeat responder. */
  readonly indicadores: IndicadoresDaUnidade | null;
  readonly aoEntrar: () => void;
  readonly altoContraste: boolean;
  readonly aoAlternarContraste: () => void;
}) {
  const { marca } = config;
  const { kicker, headline } = partirSlogan(marca.slogan, marca.nomeDaAcademia);
  const temBloco = blocosVisiveis(config).length > 0;

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
        A DISTRIBUICAO do §4: sem bloco opcional nenhum, o espaco sobra. Ele e
        repartido em DOIS -- um antes do hero, um depois -- e nao empilhado
        inteiro embaixo dele: com um `flex: 1` so, o hero fica grudado no
        cabecalho e a tela parece truncada no meio. Com dois, o hero flutua no
        terco superior e o CTA no inferior, que e a leitura que o §4 descreve.
        Com blocos ligados, eles ocupam o vao de baixo e os `flex` cedem.
      */}
      <span style={{ flex: 1 }} />

      <div className="heroContainer" style={{ flexShrink: 0 }}>
        {/*
          Forma angular e ponto pulsante -- §3.3, "o unico elemento decorativo
          permitido na tela publica". Os dois carregam `data-decorativo`, que e
          o seletor que o alto contraste ja usava para esconde-los desde a F51
          -- a regra existia sem nada que a acionasse.
        */}
        <span className="formaAngular" data-decorativo aria-hidden="true" />
        <span className="pontoDeAcento" data-decorativo aria-hidden="true" />
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

      {/*
        O vao de baixo SO existe quando nao ha bloco: com um cartao na tela,
        os dois `flex` continuavam empurrando e o bloco flutuava solto no meio
        de muito ar -- foi o que a tela real mostrou. Com bloco, o espaco e
        dele.
      */}
      {temBloco ? null : <span style={{ flex: 1.4 }} />}

      <BlocosPublicos config={config} indicadores={indicadores} />

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
