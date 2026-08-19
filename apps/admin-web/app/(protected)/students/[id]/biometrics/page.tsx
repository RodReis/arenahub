import type { Metadata } from 'next';

import {
  DataTable,
  EmptyState,
  EstadoSimples,
  PageHeader,
  ProblemDetail,
  StateBadge,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../../../lib/api/server-client';

export const metadata: Metadata = {
  title: 'Biometria do aluno — ArenaHub',
};

interface Consentimento {
  id: string;
  decision: string;
  subjectKind: string;
  documentVersion: number;
  allowsBiometricEnrollment: boolean;
  blockedReason: string | null;
}

interface Identidade {
  id: string;
  state: string;
  createdAt: string;
  revokedAt: string | null;
  deletedAt: string | null;
  hasEnrollmentObject: boolean;
}

interface Termo {
  version: number;
  purpose: string;
}

/**
 * Por que a biometria está bloqueada, em português.
 *
 * O código estável vem da API; a frase mora aqui porque é texto de
 * interface. A recepção age diferente em cada caso — e "não pode cadastrar"
 * sem motivo mandaria ela abrir chamado para descobrir.
 */
const MOTIVO_EM_PORTUGUES: Record<string, string> = {
  CONSENT_MISSING: 'O aluno ainda não decidiu sobre o uso da biometria.',
  CONSENT_REFUSED:
    'O aluno recusou a biometria. O acesso continua disponível por QR, cartão ou PIN.',
  CONSENT_REVOKED: 'O consentimento foi revogado.',
  CONSENT_SUPERSEDED: 'Há uma decisão mais recente registrada.',
  CONSENT_REVALIDATION_REQUIRED:
    'O aluno completou 18 anos. É preciso revalidar o consentimento com ele próprio.',
  CONSENT_DOCUMENT_RETIRED: 'O termo aceito foi substituído por uma versão nova.',
};

/*
 * `ROTULO_DE_ESTADO` e `formatarInstante` MORRERAM -- a segunda copia dos dois,
 * gemea da que saiu de `devices/page.tsx`. As quatro frases daqui sao as que
 * venceram no dicionario canonico: elas ja diziam "Revogada — aguardando
 * exclusao nos leitores" onde o contrato §7 propunha o generico "Exclusao em
 * andamento", e a producao venceu.
 */

/**
 * Fuso FIXO, preservado da implementacao anterior -- mesma divida de
 * `devices/page.tsx`. A rota de identidades nao devolve o fuso da unidade, e
 * busca-lo exigiria chamada nova, que e comportamento.
 */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

/**
 * Biometria de um aluno: consentimento, identidade e estado da exclusão.
 *
 * A tela NUNCA mostra a foto nem a chave do objeto (INV-022). O que ela
 * informa é se existe cadastro, não onde ele está guardado.
 */
export default async function PaginaDeBiometria({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [consentimento, identidades, termo] = await Promise.all([
    chamarApi<Consentimento | null>(`/api/v1/students/${id}/biometric-consent`),
    chamarApi<Identidade[]>(`/api/v1/students/${id}/biometric-identities`),
    chamarApi<Termo>('/api/v1/consent-documents/biometric/current'),
  ]);

  if (!consentimento.ok && consentimento.erro?.code === 'STUDENT_NOT_FOUND') {
    return (
      <section aria-labelledby="titulo-biometria">
        <PageHeader id="titulo-biometria" title="Biometria" />
        <ProblemDetail
          testId="aluno-nao-encontrado"
          problem={{
            ...(consentimento.erro ?? {
              type: 'about:blank',
              status: 404,
              code: 'STUDENT_NOT_FOUND',
              correlationId: '',
            }),
            title: 'Aluno não encontrado.',
          }}
        />
      </section>
    );
  }

  if (!consentimento.ok) {
    return (
      <section aria-labelledby="titulo-biometria">
        <PageHeader id="titulo-biometria" title="Biometria" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(consentimento.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para ver a biometria (${consentimento.erro?.code}).`,
          }}
        />
      </section>
    );
  }

  const decisao = consentimento.dados ?? null;
  const lista = identidades.dados ?? [];

  return (
    <section aria-labelledby="titulo-biometria">
      <PageHeader id="titulo-biometria" title="Biometria" />

      <h2>Consentimento</h2>

      {/*
        O termo vigente fica VISÍVEL antes da decisão: consentimento
        específico e destacado (LGPD art. 11, I) pressupõe que a pessoa
        soube o que estava aceitando.
      */}
      {termo.ok && termo.dados ? (
        <p data-testid="finalidade-do-termo">
          <strong>Finalidade (versão {termo.dados.version}):</strong> {termo.dados.purpose}
        </p>
      ) : null}

      {decisao === null ? (
        <p data-testid="sem-consentimento">
          Nenhuma decisão registrada. O aluno pode aceitar ou recusar — recusar{' '}
          <strong>não impede</strong> a matrícula nem o acesso.
        </p>
      ) : (
        <dl data-testid="decisao-de-consentimento">
          <dt>Decisão</dt>
          <dd>{decisao.decision === 'ACCEPTED' ? 'Aceito' : 'Recusado'}</dd>

          <dt>Quem consentiu</dt>
          <dd>
            {decisao.subjectKind === 'LEGAL_GUARDIAN'
              ? 'Responsável legal'
              : 'O próprio aluno'}
          </dd>

          <dt>Versão do termo</dt>
          <dd>{decisao.documentVersion}</dd>

          <dt>Permite cadastro biométrico</dt>
          <dd>{decisao.allowsBiometricEnrollment ? 'Sim' : 'Não'}</dd>
        </dl>
      )}

      {decisao && !decisao.allowsBiometricEnrollment && decisao.blockedReason ? (
        // `role="status"`: a explicação é informação, não erro do operador.
        <p role="status" data-testid="motivo-do-bloqueio">
          {MOTIVO_EM_PORTUGUES[decisao.blockedReason] ?? decisao.blockedReason}
        </p>
      ) : null}

      <h2>Identidades biométricas</h2>

      <DataTable
        testId="tabela-de-identidades"
        rows={lista}
        rowKey={(identidade) => identidade.id}
        rowTestId={(identidade) => `identidade-${identidade.id}`}
        caption="Cadastros biométricos deste aluno"
        columns={[
          {
            key: 'situacao',
            header: 'Situação',
            role: 'state',
            /*
             * `biometric.REVOKED` e tom NEUTRO, nao erro: revogar consentimento
             * e direito do titular (ADR-008 decisao 3), nao falha do sistema.
             * A justificativa vive no `state-labels.ts`, para ninguem
             * "consertar" a diferenca para `entitlement.REVOKED`.
             */
            render: (identidade) => (
              <StateBadge machine="biometric" state={identidade.state} />
            ),
          },
          {
            key: 'cadastrada',
            header: 'Cadastrada em',
            role: 'moment',
            render: (i) => <TenantDateTime iso={i.createdAt} timeZone={FUSO_PROVISORIO} />,
          },
          {
            key: 'revogada',
            header: 'Revogada em',
            role: 'moment',
            render: (i) => <TenantDateTime iso={i.revokedAt} timeZone={FUSO_PROVISORIO} />,
          },
          {
            key: 'excluida',
            header: 'Excluída em',
            role: 'moment',
            render: (i) => <TenantDateTime iso={i.deletedAt} timeZone={FUSO_PROVISORIO} />,
          },
          {
            key: 'imagem',
            header: 'Imagem de cadastro',
            /*
             * Presença, nunca a imagem nem o caminho dela (INV-022).
             * Depois do expurgo (INV-142) esta coluna passa a dizer
             * "expurgada", que é a evidência auditável de que sumiu.
             *
             * `EstadoSimples`, nao `StateBadge`: presenca do objeto e um
             * BOOLEANO derivado, nao maquina de estado -- o §7 nao a cobre, e a
             * maquina que existe (`biometric`) ja e a coluna ao lado. O que
             * mudou e so a forma: o texto cru ficava sem peso ao lado do badge.
             *
             * Os dois tons sao NEUTROS de proposito. "Expurgada" e o resultado
             * CORRETO do INV-142, nao uma falha: pinta-la de vermelho mandaria
             * a recepcao abrir chamado sobre um expurgo que funcionou.
             *
             * O ICONE e que separa os dois, e por isso ele e explicito: dois
             * `tom="neutro"` cairiam no mesmo `minus` do padrao, e a coluna
             * teria a MESMA marca para significados opostos -- pior que o texto
             * cru que ela substitui, que ao menos diferia.
             */
            role: 'state',
            render: (i) =>
              i.hasEnrollmentObject ? (
                <EstadoSimples label="Guardada" tom="neutro" icone="lock" />
              ) : (
                <EstadoSimples label="Expurgada" tom="neutro" icone="archive" />
              ),
          },
        ]}
        empty={
          <EmptyState testId="sem-identidade" title="Nenhuma identidade biométrica cadastrada." />
        }
      />
    </section>
  );
}
