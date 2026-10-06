import type { CSSProperties } from 'react';
import Link from 'next/link';

import { Icon, iniciaisDe } from '@arenahub/ui';

import { CartaoDePresenca } from './cartao-de-presenca';
import { doisNomes } from './dois-nomes';
import type { Recusado } from './recusados';
import estilos from './dashboard.module.css';

export interface PessoaRestrita {
  id: string;
  nome: string;
  temFoto: boolean;
  nota: string | null;
}

export interface SituacaoDoDashboard {
  status: string;
  motivo: string | null;
  quantidade: number;
  alunos: PessoaRestrita[];
}

/** Os quatro motivos da lista fechada da issue #241. */
const ROTULO_DE_MOTIVO: Record<string, string> = {
  DELINQUENCY: 'Inadimplência',
  STUDENT_REQUEST: 'Pedido do aluno',
  MEDICAL: 'Atestado médico',
  CONDUCT: 'Conduta',
};

const ROTULO_DE_SITUACAO: Record<string, string> = {
  SUSPENDED: 'Suspenso',
  BLOCKED: 'Bloqueado',
};

function traduzir(mapa: Record<string, string>, chave: string | null): string {
  /*
   * `null` acontece de verdade e não é erro: quem foi bloqueado ANTES de o
   * campo existir (issue #241) não tem razão gravada, e os alunos importados
   * do Pacto são todos assim. Esconder a linha faria a soma das partes não
   * bater com o total que a grid de alunos mostra.
   */
  if (chave === null) return 'Motivo não informado';

  return mapa[chave] ?? chave;
}

/** Tom do estado: bloqueado e o problema mais duro (`danger`), suspenso e pausa (`warning`). */
function tomDaSituacao(status: string): 'danger' | 'warning' {
  return status === 'BLOCKED' ? 'danger' : 'warning';
}

const ROTULO_DE_PLURAL: Record<string, string> = {
  SUSPENDED: 'suspensos',
  BLOCKED: 'bloqueados',
};

/** Quantas pessoas de cada status o repositório deixou fora dos cartões (teto por grupo). */
function pessoasQueFaltam(situacoes: readonly SituacaoDoDashboard[]): Map<string, number> {
  const faltam = new Map<string, number>();

  for (const s of situacoes) {
    const resto = s.quantidade - s.alunos.length;

    if (resto > 0) faltam.set(s.status, (faltam.get(s.status) ?? 0) + resto);
  }

  return faltam;
}

function linkDaGrid(status: string, gymUnitId: string | undefined): string {
  const consulta = new URLSearchParams({ status });

  if (gymUnitId) consulta.set('gymUnitId', gymUnitId);

  return `/students?${consulta.toString()}`;
}

/** Pessoas com o cadastro travado -- o KPI "Restrições" e a primeira metade do contador da aba. */
export function totalDeBloqueados(situacoes: readonly SituacaoDoDashboard[]): number {
  return situacoes.reduce((soma, situacao) => soma + situacao.quantidade, 0);
}

/**
 * Uma pessoa com o cadastro travado, no MESMO molde do cartão de recusa
 * (pedido do PI, 06/10/2026): faixa no tom do estado, foto sobreposta, nome e,
 * no rodapé, o MOTIVO -- a pergunta da recepção é "por que ele não passa?".
 *
 * Sem motivo gravado (importados do Pacto, ou travados antes da issue #241) o
 * rodapé diz isso por escrito e aponta a saída: informar na ficha. O cartão
 * inteiro já leva à ficha, então a pista não é um segundo link.
 */
function CartaoDeRestricao({
  pessoa,
  status,
  motivo,
  ordem,
}: {
  pessoa: PessoaRestrita;
  status: string;
  motivo: string | null;
  ordem: number;
}) {
  const semMotivo = motivo === null;
  const situacao = traduzir(ROTULO_DE_SITUACAO, status);
  const ficha = `/students/${pessoa.id}`;
  const avatar = (
    <>
      <span className={estilos['avatarDePresenca']}>
        {pessoa.temFoto ? (
          <img src={`/fotos-de-aluno/${pessoa.id}`} alt="" loading="lazy" />
        ) : (
          iniciaisDe(pessoa.nome)
        )}
      </span>
      <span className={estilos['pontoDePresenca']} />
    </>
  );

  return (
    <li
      className={`${estilos['cartaoDePresenca']} ${estilos['cartaoDeRestricao']}`}
      data-tom={tomDaSituacao(status)}
      data-testid="cartao-de-restricao"
      style={{ '--ordem': ordem } as CSSProperties}
    >
      <span className={estilos['faixaDePresenca']}>
        <Icon name={status === 'BLOCKED' ? 'ban' : 'user-minus'} />
        <span className={estilos['rotuloDaFaixa']} title={situacao}>
          {situacao}
        </span>
      </span>

      <Link className={estilos['molduraDoAvatar']} href={ficha} tabIndex={-1} aria-hidden="true">
        {avatar}
      </Link>

      <span className={estilos['nomeDePresenca']}>
        <Link className={estilos['linkDoCartao']} href={ficha}>
          {doisNomes(pessoa.nome)}
        </Link>
      </span>

      <dl className={estilos['rodapeDeRestricao']} data-sem-motivo={semMotivo ? '' : undefined}>
        <dt>Motivo</dt>
        <dd className={estilos['motivoDoCartao']}>
          {semMotivo ? 'Sem motivo registrado' : traduzir(ROTULO_DE_MOTIVO, motivo)}
        </dd>
        {pessoa.nota ? (
          <dd className={estilos['notaDoMotivo']} title={pessoa.nota}>
            {pessoa.nota}
          </dd>
        ) : null}
        {semMotivo ? (
          <dd className={estilos['pistaDoMotivo']}>
            Informar na ficha <span aria-hidden="true">→</span>
          </dd>
        ) : null}
      </dl>
    </li>
  );
}

