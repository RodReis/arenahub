import type { Metadata } from 'next';

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

const ROTULO_DE_ESTADO: Record<string, string> = {
  ACTIVE: 'Ativa',
  REVOKED: 'Revogada',
  DELETION_PENDING: 'Revogada — aguardando exclusão nos leitores',
  DELETED: 'Excluída de todos os leitores',
};

function formatarInstante(iso: string | null): string {
  if (!iso) return '—';

  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

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
        <h1 id="titulo-biometria">Biometria</h1>
        <p role="alert" data-testid="aluno-nao-encontrado">
          Aluno não encontrado.
        </p>
      </section>
    );
  }

  if (!consentimento.ok) {
    return (
      <section aria-labelledby="titulo-biometria">
        <h1 id="titulo-biometria">Biometria</h1>
        <p role="alert" data-testid="erro-de-permissao">
          Sem permissão para ver a biometria ({consentimento.erro?.code}).
        </p>
      </section>
    );
  }

  const decisao = consentimento.dados ?? null;
  const lista = identidades.dados ?? [];

  return (
    <section aria-labelledby="titulo-biometria">
      <h1 id="titulo-biometria">Biometria</h1>

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

      {lista.length === 0 ? (
        <p data-testid="sem-identidade">Nenhuma identidade biométrica cadastrada.</p>
      ) : (
        <table data-testid="tabela-de-identidades">
          <caption>Cadastros biométricos deste aluno</caption>
          <thead>
            <tr>
              <th scope="col">Situação</th>
              <th scope="col">Cadastrada em</th>
              <th scope="col">Revogada em</th>
              <th scope="col">Excluída em</th>
              <th scope="col">Imagem de cadastro</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((identidade) => (
              <tr key={identidade.id} data-testid={`identidade-${identidade.id}`}>
                <td>{ROTULO_DE_ESTADO[identidade.state] ?? identidade.state}</td>
                <td>{formatarInstante(identidade.createdAt)}</td>
                <td>{formatarInstante(identidade.revokedAt)}</td>
                <td>{formatarInstante(identidade.deletedAt)}</td>
                {/*
                  Presença, nunca a imagem nem o caminho dela (INV-022).
                  Depois do expurgo (INV-142) esta coluna passa a dizer
                  "expurgada", que é a evidência auditável de que sumiu.
                */}
                <td>{identidade.hasEnrollmentObject ? 'Guardada' : 'Expurgada'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
