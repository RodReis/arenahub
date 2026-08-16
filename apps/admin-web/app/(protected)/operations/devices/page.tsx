import type { Metadata } from 'next';

import { chamarApi } from '../../../../lib/api/server-client';

export const metadata: Metadata = {
  title: 'Sincronização de dispositivos — ArenaHub',
};

interface JobDeSync {
  id: string;
  deviceId: string;
  identityId: string;
  operation: string;
  state: string;
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  errorCode: string | null;
  recommendedAction: string | null;
}

interface Dispositivo {
  id: string;
  model: string;
  serial: string;
  status: string;
  lastHeartbeat: string | null;
  lastSyncAt: string | null;
}

/** Rótulo em pt-BR. Estado técnico não vai cru para a recepção. */
const ROTULO_DE_ESTADO: Record<string, string> = {
  PENDING: 'Aguardando',
  PROCESSING: 'Em andamento',
  SYNCED: 'Sincronizado',
  RETRYING: 'Tentando de novo',
  FAILED: 'Falhou',
  REMOVED: 'Removido',
};

const ROTULO_DE_OPERACAO: Record<string, string> = {
  UPSERT: 'Cadastro',
  DELETE: 'Exclusão',
};

function formatarInstante(iso: string | null): string {
  if (!iso) return '—';

  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Painel de pendência de sincronização.
 *
 * Server Component: a lista chega pronta, sem token no navegador.
 *
 * Job em dead letter aparece aqui como qualquer outro — sumir é o que faz a
 * operação descobrir o problema pelo aluno reclamando na catraca.
 */
export default async function PaginaDeSincronizacao() {
  const [jobs, dispositivos] = await Promise.all([
    chamarApi<JobDeSync[]>('/api/v1/device-sync-jobs?limit=100'),
    chamarApi<Dispositivo[]>('/api/v1/devices'),
  ]);

  if (!jobs.ok) {
    return (
      <section aria-labelledby="titulo-sync">
        <h1 id="titulo-sync">Sincronização de dispositivos</h1>
        <p role="alert" data-testid="erro-de-permissao">
          Sem permissão para ver a sincronização ({jobs.erro?.code}).
        </p>
      </section>
    );
  }

  const lista = jobs.dados ?? [];
  const equipamentos = dispositivos.dados ?? [];

  const comFalha = lista.filter((job) => job.state === 'FAILED');

  return (
    <section aria-labelledby="titulo-sync">
      <h1 id="titulo-sync">Sincronização de dispositivos</h1>

      {/*
        Região viva: quem usa leitor de tela é avisado da pendência sem
        precisar varrer a tabela inteira (`M1-NFR-008`, WCAG 2.2 AA).
      */}
      <p aria-live="polite" data-testid="resumo-de-pendencia">
        {comFalha.length === 0
          ? 'Nenhuma sincronização com falha.'
          : `${comFalha.length} sincronização(ões) precisam de atenção.`}
      </p>

      <h2>Equipamentos</h2>

      {equipamentos.length === 0 ? (
        <p data-testid="sem-dispositivo">Nenhum dispositivo cadastrado.</p>
      ) : (
        <table data-testid="tabela-de-dispositivos">
          <caption>Leitores e catracas desta academia</caption>
          <thead>
            <tr>
              <th scope="col">Modelo</th>
              <th scope="col">Série</th>
              <th scope="col">Situação</th>
              <th scope="col">Último contato</th>
              <th scope="col">Última sincronização</th>
            </tr>
          </thead>
          <tbody>
            {equipamentos.map((dispositivo) => (
              <tr key={dispositivo.id}>
                <td>{dispositivo.model}</td>
                <td>{dispositivo.serial}</td>
                <td>
                  {dispositivo.status === 'ACTIVE' ? 'Ativo' : 'Fora de operação'}
                </td>
                <td>{formatarInstante(dispositivo.lastHeartbeat)}</td>
                <td>{formatarInstante(dispositivo.lastSyncAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Fila de sincronização</h2>

      {lista.length === 0 ? (
        <p data-testid="fila-vazia">Nada pendente.</p>
      ) : (
        <table data-testid="tabela-de-sync">
          <caption>Cadastros e exclusões por dispositivo</caption>
          <thead>
            <tr>
              <th scope="col">Operação</th>
              <th scope="col">Situação</th>
              <th scope="col">Tentativas</th>
              <th scope="col">Última tentativa</th>
              <th scope="col">Próxima tentativa</th>
              <th scope="col">O que fazer</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((job) => (
              <tr key={job.id} data-testid={`job-${job.id}`}>
                <td>{ROTULO_DE_OPERACAO[job.operation] ?? job.operation}</td>
                <td>
                  {/*
                    Texto, não só cor: cor sozinha não informa quem não a
                    distingue. O ícone acompanha, não substitui.
                  */}
                  <span aria-hidden="true">{job.state === 'FAILED' ? '⚠ ' : ''}</span>
                  {ROTULO_DE_ESTADO[job.state] ?? job.state}
                </td>
                <td>{job.attempts}</td>
                <td>{formatarInstante(job.lastAttemptAt)}</td>
                <td>{formatarInstante(job.nextAttemptAt)}</td>
                {/*
                  A ação recomendada vem da API, não da tela: o mesmo texto
                  serve para o painel e para qualquer outro consumidor.
                */}
                <td>{job.recommendedAction ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
