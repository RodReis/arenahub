import type { Metadata } from 'next';

import {
  Button,
  DataTable,
  EmptyState,
  EstadoSimples,
  Identidade,
  PageHeader,
  ProblemDetail,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';

export const metadata: Metadata = {
  title: 'Unidades — ArenaHub',
};

interface Unidade {
  id: string;
  code: string;
  name: string;
  timezone: string;
  status: string;
}

/**
 * Server Component: a lista e buscada no servidor e chega pronta. Sem
 * estado de carregamento no cliente, sem token exposto ao navegador.
 */
export default async function PaginaDeUnidades() {
  const resposta = await chamarApi<Unidade[]>('/api/v1/units');

  if (!resposta.ok) {
    // Negacao explicita, com o codigo estavel visivel. Tela vazia deixaria
    // o operador sem saber se nao ha unidade ou se ele nao tem permissao.
    return (
      <section aria-labelledby="titulo-unidades">
        <PageHeader
        id="titulo-unidades"
        title="Unidades"
        breadcrumb={<span>Administração</span>}
        actions={
          /*
            `POST /units` existia na API desde sempre -- com validacao de fuso
            IANA e auditoria -- e nunca teve um chamador no painel. A unica
            unidade que existia veio do seed.
          */
          <Button href="/units/nova" data-testid="nova-unidade">
            Nova unidade
          </Button>
        }
      />
        {/*
          Mesma frase que ja estava na tela, agora acentuada (o plano autoriza
          so a acentuacao desta tela). O `title` do `problem+json` da API NAO
          entra no lugar dela: a frase local diz o que o operador perdeu -- as
          unidades -- e a do servidor e generica.
        */}
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para ver as unidades (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const unidades = resposta.dados ?? [];

  return (
    <section aria-labelledby="titulo-unidades">
      <PageHeader id="titulo-unidades" title="Unidades" />

      <DataTable
        testId="tabela-de-unidades"
        rows={unidades}
        rowKey={(unidade) => unidade.id}
        caption="Unidades da sua academia"
        columns={[
          /*
           * Cabecalhos SEM acento, byte a byte como estavam.
           *
           * O E2E afirma `columnheader { name: 'Codigo' }` por TEXTO -- acentuar
           * aqui quebra a rede que prova que a migracao nao mudou
           * comportamento. Corrigir a grafia e trabalho do card que tambem
           * atualiza o teste, nao desta fatia.
           */
          /*
           * `code` e nao `value`: codigo de unidade ("AP-01") se le caractere a
           * caractere, nao se soma. Era `numeric: true`, que nunca alinhou nada
           * -- o `globals.css` ja dava `tabular-nums` a tabela inteira.
           */
          { key: 'codigo', header: 'Codigo', role: 'code', render: (u) => u.code },
          {
            key: 'nome',
            header: 'Nome',
            role: 'identity',
            /*
             * `semAvatar`: unidade e um ENDERECO, nao uma pessoa. A inicial num
             * circulo daria a cada linha um rosto que ela nao tem -- enfeite
             * fingindo ser informacao.
             *
             * O fuso NAO desce para o `secundario` do bloco, embora coubesse: o
             * E2E afirma cabecalho por texto, e fundir duas colunas numa apaga
             * um `columnheader`. Migrar aparencia nao pode custar a rede que
             * prova que a aparencia foi a unica coisa que mudou.
             */
            render: (u) => <Identidade semAvatar nome={u.name} />,
          },
          /*
           * `code` e nao `support`: "America/Sao_Paulo" e um identificador IANA,
           * nao frase da API. `support` reservaria 32ch de piso a uma string de
           * 17 caracteres e abriria um vao ate a coluna seguinte.
           */
          { key: 'fuso', header: 'Fuso horario', role: 'code', render: (u) => u.timezone },
          {
            key: 'situacao',
            header: 'Situacao',
            role: 'state',
            /*
             * `EstadoSimples`, nao `StateBadge`: o §7 define 11 maquinas de
             * estado e NENHUMA e de unidade. Inventar `machine="unit"` no
             * dicionario canonico seria decisao de produto, e ela nao e minha.
             *
             * O que mudou e so a FORMA: antes era texto cru ao lado de colunas
             * com badge, e a tabela parecia ter duas linguagens visuais.
             * `EstadoSimples` da a ela ponto, icone e rotulo -- sem fingir que
             * existe uma maquina por tras.
             *
             * Texto, nao so cor: `M1-NFR-008` exige WCAG 2.2 AA.
             */
            render: (u) =>
              u.status === 'ACTIVE' ? (
                <EstadoSimples label="Ativa" tom="positivo" />
              ) : (
                <EstadoSimples label="Inativa" tom="neutro" />
              ),
          },
        ]}
        empty={
          <EmptyState
            testId="lista-vazia"
            title="Nenhuma unidade cadastrada ainda."
            hint="Cadastre a primeira unidade para liberar o acesso da recepção."
            /*
              A dica MANDAVA cadastrar e nao oferecia caminho -- "vazio sem
              saida e beco", como o proprio `EmptyState` documenta.
            */
            action={
              <Button href="/units/nova" data-testid="nova-unidade-vazio">
                Cadastrar unidade
              </Button>
            }
          />
        }
      />
    </section>
  );
}
