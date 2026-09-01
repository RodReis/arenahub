import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import {
  DataFreshness,
  EmptyState,
  Icon,
  type IconName,
  PageHeader,
  ProblemDetail,
  TenantDateTime,
} from '@arenahub/ui';

import { lerFeedDeAcessos } from '../../actions/dashboard';
import { chamarApi } from '../../../lib/api/server-client';
import estilos from './dashboard.module.css';
import { doisNomes } from './dois-nomes';
import { FeedAoVivo } from './feed-ao-vivo';
import { NumeroQueConta } from './numero-que-conta';

export const metadata: Metadata = {
  title: 'Dashboard operacional — ArenaHub',
};

/**
 * Sem cache: um painel operacional que mostra estado de dois minutos atrás é
 * pior que não ter painel — a recepção age com base em informação vencida.
 */
export const dynamic = 'force-dynamic';

interface Unidade {
  id: string;
  name: string;
  timezone: string;
}

interface Dashboard {
  unidade: Unidade | null;
  unidades: Unidade[];
  geradoEm: string;
  dispositivos: { online: number; total: number; degradados: number };
  acessosDeHoje: { desde: string; allow: number; deny: number; override: number } | null;
  situacoes: {
    status: string;
    motivo: string | null;
    quantidade: number;
    alunos: string[];
  }[];
  placar: {
    mes: string;
    publicadoEm: string | null;
    entradas: { position: number; points: number; nome: string }[];
  } | null;
  desafiosAtivos: { id: string; title: string; endsOn: string; participantes: number }[];
  feriados: { data: string; nome: string; origem: string }[];
}

/** Os quatro motivos da lista fechada da issue #241. */
const ROTULO_DE_MOTIVO: Record<string, string> = {
  DELINQUENCY: 'Inadimplência',
  STUDENT_REQUEST: 'Pedido do aluno',
  MEDICAL: 'Atestado médico',
  CONDUCT: 'Conduta',
};

const ROTULO_DE_SITUACAO: Record<string, string> = {
  SUSPENDED: 'Suspenso',
  BLOCKED: 'Bloqueado',
};

const MES_ABREVIADO = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/**
 * Vazio com ÍCONE e próximo passo — `DS-PAINEL.md` §9.
 *
 * A primeira versão desta tela tinha cinco frases soltas que constatavam
 * ausência ("Nenhum placar publicado neste mês") sem dizer se aquilo era bom,
 * ruim ou esperado. `tom="success"` marca o vazio que é BOA notícia: ninguém
 * bloqueado é a academia funcionando, e pintá-lo do mesmo cinza de "nenhum
 * desafio criado" manda procurar problema onde não há.
 */
function Vazio({
  icone,
  children,
  saida,
  tom,
}: {
  icone: IconName;
  children: ReactNode;
  saida?: ReactNode;
  tom?: 'success';
}) {
  return (
    <div className={estilos['vazio']}>
      <span className={estilos['iconeDoVazio']} {...(tom ? { 'data-tom': tom } : {})}>
        <Icon name={icone} />
      </span>
      <span className={estilos['textoDoVazio']}>
        {children}
        {saida ? <span className={estilos['saidaDoVazio']}>{saida}</span> : null}
      </span>
    </div>
  );
}

function traduzir(mapa: Record<string, string>, chave: string | null): string {
  /*
   * `null` acontece de verdade e não é erro: quem foi bloqueado ANTES de o
   * campo existir (issue #241) não tem razão gravada, e os alunos importados
   * do Pacto são todos assim. Esconder a linha faria a soma das partes não
   * bater com o total que a grid de alunos mostra.
   *
   * O texto diz o próximo passo em vez de só constatar a ausência: o motivo é
   * preenchível na ficha, e quem lê o painel é quem pode preencher.
   */
  if (chave === null) return 'Motivo não informado';

  return mapa[chave] ?? chave;
}

