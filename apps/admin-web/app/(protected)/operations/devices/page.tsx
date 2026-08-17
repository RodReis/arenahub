import type { Metadata } from 'next';

import {
  Ausente,
  DataTable,
  EmptyState,
  PageHeader,
  ProblemDetail,
  StateBadge,
  TenantDateTime,
} from '@arenahub/ui';

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

/*
 * `ROTULO_DE_ESTADO` e `formatarInstante` MORRERAM aqui -- eram a duplicata
 * que esta fatia existe para matar. O estado agora vem de `stateLabel` via
 * `StateBadge`, e o instante de `TenantDateTime`.
 *
 * Divergencia que a consolidacao resolveu: este arquivo dizia
 * `RETRYING: 'Tentando de novo'` e o contrato §7 diz "Tentando novamente" --
 * mesmo estado, dois nomes, duas telas. Venceu o contrato.
 */

/**
 * `ROTULO_DE_OPERACAO` FICA: `UPSERT`/`DELETE` nao e maquina de estado, e o §7
 * define 11 e nenhuma delas cobre operacao de fila. Achado registrado no plano
 * ("oito dicionarios pt-BR sem casa no §7") -- dar destino a ele e decisao de
 * produto, portanto Cowork + PI, nao esta fatia.
 */
const ROTULO_DE_OPERACAO: Record<string, string> = {
  UPSERT: 'Cadastro',
  DELETE: 'Exclusão',
};

/**
 * Fuso FIXO, preservado da implementacao anterior.
 *
 * `TenantDateTime` exige `timeZone` sem default justamente para tornar esta
 * suposicao visivel -- e ela e uma divida real: a rota de dispositivos devolve
 * `gymUnitId`, nao o fuso da unidade, entao resolver de verdade exigiria
 * cruzar com `/units`. Isso e chamada nova, ou seja, mudanca de comportamento,
 * e esta fatia muda aparencia. Fica como esta ate a fatia que corrigir a rota.
 */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

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
        <PageHeader id="titulo-sync" title="Sincronização de dispositivos" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(jobs.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para ver a sincronização (${jobs.erro?.code}).`,
          }}
        />
      </section>
    );
  }

  const lista = jobs.dados ?? [];
  const equipamentos = dispositivos.dados ?? [];

  const comFalha = lista.filter((job) => job.state === 'FAILED');

  return (
    <section aria-labelledby="titulo-sync">
      <PageHeader id="titulo-sync" title="Sincronização de dispositivos" />

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

      <DataTable
        testId="tabela-de-dispositivos"
        rows={equipamentos}
        rowKey={(dispositivo) => dispositivo.id}
        caption="Leitores e catracas desta academia"
        columns={[
          { key: 'modelo', header: 'Modelo', render: (d) => d.model },
          { key: 'serie', header: 'Série', numeric: true, render: (d) => d.serial },
          {
            key: 'situacao',
            header: 'Situação',
            /*
             * Ternario preservado, NAO `StateBadge machine="device"`.
             *
             * O dicionario canonico tem `device` com 5 estados
             * (PROVISIONING/ONLINE/DEGRADED/OFFLINE/RETIRED), mas esta rota
             * devolve `ACTIVE`, que nao existe la -- o badge cairia em `—` e a
             * recepcao perderia a informacao. Alinhar os dois e mudanca de
             * contrato de API, nao de aparencia.
             */
            render: (d) => (d.status === 'ACTIVE' ? 'Ativo' : 'Fora de operação'),
          },
          {
            key: 'contato',
            header: 'Último contato',
            render: (d) => <TenantDateTime iso={d.lastHeartbeat} timeZone={FUSO_PROVISORIO} />,
          },
          {
            key: 'sincronizacao',
            header: 'Última sincronização',
            render: (d) => <TenantDateTime iso={d.lastSyncAt} timeZone={FUSO_PROVISORIO} />,
          },
        ]}
        empty={<EmptyState testId="sem-dispositivo" title="Nenhum dispositivo cadastrado." />}
      />

      <h2>Fila de sincronização</h2>

      <DataTable
        testId="tabela-de-sync"
        rows={lista}
        rowKey={(job) => job.id}
        rowTestId={(job) => `job-${job.id}`}
        caption="Cadastros e exclusões por dispositivo"
        columns={[
          {
            key: 'operacao',
            header: 'Operação',
            render: (job) => ROTULO_DE_OPERACAO[job.operation] ?? job.operation,
          },
          {
            key: 'situacao',
            header: 'Situação',
            /*
             * Texto, não só cor: cor sozinha não informa quem não a distingue.
             * O `StateBadge` carrega icone E rotulo, entao o `⚠` manual saiu --
             * ele era o mesmo canal, feito a mao.
             */
            render: (job) => <StateBadge machine="syncJob" state={job.state} />,
          },
          { key: 'tentativas', header: 'Tentativas', numeric: true, render: (job) => job.attempts },
          {
            key: 'ultima',
            header: 'Última tentativa',
            render: (job) => <TenantDateTime iso={job.lastAttemptAt} timeZone={FUSO_PROVISORIO} />,
          },
          {
            key: 'proxima',
            header: 'Próxima tentativa',
            render: (job) => <TenantDateTime iso={job.nextAttemptAt} timeZone={FUSO_PROVISORIO} />,
          },
          {
            key: 'acao',
            header: 'O que fazer',
            /*
             * A ação recomendada vem da API, não da tela: o mesmo texto
             * serve para o painel e para qualquer outro consumidor.
             */
            render: (job) => job.recommendedAction ?? <Ausente />,
          },
        ]}
        empty={<EmptyState testId="fila-vazia" title="Nada pendente." />}
      />
    </section>
  );
}
