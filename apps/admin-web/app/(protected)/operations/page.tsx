import type { Metadata } from 'next';

import {
  AcoesDaLinha,
  Ausente,
  AusenteDeAcao,
  Button,
  DataTable,
  EmptyState,
  EstadoSimples,
  Icon,
  Idade,
  PageHeader,
  ProblemDetail,
  SummaryStrip,
  TenantDateTime,
  type CelulaDeResumo,
  type IconName,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { SeletorDeUnidade } from '../seletor-de-unidade';
import { AtualizarAoVivo } from './atualizar-ao-vivo';
import estilos from './operations.module.css';
import { PareaEdge } from './parear-edge';
import { ReconhecerAlerta } from './reconhecer-alerta';
import {
  ROTULO_DE_ESTADO_DE_ALERTA,
  ROTULO_DE_SEVERIDADE,
  idadeLegivel,
  traduzir,
} from '../../../src/operations/formatar';
import {
  formatarPercentual,
  resumirOperacao,
  situacaoDoDispositivo,
  situacaoDoEdge,
  type NivelDaOperacao,
  type SituacaoDeRecurso,
} from '../../../src/operations/situacao';

export const metadata: Metadata = {
  title: 'Operação — ArenaHub',
};

/**
 * Sem cache: um painel operacional que mostra estado de dois minutos atrás é
 * pior que não ter painel — a recepção age com base em informação vencida.
 */
export const dynamic = 'force-dynamic';

interface Alerta {
  id: string;
  code: string;
  severity: string;
  state: string;
  resource: string;
  resourceId: string;
  gymUnitId: string | null;
  impact: string;
  recommendedAction: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface Unidade {
  id: string;
  name: string;
  timezone: string;
  status: string;
}

interface Panorama {
  edges: {
    id: string;
    codigo: string;
    gymUnitId: string;
    status: string;
    agentVersion: string | null;
    ultimoHeartbeat: string | null;
    derivaMs: number | null;
  }[];
  dispositivos: {
    id: string;
    serial: string;
    modelo: string;
    kind: string;
    status: string;
    gymUnitId: string;
    ultimoHeartbeat: string | null;
    ultimoSync: string | null;
  }[];
  sync: {
    pendentes: number;
    processando: number;
    falhados: number;
    deadLetters: number;
    totalDoDia: number;
    sucessosDoDia: number;
    /** Início do "dia" das contagens: a última virada das 23h na unidade (issue #549). */
    desde: string;
  };
  acesso: { allow: number; deny: number; override: number };
}

/**
 * Painel operacional — `M1-AC-011`, INV-146.
 *
 * A HIERARQUIA DA TELA É A REGRA, não decoração. De cima para baixo:
 * alertas críticos, depois Edge e dispositivos, depois sync, depois acesso.
 * Quem abre esta tela quer saber, nesta ordem: "a catraca está funcionando?",
 * "vai parar?", "alguém não vai conseguir entrar?".
 *
 * TODO ESTADO TEM TEXTO. Cor é complemento, nunca a informação: cerca de 8%
 * dos homens têm alguma daltonia, e um painel que comunica "crítico" só por
 * vermelho não comunica para eles. Cada linha diz o estado por extenso, com
 * idade e ação.
 */
export default async function PaginaDeOperacao({
  searchParams,
}: {
  searchParams: Promise<{ unidade?: string }>;
}) {
  /*
   * A UNIDADE VEM DA URL (`?unidade=`), a mesma do seletor da topbar (issue
   * #549). Quem decide o escopo é a API: unidade de fora dá 404, como no
   * dashboard. Sem unidade, o painel mostra TODAS as visíveis -- num painel de
   * alarme, "ninguém escolheu" não pode esconder o crítico de nenhuma.
   */
  const { unidade: unidadePedida } = await searchParams;
  const daUnidade = unidadePedida ? `gymUnitId=${encodeURIComponent(unidadePedida)}` : '';

  const [panorama, alertas, unidades] = await Promise.all([
    chamarApi<Panorama>(`/api/v1/operations/overview${daUnidade ? `?${daUnidade}` : ''}`),
    chamarApi<Alerta[]>(
      `/api/v1/operations/alerts?open=true&limit=50${daUnidade ? `&${daUnidade}` : ''}`,
    ),
    /*
     * O overview devolve `gymUnitId`, não o fuso da unidade -- e a validade
     * do código de pareamento tem de sair no fuso DELA, nunca no do
     * navegador (DS §11, regra 5). Em paralelo com as outras duas: a tela
     * não espera uma para pedir a próxima.
     */
    chamarApi<Unidade[]>('/api/v1/units'),
  ]);

  /*
   * Uma unidade ativa: ela é o contexto e o seletor vira rótulo. Várias: select
   * com "Todas as unidades" como opção real (decisão do PI, issue #549).
   */
  const unidadesAtivas = (unidades.dados ?? []).filter((u) => u.status === 'ACTIVE');
  const unidadeEscolhida =
    unidadesAtivas.find((u) => u.id === unidadePedida) ??
    (unidadesAtivas.length === 1 ? unidadesAtivas[0] : undefined);
  // Mesmo critério da API para o corte do dia: a escolhida, ou a primeira visível.
  const fusoDoPainel = (unidadeEscolhida ?? unidadesAtivas[0])?.timezone;

  const seletorDeUnidade = (
    <SeletorDeUnidade
      unidades={unidadesAtivas}
      vazio="Nenhuma unidade ativa"
      todas="Todas as unidades"
      testId="unidade-da-operacao"
      superficie="pagina"
    />
  );

  if (!panorama.ok) {
    return (
      <section aria-labelledby="titulo-operacao">
        <PageHeader id="titulo-operacao" title="Operação" actions={seletorDeUnidade} />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(panorama.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title:
              panorama.erro?.code === 'UNIT_NOT_FOUND'
                ? 'Unidade não encontrada. Escolha outra no seletor de unidade.'
                : `Sem permissão para ver o painel operacional (${panorama.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const dados = panorama.dados!;
  const listaDeAlertas = alertas.dados ?? [];

  /*
   * Fuso POR UNIDADE. Sem fallback global: o Edge sempre tem unidade, e um
   * fuso chutado na validade de um código de pareamento faria o operador
   * achar que tem mais (ou menos) tempo do que tem.
   */
  const fusoPorUnidade = new Map(
    (unidades.dados ?? []).map((unidade) => [unidade.id, unidade.timezone]),
  );

  const criticos = listaDeAlertas.filter((a) => a.severity === 'CRITICAL');
  const demais = listaDeAlertas.filter((a) => a.severity !== 'CRITICAL');

  const agora = new Date();

  const situacaoDosEdges = new Map(
    dados.edges.map((e) => [e.id, situacaoDoEdge(e, agora)] as const),
  );
  const situacaoDosDispositivos = new Map(
    dados.dispositivos.map((d) => [d.id, situacaoDoDispositivo(d, agora)] as const),
  );

  const edgesForaDoAr = [...situacaoDosEdges.values()].filter((s) => s.foraDoAr).length;
  const dispositivosForaDoAr = [...situacaoDosDispositivos.values()].filter(
    (s) => s.foraDoAr,
  ).length;

  const taxaDeSync =
    dados.sync.totalDoDia > 0
      ? Math.round((dados.sync.sucessosDoDia / dados.sync.totalDoDia) * 1000) / 10
      : null;

  const maisAntigoDosCriticos = criticos
    .map((a) => a.firstSeenAt)
    .sort()
    .at(0);

  const resumo = resumirOperacao({
    criticos: criticos.length,
    criticosReconhecidos: criticos.filter((a) => a.state === 'ACKNOWLEDGED').length,
    demais: demais.length,
    criticoMaisAntigoHa:
      maisAntigoDosCriticos === undefined ? null : idadeLegivel(maisAntigoDosCriticos, agora),
    edgesForaDoAr,
    dispositivosForaDoAr,
    totalDeEdges: dados.edges.length,
    alertasIndisponiveis: !alertas.ok,
  });

  // Sem unidade legível o carimbo cala: chutar um fuso seria pior que omitir.
  const fusoDoCarimbo = fusoDoPainel;

  return (
    <section aria-labelledby="titulo-operacao">
      <PageHeader
        id="titulo-operacao"
        title="Operação"
        actions={
          <>
            {seletorDeUnidade}
            <AtualizarAoVivo>
              {fusoDoCarimbo === undefined ? undefined : (
                <>
                  Atualizado às{' '}
                  <TenantDateTime
                    iso={agora.toISOString()}
                    timeZone={fusoDoCarimbo}
                    format="time"
                  />
                </>
              )}
            </AtualizarAoVivo>
            {/*
              `POST /edge-nodes/:id/pairing-codes` existia desde a F59 e exigia
              um Edge já cadastrado -- mas não havia como cadastrá-lo, nem por
              API nem por tela. A instalação real na Arena Positiva travou aqui
              (issue #404).
            */}
            <Button href="/operations/edge-nodes/novo" data-testid="novo-edge-node">
              Novo Edge
            </Button>
          </>
        }
      />

      {/*
        Resumo em uma frase, antes de qualquer tabela. Quem passa pela tela
        entre dois atendimentos lê isto e nada mais -- por isso a faixa carrega
        três canais (cor, ícone e texto) e nunca afirma "tudo bem" sem ter lido
        tudo (ver `resumirOperacao`).
      */}
      <div
        className={estilos['faixa']}
        data-nivel={resumo.nivel}
        data-testid="resumo-da-operacao"
        role="status"
      >
        <span className={estilos['selo']} aria-hidden="true">
          <Icon name={ICONE_DO_NIVEL[resumo.nivel]} />
        </span>
        <p className={estilos['titulo']}>{resumo.titulo}</p>
        {resumo.apoio !== '' ? <p className={estilos['apoio']}>{resumo.apoio}</p> : null}
        {/*
          Contagem redundante com as tabelas, de propósito: é o que o E2E e o
          operador com pressa usam para conferir sem ler linha por linha.
        */}
        <p className={estilos['contagem']} data-testid="contagem-fora-do-ar">
          {edgesForaDoAr} Edge(s) e {dispositivosForaDoAr} dispositivo(s) sem resposta.
        </p>
      </div>

      <div className={estilos['secaoAbertura']}>
        <h2>Alertas</h2>
        {alertas.ok ? (
          <EstadoSimples
            label={
              listaDeAlertas.length === 0
                ? 'Nenhum aberto'
                : `${listaDeAlertas.length} ${listaDeAlertas.length === 1 ? 'aberto' : 'abertos'}`
            }
            tom={listaDeAlertas.length === 0 ? 'positivo' : criticos.length > 0 ? 'negativo' : 'atencao'}
          />
        ) : null}
      </div>

      {!alertas.ok ? (
        /*
         * Sem este ramo, uma falha na leitura caía no `empty` abaixo e a tela
         * dizia "Nenhum alerta aberto. Edge e dispositivos respondendo" --
         * tranquilidade que ninguém verificou.
         */
        <ProblemDetail
          testId="erro-de-alertas"
          problem={{
            ...(alertas.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar os alertas (${alertas.erro?.code ?? 'erro'}).`,
          }}
        />
      ) : (
        <DataTable
          testId="tabela-de-alertas"
          rows={[...criticos, ...demais]}
          rowKey={(alerta) => alerta.id}
          rowTestId={(alerta) => `alerta-${alerta.code}`}
          rowTom={(alerta) =>
            alerta.severity === 'CRITICAL'
              ? 'negativo'
              : alerta.severity === 'WARNING'
                ? 'atencao'
                : undefined
          }
          caption="Alertas abertos, os críticos primeiro"
          columns={[
            {
              key: 'severidade',
              header: 'Severidade',
              role: 'state',
              /*
               * Texto, não só cor. Um painel que diz "crítico" apenas por
               * vermelho não diz nada para quem não distingue vermelho.
               *
               * `ROTULO_DE_SEVERIDADE` e `ROTULO_DE_ESTADO_DE_ALERTA` FICAM: o §7
               * define 11 máquinas e nenhuma cobre alerta operacional. O plano
               * já registrou `ROTULO_DE_ESTADO_DE_ALERTA` como "máquina de estado
               * de fato, só não está no §7" -- dar-lhe casa é decisão do Cowork.
               */
              render: (a) => (
                <EstadoSimples
                  label={traduzir(ROTULO_DE_SEVERIDADE, a.severity)}
                  tom={TOM_DA_SEVERIDADE[a.severity] ?? 'neutro'}
                />
              ),
            },
            {
              key: 'situacao',
              header: 'Situação',
              role: 'state',
              /*
               * Aberto pede atenção; reconhecido diz que ALGUÉM já viu (e não
               * que resolveu -- a condição continua sendo avaliada).
               */
              render: (a) => (
                <EstadoSimples
                  label={traduzir(ROTULO_DE_ESTADO_DE_ALERTA, a.state)}
                  {...(a.state === 'ACKNOWLEDGED'
                    ? { tom: 'neutro' as const, icone: 'user-check' as const }
                    : a.state === 'RESOLVED'
                      ? { tom: 'positivo' as const }
                      : { tom: 'atencao' as const })}
                />
              ),
            },
            {
              key: 'impede',
              header: 'O que isso impede',
              role: 'support',
              render: (a) => a.impact,
            },
            {
              key: 'fazer',
              header: 'O que fazer',
              role: 'support',
              /*
               * DUAS COLUNAS DE APOIO LADO A LADO -- e o único lugar do painel
               * onde isso acontece, e é deliberado: "o que impede" e "o que
               * fazer" respondem perguntas diferentes que a operação lê juntas.
               * Quem está decidindo se acorda alguém às 6h precisa do impacto e
               * da ação na mesma varredura.
               *
               * O papel `support` dá a cada uma piso e teto, então elas dividem
               * o espaço em vez de uma engolir a outra -- que era o que
               * acontecia antes, sem largura declarada.
               */
              render: (a) => a.recommendedAction,
            },
            {
              key: 'desde',
              header: 'Desde',
              role: 'moment',
              /*
               * `idadeLegivel` FICA, e não vira `TenantDateTime`: ele devolve
               * idade relativa ("há 3 h"), não instante -- e é o que a operação
               * precisa ler de relance num alerta aberto.
               */
              render: (a) => (
                <Idade iso={a.firstSeenAt} texto={idadeLegivel(a.firstSeenAt, agora)} />
              ),
            },
            {
              key: 'acao',
              header: 'Ação',
              role: 'actions',
              /*
               * `AusenteDeAcao` no lugar de `<span>—</span>`: o travessão cru era
               * lido como pontuação solta pelo leitor de tela, sem dizer se a
               * coluna estava vazia por falta de dado ou por não haver ação. São
               * coisas diferentes, e agora o `aria-label` diz qual.
               */
              render: (a) =>
                a.state === 'OPEN' ? (
                  <AcoesDaLinha>
                    <ReconhecerAlerta alertaId={a.id} />
                  </AcoesDaLinha>
                ) : (
                  <AusenteDeAcao />
                ),
            },
          ]}
          empty={
            <EmptyState
              testId="sem-alertas"
              title="Nenhum alerta aberto."
              hint="Edge e dispositivos respondendo, sincronização em dia."
            />
          }
        />
      )}

      <div className={estilos['secao']}>
        <h2>Edge</h2>
        <ChipDeEquipamento total={dados.edges.length} foraDoAr={edgesForaDoAr} />
      </div>

      <DataTable
        testId="tabela-de-edges"
        rows={dados.edges}
        rowKey={(edge) => edge.id}
        rowTestId={(edge) => `edge-${edge.codigo}`}
        rowTom={(edge) =>
          situacaoDosEdges.get(edge.id)?.tom === 'negativo' ? 'negativo' : undefined
        }
        caption="Agentes instalados nas unidades"
        columns={[
          { key: 'codigo', header: 'Código', role: 'code', render: (e) => e.codigo },
          {
            key: 'estado',
            header: 'Estado',
            role: 'state',
            /*
             * "Respondendo"/"Sem resposta" é DERIVADO do heartbeat, não um
             * estado que o servidor emite -- não há máquina no §7 para isso.
             * Por isso `EstadoSimples` (sem moldura), não `StateBadge`.
             */
            render: (e) => {
              const situacao = situacaoDosEdges.get(e.id)!;

              return (
                <EstadoSimples
                  label={situacao.label}
                  tom={situacao.tom}
                  {...iconeDaSituacao(situacao)}
                  testId={`estado-do-edge-${e.codigo}`}
                />
              );
            },
          },
          {
            key: 'sinal',
            header: 'Último sinal',
            role: 'moment',
            render: (e) => <SinalDeVida iso={e.ultimoHeartbeat} agora={agora} />,
          },
          {
            key: 'versao',
            header: 'Versão',
            role: 'label',
            render: (e) => e.agentVersion ?? <Ausente />,
          },
          {
            key: 'relogio',
            header: 'Relógio',
            role: 'value',
            render: (e) =>
              e.derivaMs === null ? (
                <Ausente />
              ) : (
                `${e.derivaMs > 0 ? '+' : ''}${Math.round(e.derivaMs / 1000)}s`
              ),
          },
          {
            key: 'acao',
            header: 'Ação',
            role: 'actions',
            /*
             * PAREAMENTO NÃO É EVENTO ÚNICO: o código tem TTL curto, morre no
             * primeiro uso, e o ADR-011 prevê revogação pelo painel. Sem esta
             * ação, um Edge revogado ou com código expirado só voltaria a
             * funcionar cadastrando OUTRO -- duplicando o registro e perdendo
             * o histórico de heartbeat (issue #404).
             *
             * Sem fuso da unidade não há ação: exibir validade no fuso errado
             * é pior que não oferecer o botão, porque o operador agiria sobre
             * um prazo que não é o dele.
             */
            render: (e) => {
              const fuso = fusoPorUnidade.get(e.gymUnitId);

              return fuso === undefined ? (
                <AusenteDeAcao />
              ) : (
                <AcoesDaLinha>
                  <PareaEdge edgeNodeId={e.id} timeZone={fuso} />
                </AcoesDaLinha>
              );
            },
          },
        ]}
        empty={
          <EmptyState
            testId="sem-edge"
            title="Nenhum Edge cadastrado."
            hint='Sem Edge, a catraca não decide nada. Use "Novo Edge" para cadastrar o agente da recepção e gerar o código de pareamento.'
          />
        }
      />

      <div className={estilos['secao']}>
        <h2>Dispositivos</h2>
        <ChipDeEquipamento total={dados.dispositivos.length} foraDoAr={dispositivosForaDoAr} />
        <a href="/operations/devices">Gerenciar e ver a fila de sincronização</a>
      </div>

      <DataTable
        testId="tabela-de-dispositivos"
        rows={dados.dispositivos}
        rowKey={(dispositivo) => dispositivo.id}
        rowTestId={(dispositivo) => `dispositivo-${dispositivo.serial}`}
        rowTom={(dispositivo) =>
          situacaoDosDispositivos.get(dispositivo.id)?.tom === 'negativo' ? 'negativo' : undefined
        }
        caption="Leitores e catracas"
        columns={[
          { key: 'serie', header: 'Série', role: 'code', render: (d) => d.serial },
          {
            key: 'tipo',
            header: 'Tipo',
            role: 'label',
            render: (d) => (d.kind === 'TURNSTILE' ? 'Catraca' : 'Leitor facial'),
          },
          {
            key: 'estado',
            header: 'Estado',
            role: 'state',
            render: (d) => {
              const situacao = situacaoDosDispositivos.get(d.id)!;

              return (
                <EstadoSimples
                  label={situacao.label}
                  tom={situacao.tom}
                  {...iconeDaSituacao(situacao)}
                  testId={`estado-do-dispositivo-${d.serial}`}
                />
              );
            },
          },
          {
            key: 'sinal',
            header: 'Último sinal',
            role: 'moment',
            render: (d) => <SinalDeVida iso={d.ultimoHeartbeat} agora={agora} />,
          },
          {
            key: 'sincronizacao',
            header: 'Última sincronização',
            role: 'moment',
            render: (d) => <SinalDeVida iso={d.ultimoSync} agora={agora} />,
          },
        ]}
        empty={<EmptyState testId="sem-dispositivo" title="Nenhum leitor ou catraca cadastrado." />}
      />

      <div className={estilos['secao']}>
        <h2>Sincronização de biometria</h2>
      </div>

      <SummaryStrip
        label="Resumo da sincronização de biometria"
        testId="resumo-de-sync"
        celulas={celulasDeSync(dados.sync, taxaDeSync, fusoDoPainel)}
      />

      <div className={estilos['secao']}>
        <h2>Acesso nas últimas 24 horas</h2>
        <a href="/access-events">Ver eventos de acesso</a>
      </div>

      <SummaryStrip
        label="Resumo dos acessos nas últimas 24 horas"
        testId="resumo-de-acesso"
        celulas={celulasDeAcesso(dados.acesso)}
      />
    </section>
  );
}

