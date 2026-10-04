import type { Metadata } from 'next';

import { Ausente, PageHeader, ProblemDetail, TenantDateTime } from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { rotuloDePerfil } from '../../../src/iam/rotulos';
import { iniciais } from '../usuario';
import { FormularioDeSenha } from './formulario-de-senha';
import estilos from './perfil.module.css';

export const metadata: Metadata = {
  title: 'Meu perfil — ArenaHub',
};

interface PerfilDaConta {
  email: string;
  createdAt: string;
  roles: string[];
  tenant: { displayName: string; timezone: string | null };
}

/**
 * Perfil do usuario logado -- SPEC-XXX.
 *
 * SO LEITURA, alem da senha (decisao do PI em 04/10/2026). Avatar com
 * iniciais: a foto do leitor mora em `Student` e nao ha vinculo com `User`.
 */
export default async function PaginaDePerfil() {
  const resposta = await chamarApi<PerfilDaConta>('/api/v1/auth/profile');

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-perfil">
        <PageHeader id="titulo-perfil" title="Meu perfil" />
        <ProblemDetail
          testId="erro-do-perfil"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: 'Não foi possível carregar o seu perfil.',
          }}
        />
      </section>
    );
  }

  const perfil = resposta.dados;

  return (
    <section aria-labelledby="titulo-perfil" className={estilos['pagina']}>
      <PageHeader id="titulo-perfil" title="Meu perfil" />

      <div className={estilos['grade']}>
        <article className={estilos['cartao']} aria-labelledby="titulo-conta">
          <div className={estilos['identidade']}>
            <span className={estilos['avatar']} aria-hidden="true" data-testid="perfil-avatar">
              {iniciais(perfil.email)}
            </span>
            <h2 id="titulo-conta" className={estilos['email']} data-testid="perfil-email">
              {perfil.email}
            </h2>
          </div>

          <dl className={estilos['dados']}>
            <dt>Perfil</dt>
            <dd data-testid="perfil-papeis">
              {perfil.roles.length === 0 ? (
                <Ausente />
              ) : (
                perfil.roles.map((papel) => rotuloDePerfil(papel)).join(', ')
              )}
            </dd>

            <dt>Academia</dt>
            <dd data-testid="perfil-academia">{perfil.tenant.displayName}</dd>

            <dt>Conta criada em</dt>
            <dd data-testid="perfil-criada-em">
              {/* Sem fuso conhecido, ausente: chutar um fuso e o bug que o TenantDateTime existe para matar. */}
              {perfil.tenant.timezone ? (
                <TenantDateTime
                  iso={perfil.createdAt}
                  timeZone={perfil.tenant.timezone}
                  format="date"
                />
              ) : (
                <Ausente />
              )}
            </dd>
          </dl>
        </article>

        <article className={estilos['cartao']} aria-labelledby="titulo-senha">
          <h2 id="titulo-senha" className={estilos['tituloDoCartao']}>
            Alterar senha
          </h2>
          <FormularioDeSenha />
        </article>
      </div>
    </section>
  );
}
