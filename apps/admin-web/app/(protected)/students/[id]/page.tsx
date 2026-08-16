import type { Metadata } from 'next';

import { chamarApi } from '../../../../lib/api/server-client';
import { traduzir } from '../../../../src/operations/formatar';
import {
  ROTULO_DE_ENTITLEMENT,
  ROTULO_DE_ORIGEM,
  ROTULO_DE_SITUACAO,
  dataLegivel,
  impedeAcesso,
  janelaLegivel,
  vigenteAgora,
} from '../../../../src/students/formatar';
import { AlterarSituacao } from './alterar-situacao';
import { AtribuirPlano } from './atribuir-plano';

export const metadata: Metadata = {
  title: 'Ficha do aluno — ArenaHub',
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

interface Janela {
  gymUnitId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface Entitlement {
  id: string;
  source: string;
  status: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  subscriptionId: string | null;
  janelas: Janela[];
}

interface Plano {
  id: string;
  name: string;
  isActive: boolean;
}

interface Unidade {
  id: string;
  name: string;
}

/**
 * Ficha do aluno — `M1-AC-002` e `M1-AC-003`, Slice 1.2.
 *
 * Esta é a tela que fecha o aceite da fatia: *"a recepção cadastra aluno,
 * atribui plano e visualiza exatamente QUANDO e ONDE o acesso é válido"*. Por
 * isso a janela de horário aparece com dia e hora legíveis, e a unidade
 * aparece pelo nome — `gymUnitId` em UUID responderia "onde" só no papel.
 */
export default async function PaginaDaFicha({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Em série o operador esperaria quatro viagens; em paralelo, uma.
  const [respostaDoAluno, respostaDosDireitos, respostaDosPlanos, respostaDasUnidades] =
    await Promise.all([
      chamarApi<Aluno>(`/api/v1/students/${id}`),
      chamarApi<Entitlement[]>(`/api/v1/students/${id}/entitlements`),
      chamarApi<Plano[]>('/api/v1/plans'),
      chamarApi<Unidade[]>('/api/v1/units'),
    ]);

  if (!respostaDoAluno.ok || !respostaDoAluno.dados) {
    const codigo = respostaDoAluno.erro?.code ?? 'erro';

    return (
      <section aria-labelledby="titulo-ficha">
        <h1 id="titulo-ficha">Ficha do aluno</h1>
        <p role="alert" data-testid={codigo === 'STUDENT_NOT_FOUND' ? 'aluno-nao-encontrado' : 'erro-da-ficha'}>
          {codigo === 'STUDENT_NOT_FOUND'
            ? 'Aluno não encontrado nesta academia.'
            : `Não foi possível abrir a ficha (${codigo}).`}
        </p>
        <p>
          <a href="/students">Voltar para a lista de alunos</a>
        </p>
      </section>
    );
  }

  const aluno = respostaDoAluno.dados;

  // FALHA NÃO É LISTA VAZIA.
  //
  // Se a consulta de direitos cair, `?? []` faria a seção "Acesso agora"
  // dizer "sem direito de acesso vigente" -- para um aluno que talvez tenha
  // direito ativo. A recepção negaria a passagem, ou atribuiria um segundo
  // plano achando que não havia nenhum. Uma tela que responde a pergunta
  // errada com confiança é pior que uma tela que admite não saber.
  if (!respostaDosDireitos.ok || !respostaDosDireitos.dados) {
    return (
      <section aria-labelledby="titulo-ficha">
        <h1 id="titulo-ficha">{aluno.fullName}</h1>
        <p role="alert" data-testid="erro-dos-direitos">
          Não foi possível carregar os direitos de acesso deste aluno (
          {respostaDosDireitos.erro?.code ?? 'erro'}). Recarregue a página — enquanto isso, esta
          tela não consegue dizer se o acesso está válido.
        </p>
        <p>
          <a href="/students">Voltar para a lista de alunos</a>
        </p>
      </section>
    );
  }

  const direitos = respostaDosDireitos.dados;

  // Planos e unidades são acessórios: sem eles não dá para ATRIBUIR, mas o
  // que já existe continua legível. Cada bloco avisa a própria limitação, em
  // vez de derrubar a ficha inteira.
  const planos = respostaDosPlanos.dados ?? [];
  const unidades = respostaDasUnidades.dados ?? [];
  const unidadesIndisponiveis = !respostaDasUnidades.ok;
  const planosIndisponiveis = !respostaDosPlanos.ok;

  const nomeDaUnidade = (unidadeId: string): string =>
    unidades.find((unidade) => unidade.id === unidadeId)?.name ?? unidadeId;

  const agora = new Date();
  const vigentes = direitos.filter((direito) => vigenteAgora(direito, agora));
  const bloqueado = impedeAcesso(aluno.status);

  return (
    <section aria-labelledby="titulo-ficha">
      <h1 id="titulo-ficha">{aluno.fullName}</h1>

      <p>
        <a href="/students">Voltar para a lista de alunos</a>
      </p>

      <dl data-testid="dados-do-aluno">
        <dt>Matrícula</dt>
        <dd data-testid="matricula">{aluno.membershipNumber}</dd>

        <dt>Nascimento</dt>
        <dd>
          <time dateTime={aluno.birthDate}>{dataLegivel(aluno.birthDate)}</time>
        </dd>

        <dt>CPF</dt>
        <dd>{aluno.cpfMasked ?? 'não informado'}</dd>

        <dt>Situação</dt>
        <dd data-testid="situacao-do-aluno">{traduzir(ROTULO_DE_SITUACAO, aluno.status)}</dd>
      </dl>

      {/*
        A pergunta mais urgente da recepção -- "essa pessoa entra agora?" --
        respondida na primeira linha, em TEXTO. Uma tarja colorida sozinha
        deixaria de fora quem não distingue as cores e quem está de relance.
      */}
      <section aria-labelledby="titulo-acesso">
        <h2 id="titulo-acesso">Acesso agora</h2>

        {bloqueado ? (
          <p role="alert" data-testid="acesso-impedido">
            A situação <strong>{traduzir(ROTULO_DE_SITUACAO, aluno.status)}</strong> impede o
            acesso. A catraca vai negar mesmo que exista plano vigente.
          </p>
        ) : vigentes.length > 0 ? (
          <p role="status" data-testid="acesso-vigente">
            Tem direito de acesso vigente. A catraca ainda confere unidade e horário no momento da
            passagem.
          </p>
        ) : (
          <p role="status" data-testid="acesso-sem-direito">
            Sem direito de acesso vigente. Atribua um plano abaixo para liberar a catraca.
          </p>
        )}
      </section>

      <section aria-labelledby="titulo-direitos">
        <h2 id="titulo-direitos">Direitos de acesso</h2>

        {/*
          Sem a lista de unidades, `nomeDaUnidade` cai para o UUID. Dizer isso
          evita que a recepção leia um identificador técnico achando que é o
          nome de uma unidade que ela não conhece.
        */}
        {unidadesIndisponiveis ? (
          <p role="alert" data-testid="unidades-indisponiveis">
            Não foi possível carregar os nomes das unidades. Onde deveria aparecer o nome, está o
            identificador interno.
          </p>
        ) : null}

        {direitos.length === 0 ? (
          <p data-testid="sem-direitos">
            Nenhum direito de acesso registrado. Atribua um plano para criar o primeiro.
          </p>
        ) : (
          <table data-testid="tabela-de-direitos">
            <caption>Direitos de acesso, do mais recente para o mais antigo</caption>
            <thead>
              <tr>
                <th scope="col">Situação</th>
                <th scope="col">Origem</th>
                <th scope="col">Vigência</th>
                <th scope="col">Onde e quando vale</th>
                <th scope="col">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {direitos.map((direito) => (
                <tr key={direito.id} data-testid={`direito-${direito.id}`}>
                  <td>
                    {traduzir(ROTULO_DE_ENTITLEMENT, direito.status)}
                    {vigenteAgora(direito, agora) ? (
                      <span data-testid={`vigente-${direito.id}`}> — vale agora</span>
                    ) : null}
                  </td>
                  <td>{traduzir(ROTULO_DE_ORIGEM, direito.source)}</td>
                  <td>
                    <time dateTime={direito.startsAt}>{dataLegivel(direito.startsAt)}</time> até{' '}
                    <time dateTime={direito.endsAt}>{dataLegivel(direito.endsAt)}</time>
                  </td>
                  <td>
                    {direito.janelas.length === 0 ? (
                      '—'
                    ) : (
                      <ul>
                        {direito.janelas.map((janela, indice) => (
                          <li
                            key={`${janela.gymUnitId}-${janela.dayOfWeek}-${janela.startMinute}-${indice}`}
                          >
                            {nomeDaUnidade(janela.gymUnitId)} — {janelaLegivel(janela)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{direito.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="titulo-atribuir">
        <h2 id="titulo-atribuir">Atribuir plano</h2>

        {/*
          Lista de planos vazia por falha tem a mesma aparência de "nenhum
          plano cadastrado" -- e as duas pedem ações opostas: uma manda
          recarregar, a outra manda cadastrar plano.
        */}
        {planosIndisponiveis ? (
          <p role="alert" data-testid="planos-indisponiveis">
            Não foi possível carregar a lista de planos ({respostaDosPlanos.erro?.code ?? 'erro'}).
            Recarregue a página para atribuir um plano.
          </p>
        ) : (
          <AtribuirPlano studentId={aluno.id} planos={planos} impedido={bloqueado} />
        )}
      </section>

      <section aria-labelledby="titulo-situacao">
        <h2 id="titulo-situacao">Situação do cadastro</h2>
        <AlterarSituacao
          studentId={aluno.id}
          situacaoAtual={aluno.status}
          version={aluno.version}
        />
      </section>

      <section aria-labelledby="titulo-mais">
        <h2 id="titulo-mais">Mais sobre este aluno</h2>
        <ul>
          <li>
            <a href={`/students/${aluno.id}/timeline`} data-testid="link-timeline">
              Histórico administrativo
            </a>
          </li>
          <li>
            <a href={`/students/${aluno.id}/biometrics`} data-testid="link-biometria">
              Consentimento e biometria
            </a>
          </li>
        </ul>
      </section>
    </section>
  );
}
