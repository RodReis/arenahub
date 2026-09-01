'use client';

import { useEffect, useState } from 'react';
import {
  rotuloDePatrocinio,
  type BlocoDaTelaPublica,
  type EntradaPublicaDoPlacar,
  type IndicadoresDaUnidade,
  type KioskConfig,
} from '@arenahub/api-contracts';

import { blocosVisiveis, indiceSeguro, proximoIndice } from '../lib/rodizio';
import { IconeInstagram } from './icones';

/**
 * Grade densa da tela publica -- F51, `M3.5-FR-004`/`M3.5-FR-005`, reescrita
 * na F31 Task 14 para `DS-TOTEM.md` §4 v2.1 (ADR-047, Emenda de 27/08/2026 (2)).
 *
 * ---------------------------------------------------------------------------
 * NENHUM DADO DE ALUNO CHEGA AQUI, E A TRAVA E ESTRUTURAL.
 * ---------------------------------------------------------------------------
 *
 * `M3.5-BR-001`: as props sao `config` e `indicadores` -- nao ha por onde um
 * nome, um valor de pendencia ou um id entrar, mesmo que alguem quisesse.
 * `SessaoDoAluno` nao e importado neste arquivo. Os indicadores sao dois
 * INTEIROS agregados da unidade, mais o placar publico ja resolvido.
 *
 * ---------------------------------------------------------------------------
 * A TELA PUBLICA NAO FALA COM A REDE.
 * ---------------------------------------------------------------------------
 *
 * Nao ha `fetch` aqui. A midia chega como URL ja assinada no boot (a API a
 * resolve em `GET /kiosk/config`) e o navegador a baixa uma vez; os numeros
 * chegam pelo heartbeat que ja existia e sao mantidos em memoria pelo pai.
 * Sem rede, o ultimo numero conhecido continua na tela.
 *
 * ---------------------------------------------------------------------------
 * F31 (Task 14) TROCA O RODIZIO ENTRE TIPOS PELA GRADE DENSA DE DUAS COLUNAS.
 * ---------------------------------------------------------------------------
 *
 * O rodizio antigo alternava um bloco de mídia por vez, com todos os tipos
 * disputando o mesmo cartao. O §4 v2.1 substituiu isso por composicao fixa:
 *
 *   - coluna esquerda ("reel"): o PRIMEIRO bloco visivel, em altura total;
 *   - coluna direita, linha de cima ("carrossel"): os DEMAIS blocos visiveis,
 *     girando entre si -- e o rodizio que sobrevive, so que restrito ao que
 *     nao e o reel;
 *   - coluna direita, linha de baixo ("ranking"): o placar publico, quando
 *     `indicadores.placar` tem alguma entrada.
 *
 * Qualquer um dos tres pode faltar (bloco desligado no painel, placar vazio,
 * ou config sem nenhum item), e a grade se recompoe por CSS (ver
 * `.gradeDaTelaPublica` em globals.css) -- nunca card vazio, nunca buraco.
 *
 * DECISAO REGISTRADA (task-14-report.md): o rodizio INTERNO do slot
 * "carrossel" continua existindo (mesmo relogio de `tempoPorBlocoSegundos`)
 * porque o contrato (`kiosk-config.ts`) nao proibe dois itens do mesmo tipo
 * na lista -- so morre o rodizio ENTRE reel e os demais tipos, que e o que o
 * §4 v2.1 elimina.
 *
 * O placar chega DENTRO de `indicadores` (`indicadores.placar`), a mesma
 * prop que ja existia -- nao um terceiro parametro, nao um `fetch` novo.
 * `resolverExposicao()` roda no SERVIDOR antes de o heartbeat sair da API:
 * o array so tem `position`/`nomeExibido`/`points`, nunca `studentId`
 * (`EntradaPublicaDoPlacar` em `@arenahub/api-contracts`), e o nome ja chega
 * abreviado (F30/F31 Task 13) -- este componente NAO abrevia, NAO filtra.
 */