/**
 * Dia e mês de uma data PURA (`AAAA-MM-DD`), sem passar por `Date`.
 *
 * Converter para `Date` reinterpretaria a string como meia-noite UTC e puxaria
 * o dia para trás a oeste de Greenwich — 25/12 vira 24/12. Feriado é um dia do
 * calendário, não um instante, e fatiar a string é o que preserva isso.
 */
function partesDaData(data: string): { dia: string; mes: string } {
  const [, mes = '01', dia = '01'] = data.split('-');

  return { dia, mes: MES_ABREVIADO[Number(mes) - 1] ?? mes };
}

/**
 * Dashboard operacional — F57, `SPEC-057`.
 *
 * A porta de entrada do painel. Responde "a academia está de pé?" sem exigir
 * um clique. Quem vai INVESTIGAR continua indo para `Operação`, que segue no
 * menu com os alertas detalhados, a fila de sync e o detalhe de dispositivo.
 *
 * Nenhum bloco desta tela escreve. A tela que fica aberta o turno inteiro na
 * recepção é o pior lugar possível para um botão que muda estado.
 */
export default async function PaginaDoDashboard({
  searchParams,
}: {
  searchParams: Promise<{ unidade?: string }>;
}) {
  const { unidade: unidadePedida } = await searchParams;

  const consulta = unidadePedida ? `?gymUnitId=${encodeURIComponent(unidadePedida)}` : '';
  const resposta = await chamarApi<Dashboard>(`/api/v1/dashboard${consulta}`);

  if (!resposta.ok || !resposta.dados) {
    return (
      <>
        <PageHeader breadcrumb="Operação" title="Dashboard operacional" />
        <ProblemDetail
          testId="erro-do-dashboard"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar o painel (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </>
    );
  }

  const dados = resposta.dados;
  const unidade = dados.unidade;

  /*
   * O feed nasce PREENCHIDO, do servidor: a alternativa é a tela abrir vazia e
   * só ganhar conteúdo no primeiro ciclo de 5 s — cinco segundos de "nenhum
   * acesso hoje" numa academia que teve trezentos.
   */
  const feedInicial = unidade ? (await lerFeedDeAcessos(unidade.id)).eventos : [];

  // Sem unidade não há fuso; o carimbo do topo cai para UTC apenas para não
  // ficar sem hora nenhuma — e nesse estado a tela também não mostra número.
  const fuso = unidade?.timezone ?? 'UTC';

  const totalDeRestricoes = dados.situacoes.reduce((soma, s) => soma + s.quantidade, 0);
  // Passagens do dia -- zero significa "ninguém passou", não "não sei".
  const movimentoDoDia =
    (dados.acessosDeHoje?.allow ?? 0) + (dados.acessosDeHoje?.deny ?? 0);
  const tudoOnline =
    dados.dispositivos.total > 0 && dados.dispositivos.online === dados.dispositivos.total;

  return (
    <>
      <PageHeader
        breadcrumb="Operação"
        title="Dashboard operacional"
        actions={<DataFreshness state="current" at={dados.geradoEm} timeZone={fuso} />}
      />

      {unidade === null ? (
        <EmptyState
          testId="dashboard-sem-unidade"
          title="Escolha uma unidade"
          hint={
            dados.unidades.length === 0
              ? 'Nenhuma unidade ativa cadastrada. Cadastre uma em Unidades para o painel ter o que mostrar.'
              : 'Use o seletor no topo. O painel mostra o movimento de uma unidade por vez — somar duas daria um número que não corresponde a academia nenhuma.'
          }
        />
      ) : null}

      <div className={estilos['faixaDeKpi']}>
        {/*
          TRÊS CANAIS em cada KPI, sempre: cor de estado, ícone e texto. Quem
          não distingue verde de vermelho, quem opera com brilho baixo e quem
          usa leitor de tela chegam à mesma leitura.
        */}
        <div
          className={estilos['kpi']}
          data-tom={
            dados.dispositivos.total === 0
              ? undefined
              : tudoOnline
                ? 'success'
                : 'warning'
          }
        >
          <p className={estilos['kpiRotulo']}>
            <Icon name={tudoOnline ? 'wifi' : 'wifi-off'} />
            Dispositivos
          </p>
          <p className={estilos['kpiValor']} data-testid="kpi-dispositivos">
            <NumeroQueConta valor={dados.dispositivos.online}>
              <span className={estilos['kpiUnidade']}>/{dados.dispositivos.total} online</span>
            </NumeroQueConta>
          </p>
          {dados.dispositivos.degradados > 0 ? (
            <p className={estilos['kpiApoio']}>
              <Icon name="alert-triangle" />
              {dados.dispositivos.degradados} em manutenção
            </p>
          ) : null}
        </div>

        {/*
          CATEGORIA e não estado: a cor diz o que a célula MEDE. Antes, numa
          academia parada, três dos quatro KPIs ficavam brancos -- a faixa
          perdia identidade justamente no estado mais comum, o de tudo em
          ordem. O tom de alerta continua mais forte e salta por cima.
        */}
        <div className={estilos['kpi']} data-categoria="acesso">
          <p className={estilos['kpiRotulo']}>
            <Icon name="user-check" />
            Acessos hoje
          </p>
          {/*
            Dado ausente é `—`, nunca `0` (Princípio 4): zero é uma afirmação
            sobre o mundo, ausência é a confissão de que não sabemos.
          */}
          {/*
            `—` quando a rota não informa (Princípio 4: ausência não é zero) --
            e nesse caso não há o que contar.
          */}
          <p className={estilos['kpiValor']} data-testid="kpi-acessos">
            {dados.acessosDeHoje ? (
              <NumeroQueConta valor={dados.acessosDeHoje.allow} />
            ) : (
              '—'
            )}
          </p>
          {/*
            O "desde" fica DECLARADO: sem ele o número não diz de que janela
            fala, e a recepção compara com a própria contagem sem saber se o
            corte é o mesmo. Aqui é meia-noite da unidade.
          */}
          {dados.acessosDeHoje ? (
            <p className={estilos['kpiApoio']}>
              <Icon name="clock" />
              desde{' '}
              <TenantDateTime iso={dados.acessosDeHoje.desde} timeZone={fuso} format="time" />
            </p>
          ) : null}
          {/*
            A PROPORÇÃO do dia, liberados contra recusados. Dois números lado
            a lado exigem conta de cabeça para saber se 9 recusas é muito; a
            barra responde antes da conta. Os números continuam escritos nos
            KPIs, e o `title` diz a proporção por extenso — cor não é canal
            único.
          */}
          {dados.acessosDeHoje ? (
            <div
              className={estilos['proporcao']}
              data-vazio={movimentoDoDia === 0}
              role="img"
              aria-label={
                movimentoDoDia === 0
                  ? 'Nenhuma passagem hoje'
                  : `${dados.acessosDeHoje.allow} liberadas e ${dados.acessosDeHoje.deny} recusadas hoje`
              }
            >
              <span
                className={estilos['proporcaoLiberado']}
                style={{ flexGrow: dados.acessosDeHoje.allow }}
              />
              <span
                className={estilos['proporcaoNegado']}
                style={{ flexGrow: dados.acessosDeHoje.deny }}
              />
            </div>
          ) : null}
        </div>

        <div
          className={estilos['kpi']}
          data-categoria="recusa"
          data-tom={(dados.acessosDeHoje?.deny ?? 0) > 0 ? 'danger' : undefined}
        >
          <p className={estilos['kpiRotulo']}>
            <Icon name="ban" />
            Recusas hoje
          </p>
          <p className={estilos['kpiValor']} data-testid="kpi-recusas">
            {dados.acessosDeHoje ? <NumeroQueConta valor={dados.acessosDeHoje.deny} /> : '—'}
          </p>
          {(dados.acessosDeHoje?.override ?? 0) > 0 ? (
            <p className={estilos['kpiApoio']}>
              <Icon name="key-round" />
              {dados.acessosDeHoje?.override} liberação manual
            </p>
          ) : null}
        </div>

        {/*
          SEM TOM, de propósito. "2 suspensos" não é bom nem ruim — é o número
          normal de uma academia com trezentos alunos, e pintar a célula de
          azul faria a faixa ter três cores competindo sem que a terceira
          signifique nada. Cor aqui é ESTADO, não decoração (Princípio 5).
        */}
        <div className={estilos['kpi']} data-categoria="restricao">
          <p className={estilos['kpiRotulo']}>
            <Icon name="user-x" />
            Restrições
          </p>
          <p className={estilos['kpiValor']} data-testid="kpi-restricoes">
            {unidade === null ? '—' : <NumeroQueConta valor={totalDeRestricoes} />}
          </p>
          <p className={estilos['kpiApoio']}>suspensos e bloqueados</p>
        </div>
      </div>

      <div className={estilos['corpo']}>
        <div className={estilos['coluna']}>
          {unidade ? (
            <FeedAoVivo gymUnitId={unidade.id} timeZone={unidade.timezone} inicial={feedInicial} />
          ) : null}

          <section className={estilos['cartao']} aria-labelledby="titulo-das-situacoes">
            <header className={estilos['cabecalhoDoCartao']}>
              <h2 className={estilos['tituloDoCartao']} id="titulo-das-situacoes">
                <Icon name="user-x" />
                Bloqueados e suspensos
              </h2>
            </header>
            <div className={estilos['conteudoDoCartao']}>
              {dados.situacoes.length === 0 ? (
                <Vazio icone="check-circle" tom="success">
                  Ninguém bloqueado ou suspenso — todo mundo com acesso liberado.
                </Vazio>
              ) : (
                <ul className={estilos['lista']} data-testid="lista-de-situacoes">
                  {dados.situacoes.map((situacao) => (
                    <li
                      className={estilos['linhaDeSituacao']}
                      key={`${situacao.status}-${situacao.motivo}`}
                    >
                      <span className={estilos['linha']}>
                        <span className={estilos['linhaTexto']}>
                          <Icon name={situacao.status === 'BLOCKED' ? 'ban' : 'user-minus'} />
                          {traduzir(ROTULO_DE_SITUACAO, situacao.status)} ·{' '}
                          {traduzir(ROTULO_DE_MOTIVO, situacao.motivo)}
                        </span>
                        <span className={estilos['linhaValor']}>{situacao.quantidade}</span>
                      </span>
                      {/*
                        QUEM são, não só quantos. "2 bloqueados" não ajuda quem
                        está no balcão com o aluno na frente — a pergunta é
                        "quem?". Cinco nomes cabem; acima disso a contagem ao
                        lado volta a ser a informação útil.
                      */}
                      {situacao.alunos.length > 0 ? (
                        <span className={estilos['nomesDaSituacao']}>
                          {situacao.alunos.map(doisNomes).join(' · ')}
                          {situacao.quantidade > situacao.alunos.length
                            ? ` e mais ${situacao.quantidade - situacao.alunos.length}`
                            : ''}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {/*
                A dica só aparece quando há motivo ausente — texto permanente
                que explica um caso que não está acontecendo é ruído no balcão.
              */}
              {dados.situacoes.some((s) => s.motivo === null) ? (
                <p className={estilos['apoio']}>
                  <Icon name="alert-circle" />
                  Sem motivo são de antes do campo existir. Informe na ficha do aluno.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <div className={estilos['coluna']}>
          <section className={estilos['cartao']} aria-labelledby="titulo-do-placar">
            <header className={estilos['cabecalhoDoCartao']}>
              <h2 className={estilos['tituloDoCartao']} id="titulo-do-placar">
                <Icon name="dumbbell" />
                Placar do mês
              </h2>
            </header>
            <div className={estilos['conteudoDoCartao']}>
              {dados.placar === null || dados.placar.entradas.length === 0 ? (
                <Vazio
                  icone="hourglass"
                  saida={<>O placar do mês fecha automaticamente, ou pode ser publicado em Engajamento.</>}
                >
                  Nenhum placar publicado neste mês.
                </Vazio>
              ) : (
                <>
                  <ul className={estilos['lista']} data-testid="placar-do-mes">
                    {dados.placar.entradas.slice(0, 5).map((entrada) => (
                      <li className={estilos['linha']} key={entrada.position}>
                        <span className={estilos['linhaTexto']}>
                          <span
                            className={estilos['posicao']}
                            data-podio={entrada.position <= 3}
                          >
                            {entrada.position}
                          </span>
                          {entrada.nome}
                        </span>
                        <span className={estilos['linhaValor']}>{entrada.points}</span>
                      </li>
                    ))}
                  </ul>
                  {/*
                    O placar é SNAPSHOT: entre uma publicação e outra o número
                    não anda. Sem a data, um placar parado é indistinguível de
                    um job que morreu.
                  */}
                  <p className={estilos['apoio']}>
                    <Icon name="clock" />
                    Publicado em <TenantDateTime iso={dados.placar.publicadoEm} timeZone={fuso} />
                  </p>
                </>
              )}
            </div>
          </section>

          <section className={estilos['cartao']} aria-labelledby="titulo-dos-desafios">
            <header className={estilos['cabecalhoDoCartao']}>
              <h2 className={estilos['tituloDoCartao']} id="titulo-dos-desafios">
                <Icon name="check-circle" />
                Desafios ativos
              </h2>
            </header>
            <div className={estilos['conteudoDoCartao']}>
              {dados.desafiosAtivos.length === 0 ? (
                <Vazio icone="dumbbell" saida={<>Crie e ative um em Engajamento → Desafios.</>}>
                  Nenhum desafio em andamento.
                </Vazio>
              ) : (
                <ul className={estilos['lista']} data-testid="desafios-ativos">
                  {dados.desafiosAtivos.map((desafio) => (
                    <li className={estilos['linha']} key={desafio.id}>
                      <span className={estilos['linhaTexto']}>{desafio.title}</span>
                      <span className={estilos['linhaValor']}>{desafio.participantes}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className={estilos['cartao']} aria-labelledby="titulo-dos-feriados">
            <header className={estilos['cabecalhoDoCartao']}>
              <h2 className={estilos['tituloDoCartao']} id="titulo-dos-feriados">
                <Icon name="calendar-x" />
                Feriados do mês
              </h2>
            </header>
            <div className={estilos['conteudoDoCartao']}>
              {dados.feriados.length === 0 ? (
                <Vazio icone="check-circle" tom="success">
                  Nenhum feriado neste mês — mês cheio de expediente.
                </Vazio>
              ) : (
                <ul className={estilos['lista']} data-testid="feriados-do-mes">
                  {dados.feriados.map((feriado) => {
                    const { dia, mes } = partesDaData(feriado.data);

                    return (
                      <li className={estilos['feriado']} key={feriado.data}>
                        <span className={estilos['diaDoFeriado']}>
                          <span className={estilos['diaDoFeriadoNumero']}>{dia}</span>
                          <span className={estilos['diaDoFeriadoMes']}>{mes}</span>
                        </span>
                        <span className={estilos['linhaTexto']}>{feriado.nome}</span>
                        {/*
                          MUNICIPAL se distingue do nacional: quem cadastrou
                          precisa saber qual dá para editar. Texto, não só cor.
                        */}
                        {feriado.origem === 'MUNICIPAL' ? (
                          <span className={estilos['origem']}>Municipal</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
