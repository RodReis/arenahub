import type { Metadata } from 'next';
import type { CSSProperties } from 'react';

import {
  Ausente,
  PageHeader,
  ProblemDetail,
  SectionCard,
  SummaryStrip,
  TenantDateTime,
} from '@arenahub/ui';

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
 * Perfil do usuario logado -- SPEC-084.
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

      <div className={estilos['identidade']}>
        <span className={estilos['avatar']} aria-hidden="true" data-testid="perfil-avatar">
          {iniciais(perfil.email)}
        </span>
        <h2 id="titulo-conta" className={estilos['email']} data-testid="perfil-email">
          {perfil.email}
        </h2>
      </div>

      <div className={estilos['resumo']}>
        <SummaryStrip
          label="Dados da conta"
          celulas={[
            {
              id: 'perfil',
              label: 'Perfil',
              icon: 'shield',
              value: (
                <span data-testid="perfil-papeis">
                  {perfil.roles.length === 0 ? (
                    <Ausente />
                  ) : (
                    perfil.roles.map((papel) => rotuloDePerfil(papel)).join(', ')
                  )}
                </span>
              ),
            },
            {
              id: 'academia',
              label: 'Academia',
              icon: 'building',
              value: <span data-testid="perfil-academia">{perfil.tenant.displayName}</span>,
            },
            {
              id: 'criada-em',
              label: 'Conta criada em',
              icon: 'clock',
              value: (
                <span data-testid="perfil-criada-em">
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
                </span>
              ),
            },
          ]}
        />
      </div>

      <div className="ah-entrar" style={{ '--ordem': 3 } as CSSProperties}>
        <SectionCard
          title="Alterar senha"
          icon="lock"
          summary="Mínimo de 8 caracteres. Ao alterar, você continua conectado aqui e as outras sessões são encerradas."
        >
          <FormularioDeSenha />
        </SectionCard>
      </div>
    </section>
  );
}