/**
 * Ha algo para a grade publica mostrar?
 *
 * PURA e EXPORTADA porque `atrator.tsx` precisa da MESMA resposta para
 * decidir o espacamento do hero/CTA (§4: "se todos os blocos opcionais
 * estiverem desligados, hero e CTA se distribuem com o espaco restante") --
 * e o ranking sozinho (sem nenhum bloco configuravel ligado) TAMBEM conta
 * como "ha algo", entao a checagem nao pode ser so `blocosVisiveis(...).length`.
 */
export function haAlgoNaGradePublica(
  config: KioskConfig,
  indicadores: IndicadoresDaUnidade | null,
): boolean {
  return (
    blocosVisiveis(config, indicadores?.desafio ?? null).length > 0 ||
    (indicadores?.placar.length ?? 0) > 0
  );
}

export function BlocosPublicos({
  config,
  indicadores,
}: {
  readonly config: KioskConfig;
  readonly indicadores: IndicadoresDaUnidade | null;
}) {
  const placar = indicadores?.placar ?? [];

  /*
   * `visiveis[0]` e o reel (coluna esquerda); o resto e o slot de carrossel
   * (coluna direita, linha de cima). A mesma funcao de sempre decide QUAIS
   * blocos entram -- so o LUGAR deles na tela mudou.
   *
   * "reel" e "carrossel" aqui sao POSICAO na grade, nao TIPO de bloco: o
   * contrato (`TIPOS_DE_BLOCO`) nao nomeia esses dois papeis -- qualquer um
   * dos cinco tipos (VIDEO, EVENTOS, MATERIAL, INSTAGRAM, INFORMACOES) vira
   * reel se for o primeiro item visivel da lista, e carrossel se vier depois.
   * Decisao registrada no relatorio da task 14: nao ha campo no schema que
   * marque um bloco como "e o reel".
   */
  const visiveis = blocosVisiveis(config, indicadores?.desafio ?? null);
  const reel = visiveis[0];
  const blocosDoCarrossel = visiveis.slice(1);
  const temRanking = placar.length > 0;

  /*
   * Classe de composicao: uma por combinacao de (reel, carrossel, ranking).
   * O CSS le esta classe para decidir a `grid-template-areas` -- ver o
   * comentario de `.gradeDaTelaPublica` em globals.css para a tabela
   * completa das seis composicoes possiveis.
   */
  const composicao = classeDaComposicao({
    temReel: reel !== undefined,
    temCarrossel: blocosDoCarrossel.length > 0,
    temRanking,
  });

  return (
    <>
      {composicao !== null && (
        <div className={`gradeDaTelaPublica ${composicao}`} data-testid="grade-da-tela-publica">
          {reel !== undefined && (
            <section className="slotReel" data-testid="slot-reel" data-tipo={reel.tipo}>
              <ConteudoDoBloco bloco={reel} indicadores={indicadores} />
            </section>
          )}

          {blocosDoCarrossel.length > 0 && (
            <BlocoDeCarrossel blocos={blocosDoCarrossel} indicadores={indicadores} segundos={config.blocos.tempoPorBlocoSegundos} />
          )}

          {temRanking && <BlocoDePlacar placar={placar} />}
        </div>
      )}
    </>
  );
}

/**
 * A classe CSS da composicao, ou `null` quando nao ha nada a mostrar.
 *
 * PURA: e so uma tabela de decisao, testavel sem montar componente nenhum.
 * As seis linhas da tabela do brief da task 14 viram estas seis branches.
 */
function classeDaComposicao({
  temReel,
  temCarrossel,
  temRanking,
}: {
  readonly temReel: boolean;
  readonly temCarrossel: boolean;
  readonly temRanking: boolean;
}): string | null {
  if (!temReel && !temCarrossel && !temRanking) return null;

  // Reel desligado: a coluna direita (carrossel e/ou ranking) ocupa tudo.
  if (!temReel) return 'gradeSemReel';

  if (temCarrossel && temRanking) return 'gradeCompleta';
  if (temCarrossel) return 'gradeSemRanking';
  if (temRanking) return 'gradeSemCarrossel';

  // So o reel: uma coluna, largura total.
  return 'gradeSoReel';
}

