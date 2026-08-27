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
  return blocosVisiveis(config).length > 0 || (indicadores?.placar.length ?? 0) > 0;
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
  const visiveis = blocosVisiveis(config);
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

      <FaixaDePatrocinio patrocinio={config.patrocinio} />
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
      <ConteudoDoBloco bloco={atual} indicadores={indicadores} />

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

function ConteudoDoBloco({
  bloco,
  indicadores,
}: {
  readonly bloco: BlocoDaTelaPublica;
  readonly indicadores: IndicadoresDaUnidade | null;
}) {
  switch (bloco.tipo) {
    case 'VIDEO':
      return (
        <>
          {/*
            SEM SOM E COM LEGENDA -- DS-TOTEM.md §4: a recepcao nao tem audio
            confiavel. `muted` e `playsInline` tambem sao o que faz o
            navegador aceitar `autoPlay` sem gesto do usuario; sem eles o
            video ficaria parado no primeiro quadro.
          */}
          <video
            className="videoDoBloco"
            src={bloco.midiaUrl ?? undefined}
            autoPlay
            muted
            loop
            playsInline
            data-testid="video-do-bloco"
          />
          <h2 className="tituloDoBloco">{bloco.titulo}</h2>
          <p className="corpo">{bloco.legenda}</p>
        </>
      );

    case 'EVENTOS':
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
      return (
        <>
          <h2 className="tituloDoBloco">{bloco.perfil}</h2>
          <p className="corpo">{bloco.chamada}</p>
        </>
      );

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

      <ul className="listaDoPlacar" data-testid="lista-de-placar">
        {linhas.map((entrada) => (
          <li key={entrada.position} className="linhaDoPlacar">
            <span className="medalhao" data-posicao={faixaDoMedalhao(entrada.position)}>
              {entrada.position}º
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
function FaixaDePatrocinio({
  patrocinio,
}: {
  readonly patrocinio: KioskConfig['patrocinio'];
}) {
  if (!patrocinio.habilitado || patrocinio.marcas.length === 0) return null;

  return (
    <section className="faixaDePatrocinio" data-testid="faixa-de-patrocinio">
      <span className="rotuloDoPatrocinio">{rotuloDePatrocinio(patrocinio.rotulo)}</span>

      <div className="marcas">
        {patrocinio.marcas.map((marca) => (
          <span key={marca.nome} className="marca">
            {marca.logotipoUrl !== null ? (
              /*
               * `<img>` e nao `next/image`: o logotipo vem de URL que o
               * gerente configura, e `next/image` exige dominio declarado em
               * BUILD -- o dominio muda por academia, entao a otimizacao
               * quebraria o totem do proximo cliente.
               */
              <img src={marca.logotipoUrl} alt={marca.nome} className="logotipoDoPatrocinador" />
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
