import type { Metadata } from 'next';
import { z } from 'zod';

import {
  Ausente,
  Button,
  DataTable,
  EmptyState,
  Identidade,
  PageHeader,
  ProblemDetail,
  Telefone,
} from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { mascararCpf } from '../../../../src/lib/mascaras';
import { consultaDoFiltro } from '../../../../src/reports/filtro';
import { FiltroDoRelatorio } from './filtro-do-relatorio';

export const metadata: Metadata = { title: 'Relatório de alunos — ArenaHub' };

export const dynamic = 'force-dynamic';

const POR_PAGINA = 20;

const esquemaDoRelatorio = z.object({
  total: z.number(),
  proximoCursor: z.string().nullable(),
  linhas: z.array(
    z.object({
      studentId: z.string(),
      deviceIds: z.array(z.string()),
      fullName: z.string(),
      cpf: z.string().nullable(),
      phone: z.string().nullable(),
      planLabel: z.string().nullable(),
    }),
  ),
});

const esquemaDeNomes = z.array(z.object({ id: z.string(), name: z.string() }));

/** O que a Route Handler de exportação manda na URL quando o download falha. */
const AVISO_DE_EXPORTACAO: Readonly<Record<string, { code: string; title: string }>> = {
  'muito-grande': {
    code: 'REPORT_TOO_LARGE',
    title: 'O relatório passa de 20.000 alunos. Refine os filtros e exporte de novo.',
  },
  falha: {
    code: 'REPORT_EXPORT_FAILED',
    title: 'Não foi possível gerar o arquivo. Tente de novo.',
  },
};

/**
 * Relatório de Alunos -- F90. Irmã da Lista de Alunos: mesmo cabeçalho, mesma
 * tabela, filtros na URL. Server Component, sem JavaScript para filtrar.
 *
 * A EXPORTAÇÃO É O MESMO FILTRO: os dois botões apontam para a Route Handler
 * com exatamente a consulta desta tela, então o arquivo é o que se vê.
 */
export default async function PaginaDoRelatorioDeAlunos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const texto = (chave: string): string | undefined => {
    const valor = parametros[chave];

    return typeof valor === 'string' && valor !== '' ? valor : undefined;
  };

  const filtro = consultaDoFiltro(texto);
  const aviso = AVISO_DE_EXPORTACAO[texto('erro') ?? ''];
  const cursor = texto('cursor');

  const consulta = new URLSearchParams(filtro);
  consulta.set('limit', String(POR_PAGINA));
  if (cursor) consulta.set('cursor', cursor);

  // Unidades e planos são do FILTRO: falhar ao buscá-los não derruba a tela.
  const [resposta, respostaDeUnidades, respostaDePlanos] = await Promise.all([
    chamarApi(`/api/v1/reports/students?${consulta.toString()}`, { esquema: esquemaDoRelatorio }),
    chamarApi('/api/v1/units', { esquema: esquemaDeNomes }),
    chamarApi('/api/v1/plans', { esquema: esquemaDeNomes }),
  ]);

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-relatorio-de-alunos">
        <PageHeader id="titulo-relatorio-de-alunos" title="Relatório de alunos" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? { type: 'about:blank', status: 0, code: 'erro', correlationId: '' }),
            title: `Sem permissão para consultar o relatório (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const relatorio = resposta.dados;
  const unidades = respostaDeUnidades.ok ? (respostaDeUnidades.dados ?? []) : [];
  const planos = respostaDePlanos.ok ? (respostaDePlanos.dados ?? []) : [];
  const temFiltro = filtro.size > 0;

  const proxima = relatorio.proximoCursor
    ? `/reports/students?${new URLSearchParams([...filtro, ['cursor', relatorio.proximoCursor]]).toString()}`
    : '';
  const primeira = cursor ? `/reports/students${temFiltro ? `?${filtro.toString()}` : ''}` : '';

  const exportar = (formato: 'pdf' | 'csv'): string => {
    const url = new URLSearchParams(filtro);
    url.set('format', formato);

    return `/reports/students/export?${url.toString()}`;
  };

  return (
    <section aria-labelledby="titulo-relatorio-de-alunos">
      <PageHeader
        id="titulo-relatorio-de-alunos"
        title="Relatório de alunos"
        breadcrumb={<span>Relatórios</span>}
        actions={
          <>
            <Button href={exportar('pdf')} variant="outline" data-testid="exportar-pdf">
              Exportar PDF
            </Button>
            <Button href={exportar('csv')} variant="outline" data-testid="exportar-csv">
              Exportar CSV
            </Button>
          </>
        }
      />

      {aviso ? (
        <ProblemDetail
          testId="erro-de-exportacao"
          problem={{ type: 'about:blank', status: 0, correlationId: '', ...aviso }}
        />
      ) : null}

      <FiltroDoRelatorio
        unidades={unidades}
        planos={planos}
        valores={{
          gymUnitId: texto('gymUnitId') ?? '',
          status: texto('status') ?? '',
          profile: texto('profile') ?? '',
          planId: texto('planId') ?? '',
          financeiro: texto('financeiro') ?? '',
        }}
      />

      <DataTable
        testId="tabela-do-relatorio-de-alunos"
        rows={relatorio.linhas}
        total={relatorio.total}
        rowKey={(aluno) => aluno.studentId}
        rowTestId={(aluno) => `relatorio-aluno-${aluno.studentId}`}
        caption="Alunos do relatório, em ordem alfabética"
        columns={[
          {
            key: 'catraca',
            header: 'Catraca',
            role: 'code',
            // Dois números aparecem os dois: é o caso que precisa ser visto (cartão antigo ainda válido).
            render: (aluno) =>
              aluno.deviceIds.length === 0 ? <Ausente /> : aluno.deviceIds.join(', '),
          },
          {
            key: 'nome',
            header: 'Nome',
            role: 'identity',
            render: (aluno) => (
              <Identidade nome={aluno.fullName} href={`/students/${aluno.studentId}`} />
            ),
          },
          {
            key: 'cpf',
            header: 'CPF',
            role: 'code',
            render: (aluno) => (aluno.cpf === null ? <Ausente /> : mascararCpf(aluno.cpf)),
          },
          {
            key: 'contato',
            header: 'Contato',
            role: 'label',
            render: (aluno) => <Telefone numero={aluno.phone} />,
          },
          {
            key: 'plano',
            header: 'Plano',
            role: 'label',
            render: (aluno) => (aluno.planLabel === null ? <Ausente /> : aluno.planLabel),
          },
        ]}
        {...(primeira ? { prevHref: primeira, prevLabel: 'Primeira página' } : {})}
        {...(proxima ? { nextHref: proxima } : {})}
        empty={
          <EmptyState
            testId="sem-alunos-no-relatorio"
            title={
              temFiltro ? 'Nenhum aluno encontrado com esses filtros.' : 'Nenhum aluno cadastrado ainda.'
            }
            hint={
              temFiltro ? 'Amplie ou limpe os filtros.' : 'Cadastre o primeiro aluno para ver o relatório.'
            }
          />
        }
      />
    </section>
  );
}