/**
 * Slot de carrossel -- os blocos que NAO sao o reel, girando entre si.
 *
 * O relogio e o mesmo `tempoPorBlocoSegundos` de sempre: o campo continua
 * vivo porque o rodizio INTERNO deste slot ainda o consome (ver o
 * comentario no topo do arquivo e o relatorio da task 14).
 */
function BlocoDeCarrossel({
  blocos,
  indicadores,
  segundos,
}: {
  readonly blocos: readonly BlocoDaTelaPublica[];
  readonly indicadores: IndicadoresDaUnidade | null;
  readonly segundos: number;
}) {
  const total = blocos.length;
  const [indice, setIndice] = useState(0);

  useEffect(() => {
    if (total <= 1) return;

    const relogio = setInterval(() => {
      setIndice((atual) => proximoIndice(atual, total));
    }, segundos * 1000);

    return () => {
      clearInterval(relogio);
    };
  }, [total, segundos]);

  useEffect(() => {
    setIndice((atual) => indiceSeguro(atual, total));
  }, [total]);

  const atual = blocos[indiceSeguro(indice, total)];

  if (atual === undefined) return null;

  return (
    <section
      className="slotCarrossel"
      data-testid="slot-carrossel"
      data-tipo={atual.tipo}
      // O rodizio troca sozinho: `aria-live="off"` impede o leitor de tela
      // de anunciar cada volta por cima do que a pessoa faz.
      aria-live="off"
    >
      {/*
        `key={atual.id}` REMONTA o quadro a cada volta do rodizio, e a
        montagem dispara o crossfade de `.quadroDoRodizio` -- a troca seca de
        antes fazia o cartao "piscar" de um conteudo para outro sem
        transicao. Reduced-motion e alto contraste desligam a animacao no
        CSS, nunca aqui.
      */}
      <div key={atual.id} className="quadroDoRodizio">
        <ConteudoDoBloco bloco={atual} indicadores={indicadores} />
      </div>

      {total > 1 && (
        <div className="progressoDoRodizio" aria-hidden="true">
          {blocos.map((bloco, posicao) => (
            <span
              key={bloco.id}
              className="pontoDoRodizio"
              data-ativo={posicao === indiceSeguro(indice, total)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * A preferencia de movimento do SISTEMA, lida em JS.
 *
 * O CSS ja desliga animacao em `prefers-reduced-motion` (globals.css), mas
 * `<video autoPlay loop>` nao e animacao de CSS: nenhuma media query o
 * alcanca. Quem decide se ele roda e o atributo, entao a preferencia precisa
 * chegar ate aqui.
 *
 * Comeca em `false` de proposito: no servidor nao existe `matchMedia`, e um
 * default `true` faria o video nascer parado e so comecar depois da
 * hidratacao -- pior que o contrario.
 */
function useMenosMovimento(): boolean {
  const [menos, setMenos] = useState(false);

  useEffect(() => {
    /*
      `matchMedia` conferido antes de chamar: jsdom nao o implementa, e o
      navegador do totem, sim. Sem a guarda o efeito lanca no primeiro render
      da suite e derruba a arvore inteira -- o video seguiria tocando, mas o
      cartao ao redor nunca chegaria a tela.
    */
    if (typeof window.matchMedia !== 'function') return;

    const consulta = window.matchMedia('(prefers-reduced-motion: reduce)');
    setMenos(consulta.matches);

    const aoMudar = (evento: MediaQueryListEvent) => {
      setMenos(evento.matches);
    };
    consulta.addEventListener('change', aoMudar);
    return () => {
      consulta.removeEventListener('change', aoMudar);
    };
  }, []);

  return menos;
}

function ConteudoDoBloco({
  bloco,
  indicadores,
}: {
  readonly bloco: BlocoDaTelaPublica;
  readonly indicadores: IndicadoresDaUnidade | null;
}) {
  /*
    ANTES do `switch`: hook nao pode viver dentro de `case`, e o de VIDEO e o
    unico que o consome. Custo de um `matchMedia` por bloco renderizado.
  */
  const menosMovimento = useMenosMovimento();

  switch (bloco.tipo) {
    case 'VIDEO':
      /*
       * MIDIA-PRIMEIRO (imagem de referencia de 28/08/2026): o video ocupa o
       * cartao INTEIRO (o CSS zera o padding via `[data-tipo='VIDEO']`) e o
       * texto vem SOBREPOSTO na base, sobre o veu de legibilidade do §3.4 --
       * antes a midia era uma tira com titulo embaixo, e um reel 9/16 num
       * cartao alto deixava metade do card em texto vazio.
       *
       * `object-fit: cover` e o que serve o 9/16: o cartao do reel e mais
       * alto que 16/9 e o video preenche recortando as bordas, nunca
       * esticando nem letterbox.
       */
      return (
        <figure className="midiaDoBloco">
          {/*
            SEM SOM E COM LEGENDA -- DS-TOTEM.md §4: a recepcao nao tem audio
            confiavel. `muted` e `playsInline` tambem sao o que faz o
            navegador aceitar `autoPlay` sem gesto do usuario; sem eles o
            video ficaria parado no primeiro quadro.
          */}
          {/*
            `autoPlay` e `loop` so quando ninguem pediu menos movimento. Video
            que roda sozinho, em laco, sem parada e por mais de 5s e o que a
            WCAG 2.2.2 (nivel A) proibe -- e num totem sem cursor um botao de
            pausa nao tem quem o alcance: a preferencia do sistema E o
            controle. Desligado, o quadro fica no primeiro frame, que continua
            sendo a midia da academia, so que quieta.
          */}
          <video
            className="videoDoBloco"
            src={bloco.midiaUrl ?? undefined}
            autoPlay={!menosMovimento}
            muted
            loop={!menosMovimento}
            playsInline
            data-testid="video-do-bloco"
          />
          <span className="veuDaMidia" aria-hidden="true" />
          <figcaption className="legendaDaMidia">
            <h2 className="tituloDoBloco">{bloco.titulo}</h2>
            <p className="corpoDaMidia">{bloco.legenda}</p>
            {/*
              O aviso do §3.4 e obrigatorio -- mas quando a PROPRIA legenda
              do gerente ja avisa ("sem som"), repetir a frase uma linha
              abaixo le como defeito, nao como aviso.
            */}
            {!/sem som/i.test(bloco.legenda) && (
              <p className="avisoDaMidia">reproduz sem som, com legenda</p>
            )}
          </figcaption>
        </figure>
      );

    case 'EVENTOS':
      /*
        LISTA VAZIA NAO E LISTA -- mesma tese de `Movimentos` em `xp.tsx`.
        Um titulo "Agenda" com nada embaixo, na parede da recepcao, le como
        carregamento que falhou; a frase diz que nao ha evento, que e outra
        coisa. O titulo do gerente continua aparecendo: ele nomeia o espaco.
      */
      if (bloco.itens.length === 0) {
        return (
          <>
            <h2 className="tituloDoBloco">{bloco.titulo}</h2>
            <p className="corpo" data-testid="sem-eventos">
              Nenhum evento marcado por enquanto.
            </p>
          </>
        );
      }

      return (
        <>
          <h2 className="tituloDoBloco">{bloco.titulo}</h2>
          <ul className="listaDeEventos">
            {bloco.itens.map((evento) => (
              <li key={`${evento.data}-${evento.titulo}`} className="evento">
                <span className="dataDoEvento">{formatarData(evento.data)}</span>
                <span className="tituloDoEvento">{evento.titulo}</span>
                <span className="metadado">{evento.informacao}</span>
              </li>
            ))}
          </ul>
        </>
      );

    case 'MATERIAL':
      return (
        <>
          <h2 className="tituloDoBloco">{bloco.titulo}</h2>
          <p className="corpo">{bloco.resumo}</p>
          {/*
            O ENDERECO EM TEXTO, e nao um QR gerado aqui: desenhar QR exigiria
            biblioteca nova, e `M3.5-FR-005` proibe script de terceiro na tela
            publica. O QR de verdade e fatia propria, quando houver decisao
            sobre qual gerador entra.
          */}
          <p className="metadado" data-testid="endereco-do-material">
            {bloco.urlDoQr}
          </p>
        </>
      );

    case 'INSTAGRAM':
      /*
       * SEM MIDIA NO CONTRATO (perfil + chamada, nada mais), o cartao vivia
       * como duas linhas soltas num mar de superficie vazia. Centralizar e
       * dar o icone transforma o mesmo dado em convite: quem passa le o
       * @perfil de longe.
       */
      return (
        <div className="blocoDeInstagram" data-testid="bloco-de-instagram">
          <span className="discoDeInstagram" aria-hidden="true">
            <IconeInstagram tamanho={40} />
          </span>
          <h2 className="perfilDeInstagram">{bloco.perfil}</h2>
          {bloco.chamada !== '' && <p className="corpo">{bloco.chamada}</p>}
        </div>
      );

    case 'DESAFIO':
      /*
       * SEM O DESAFIO, NAO RENDERIZA NADA -- `blocosVisiveis` ja tirou este
       * bloco da lista quando `desafio` e nulo, entao este `null` e a rede
       * de seguranca, nao o caminho normal. Um titulo sozinho na parede
       * anunciaria uma campanha que nao existe.
       *
       * Sem contagem de inscritos e sem nome de aluno: `M3.5-BR-001` proibe
       * dado de aluno na tela publica, e com a inscricao automatica o numero
       * de inscritos e a base inteira da academia (ADR-048, emenda 2).
       */
      return indicadores?.desafio ? (
        <div className="blocoDeDesafio" data-testid="bloco-de-desafio">
          <p className="metadado">{bloco.titulo}</p>
          <h2 className="nomeDoDesafio">{indicadores.desafio.titulo}</h2>

          {/*
            A META E O NUMERO GRANDE, nao o titulo: quem passa a 3 m de
            distancia le "6 treinos" e entende o que a academia esta pedindo.
            O nome da campanha e contexto; a meta e a informacao.
          */}
          <p className="metaDoDesafio">
            <span className="valorDaMetrica">{indicadores.desafio.meta}</span>
            <span className="corpo"> treinos</span>
          </p>

          {/*
            O PRAZO FECHA O BLOCO, alinhado embaixo -- e o que cria urgencia,
            e no ultimo dia ganha destaque de estado em vez de virar
            "faltam 0 dias".
          */}
          <p
            className={
              indicadores.desafio.diasRestantes === 0 ? 'prazoDoDesafioUltimoDia' : 'metadado'
            }
          >
            {indicadores.desafio.diasRestantes === 0
              ? 'Último dia'
              : `Faltam ${String(indicadores.desafio.diasRestantes)} dias`}
          </p>
        </div>
      ) : null;

    case 'INFORMACOES':
      return (
        <>
          <h2 className="tituloDoBloco">{bloco.titulo}</h2>

          {/*
            SEM NUMERO AINDA (o primeiro heartbeat nao voltou, ou a rede caiu
            antes dele) o bloco mostra so o titulo -- nunca um zero. Zero e
            uma afirmacao: "ninguem treinou hoje" na recepcao de uma academia
            cheia e pior do que nao dizer nada.
          */}
          {indicadores !== null && (
            <div className="indicadores" data-testid="indicadores">
              {bloco.mostrarCheckinsDeHoje && (
                <Indicador rotulo="Check-ins hoje" valor={indicadores.checkinsDeHoje} />
              )}
              {bloco.mostrarTreinandoAgora && (
                <Indicador rotulo="Treinando agora" valor={indicadores.treinandoAgora} />
              )}
            </div>
          )}
        </>
      );
  }
}

function Indicador({ rotulo, valor }: { readonly rotulo: string; readonly valor: number }) {
  return (
    <div className="indicador">
      <span className="valorDoIndicador">{valor}</span>
      <span className="metadado">{rotulo}</span>
    </div>
  );
}

/** Os cinco medalhoes de posicao que o §3.4c define -- nunca um sexto. */
const MAXIMO_DE_LINHAS_NO_PLACAR = 5;

/**
 * Bloco de placar na tela publica -- `DS-TOTEM.md` §3.4c.
 *
 * Classes PROPRIAS (`placarPublico`, `linhaDoPlacar`, `medalhao`, ...), e nao
 * as de evento: os dois blocos vao divergir (o §3.4c ja pede medalhao por
 * posicao, chip de periodo e rodape que o card de evento nao tem), e reusar
 * a classe acoplaria dois componentes que nao tem por que mudar juntos.
 *
 * `placar` chega PRONTO do servidor (`resolverExposicao()` ja filtrou
 * opt-out e inatividade, e a F31 Task 13 ja abreviou o nome antes de o
 * heartbeat sair da API): so `position`/`nomeExibido`/`points`, nunca
 * `studentId` -- a trava do `M3.5-BR-001` continua de pe porque o TIPO em si
 * (`EntradaPublicaDoPlacar`) nao tem por onde um id entrar.
 */
function BlocoDePlacar({ placar }: { readonly placar: readonly EntradaPublicaDoPlacar[] }) {
  const linhas = placar.slice(0, MAXIMO_DE_LINHAS_NO_PLACAR);

  return (
    <section className="placarPublico" data-testid="placar-publico">
      <header className="cabecalhoDoPlacar">
        <h2 className="tituloDoBloco">Ranking do mês</h2>
        <span className="chipDoPlacar" data-testid="chip-periodo-placar">
          {rotuloDoPeriodo()}
        </span>
      </header>

      {/*
        Placar vazio e um estado NORMAL, nao uma falha: mes recem-virado, ou
        ninguem optou por aparecer (a participacao e opcional, e o rodape
        abaixo diz isso). Sem esta frase, o cartao mostrava cabecalho, chip de
        periodo e uma lista vazia -- que na parede da recepcao le como sistema
        quebrado.
      */}
      {linhas.length === 0 ? (
        <p className="corpo" data-testid="sem-placar">
          Ainda não há ranking neste mês.
        </p>
      ) : null}

      <ul className="listaDoPlacar" data-testid="lista-de-placar">
        {linhas.map((entrada) => (
          <li key={entrada.position} className="linhaDoPlacar">
            {/* Numero seco no medalhao (imagem de referencia): o circulo ja
                diz "posicao"; o "º" so espremia o numeral no disco de 52px. */}
            <span className="medalhao" data-posicao={faixaDoMedalhao(entrada.position)}>
              {entrada.position}
            </span>
            <span className="nomeDoPlacar">{entrada.nomeExibido}</span>
            <span className="pontosDoPlacar">{entrada.points} pts</span>
          </li>
        ))}
      </ul>

      <p className="rodapeDoPlacar">Participação opcional · nomes abreviados</p>
    </section>
  );
}

/**
 * A faixa de cor do medalhao, por posicao -- `DS-TOTEM.md` §3.4c: 1o em
 * `brand/500` com texto branco, 2o-3o em `brand/tint` com texto `brand/200`,
 * 4o-5o em `border/hairline`. `data-posicao` e o que o CSS usa para escolher
 * a faixa -- nunca hex aqui (regra 1 do DS §11).
 */
function faixaDoMedalhao(position: number): 'ouro' | 'prata' | 'bronze' {
  if (position === 1) return 'ouro';
  if (position <= 3) return 'prata';

  return 'bronze';
}

const MESES_DO_PERIODO = [
  'JANEIRO',
  'FEVEREIRO',
  'MARÇO',
  'ABRIL',
  'MAIO',
  'JUNHO',
  'JULHO',
  'AGOSTO',
  'SETEMBRO',
  'OUTUBRO',
  'NOVEMBRO',
  'DEZEMBRO',
] as const;

/**
 * O chip "AGOSTO · TREINOS" do §3.4c.
 *
 * "TREINOS" e fixo: a metrica do placar publico e sempre sessao confirmada
 * (ADR-047, Decisao 3 -- catalogo de XP v1, `treino-diario`), entao nao ha
 * hoje um segundo tipo de metrica para escolher. `agora` opcional e nao
 * injetado por prop: e texto de vitrine (mes corrente), nao decisao de
 * dominio -- mesmo criterio que `use-sessao.ts` ja usa para o relogio local
 * do totem.
 */
export function rotuloDoPeriodo(agora: Date = new Date()): string {
  const mes = MESES_DO_PERIODO[agora.getMonth()];

  return `${mes ?? ''} · TREINOS`;
}

/**
 * A assinatura ArenaHub quando NAO ha faixa -- DS-TOTEM.md §11.10.
 *
 * O §11.10 nao e opcional: a assinatura aparece na tela publica sempre. Com a
 * faixa ligada ela vive DENTRO dela, dividindo a linha com o rotulo, como no
 * protótipo. Desligada a faixa, a linha inteira some -- e a assinatura junto,
 * se nao houvesse este caminho.
 *
 * Mesma condicao de `FaixaDePatrocinio`, invertida: as duas nunca aparecem
 * juntas, e nunca somem juntas.
 */
export function AssinaturaSolta({
  patrocinio,
}: {
  readonly patrocinio: KioskConfig['patrocinio'];
}) {
  if (patrocinio.habilitado && patrocinio.marcas.length > 0) return null;

  return (
    <p className="assinaturaSolta" data-testid="assinatura-arenahub">
      tecnologia <strong>arenahub</strong>
    </p>
  );
}

/**
 * Faixa de patrocinadores -- ADR-042, Decisao 4.
 *
 * FIXA, FORA DA GRADE, e com rotulo que nao pode ser esvaziado (CDC art.
 * 36 -- publicidade identificada como tal, ao lado de conteudo informativo
 * da propria academia).
 *
 * NAO HA CLIQUE, NAO HA QR, NAO HA CONTADOR: as marcas sao `<span>`, nunca
 * `<a>`. No momento em que o ArenaHub conta exibicao, ele produz o numero em
 * que um contrato de patrocinio se apoia -- e passa a responder por ele.
 */
export function FaixaDePatrocinio({
  patrocinio,
}: {
  readonly patrocinio: KioskConfig['patrocinio'];
}) {
  if (!patrocinio.habilitado || patrocinio.marcas.length === 0) return null;

  return (
    <section className="faixaDePatrocinio" data-testid="faixa-de-patrocinio">
      {/*
        DUAS LINHAS, como o protótipo: rotulo e assinatura dividem a de cima,
        as pastilhas ficam com a de baixo inteira. Numa linha so -- como era
        ate 28/08/2026 -- o rotulo comia largura das marcas, e com cinco
        patrocinadores (o maximo) cada pastilha ficava estreita demais para o
        nome caber.
      */}
      <div className="cabecalhoDoPatrocinio">
        <span className="rotuloDoPatrocinio">{rotuloDePatrocinio(patrocinio.rotulo)}</span>
        <span className="assinaturaDoPatrocinio">
          tecnologia <strong>arenahub</strong>
        </span>
      </div>

      <div className="marcas">
        {patrocinio.marcas.map((marca) => (
          <span key={marca.nome} className="marca">
            {/*
              A URL ASSINADA, nunca a chave: `logotipoKey` e identificador de
              objeto no storage e nao carrega em `<img src>`. Quem a resolve e
              a API no boot (`kiosk-media-link.service.ts`), do mesmo modo que
              ja resolvia `midiaKey` -> `midiaUrl` do bloco de video.

              Chave que nao pertence ao tenant, ou storage fora do ar, chegam
              aqui como `null` e a faixa cai no NOME -- que e o mesmo destino
              da marca que nunca teve logotipo. Uma imagem quebrada na parede
              e pior do que o nome escrito.

              `<img>` e nao `next/image`: a URL e assinada e expira em uma
              hora, entao o otimizador de build nao tem o que pre-processar.
            */}
            {marca.logotipoUrlAssinada != null ? (
              <img
                src={marca.logotipoUrlAssinada}
                alt={marca.nome}
                className="logotipoDoPatrocinador"
              />
            ) : (
              marca.nome
            )}
          </span>
        ))}
      </div>
    </section>
  );
}

/**
 * `2026-08-30` vira `30 AGO`.
 *
 * Sem `Intl` e sem `Date`: a string ja e a data local que o gerente digitou,
 * e `new Date('2026-08-30')` a interpretaria como UTC -- num fuso negativo,
 * o dia 30 vira 29 na tela. Fatiar a string nao tem esse problema.
 */
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

export function formatarData(iso: string): string {
  const [, mes, dia] = iso.split('-');

  if (mes === undefined || dia === undefined) return iso;

  const nome = MESES[Number(mes) - 1];

  return nome === undefined ? iso : `${dia} ${nome}`;
}
