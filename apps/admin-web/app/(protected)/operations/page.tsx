import type { Metadata } from 'next';

import { Ausente, DataTable, EmptyState, PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { ReconhecerAlerta } from './reconhecer-alerta';
import {
  ROTULO_DE_ESTADO_DE_ALERTA,
  ROTULO_DE_SEVERIDADE,
  estaSilencioso,
  idadeLegivel,
  traduzir,
} from '../../../src/operations/formatar';

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
export default async function PaginaDeOperacao() {
  const [panorama, alertas] = await Promise.all([
    chamarApi<Panorama>('/api/v1/operations/overview'),
    chamarApi<Alerta[]>('/api/v1/operations/alerts?open=true&limit=50'),
  ]);

  if (!panorama.ok) {
    return (
      <section aria-labelledby="titulo-operacao">
        <PageHeader id="titulo-operacao" title="Operação" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(panorama.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para ver o painel operacional (${panorama.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const dados = panorama.dados!;
  const listaDeAlertas = alertas.dados ?? [];

  const criticos = listaDeAlertas.filter((a) => a.severity === 'CRITICAL');
  const demais = listaDeAlertas.filter((a) => a.severity !== 'CRITICAL');

  const agora = new Date();

  const edgesForaDoAr = dados.edges.filter((e) => estaSilencioso(e.ultimoHeartbeat, agora));
  const dispositivosForaDoAr = dados.dispositivos.filter(
    (d) => d.status === 'ACTIVE' && estaSilencioso(d.ultimoHeartbeat, agora),
  );

  const taxaDeSync =
    dados.sync.totalDoDia > 0
      ? Math.round((dados.sync.sucessosDoDia / dados.sync.totalDoDia) * 1000) / 10
      : null;

  return (
    <section aria-labelledby="titulo-operacao">
      <PageHeader id="titulo-operacao" title="Operação" />

      {/*
        Resumo em uma frase, antes de qualquer tabela. Quem passa pela tela
        entre dois atendimentos lê isto e nada mais.
      */}
      <p data-testid="resumo-da-operacao" role="status">
        {criticos.length === 0 ? (
          <strong>Nenhum problema crítico agora.</strong>
        ) : (
          <strong>
            {criticos.length} {criticos.length === 1 ? 'problema crítico' : 'problemas críticos'}{' '}
            impedindo acesso agora.
          </strong>
        )}
      </p>

      <h2>Alertas</h2>

      <DataTable
        testId="tabela-de-alertas"
        rows={[...criticos, ...demais]}
        rowKey={(alerta) => alerta.id}
        rowTestId={(alerta) => `alerta-${alerta.code}`}
        caption="Alertas abertos, os críticos primeiro"
        columns={[
          {
            key: 'severidade',
            header: 'Severidade',
            /*
             * Texto, não só cor. Um painel que diz "crítico" apenas por
             * vermelho não diz nada para quem não distingue vermelho.
             *
             * `ROTULO_DE_SEVERIDADE` e `ROTULO_DE_ESTADO_DE_ALERTA` FICAM: o §7
             * define 11 maquinas e nenhuma cobre alerta operacional. O plano
             * ja registrou `ROTULO_DE_ESTADO_DE_ALERTA` como "maquina de estado
             * de fato, so nao esta no §7" -- dar-lhe casa e decisao do Cowork.
             */
            render: (a) => traduzir(ROTULO_DE_SEVERIDADE, a.severity),
          },
          {
            key: 'situacao',
            header: 'Situação',
            render: (a) => traduzir(ROTULO_DE_ESTADO_DE_ALERTA, a.state),
          },
          { key: 'impede', header: 'O que isso impede', render: (a) => a.impact },
          { key: 'fazer', header: 'O que fazer', render: (a) => a.recommendedAction },
          {
            key: 'desde',
            header: 'Desde',
            /*
             * `idadeLegivel` FICA, e nao vira `TenantDateTime`: ele devolve
             * idade relativa ("ha 3 h"), nao instante -- e e o que a operacao
             * precisa ler de relance num alerta aberto.
             */
            render: (a) => (
              <time dateTime={a.firstSeenAt}>{idadeLegivel(a.firstSeenAt, agora)}</time>
            ),
          },
          {
            key: 'acao',
            header: 'Ação',
            render: (a) =>
              a.state === 'OPEN' ? <ReconhecerAlerta alertaId={a.id} /> : <span>—</span>,
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

      <h2>Edge</h2>

      <DataTable
        testId="tabela-de-edges"
        rows={dados.edges}
        rowKey={(edge) => edge.id}
        rowTestId={(edge) => `edge-${edge.codigo}`}
        caption="Agentes instalados nas unidades"
        columns={[
          { key: 'codigo', header: 'Código', numeric: true, render: (e) => e.codigo },
          {
            key: 'estado',
            header: 'Estado',
            /*
             * "Respondendo"/"Sem resposta" e DERIVADO do heartbeat, nao um
             * estado que o servidor emite -- nao ha maquina no §7 para isso.
             */
            render: (e) =>
              estaSilencioso(e.ultimoHeartbeat, agora) ? 'Sem resposta' : 'Respondendo',
          },
          {
            key: 'sinal',
            header: 'Último sinal',
            render: (e) => (
              <time dateTime={e.ultimoHeartbeat ?? undefined}>
                {idadeLegivel(e.ultimoHeartbeat, agora)}
              </time>
            ),
          },
          { key: 'versao', header: 'Versão', render: (e) => e.agentVersion ?? <Ausente /> },
          {
            key: 'relogio',
            header: 'Relógio',
            numeric: true,
            render: (e) =>
              e.derivaMs === null ? (
                <Ausente />
              ) : (
                `${e.derivaMs > 0 ? '+' : ''}${Math.round(e.derivaMs / 1000)}s`
              ),
          },
        ]}
        empty={
          <EmptyState
            testId="sem-edge"
            title="Nenhum Edge cadastrado."
            hint="Sem Edge, a catraca não decide nada."
          />
        }
      />

      <h2>Dispositivos</h2>

      <DataTable
        testId="tabela-de-dispositivos"
        rows={dados.dispositivos}
        rowKey={(dispositivo) => dispositivo.id}
        rowTestId={(dispositivo) => `dispositivo-${dispositivo.serial}`}
        caption="Leitores e catracas"
        columns={[
          { key: 'serie', header: 'Série', numeric: true, render: (d) => d.serial },
          {
            key: 'tipo',
            header: 'Tipo',
            render: (d) => (d.kind === 'TURNSTILE' ? 'Catraca' : 'Leitor facial'),
          },
          {
            key: 'estado',
            header: 'Estado',
            render: (d) =>
              d.status !== 'ACTIVE'
                ? // Equipamento em manutenção não é falha: alguém já sabe.
                  'Em manutenção'
                : estaSilencioso(d.ultimoHeartbeat, agora)
                  ? 'Sem resposta'
                  : 'Respondendo',
          },
          {
            key: 'sinal',
            header: 'Último sinal',
            render: (d) => (
              <time dateTime={d.ultimoHeartbeat ?? undefined}>
                {idadeLegivel(d.ultimoHeartbeat, agora)}
              </time>
            ),
          },
          {
            key: 'sincronizacao',
            header: 'Última sincronização',
            render: (d) => idadeLegivel(d.ultimoSync, agora),
          },
        ]}
        empty={<EmptyState testId="sem-dispositivo" title="Nenhum leitor ou catraca cadastrado." />}
      />

      <h2>Sincronização de biometria</h2>

      <dl data-testid="resumo-de-sync">
        <dt>Pendentes</dt>
        <dd>{dados.sync.pendentes}</dd>

        <dt>Em processamento</dt>
        <dd>{dados.sync.processando}</dd>

        <dt>Falhadas</dt>
        <dd>{dados.sync.falhados}</dd>

        <dt>Taxa do dia</dt>
        <dd>
          {taxaDeSync === null
            ? // Sem volume, "0%" assustaria sem informar.
              'sem sincronizações hoje'
            : `${taxaDeSync}% (${dados.sync.sucessosDoDia} de ${dados.sync.totalDoDia})`}
        </dd>
      </dl>

      <h2>Acesso nas últimas 24 horas</h2>

      <dl data-testid="resumo-de-acesso">
        <dt>Liberados</dt>
        <dd>{dados.acesso.allow}</dd>

        <dt>Negados</dt>
        <dd>{dados.acesso.deny}</dd>

        <dt>Liberações manuais</dt>
        <dd>{dados.acesso.override}</dd>
      </dl>

      <p>
        <a href="/access-events">Ver eventos de acesso</a>
      </p>

      {/*
        Contagem redundante com as tabelas, de propósito: é o que o E2E e o
        operador com pressa usam para conferir sem ler linha por linha.
      */}
      <p data-testid="contagem-fora-do-ar">
        {edgesForaDoAr.length} Edge(s) e {dispositivosForaDoAr.length} dispositivo(s) sem
        resposta.
      </p>
    </section>
  );
}
