import {
  AcoesDaLinha,
  Button,
  DataTable,
  EmptyState,
  Identidade,
  StateBadge,
  Telefone,
  TenantDateTime,
} from '@arenahub/ui';

import {
  competenciaLegivel,
  linkDeCobrancaDeMeses,
  situacaoVisivel,
} from '../../../../src/billing/inadimplencia';
import { BuscaDeAluno } from './busca-de-aluno';
import estilos from './delinquency.module.css';

/** Linha da aba "Inadimplentes Mes Anterior": UM ALUNO por linha, sem valor em R$. */
export interface LinhaAnterior {
  studentId: string;
  studentName: string;
  telefone: string | null;
  /** Meses de vencimento (`AAAA-MM`), do mais antigo ao mais recente. */
  mesesEmAberto: string[];
  faturas: number;
  vencimentoMaisAntigo: string;
  diasEmAtraso: number;
  situacao: string;
  liberadoAte: string | null;
  fusoDaUnidade: string;
}

/**
 * A aba "Inadimplentes mês anterior": quem tem fatura vencida em aberto de
 * meses ANTERIORES ao corrente. UMA LINHA POR ALUNO (decisão do PI,
 * 19/10/2026), com os meses em aberto e o vencimento mais antigo -- sem valor
 * em R$, como o resto desta tela. Mesmas ações da fila do mês atual; o link de
 * cobrança não cita fatura, porque o aluno pode dever várias.
 */
export function FilaDeMesesAnteriores({
  linhas,
  termoDeBusca,
  prevHref,
  nextHref,
}: {
  linhas: LinhaAnterior[];
  termoDeBusca: string;
  prevHref: string;
  nextHref: string;
}) {
  return (
    <>
      <h2 className={estilos['tituloDaFila']}>
        Inadimplentes mês anterior
        <span className={estilos['apoioDoTitulo']}>atraso mais antigo primeiro</span>
      </h2>

      <BuscaDeAluno
        prefixo="qAnt"
        termoInicial={termoDeBusca}
        label="Buscar aluno com mês anterior em aberto"
        testId="busca-meses-anteriores"
      />

      <DataTable
        testId="tabela-de-meses-anteriores"
        rows={linhas}
        rowKey={(linha) => linha.studentId}
        rowTestId={(linha) => `anterior-${linha.studentId}`}
        caption="Alunos com fatura vencida em aberto de meses anteriores, do atraso mais antigo para o mais recente"
        {...(prevHref ? { prevHref, prevLabel: 'Primeira página' } : {})}
        {...(nextHref ? { nextHref } : {})}
        columns={[
          {
            key: 'aluno',
            header: 'Aluno',
            role: 'identity',
            render: (linha) => (
              <div className={estilos['celulaDoAluno']}>
                <Identidade
                  nome={linha.studentName}
                  secundario={
                    linha.telefone === null ? (
                      <span className={estilos['semTelefone']}>sem telefone cadastrado</span>
                    ) : (
                      <Telefone numero={linha.telefone} />
                    )
                  }
                />
              </div>
            ),
          },
          {
            key: 'meses',
            header: 'Meses em aberto',
            role: 'support',
            render: (linha) => (
              <ul className={estilos['motivos']}>
                {linha.mesesEmAberto.map((mes) => (
                  <li key={mes} className={estilos['motivo']}>
                    {competenciaLegivel(mes)}
                  </li>
                ))}
              </ul>
            ),
          },
          {
            key: 'faturas',
            header: 'Faturas',
            role: 'code',
            render: (linha) => (
              <div className={estilos['fatura']}>
                <span className={estilos['numero']}>{linha.faturas}</span>
                <span className={estilos['vencimento']}>
                  desde{' '}
                  <TenantDateTime
                    iso={linha.vencimentoMaisAntigo}
                    timeZone={linha.fusoDaUnidade}
                    format="date"
                  />
                </span>
              </div>
            ),
          },
          {
            key: 'acesso',
            header: 'Acesso',
            role: 'state',
            render: (linha) => (
              <StateBadge machine="delinquencyAccess" state={situacaoVisivel(linha)} />
            ),
          },
          {
            key: 'acoes',
            header: 'Ações',
            role: 'actions',
            render: (linha) => (
              <AcoesDaLinha>
                <Button variant="ghost" href={`/students/${linha.studentId}`}>
                  Ver aluno
                </Button>

                {linha.telefone === null ? (
                  <Button variant="outline" href={`/students/${linha.studentId}`}>
                    Cadastrar telefone
                  </Button>
                ) : (
                  <Button
                    variant="solid"
                    href={linkDeCobrancaDeMeses(linha.telefone, linha.studentName) ?? '#'}
                  >
                    Cobrar no WhatsApp
                  </Button>
                )}
              </AcoesDaLinha>
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="sem-meses-anteriores"
            title={
              termoDeBusca
                ? 'Nenhum aluno encontrado com esse nome.'
                : 'Ninguém com mês anterior em aberto'
            }
            hint={
              termoDeBusca
                ? 'Confira a grafia ou limpe a busca.'
                : 'Nenhuma fatura vencida em aberto de meses anteriores.'
            }
          />
        }
      />
    </>
  );
}