const ICONE_DO_NIVEL: Readonly<Record<NivelDaOperacao, IconName>> = {
  critico: 'alert-triangle',
  atencao: 'alert-circle',
  ok: 'check-circle',
  indisponivel: 'wifi-off',
};

/** Fora do ar e respondendo ganham o glifo de rede; o resto fica com o padrão do tom. */
function iconeDaSituacao(situacao: SituacaoDeRecurso): { icone?: IconName } {
  if (situacao.foraDoAr) return { icone: 'wifi-off' };

  return situacao.tom === 'positivo' ? { icone: 'wifi' } : {};
}

/** "Há quanto tempo falou", com o instante exato no `title` quando existe. */
function SinalDeVida({ iso, agora }: { iso: string | null; agora: Date }) {
  return iso === null ? (
    <span>{idadeLegivel(null, agora)}</span>
  ) : (
    <Idade iso={iso} texto={idadeLegivel(iso, agora)} />
  );
}

/** O estado da seção ao lado do título: quem varre a página já lê "1 sem resposta". */
function ChipDeEquipamento({ total, foraDoAr }: { total: number; foraDoAr: number }) {
  if (total === 0) return null;

  return foraDoAr > 0 ? (
    <EstadoSimples label={`${foraDoAr} sem resposta`} tom="negativo" icone="wifi-off" />
  ) : (
    <EstadoSimples label="Todos respondendo" tom="positivo" icone="wifi" />
  );
}

