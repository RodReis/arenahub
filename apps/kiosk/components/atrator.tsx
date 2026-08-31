'use client';

import type { IndicadoresDaUnidade, KioskConfig } from '@arenahub/api-contracts';

import {
  AssinaturaSolta,
  BlocosPublicos,
  FaixaDePatrocinio,
  haAlgoNaGradePublica,
} from './blocos-publicos';
import { IconeEntrar, IconeMarca } from './icones';

/**
 * Tela publica -- DS-TOTEM.md §4 v2.1 (grade densa, ADR-047 Emenda de
 * 27/08/2026 (2)).
 *
 * REGRA QUE NAO SE NEGOCIA: nenhum dado IDENTIFICAVEL de aluno aparece
 * aqui. Nem nome civil, nem foto, nem id. O bloco de ranking (F31) e a
 * excecao desenhada: mostra posicao, nome JA ABREVIADO e pontos, porque
 * `resolverExposicao()` roda no SERVIDOR antes do heartbeat chegar --
 * `Atrator` continua recebendo so `config` e dois INTEIROS agregados mais o
 * placar ja resolvido, nunca um `studentId` (`M3.5-BR-001`).
 *
 * Os blocos opcionais, o ranking e a faixa de patrocinadores vivem em
 * `BlocosPublicos`. O §4 continua valendo quando nao ha nenhum ligado -- "se
 * todos os blocos opcionais estiverem desligados, hero e CTA se distribuem
 * com o espaco restante": os dois `flex` abaixo sao essa distribuicao, e
 * `haAlgoNaGradePublica` decide quando a grade nao renderiza nada.
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
  const temBloco = haAlgoNaGradePublica(config, indicadores);

  return (
    /*
      A TELA INTEIRA E TOCAVEL (§4): o clique no fundo leva a identificacao,
      nao so o botao do cabecalho. O caminho de teclado/leitor de tela e o
      proprio botao "Entrar" -- por isso o div nao carrega role nem tabindex:
      dois alvos identicos anunciados em sequencia so confundem.
    */
    <div
      className="tela"
      data-testid="tela-atratora"
      onClick={aoEntrar}
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
          onClick={(evento) => {
            /*
              A tela inteira e tocavel (onClick no container): sem o
              stopPropagation, alternar o contraste tambem ABRIRIA a
              identificacao -- o toque de acessibilidade nao pode navegar.
            */
            evento.stopPropagation();
            aoAlternarContraste();
          }}
        >
          Alto contraste
        </button>

        {/*
          O BOTAO ENTRAR MOROU AQUI a partir da imagem de referencia do PI
          (28/08/2026) e do diagrama do §4 v2.1 -- `[contraste][Entrar]` no
          cabecalho, hint fixo no rodape. O CTA gigante de rodape saiu: a tela
          inteira ja e o alvo de toque, e o §3.8 segue valendo (um unico CTA
          primario por tela -- este).

          Reusa `.ctaPrimario` de proposito: alto contraste, reduced-motion e
          o retorno de toque (:active) vem de graca; `.ctaDoCabecalho` so
          encolhe o tamanho para o cabecalho.
        */}
        <button
          type="button"
          className="ctaPrimario ctaDoCabecalho"
          data-testid="entrar-cabecalho"
          onClick={(evento) => {
            evento.stopPropagation();
            aoEntrar();
          }}
        >
          <IconeEntrar tamanho={26} />
          Entrar
        </button>
      </header>

      {/*
        A DISTRIBUICAO do §4 vale SO quando nao ha bloco: "se todos os blocos
        opcionais estiverem desligados, hero e CTA se distribuem com o espaco
        restante". Sem bloco, o espaco e repartido em DOIS -- um vao antes do
        hero, um depois -- e nao empilhado inteiro embaixo dele: com um so, o
        hero grudaria no cabecalho numa tela vazia.

        COM bloco, os dois vaos somem. Ate 28/08/2026 este de cima rodava
        SEMPRE, e empurrava o hero 500px para baixo numa tela de 1920 --
        medido no totem real: cabecalho terminava em 132, o hero comecava em
        720. O espaco morto saia da grade, que e onde o protótipo (`Totem.dc.html`)
        poe o conteudo. O vao de baixo ja era condicional desde a F31; este
        ficou para tras.
      */}
      {temBloco ? null : <span style={{ flex: 1 }} />}

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
        {/*
          As frases correm NA MESMA LINHA (imagem de referencia de
          28/08/2026), quebrando naturalmente quando nao couberem -- o `<br>`
          forcado de antes fazia todo slogan de duas frases ocupar duas
          linhas e roubava altura da grade.
        */}
        <h1 className="hero">
          {headline.map((frase, indice) => (
            <span key={frase}>
              {indice > 0 && ' '}
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

      {/*
        O HINT FIXO DO §4 no lugar do CTA gigante: com o botao Entrar no
        cabecalho e a tela inteira tocavel, o rodape vira a instrucao -- e a
        promessa do que ha do outro lado. "pagamentos" so entra quando o
        modulo esta LIGADO: prometer pagamento numa unidade que o desligou
        manda o aluno procurar o que nao existe (§11).
      */}
      <p className="dicaDeEntrada" data-testid="dica-de-entrada">
        Toque na tela para entrar na sua área
        {config.modulos.pagamento ? ' — plano, avaliação e pagamentos' : ' — plano e avaliação'}
      </p>

      {/*
        A FAIXA FECHA A TELA, depois do CTA -- e a ordem do protótipo
        (`Totem.dc.html`). Ate 28/08/2026 ela saia de dentro de
        `BlocosPublicos`, o que a prendia ACIMA do botao: patrocinador
        aparecia antes da acao principal, invertendo a hierarquia da tela.

        A ASSINATURA ArenaHub (§11.10) mora dentro da faixa, dividindo a linha
        com "ESPACO PATROCINADO". Sem faixa, `AssinaturaSolta` a devolve
        sozinha -- as duas nunca aparecem juntas nem somem juntas.
      */}
      <FaixaDePatrocinio patrocinio={config.patrocinio} />
      <AssinaturaSolta patrocinio={config.patrocinio} />
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
