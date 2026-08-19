import type { Metadata } from 'next';

import {
  DataTable,
  EmptyState,
  EstadoSimples,
  Identidade,
  PageHeader,
  ProblemDetail,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { janelaLegivel } from '../../../src/students/formatar';
import { FormularioDePlano } from './formulario-de-plano';

export const metadata: Metadata = {
  title: 'Planos — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Janela {
  gymUnitId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface Plano {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  gymUnitIds: string[];
  janelas: Janela[];
}

interface Unidade {
  id: string;
  name: string;
}

/**
 * Planos — Slice 1.2.
 *
 * O plano define ONDE e QUANDO o acesso vale. Preço não aparece aqui: o
 * modelo não tem campo monetário no MVP 1, e cobrança entra no MVP 2 (F12).
 */
export default async function PaginaDePlanos() {
  const [respostaDosPlanos, respostaDasUnidades] = await Promise.all([
    chamarApi<Plano[]>('/api/v1/plans'),
    chamarApi<Unidade[]>('/api/v1/units'),
  ]);

  if (!respostaDosPlanos.ok) {
    return (
      <section aria-labelledby="titulo-planos">
        <PageHeader id="titulo-planos" title="Planos" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(respostaDosPlanos.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar planos (${respostaDosPlanos.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const planos = respostaDosPlanos.dados ?? [];
  const unidades = respostaDasUnidades.dados ?? [];

  const nomeDaUnidade = (unidadeId: string): string =>
    unidades.find((unidade) => unidade.id === unidadeId)?.name ?? unidadeId;

  return (
    <section aria-labelledby="titulo-planos">
      <PageHeader id="titulo-planos" title="Planos" />

      {/*
        Sem unidades, o formulário de criação não tem o que selecionar e a
        tabela mostra UUID no lugar do nome. Falha silenciosa aqui pareceria
        "academia sem unidade cadastrada", que é outro problema e outra ação.
      */}
      {!respostaDasUnidades.ok ? (
        <ProblemDetail
          testId="unidades-indisponiveis"
          problem={{
            ...(respostaDasUnidades.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            /*
             * A frase segue no `title`, byte a byte como estava. `hint` NAO
             * serve aqui: o componente o prefixa com "O que fazer: ", e isso
             * reescreveria texto de tela numa fatia que so muda aparencia.
             */
            title: `Não foi possível carregar as unidades (${respostaDasUnidades.erro?.code ?? 'erro'}). Recarregue a página antes de criar ou conferir planos.`,
          }}
        />
      ) : null}

      <DataTable
        testId="tabela-de-planos"
        rows={planos}
        rowKey={(plano) => plano.id}
        rowTestId={(plano) => `plano-${plano.id}`}
        caption="Planos cadastrados, em ordem alfabética"
        columns={[
          {
            key: 'plano',
            header: 'Plano',
            role: 'identity',
            /*
             * Nome mais descricao empilhados -- que e exatamente o que o
             * `<>{name}<small> — {desc}</small></>` desenhava a mao, com o
             * travessao fazendo o trabalho que a hierarquia visual faz melhor.
             *
             * `semAvatar`: plano nao e pessoa nem equipamento. Uma inicial num
             * circulo daria rosto a um contrato.
             *
             * A descricao so entra QUANDO EXISTE: passar `secundario={null}`
             * reservaria a segunda linha em toda linha da tabela, e a maioria
             * dos planos nao tem descricao.
             */
            render: (plano) => (
              <Identidade
                semAvatar
                nome={plano.name}
                {...(plano.description ? { secundario: plano.description } : {})}
              />
            ),
          },
          {
            key: 'situacao',
            header: 'Situação',
            role: 'state',
            /*
             * `EstadoSimples`, nao `StateBadge`: `isActive` e booleano, nao
             * maquina de estado -- o §7 nao define uma para plano.
             *
             * O que mudou e so a FORMA. O texto cru desta coluna ficava sem
             * peso ao lado das colunas com badge nas outras telas; agora ela
             * tem ponto, icone e rotulo -- sem fingir que existe uma maquina.
             *
             * Todo estado tem TEXTO: "Inativo" some se for só uma cor.
             */
            render: (plano) =>
              plano.isActive ? (
                <EstadoSimples label="Ativo" tom="positivo" />
              ) : (
                <EstadoSimples label="Inativo" tom="neutro" />
              ),
          },
          {
            key: 'unidades',
            header: 'Unidades',
            /*
             * SEM `role`, e nao `support`: nome de unidade e curto e vem em
             * lista vertical, entao o PISO de 32ch do papel `support` reservaria
             * espaco que a coluna nao usa -- e o roubaria de "Janelas de
             * horário" ao lado, que e a frase de verdade desta tabela. Duas
             * colunas `support` numa tabela de quatro somam 64ch de minimo.
             */
            render: (plano) => (
              <ul>
                {plano.gymUnitIds.map((unidadeId) => (
                  <li key={unidadeId}>{nomeDaUnidade(unidadeId)}</li>
                ))}
              </ul>
            ),
          },
          {
            key: 'janelas',
            header: 'Janelas de horário',
            /* A coluna mais longa da tabela: uma linha por janela, cada uma com
             * unidade, dias e horario. */
            role: 'support',
            render: (plano) => (
              <ul>
                {plano.janelas.map((janela, indice) => (
                  <li
                    key={`${janela.gymUnitId}-${janela.dayOfWeek}-${janela.startMinute}-${indice}`}
                  >
                    {nomeDaUnidade(janela.gymUnitId)} — {janelaLegivel(janela)}
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="sem-planos-cadastrados"
            title="Nenhum plano cadastrado ainda."
            hint="Crie o primeiro no formulário abaixo."
          />
        }
      />

      <section aria-labelledby="titulo-novo-plano">
        <h2 id="titulo-novo-plano">Criar plano</h2>
        <FormularioDePlano unidades={unidades} />
      </section>
    </section>
  );
}