/**
 * Só "Falhadas" descreve ESTADO e só ela ganha tom: pendente e em
 * processamento são fluxo normal, e um número verde por ser número gastaria a
 * cor que a falha precisa (PRODUCT.md, emenda de 30/09/2026).
 */
function celulasDeSync(
  sync: Panorama['sync'],
  taxa: number | null,
  fuso: string | undefined,
): readonly CelulaDeResumo[] {
  return [
    { id: 'pendentes', label: 'Pendentes', icon: 'hourglass', value: sync.pendentes },
    { id: 'processando', label: 'Em processamento', icon: 'refresh-cw', value: sync.processando },
    {
      id: 'falhadas',
      label: 'Falhadas',
      icon: 'x-circle',
      value: sync.falhados,
      tom: sync.falhados > 0 ? 'risco' : 'positivo',
      hint:
        sync.falhados > 0 ? (
          <a href="/operations/devices">Precisam de ação — ver a fila</a>
        ) : (
          'Nenhuma falha'
        ),
    },
    {
      id: 'taxa',
      label: 'Taxa do dia',
      icon: 'trending-up',
      // Sem volume, "0%" assustaria sem informar -- e afirmaria uma falha que não houve.
      value: taxa === null ? <Ausente /> : formatarPercentual(taxa),
      /*
       * "desde 23:00" vem da API (`sync.desde`), não de uma constante aqui: o
       * dia vira às 23h da unidade (issue #549), e a tela mostra o corte que a
       * contagem usou em vez de repetir a regra.
       */
      hint: (
        <>
          {taxa === null
            ? 'sem sincronizações'
            : `${sync.sucessosDoDia} de ${sync.totalDoDia}`}{' '}
          {fuso === undefined ? (
            'hoje'
          ) : (
            <>
              desde <TenantDateTime iso={sync.desde} timeZone={fuso} format="time" />
            </>
          )}
        </>
      ),
    },
  ];
}

