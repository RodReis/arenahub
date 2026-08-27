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
 * Rodizio da tela publica -- F51, `M3.5-FR-004` e `M3.5-FR-005`.
 *
 * ---------------------------------------------------------------------------
 * NENHUM DADO DE ALUNO CHEGA AQUI, E A TRAVA E ESTRUTURAL.
 * ---------------------------------------------------------------------------
 *
 * `M3.5-BR-001`: as props sao `config` e `indicadores` -- nao ha por onde um
 * nome, um valor de pendencia ou um id entrar, mesmo que alguem quisesse.
 * `SessaoDoAluno` nao e importado neste arquivo. Os indicadores sao dois
 * INTEIROS agregados da unidade.
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
 * F31 (Task 10) ACRESCENTA O BLOCO RANKING -- AS DUAS GARANTIAS CONTINUAM DE PE.
 * ---------------------------------------------------------------------------
 *
 * O placar chega DENTRO de `indicadores` (`indicadores.placar`), a mesma
 * prop que ja existia -- nao um terceiro parametro, nao um `fetch` novo.
 * `resolverExposicao()` roda no SERVIDOR antes de o heartbeat sair da API:
 * o array so tem `position`/`nomeExibido`/`points`, nunca `studentId`
 * (`EntradaPublicaDoPlacar` em `@arenahub/api-contracts`). Placar vazio (o
 * modulo `xp` desligado, ou nenhum snapshot publicado) tira o bloco do
 * rodizio -- ele nunca aparece cinza ou vazio.
 */
/**
 * O bloco de placar publico -- F31, Task 10.
 *
 * NAO E um dos `TIPOS_DE_BLOCO` de `config.blocos.itens`: o placar nao e
 * midia que o gerente cadastra, e o conteudo dele (`indicadores.placar`) so
 * existe em runtime, vindo do heartbeat. Por isso e um tipo LOCAL, que so
 * entra na rotacao quando ha o que mostrar -- nunca um item configuravel
 * que o painel liga/desliga.
 */
type BlocoDeRanking = { readonly tipo: 'RANKING' };
type BlocoEmRotacao = BlocoDaTelaPublica | BlocoDeRanking;

export function BlocosPublicos({
  config,
  indicadores,
}: {
  readonly config: KioskConfig;
  readonly indicadores: IndicadoresDaUnidade | null;
}) {
  const placar = indicadores?.placar ?? [];

  /*
   * Placar vazio (retido, ou modulo `xp` desligado -- API sempre manda `[]`
   * nesses casos, nunca omite o campo) TIRA o bloco do rodizio -- nao entra
   * cinza, nao entra vazio (mesma regra do §4 para os blocos configuraveis).
   */
  const visiveis: readonly BlocoEmRotacao[] =
    placar.length > 0 ? [...blocosVisiveis(config), { tipo: 'RANKING' } as const] : blocosVisiveis(config);
  const [indice, setIndice] = useState(0);

  const total = visiveis.length;
  const segundos = config.blocos.tempoPorBlocoSegundos;

  /**
   * O relogio do rodizio.
   *
   * Recriado quando o TOTAL muda, e nao quando o indice muda: um efeito que
   * dependesse do indice reiniciaria a contagem a cada troca -- o que
   * funciona por acaso, mas faz o primeiro bloco depois de uma mudanca de
   * config durar o tempo errado.
   *
   * Bloco unico nao gira: um `setInterval` que troca 0 por 0 e trabalho a
   * cada 12 segundos para redesenhar o mesmo cartao.
   */
  useEffect(() => {
    if (total <= 1) return;

    const relogio = setInterval(() => {
      setIndice((atual) => proximoIndice(atual, total));
    }, segundos * 1000);

    return () => {
      clearInterval(relogio);
    };
  }, [total, segundos]);

  /**
   * Config nova pode chegar SEM reinicio (o reinicio so acontece fora de
   * sessao -- ADR-042, Decisao 3). Sem isto, o indice 4 de uma lista que
   * passou a ter 2 blocos apontaria para o vazio ate a proxima volta.
   */
  useEffect(() => {
    setIndice((atual) => indiceSeguro(atual, total));
  }, [total]);

  const atual = visiveis[indiceSeguro(indice, total)];

  return (
    <>
      {/*
        O §4 exige que a tela nao quebre sem os blocos opcionais: sem nenhum
        visivel, este espaco simplesmente nao existe e hero e CTA se
        distribuem com o que sobra.
      */}
      {atual !== undefined && (
        <section
          className="blocoPublico"
          data-testid="bloco-em-exibicao"
          data-tipo={atual.tipo}
          // O rodizio troca sozinho: `aria-live="off"` impede o leitor de
          // tela de anunciar cada volta por cima do que a pessoa faz.
          aria-live="off"
        >
          <ConteudoDoBloco bloco={atual} indicadores={indicadores} />

          {total > 1 && (
            <div className="progressoDoRodizio" aria-hidden="true">
              {visiveis.map((bloco, posicao) => (
                <span
                  // O bloco de RANKING nao tem `id` (nao vem de
                  // `config.blocos.itens`) -- o tipo so se repete uma vez na
                  // lista, entao ele mesmo serve de chave.
                  key={bloco.tipo === 'RANKING' ? 'RANKING' : bloco.id}
                  className="pontoDoRodizio"
                  data-ativo={posicao === indiceSeguro(indice, total)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <FaixaDePatrocinio patrocinio={config.patrocinio} />
    </>
  );
}

function ConteudoDoBloco({
  bloco,
  indicadores,
}: {
  readonly bloco: BlocoEmRotacao;
  readonly indicadores: IndicadoresDaUnidade | null;
}) {
  switch (bloco.tipo) {
    case 'RANKING':
      // Placar vazio ja tira o bloco da rotacao (ver `visiveis` acima) --
      // aqui `indicadores` nunca e nulo com pelo menos uma entrada.
      return <BlocoDePlacar placar={indicadores?.placar ?? []} />;

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

/**
 * Bloco de placar na tela publica -- F31, Task 10.
 *
 * `placar` chega PRONTO do servidor (`resolverExposicao()` ja filtrou
 * opt-out e inatividade antes de o heartbeat sair da API): so
 * `position`/`nomeExibido`/`points`, nunca `studentId` -- a trava do
 * `M3.5-BR-001` continua de pe porque o TIPO em si (`EntradaPublicaDoPlacar`)
 * nao tem por onde um id entrar.
 */
function BlocoDePlacar({ placar }: { readonly placar: readonly EntradaPublicaDoPlacar[] }) {
  return (
    <>
      <h2 className="tituloDoBloco">Ranking do mês</h2>
      <ul className="listaDeEventos" data-testid="lista-de-placar">
        {placar.map((entrada) => (
          <li key={entrada.position} className="evento">
            <span className="dataDoEvento">{entrada.position}º</span>
            <span className="tituloDoEvento">{entrada.nomeExibido}</span>
            <span className="metadado">{entrada.points} pts</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Faixa de patrocinadores -- ADR-042, Decisao 4.
 *
 * FIXA, FORA DO RODIZIO, e com rotulo que nao pode ser esvaziado (CDC art.
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
