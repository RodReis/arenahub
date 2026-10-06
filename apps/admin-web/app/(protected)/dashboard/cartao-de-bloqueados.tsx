import type { CSSProperties } from 'react';

import { Icon } from '@arenahub/ui';

import { CartaoDePresenca } from './cartao-de-presenca';
import { doisNomes } from './dois-nomes';
import type { Recusado } from './recusados';
import estilos from './dashboard.module.css';

export interface SituacaoDoDashboard {
  status: string;
  motivo: string | null;
  quantidade: number;
  alunos: string[];
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

/** "Maria Clara" -> "MC". So decoracao: o nome vai escrito ao lado. */
function iniciais(nome: string): string {
  return nome
    .split(' ')
    .map((parte) => parte.charAt(0))
    .join('')
    .toUpperCase();
}

/** Pessoas com o cadastro travado -- o contador da aba "Bloqueados e suspensos". */
export function totalDeBloqueados(situacoes: readonly SituacaoDoDashboard[]): number {
  return situacoes.reduce((soma, situacao) => soma + situacao.quantidade, 0);
}

/**
 * Bloqueados e suspensos — F57, e quem a catraca recusou hoje.
 *
 * DUAS PERGUNTAS NO MESMO PAINEL, porque a recepção as faz juntas: "quem está
 * com o cadastro travado?" (status) e "quem foi barrado na porta hoje?"
 * (recusa na catraca). A segunda entrou por pedido do PI em 02/10/2026 —
 * barrado por plano vencido, sem identificação ou fora de horário não aparecia
 * em lugar nenhum do dashboard.
 *
 * Só o CONTEÚDO: desde 05/10/2026 (pedido do PI) o painel mora numa aba do
 * dashboard, e a aba é quem dá o título.
 *
 * Os recusados usam o MESMO cartão de pessoa do feed ao vivo (pedido do PI,
 * 05/10/2026): foto, nome -- ou o número da catraca de quem o leitor não
 * identificou -- e o motivo na faixa.
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
}: {
  situacoes: readonly SituacaoDoDashboard[];
  recusados?: readonly Recusado[];
  /** Relógio do feed -- obrigatório na prática quando há `recusados`. */
  agora?: number;
  timeZone: string;
}) {
  return (
    <>
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
        /*
         * UM BLOCO POR SITUACAO, tingido pelo tom do estado (emenda de
         * 05/10/2026, pedido do PI: "mais destaque, cores, efeitos"). Mesmo
         * tratamento do `PainelDeEstado`: aresta superior de 3 px, degrade que
         * some antes do meio, selo no tom -- o que o DS ja liberou para
         * qualquer tela com estado a comunicar (DS-PAINEL §4.6b).
         *
         * A cor e do ESTADO, nunca enfeite: bloqueado e `danger`, suspenso e
         * `warning`. Rotulo, motivo e numero continuam escritos.
         */
        <ul className={estilos['blocosDeSituacao']} data-testid="lista-de-situacoes">
          {situacoes.map((situacao, ordem) => (
            <li
              className={estilos['blocoDeSituacao']}
              key={`${situacao.status}-${situacao.motivo}`}
              data-tom={tomDaSituacao(situacao.status)}
              data-testid="bloco-de-situacao"
              style={{ '--ordem': ordem } as CSSProperties}
            >
              <div className={estilos['cabecalhoDaSituacao']}>
                <span className={estilos['seloDaSituacao']} aria-hidden="true">
                  <Icon name={situacao.status === 'BLOCKED' ? 'ban' : 'user-minus'} />
                </span>
                <span className={estilos['tituloDaSituacao']}>
                  <strong>{traduzir(ROTULO_DE_SITUACAO, situacao.status)}</strong>
                  <span
                    className={estilos['motivoDaSituacao']}
                    data-sem-motivo={situacao.motivo === null ? '' : undefined}
                  >
                    {traduzir(ROTULO_DE_MOTIVO, situacao.motivo)}
                  </span>
                </span>
                <span className={estilos['contagemDaSituacao']} data-testid="contagem-da-situacao">
                  {situacao.quantidade}
                </span>
              </div>
              {/*
                QUEM sao, nao so quantos: chips com iniciais. As iniciais sao
                `aria-hidden` -- quem usa leitor ouve o nome, nao "M C". Acima
                de cinco nomes, "+N" diz quantos faltam.
              */}
              {situacao.alunos.length > 0 ? (
                <ul className={estilos['pessoasDaSituacao']}>
                  {situacao.alunos.map((aluno) => {
                    const nome = doisNomes(aluno);

                    return (
                      <li key={aluno} className={estilos['pessoa']}>
                        <span className={estilos['iniciais']} aria-hidden="true">
                          {iniciais(nome)}
                        </span>
                        {nome}
                      </li>
                    );
                  })}
                  {situacao.quantidade > situacao.alunos.length ? (
                    <li className={estilos['maisPessoas']}>
                      +{situacao.quantidade - situacao.alunos.length}
                    </li>
                  ) : null}
                </ul>
              ) : null}
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
            Recusados na catraca hoje
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
