import type { Metadata } from 'next';

import { Button, EmptyState, Icon, PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { hojeEmBrasilia, idadeEm } from '../../../src/health/indicadores';
import estilos from './avaliacoes.module.css';

export const metadata: Metadata = {
  title: 'Avaliação física — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Aluno {
  id: string;
  membershipNumber: string;
  fullName: string;
  birthDate: string;
  profile: string;
}

/** Mesmo teto da grade de alunos: a busca é para achar um, não para listar a base. */
const LIMITE = 20;

/**
 * Entrada do professor na ficha de avaliação — F91 (SPEC-091).
 *
 * Busca pelo nome (o mesmo `?q=` da grade de alunos) e abre a ficha. Form GET
 * nativo: funciona sem JavaScript e a busca fica na URL.
 */
export default async function PaginaDeAvaliacoes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const termo = (q ?? '').trim();
  const resposta = await chamarApi<Aluno[]>(
    `/api/v1/students?limit=${LIMITE}${termo ? `&q=${encodeURIComponent(termo)}` : ''}`,
  );
  const alunos = (resposta.dados ?? []).filter((aluno) => aluno.profile === 'STUDENT');
  const hoje = hojeEmBrasilia();

  return (
    <section aria-labelledby="titulo-avaliacoes" className={estilos['pagina']}>
      <PageHeader id="titulo-avaliacoes" title="Avaliação física" />

      <form className={estilos['busca']} role="search" action="/avaliacoes">
        <label htmlFor="busca-aluno" className={estilos['rotulo']}>
          Aluno
        </label>
        <div className={estilos['linha']}>
          <input
            id="busca-aluno"
            name="q"
            type="search"
            defaultValue={termo}
            placeholder="Nome, matrícula ou telefone"
            autoComplete="off"
            className={estilos['campo']}
            data-testid="busca-aluno"
          />
          <Button type="submit">Buscar</Button>
        </div>
      </form>

      {!resposta.ok ? (
        <ProblemDetail
          testId="erro-da-busca"
          problem={{
            ...(resposta.erro ?? { type: 'about:blank', status: 0, code: 'erro', correlationId: '' }),
            title: 'Não foi possível buscar alunos. Tente de novo.',
          }}
        />
      ) : alunos.length === 0 ? (
        <EmptyState
          title={termo ? `Nenhum aluno encontrado para “${termo}”` : 'Nenhum aluno cadastrado'}
          {...(termo ? { hint: 'Confira a grafia ou busque pela matrícula.' } : {})}
          testId="busca-vazia"
        />
      ) : (
        <ul className={estilos['lista']} aria-label="Alunos">
          {alunos.map((aluno) => {
            const idade = idadeEm(aluno.birthDate, hoje);

            return (
              <li key={aluno.id}>
                <a
                  href={`/students/${aluno.id}/avaliacao`}
                  className={estilos['aluno']}
                  data-testid="abrir-ficha"
                >
                  <span className={estilos['nome']}>{aluno.fullName}</span>
                  <span className={estilos['meta']}>
                    Matrícula {aluno.membershipNumber}
                    {idade !== null ? ` · ${idade} anos` : ''}
                  </span>
                  <span className={estilos['abrir']}>
                    Abrir ficha
                    <Icon name="chevron-down" />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
