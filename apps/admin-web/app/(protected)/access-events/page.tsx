import type { Metadata } from 'next';

import {
  Ausente,
  Button,
  DataTable,
  EmptyState,
  EstadoSimples,
  Field,
  Identidade,
  PageHeader,
  ProblemDetail,
  SelectField,
  StateBadge,
  TenantDateTime,
} from '@arenahub/ui';

import estilos from './access-events.module.css';

import { chamarApi } from '../../../lib/api/server-client';
import { ROTULO_DE_METODO, ROTULO_DE_MODO, traduzir } from '../../../src/operations/formatar';
import { periodoPadraoDeEventos } from '../../../src/operations/periodo-padrao';

/**
 * Fuso FIXO, preservado de `instanteLegivel` -- mesma divida das outras telas.
 * O evento traz `gymUnitId`, nao o fuso da unidade.
 */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

export const metadata: Metadata = {
  title: 'Eventos de acesso — ArenaHub',
};

export const dynamic = 'force-dynamic';

interface Evento {
  id: string;
  occurredAt: string;
  receivedAt: string;
  gymUnitId: string;
  outcome: string;
  reason: string;
  mode: string;
  method: string;
  student: { id: string; fullName: string; membershipNumber: string } | null;
  externalUserId: string | null;
  passageState: string | null;
  correlationId: string;
}

interface Pagina {
  eventos: Evento[];
  proximoCursor: string | null;
  periodoLimitado: boolean;
}

/**
 * Eventos de acesso — `M1-FR-024`.
 *
 * FILTROS NA URL, não em estado de componente. Três razões práticas: o
 * operador manda o link para o colega e chega na mesma tela; o botão voltar
 * do navegador funciona; e a página inteira continua sendo Server Component,
 * sem JavaScript para filtrar.
 */
