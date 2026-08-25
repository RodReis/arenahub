import type { Metadata } from 'next';
import { z } from 'zod';

import {
  DataTable,
  EmptyState,
  EstadoSimples,
  Identidade,
  Money,
  PageHeader,
  ProblemDetail,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { CODIGO_DE_CONTRATO } from '../../../src/api/validar-resposta';
import { janelaLegivel } from '../../../src/students/formatar';
import { AcaoDeAtivacao } from './acao-de-ativacao';
import { EditarPlano } from './editar-plano';
import { AcaoDeReajuste } from './acao-de-reajuste';
import estilosDePlano from './planos.module.css';
import { Abas } from '../../../src/components/abas';
import { FormularioDePlano } from './formulario-de-plano';

export const metadata: Metadata = {
  title: 'Planos — ArenaHub',
};

export const dynamic = 'force-dynamic';

/*
 * Schemas de RESPOSTA, nao so tipos.
 *
 * O generico de `chamarApi` e assercao: quando a API respondeu sem `prices`,
 * o TS ficou calado e a tela quebrou com `Cannot read properties of
 * undefined (reading length)` dentro do render (issue #167). Com o schema, a
 * mesma divergencia vira `ProblemDetail` -- o caminho de erro que esta
 * pagina ja tinha.
 */
const esquemaDeJanela = z.object({
  gymUnitId: z.string(),
  dayOfWeek: z.number(),
  startMinute: z.number(),
  endMinute: z.number(),
});

const esquemaDePreco = z.object({
  amountMinor: z.number(),
  currency: z.string(),
  validFrom: z.string(),
});


const esquemaDePlano = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  gymUnitIds: z.array(z.string()),
  janelas: z.array(esquemaDeJanela),
  /** Preco vigente hoje, ou nulo -- nao deveria acontecer para plano criado pela tela (F53). */
  currentPrice: esquemaDePreco.nullable(),
  /** Todas as vigencias, para o reajuste mostrar o historico. */
  prices: z.array(esquemaDePreco),
});

const esquemaDeUnidade = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
});


/**
 * Planos — Slice 1.2, com preço vigente desde a F53.
 *
 * O plano define ONDE, QUANDO e QUANTO o acesso vale. O preço vigente
 * aparece na listagem porque quem reajusta ou confere um plano precisa ver
 * o valor sem abrir a ficha -- e um plano criado por esta tela nunca deveria
 * ter `currentPrice: null` (a API exige preço na criação desde o commit
 * f1a8b9b).
 */
export default async function PaginaDePlanos() {
  const [respostaDosPlanos, respostaDasUnidades] = await Promise.all([
    chamarApi('/api/v1/plans', { esquema: z.array(esquemaDePlano) }),
    chamarApi('/api/v1/units', { esquema: z.array(esquemaDeUnidade) }),
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
            /*
             * Falha de contrato ja traz o campo que divergiu no titulo --
             * sobrescrever com "sem permissao" jogaria fora a unica frase
             * que encurta o diagnostico, e mentiria sobre a causa.
             */
            title:
              respostaDosPlanos.erro?.code === CODIGO_DE_CONTRATO
                ? respostaDosPlanos.erro.title
                : `Sem permissão para consultar planos (${respostaDosPlanos.erro?.code ?? 'erro'}).`,
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

      <Abas
        rotulo="Seções de planos"
        abas={[
          {
            id: 'lista-de-planos',
            rotulo: 'Planos cadastrados',
            conteudo: (
              <>

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
                  key: 'preco',
                  header: 'Preço',
                  role: 'value',
                  /*
                   * `currentPrice` nulo nao deveria acontecer para plano criado
                   * por esta tela (a API exige preco na criacao), mas plano do
                   * seed ou de importacao futura pode nao ter vigencia -- o aviso
                   * evita que a coluna pareca vazia por engano.
                   */
                  render: (plano) => (
                    /*
                      `data-testid` na CELULA: desde que o reajuste virou modal,
                      o historico de vigencias fica montado no DOM e repete o
                      mesmo valor -- buscar "R$ 150,00" solto acha dois.
                    */
                    <span data-testid={`preco-do-plano-${plano.id}`}>
                      {plano.currentPrice ? (
                        <Money
                          cents={plano.currentPrice.amountMinor}
                          currency={plano.currentPrice.currency}
                        />
                      ) : (
                        'Sem preço vigente'
                      )}
                    </span>
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
                {
                  key: 'acoes',
                  header: 'Ações',
                  role: 'actions',
                  /*
                   * ponytail: fuso da PRIMEIRA unidade do plano, nao um por
                   * vigencia. Plano com unidades em fusos diferentes existe no
                   * dominio, mas `PlanPrice.validFrom` e um instante unico -- sem
                   * "fuso do preco" no contrato, mostrar o historico com N fusos
                   * simultaneos seria complexidade que nada pediu. Se isso incomodar
                   * na pratica, o upgrade e a API devolver o fuso junto do preco.
                   */
                  render: (plano) => (
                    <div className={estilosDePlano['acoesDaLinha']}>
                      {/*
                        EDITAR o plano -- nada dele era editavel ate
                        24/08/2026: nome errado e, o pior, unidade faltando
                        ficavam para sempre.
                      */}
                      <EditarPlano
                        planId={plano.id}
                        nome={plano.name}
                        descricao={plano.description}
                        unidadesDoPlano={plano.gymUnitIds}
                        janelas={plano.janelas}
                        unidades={unidades}
                      />

                    <AcaoDeReajuste
                      planId={plano.id}
                      nomeDoPlano={plano.name}
                      unidades={plano.gymUnitIds.map(nomeDaUnidade)}
                      historico={plano.prices}
                      timeZone={unidades.find((u) => u.id === plano.gymUnitIds[0])?.timezone ?? 'UTC'}
                    />

                      {/*
                        DESATIVAR, nao excluir: plano apagado deixaria invoice
                        e timeline citando algo que nao existe mais.
                      */}
                      <AcaoDeAtivacao
                        planId={plano.id}
                        nomeDoPlano={plano.name}
                        isActive={plano.isActive}
                      />
                    </div>
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

              </>
            ),
          },
          {
            id: 'novo-plano',
            rotulo: 'Criar plano',
            conteudo: (
              <>
            <section aria-labelledby="titulo-novo-plano">
              <h2 id="titulo-novo-plano">Criar plano</h2>
              <FormularioDePlano unidades={unidades} />
            </section>
              </>
            ),
          },
        ]}
      />
    </section>
  );
}