/**
 * Liberação manual é a ação sensível do painel (DS §2.3: `risk`) -- quando
 * houve, merece o olho. Liberados e negados são fluxo, não estado.
 */
function celulasDeAcesso(acesso: Panorama['acesso']): readonly CelulaDeResumo[] {
  return [
    { id: 'liberados', label: 'Liberados', icon: 'user-check', value: acesso.allow },
    { id: 'negados', label: 'Negados', icon: 'ban', value: acesso.deny },
    {
      id: 'manuais',
      label: 'Liberações manuais',
      icon: 'key-round',
      value: acesso.override,
      ...(acesso.override > 0
        ? { tom: 'atencao' as const, hint: 'Feitas pelo operador, sem leitura do aluno' }
        : {}),
    },
  ];
}

/**
 * O tom visual de cada severidade.
 *
 * `CRITICAL` significa **a catraca não está funcionando agora** — nada mais
 * ganha `negativo`. Uma severidade que se aplica a tudo não prioriza nada, e o
 * painel vira um mar vermelho que a operação aprende a ignorar.
 */
const TOM_DA_SEVERIDADE: Readonly<Record<string, 'neutro' | 'atencao' | 'negativo'>> = {
  CRITICAL: 'negativo',
  WARNING: 'atencao',
  INFO: 'neutro',
};