/**
 * Restrições e recusas — F57.
 *
 * DUAS PERGUNTAS NO MESMO PAINEL, porque a recepção as faz juntas, e cada uma
 * com o seu título (o contador da aba soma as duas, e sem título a soma
 * parecia erro: 2 + 2 era lido como "4 bloqueados"):
 *
 *  - "Cadastro travado": quem está BLOQUEADO ou SUSPENSO no status do aluno --
 *    o mesmo número do KPI "Restrições";
 *  - "Barrados na catraca hoje": quem a catraca recusou -- o mesmo número do
 *    KPI "Recusas hoje". Entrou por pedido do PI em 02/10/2026: barrado por
 *    plano vencido, sem identificação ou fora de horário não aparecia em lugar
 *    nenhum do dashboard.
 *
 * Só o CONTEÚDO: desde 05/10/2026 (pedido do PI) o painel mora numa aba do
 * dashboard, e a aba é quem dá o título.
 *
 * Os DOIS grupos usam o mesmo cartão de pessoa do feed ao vivo (pedido do PI,
 * 05/10 e 06/10/2026): foto, nome -- ou o número da catraca de quem o leitor
 * não identificou -- e a razão. No cadastro travado, a razão é o motivo
 * gravado no status; no barrado, a razão da decisão de acesso.
 *
 * Sem `'use client'`: o Server Component e o feed ao vivo usam o mesmo painel.
 * Quem passa `recusados` é o feed, que já recarrega a cada 5 s — a lista anda
 * sozinha sem um segundo ciclo de consulta.
 */
export function ConteudoDeBloqueados({
  situacoes,
  recusados,
  agora = 0,
  timeZone,
  gymUnitId,
}: {
  situacoes: readonly SituacaoDoDashboard[];
  recusados?: readonly Recusado[];
  /** Relógio do feed -- obrigatório na prática quando há `recusados`. */
  agora?: number;
  timeZone: string;
  /** Unidade do painel: o "+N" abre a grid dela, não a do tenant inteiro. */
  gymUnitId?: string;
}) {
  const total = totalDeBloqueados(situacoes);
  const faltamPorStatus = pessoasQueFaltam(situacoes);
  let ordem = 0;

  return (
    <>
      <h3 className={estilos['subtituloDoCartao']}>
        <Icon name="user-x" />
        Cadastro travado
        {total > 0 ? (
          <span className={estilos['contagemDeRecusas']} data-testid="contagem-de-restritos">
            {total} {total === 1 ? 'pessoa' : 'pessoas'}
          </span>
        ) : null}
      </h3>

      {situacoes.length === 0 ? (
        <div className={estilos['vazio']}>
          <span className={estilos['iconeDoVazio']} data-tom="success">
            <Icon name="check-circle" />
          </span>
          <span className={estilos['textoDoVazio']}>
            Ninguém bloqueado ou suspenso — todo mundo com acesso liberado.
          </span>
        </div>
      ) : (
        <ul className={estilos['gradeDePresenca']} data-testid="lista-de-situacoes">
          {situacoes.flatMap((situacao) =>
            situacao.alunos.map((pessoa) => (
              <CartaoDeRestricao
                key={pessoa.id}
                pessoa={pessoa}
                status={situacao.status}
                motivo={situacao.motivo}
                ordem={ordem++}
              />
            )),
          )}
          {/*
            O repositório entrega até cinco pessoas por grupo; o resto vira um
            cartão "+N" POR STATUS, que abre a grid da unidade já filtrada por
            ele. É por status e não por grupo porque é o que a grid sabe
            filtrar: o motivo não é filtro, e um "+3 · Conduta" que abrisse
            todos os bloqueados prometeria um número que a tela não mostra.
          */}
          {[...faltamPorStatus].map(([status, faltam]) => (
            <li key={`mais-${status}`} className={estilos['maisRestritos']} data-tom={tomDaSituacao(status)}>
              <Link href={linkDaGrid(status, gymUnitId)}>
                +{faltam}
                <span>{ROTULO_DE_PLURAL[status] ?? status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {situacoes.some((s) => s.motivo === null) ? (
        <p className={estilos['apoio']}>
          <Icon name="alert-circle" />
          Sem motivo são de antes do campo existir. Informe na ficha do aluno.
        </p>
      ) : null}

      {recusados === undefined ? null : (
        <>
          <h3 className={estilos['subtituloDoCartao']}>
            <Icon name="ban" />
            Barrados na catraca hoje
            {recusados.length > 0 ? (
              <span className={estilos['contagemDeRecusas']} data-testid="contagem-de-recusados">
                {recusados.length} {recusados.length === 1 ? 'recusado' : 'recusados'} hoje
              </span>
            ) : null}
          </h3>
          {recusados.length === 0 ? (
            <p className={estilos['apoio']}>
              <Icon name="check-circle" />
              Ninguém recusado na catraca hoje.
            </p>
          ) : (
            <ul className={estilos['gradeDePresenca']} data-testid="recusados-de-hoje">
              {recusados.map((recusado) => (
                <CartaoDePresenca
                  key={recusado.chave}
                  evento={recusado.evento}
                  agora={agora}
                  timeZone={timeZone}
                  vezes={recusado.vezes}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
