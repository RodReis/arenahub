import type { Metadata } from 'next';

import { PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { FormularioDoTermo, type TermoVigente } from './formulario-do-termo';

export const metadata: Metadata = {
  title: 'Termo biométrico — ArenaHub',
};

/**
 * Termo biométrico da academia (issue #491).
 *
 * Sem termo vigente, nenhuma biometria nasce: nem a do cadastro no painel,
 * nem a importada da base do leitor (consentimento legado). A API publicava
 * desde a F8, mas nenhuma tela chamava -- a Arena Positiva ficou com 366
 * alunos reconhecidos pelo leitor e negados na catraca.
 */
export default async function PaginaDoTermoBiometrico() {
  const resposta = await chamarApi<TermoVigente>('/api/v1/consent-documents/biometric/current');

  // 404 aqui não é erro: é a academia que ainda não publicou termo nenhum.
  const semTermo = !resposta.ok && resposta.erro?.code === 'CONSENT_DOCUMENT_NOT_FOUND';

  if (!resposta.ok && !semTermo) {
    return (
      <section aria-labelledby="titulo-termo-biometrico">
        <PageHeader id="titulo-termo-biometrico" title="Termo biométrico" />
        <ProblemDetail
          testId="erro-do-termo"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar o termo (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="titulo-termo-biometrico">
      <PageHeader
        id="titulo-termo-biometrico"
        title="Termo biométrico"
        breadcrumb={<a href="/operations">Administração · Operação</a>}
      />

      <FormularioDoTermo vigente={semTermo ? null : (resposta.dados ?? null)} />
    </section>
  );
}
