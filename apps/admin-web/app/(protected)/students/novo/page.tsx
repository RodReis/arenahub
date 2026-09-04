import type { Metadata } from 'next';

import { PageHeader } from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { FormularioDeCadastro } from './formulario-de-cadastro';

export const metadata: Metadata = {
  title: 'Cadastrar aluno — ArenaHub',
};

interface Unidade {
  id: string;
  code: string;
  name: string;
  status: string;
}

/** Modalidade ATIVA de alguma unidade do tenant -- F60. */
interface Modalidade {
  id: string;
  gymUnitId: string;
  name: string;
}

/**
 * Cadastro completo de aluno — F45, retrabalho da Slice 1.2.
 *
 * Server Component: as unidades vêm daqui, e não de um `useEffect` no
 * cliente. A unidade é obrigatória para concluir o cadastro — carregá-la
 * depois da hidratação deixaria o formulário momentaneamente impossível de
 * enviar, sem nada na tela explicando por quê.
 */
export default async function PaginaDeCadastro() {
  /*
   * As duas listas EM PARALELO. A de modalidades vem inteira, do tenant
   * (`/units/modalities`), e o formulário filtra por unidade no cliente
   * conforme a recepção troca o select: buscar a cada troca faria a tela ir
   * ao servidor no meio do preenchimento.
   *
   * Só as ATIVAS voltam nessa rota -- modalidade fora de operação não pode
   * ser oferecida a aluno novo.
   */
  const [unidades, modalidades] = await Promise.all([
    chamarApi<Unidade[]>('/api/v1/units'),
    chamarApi<Modalidade[]>('/api/v1/units/modalities'),
  ]);

  // Unidade inativa não recebe aluno novo: a academia fechou aquela porta.
  // Quem já está cadastrado nela continua onde está — isto filtra o
  // cadastro, não o histórico.
  const disponiveis = (unidades.dados ?? []).filter((u) => u.status === 'ACTIVE');

  return (
    <section aria-labelledby="titulo-cadastro">
      <PageHeader
        id="titulo-cadastro"
        title="Novo aluno"
        breadcrumb={<a href="/students">Cadastros · Alunos</a>}
      />

      <FormularioDeCadastro unidades={disponiveis} modalidades={modalidades.dados ?? []} />
    </section>
  );
}