export default async function PaginaDeEventos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;

  const texto = (chave: string): string | undefined => {
    const valor = parametros[chave];

    return typeof valor === 'string' && valor !== '' ? valor : undefined;
  };

  /*
   * O INPUT `datetime-local` MANDA `2026-09-01T12:04`, SEM FUSO -- FIX.
   *
   * O `<form method="get">` põe esse valor cru na URL, e a API exige
   * ISO-8601 completo (`z.string().datetime()`). Sem a conversão, TODO
   * filtro de período recusava com `VALIDATION_FAILED` -- a mensagem falava
   * em "permissão", que não era a causa, e o defeito reaparecia a cada
   * carregamento porque o filtro fica salvo na própria URL.
   *
   * Mesmo padrão de `app/actions/membership.ts` (`instanteIso`): teto
   * `Number.isFinite` para entrada mal-formada não travar a consulta.
   */
  const instanteIso = (valor: string): string | undefined => {
    const data = new Date(valor);

    return Number.isFinite(data.getTime()) ? data.toISOString() : undefined;
  };

  const consulta = new URLSearchParams();

  for (const chave of ['outcome', 'mode', 'gymUnitId', 'studentId', 'cursor']) {
    const valor = texto(chave);

    if (valor) consulta.set(chave, valor);
  }

  // `from`/`to` passam por `instanteIso`, os demais não: são os dois únicos
  // campos que o input `datetime-local` preenche.
  for (const chave of ['from', 'to']) {
    const valor = texto(chave);
    const convertido = valor ? instanteIso(valor) : undefined;

    // Entrada mal-formada vira campo AUSENTE, nunca string vazia na query --
    // `z.string().datetime().optional()` recusaria `''` do mesmo jeito que
    // recusava o formato incompleto.
    if (convertido) consulta.set(chave, convertido);
  }

  /*
   * O FORMULÁRIO MOSTRA O PERÍODO QUE A API JÁ USA, mesmo sem filtro
   * explícito na URL -- a API abre em "últimas 24h" quando `from`/`to`
   * ausentes (`PERIODO_PADRAO_HORAS`), mas nunca devolve esse cálculo na
   * resposta. Sem preencher, a academia via os campos em branco com a lista
   * cheia, e não tinha como saber o período real sem ler a hora do primeiro
   * e do último evento na tabela.
   *
   * SÓ QUANDO A URL NÃO TRAZ FILTRO: se o operador já escolheu um período
   * (mesmo que inválido), o formulário respeita a escolha dele -- o padrão
   * é só para quem ainda não filtrou nada.
   */
  const padrao = periodoPadraoDeEventos(new Date(), FUSO_PROVISORIO);
  const valorDe = texto('from') ?? padrao.de;
  const valorAte = texto('to') ?? padrao.ate;

  consulta.set('limit', '50');

  const resposta = await chamarApi<Pagina>(`/api/v1/access-events?${consulta.toString()}`);

  if (!resposta.ok) {
    return (
      <section aria-labelledby="titulo-eventos">
        <PageHeader id="titulo-eventos" title="Eventos de acesso" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para consultar eventos (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const pagina = resposta.dados!;

  const proximaUrl = (): string => {
    if (!pagina.proximoCursor) return '';

    const proxima = new URLSearchParams(consulta);

    proxima.set('cursor', pagina.proximoCursor);
    proxima.delete('limit');

    return `/access-events?${proxima.toString()}`;
  };

  return (
    <section aria-labelledby="titulo-eventos">
      <PageHeader id="titulo-eventos" title="Eventos de acesso" />

      {/* GET, não Server Action: filtro é navegação, e navegação vai na URL. */}
      <form className={estilos['filtro']} method="get" action="/access-events">
        <Field
          id="de"
          name="from"
          label="De"
          type="datetime-local"
          defaultValue={valorDe}
        />

        <Field
          id="ate"
          name="to"
          label="Até"
          type="datetime-local"
          defaultValue={valorAte}
        />

        <SelectField
          id="resultado"
          name="outcome"
          label="Resultado"
          defaultValue={texto('outcome') ?? ''}
        >
          <option value="">Todos</option>
          <option value="ALLOW">Liberado</option>
          <option value="DENY">Negado</option>
        </SelectField>

        <SelectField id="modo" name="mode" label="Origem" defaultValue={texto('mode') ?? ''}>
          <option value="">Todas</option>
          <option value="ONLINE">Online</option>
          <option value="OVERRIDE">Liberação manual</option>
        </SelectField>

        <Button type="submit" variant="outline" data-testid="filtrar">
          Filtrar
        </Button>
      </form>

      {pagina.periodoLimitado ? (
        // `role="status"`: é informação sobre o resultado, não erro do
        // operador. Sem o aviso, ele acharia que o período foi respeitado.
        <p role="status" data-testid="periodo-limitado">
          O período pedido é maior que o máximo de consulta. Mostrando os 31 dias mais
          recentes. Para um intervalo maior, use a exportação.
        </p>
      ) : null}

      <DataTable
        testId="tabela-de-eventos"
        rows={pagina.eventos}
        rowKey={(evento) => evento.id}
        rowTestId={(evento) => `evento-${evento.id}`}
        caption="Eventos, do mais recente para o mais antigo"
        columns={[
          {
            key: 'quando',
            header: 'Quando',
            role: 'moment',
            render: (e) => <TenantDateTime iso={e.occurredAt} timeZone={FUSO_PROVISORIO} />,
          },
          {
            key: 'aluno',
            header: 'Aluno',
            role: 'identity',
            /*
             * NOME E MATRICULA EMPILHADOS, nao "Nome (MAT-001)" numa linha so:
             * a matricula entre parenteses competia com o nome na varredura, e
             * quem procura uma pessoa nesta lista procura o NOME.
             *
             * `Identidade` traz o avatar -- numa lista de passagens, a marca
             * circular deixa varrer por forma antes de ler letra nenhuma.
             */
            render: (evento) =>
              evento.student ? (
                <Identidade
                  nome={evento.student.fullName}
                  secundario={evento.student.membershipNumber}
                />
              ) : (
                // Sem aluno resolvido, mostra o que o leitor viu -- é a
                // única pista de quem tentou passar. SEM AVATAR: inventar uma
                // inicial para "não identificado" daria rosto a quem o sistema
                // nao reconheceu, que e o oposto do que a linha diz.
                <Identidade
                  semAvatar
                  testId="aluno-nao-identificado"
                  nome="não identificado"
                  {...(evento.externalUserId
                    ? { secundario: `id ${evento.externalUserId}` }
                    : {})}
                />
              ),
          },
          {
            key: 'resultado',
            header: 'Resultado',
            role: 'state',
            /*
             * Ternario preservado: `ALLOW`/`DENY` e o RESULTADO da decisao,
             * nao um estado de maquina -- a razao ao lado e que carrega o
             * badge.
             *
             * A FORMA mudou para `EstadoSimples`: texto cru ao lado de uma
             * coluna com badge fazia a tabela ter duas linguagens visuais.
             */
            render: (e) =>
              e.outcome === 'ALLOW' ? (
                <EstadoSimples label="Liberado" tom="positivo" />
              ) : (
                <EstadoSimples label="Negado" tom="negativo" />
              ),
          },
          {
            key: 'motivo',
            header: 'Motivo',
            role: 'state',
            /*
             * `ROTULO_DE_RAZAO` morreu: as 8 frases estavam identicas ao
             * dicionario canonico, que as herdou desta tela por serem as que
             * dizem O QUE ACONTECEU ("o plano vale em outra unidade"), nao o
             * que o sistema concluiu.
             */
            render: (e) => <StateBadge machine="accessReason" state={e.reason} />,
          },
          { key: 'origem', header: 'Origem', role: 'state', render: (e) => traduzir(ROTULO_DE_MODO, e.mode) },
          { key: 'metodo', header: 'Método', role: 'state', render: (e) => traduzir(ROTULO_DE_METODO, e.method) },
          {
            key: 'passagem',
            header: 'Passagem',
            role: 'state',
            /*
             * `NOT_APPLICABLE` deixa de ser `'—'` e passa a dizer "Não confirma
             * giro" (PI, 16/08/2026): o travessao colapsava "equipamento nao
             * confirma giro" com "dado ausente", que e o oposto do que este
             * estado existe para impedir.
             */
            render: (e) =>
              e.passageState ? <StateBadge machine="passage" state={e.passageState} /> : <Ausente />,
          },
        ]}
        {...(pagina.proximoCursor ? { nextHref: proximaUrl() } : {})}
        empty={
          <EmptyState
            testId="sem-eventos"
            title="Nenhum evento no período."
            hint="Ajuste os filtros ou amplie o intervalo."
          />
        }
      />
    </section>
  );
}
