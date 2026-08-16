import type { Metadata } from 'next';

import { chamarApi } from '../../../lib/api/server-client';
import {
  ROTULO_DE_SITUACAO,
  dataLegivel,
  impedeAcesso,
} from '../../../src/students/formatar';
import { traduzir } from '../../../src/operations/formatar';

export const metadata: Metadata = {
  title: 'Alunos — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Aluno {
  id: string;
  membershipNumber: string;
  fullName: string;
  birthDate: string;
  cpfMasked: string | null;
  status: string;
  archivedAt: string | null;
  version: number;
}

const POR_PAGINA = 20;

/**
 * Busca de alunos — `M1-AC-002`, Slice 1.2.
 *
 * BUSCA NA URL, não em estado de componente: a recepção manda o link para a
 * colega e chega no mesmo resultado, o botão voltar funciona, e a página
 * inteira continua Server Component, sem JavaScript para buscar.
 */
export default async function PaginaDeAlunos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;

  const texto = (chave: string): string | undefined => {
    const valor = parametros[chave];

    return typeof valor === 'string' && valor !== '' ? valor : undefined;
  };

  const termo = texto('q');
  const consulta = new URLSearchParams();

  if (termo) consulta.set('q', termo);

  const cursor = texto('cursor');

  if (cursor) consulta.set('cursor', cursor);

  consulta.set('limit', String(POR_PAGINA));

  const resposta = await chamarApi<Aluno[]>(`/api/v1/students?${consulta.toString()}`);

  if (!resposta.ok) {
    return (
      <section aria-labelledby="titulo-alunos">
        <h1 id="titulo-alunos">Alunos</h1>
        <p role="alert" data-testid="erro-de-permissao">
          Sem permissão para consultar alunos ({resposta.erro?.code ?? 'erro'}).
        </p>
      </section>
    );
  }

  const alunos = resposta.dados ?? [];

  /**
   * Próxima página pelo id do último aluno.
   *
   * A rota devolve array puro, sem `nextCursor` — a paginação se apoia no
   * último id. Página cheia é o único sinal de que pode haver mais: com menos
   * que o limite, não há próxima.
   */
  const proximaUrl = (): string => {
    const ultimo = alunos[alunos.length - 1];

    if (!ultimo || alunos.length < POR_PAGINA) return '';

    const proxima = new URLSearchParams();

    if (termo) proxima.set('q', termo);
    proxima.set('cursor', ultimo.id);

    return `/students?${proxima.toString()}`;
  };

  const proxima = proximaUrl();

  return (
    <section aria-labelledby="titulo-alunos">
      <h1 id="titulo-alunos">Alunos</h1>

      <p>
        <a href="/students/novo" data-testid="novo-aluno">
          Cadastrar aluno
        </a>
      </p>

      {/* GET, não Server Action: busca é navegação, e navegação vai na URL. */}
      <form method="get" action="/students">
        <p>
          <label htmlFor="busca">Buscar por nome, matrícula ou contato</label>
          <input
            type="search"
            id="busca"
            name="q"
            defaultValue={termo ?? ''}
            placeholder="Ex.: Maria, AP-2026-00000001, (41) 99999-0000"
          />
          <button type="submit" data-testid="buscar">
            Buscar
          </button>
        </p>
      </form>

      {/*
        A busca não cobre CPF -- o documento é guardado só como hash, e
        procurar por ele exigiria rota nova. Dizer isso aqui evita a recepção
        digitar o CPF, não achar ninguém e concluir que o aluno não existe.
      */}
      <p role="note" data-testid="aviso-de-busca">
        A busca não encontra por CPF. Use nome, número de matrícula ou telefone.
      </p>

      {alunos.length === 0 ? (
        <p data-testid="sem-alunos">
          {termo
            ? 'Nenhum aluno encontrado com esse termo. Confira a grafia ou cadastre um novo aluno.'
            : 'Nenhum aluno cadastrado ainda. Comece cadastrando o primeiro.'}
        </p>
      ) : (
        <table data-testid="tabela-de-alunos">
          <caption>Alunos, do cadastro mais recente para o mais antigo</caption>
          <thead>
            <tr>
              <th scope="col">Matrícula</th>
              <th scope="col">Nome</th>
              <th scope="col">Nascimento</th>
              <th scope="col">CPF</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {alunos.map((aluno) => (
              <tr key={aluno.id} data-testid={`aluno-${aluno.id}`}>
                <td>{aluno.membershipNumber}</td>
                <td>
                  <a href={`/students/${aluno.id}`}>{aluno.fullName}</a>
                </td>
                <td>
                  <time dateTime={aluno.birthDate}>{dataLegivel(aluno.birthDate)}</time>
                </td>
                <td>{aluno.cpfMasked ?? '—'}</td>
                <td>
                  {/*
                    Todo estado tem TEXTO, cor é complemento. E o texto diz
                    a consequência: "Bloqueado" sozinho não avisa a recepção
                    de que a catraca vai negar.
                  */}
                  {traduzir(ROTULO_DE_SITUACAO, aluno.status)}
                  {impedeAcesso(aluno.status) ? (
                    <span data-testid={`sem-acesso-${aluno.id}`}> — sem acesso à catraca</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {proxima ? (
        <p>
          <a href={proxima} data-testid="proxima-pagina">
            Próxima página
          </a>
        </p>
      ) : null}
    </section>
  );
}
