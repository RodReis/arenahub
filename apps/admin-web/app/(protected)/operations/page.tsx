import type { Metadata } from 'next';

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
        <h1 id="titulo-operacao">Operação</h1>
        <p role="alert" data-testid="erro-de-permissao">
          Sem permissão para ver o painel operacional ({panorama.erro?.code ?? 'erro'}).
        </p>
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
      <h1 id="titulo-operacao">Operação</h1>

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

      {listaDeAlertas.length === 0 ? (
        <p data-testid="sem-alertas">
          Nenhum alerta aberto. Edge e dispositivos respondendo, sincronização em dia.
        </p>
      ) : (
        <table data-testid="tabela-de-alertas">
          <caption>Alertas abertos, os críticos primeiro</caption>
          <thead>
            <tr>
              <th scope="col">Severidade</th>
              <th scope="col">Situação</th>
              <th scope="col">O que isso impede</th>
              <th scope="col">O que fazer</th>
              <th scope="col">Desde</th>
              <th scope="col">Ação</th>
            </tr>
          </thead>
          <tbody>
            {[...criticos, ...demais].map((alerta) => (
              <tr key={alerta.id} data-testid={`alerta-${alerta.code}`}>
                <td>
                  {/*
                    Texto, não só cor. Um painel que diz "crítico" apenas por
                    vermelho não diz nada para quem não distingue vermelho.
                  */}
                  {traduzir(ROTULO_DE_SEVERIDADE, alerta.severity)}
                </td>
                <td>{traduzir(ROTULO_DE_ESTADO_DE_ALERTA, alerta.state)}</td>
                <td>{alerta.impact}</td>
                <td>{alerta.recommendedAction}</td>
                <td>
                  <time dateTime={alerta.firstSeenAt}>{idadeLegivel(alerta.firstSeenAt, agora)}</time>
                </td>
                <td>
                  {alerta.state === 'OPEN' ? (
                    <ReconhecerAlerta alertaId={alerta.id} />
                  ) : (
                    <span>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Edge</h2>

      {dados.edges.length === 0 ? (
        <p data-testid="sem-edge">
          Nenhum Edge cadastrado. Sem Edge, a catraca não decide nada.
        </p>
      ) : (
        <table data-testid="tabela-de-edges">
          <caption>Agentes instalados nas unidades</caption>
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Estado</th>
              <th scope="col">Último sinal</th>
              <th scope="col">Versão</th>
              <th scope="col">Relógio</th>
            </tr>
          </thead>
          <tbody>
            {dados.edges.map((edge) => (
              <tr key={edge.id} data-testid={`edge-${edge.codigo}`}>
                <td>{edge.codigo}</td>
                <td>
                  {estaSilencioso(edge.ultimoHeartbeat, agora)
                    ? 'Sem resposta'
                    : 'Respondendo'}
                </td>
                <td>
                  <time dateTime={edge.ultimoHeartbeat ?? undefined}>
                    {idadeLegivel(edge.ultimoHeartbeat, agora)}
                  </time>
                </td>
                <td>{edge.agentVersion ?? '—'}</td>
                <td>
                  {edge.derivaMs === null
                    ? '—'
                    : `${edge.derivaMs > 0 ? '+' : ''}${Math.round(edge.derivaMs / 1000)}s`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Dispositivos</h2>

      {dados.dispositivos.length === 0 ? (
        <p data-testid="sem-dispositivo">Nenhum leitor ou catraca cadastrado.</p>
      ) : (
        <table data-testid="tabela-de-dispositivos">
          <caption>Leitores e catracas</caption>
          <thead>
            <tr>
              <th scope="col">Série</th>
              <th scope="col">Tipo</th>
              <th scope="col">Estado</th>
              <th scope="col">Último sinal</th>
              <th scope="col">Última sincronização</th>
            </tr>
          </thead>
          <tbody>
            {dados.dispositivos.map((dispositivo) => (
              <tr key={dispositivo.id} data-testid={`dispositivo-${dispositivo.serial}`}>
                <td>{dispositivo.serial}</td>
                <td>{dispositivo.kind === 'TURNSTILE' ? 'Catraca' : 'Leitor facial'}</td>
                <td>
                  {dispositivo.status !== 'ACTIVE'
                    ? // Equipamento em manutenção não é falha: alguém já sabe.
                      'Em manutenção'
                    : estaSilencioso(dispositivo.ultimoHeartbeat, agora)
                      ? 'Sem resposta'
                      : 'Respondendo'}
                </td>
                <td>
                  <time dateTime={dispositivo.ultimoHeartbeat ?? undefined}>
                    {idadeLegivel(dispositivo.ultimoHeartbeat, agora)}
                  </time>
                </td>
                <td>{idadeLegivel(dispositivo.ultimoSync, agora)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
