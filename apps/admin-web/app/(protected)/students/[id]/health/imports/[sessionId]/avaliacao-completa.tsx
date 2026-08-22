import { PageHeader, ProblemDetail } from '@arenahub/ui';

import { chamarApi } from '../../../../../../../lib/api/server-client';
import { AchadoDoEcg } from './achado-do-ecg';
import { AvisoDeExtracao } from './aviso-de-extracao';
import { CabecalhoDaSessao } from './cabecalho-da-sessao';
import { CartoesDeArquivo } from './cartoes-de-arquivo';
import { HistoricoDeComposicao, type MesDoHistorico } from './historico-de-composicao';
import { MetasEControle } from './metas-e-controle';
import type { AnaliseDeAcompanhamento } from './painel-de-analise';
import { PainelDeAnalise } from './painel-de-analise';
import { PainelDeSegmentos, type MedidaDoSegmento, type RegiaoCorporal } from './painel-de-segmentos';
import { ValoresDaAvaliacao } from './valores-da-avaliacao';
import estilos from './sessao.module.css';
import {
  atributosDoAparelho,
  cartoesDeArquivo,
  recomendacoesDoAparelho,
  type SessaoDeRevisao,
} from './sessao';

interface Aluno {
  fullName: string;
  birthDate: string;
  membershipNumber: string;
}

interface EvolucaoCorporalDto {
  months: {
    assessedAtLocal: string;
    regions: Record<RegiaoCorporal, MedidaDoSegmento>;
    metrics: { type: string; value: number; unit: string | null; reading: string }[];
  }[];
}

interface UltimaAnaliseDto {
  generatedAt: string;
  analysis: {
    summary: string;
    positivePoints: readonly string[];
    attentionPoints: readonly string[];
    questionsForProfessional: readonly string[];
  };
}

/**
 * `body-evolution` não devolve o fuso da unidade -- só `health-progress` o
 * expõe hoje (`historico.timezone`, usado em `health/page.tsx`). Buscamos
 * essa rota só por este campo em vez de fixar `'America/Sao_Paulo'`, que a
 * regra 5 de lint proíbe e o `DS-PAINEL.md` §9 (`TenantDateTime`) exige vir
 * da unidade, nunca hardcoded.
 */
interface HistoricoDeSaudeDto {
  timezone: string;
}

/** Métrica `HEIGHT` mais recente de `body-evolution` -- último mês que a trouxer. */
function alturaMaisRecente(months: EvolucaoCorporalDto['months']): number | null {
  for (let i = months.length - 1; i >= 0; i -= 1) {
    const altura = months[i]?.metrics.find((m) => m.type === 'HEIGHT');

    if (altura !== undefined) return altura.value;
  }

  return null;
}

/** Região do mês mais recente -- os cinco segmentos que alimentam os dois painéis. */
function regioesMaisRecentes(
  months: EvolucaoCorporalDto['months'],
): Record<RegiaoCorporal, MedidaDoSegmento> | null {
  return months.at(-1)?.regions ?? null;
}

/**
 * A avaliação completa de UMA medição -- a tela inteira, menos a rota.
 *
 * ---------------------------------------------------------------------------
 * UM COMPONENTE, DOIS CAMINHOS ATÉ ELE.
 * ---------------------------------------------------------------------------
 *
 * `/students/:id/health` (a saúde do aluno, com o seletor de medição) e
 * `/students/:id/health/imports/:sessionId` (link direto para uma medição)
 * renderizam ISTO. Não são duas telas parecidas que precisam ser mantidas em
 * paralelo -- é a mesma tela, e um ajuste aqui aparece nos dois lugares.
 *
 * O componente busca os próprios dados (Server Component): quem o usa passa
 * `studentId` e `sessionId`, e nada mais. `cabecalho` permite à página de
 * saúde inserir o seletor de medição entre o título e a avaliação, sem que
 * este arquivo precise saber que ele existe.
 */
interface PropsDaAvaliacao {
  readonly studentId: string;
  readonly sessionId: string;
  /** Conteúdo entre o título e o corpo da avaliação -- o seletor de medição. */
  readonly cabecalho?: React.ReactNode;
  /** O link de volta, que difere entre as duas rotas. */
  readonly rodape?: React.ReactNode;
}

export async function AvaliacaoCompleta({
  studentId: id,
  sessionId,
  cabecalho,
  rodape,
}: PropsDaAvaliacao) {
  const [
    respostaDoAluno,
    respostaDaSessao,
    respostaDaEvolucao,
    respostaDaAnalise,
    respostaDoFuso,
    respostaDoAceite,
  ] = await Promise.all([
    chamarApi<Aluno>(`/api/v1/students/${id}`),
    chamarApi<SessaoDeRevisao>(`/api/v1/assessment-imports/sessions/${sessionId}`),
    chamarApi<EvolucaoCorporalDto>(`/api/v1/students/${id}/body-evolution?period=ALL`),
    chamarApi<UltimaAnaliseDto>(`/api/v1/students/${id}/ai-analyses/latest`),
    chamarApi<HistoricoDeSaudeDto>(`/api/v1/students/${id}/health-progress?period=30D`),
    // Por que NAO ha analise. `latest` responde 404 sem motivo, e a tela
    // precisa distinguir "ainda nao ha" de "o aluno nao consentiu".
    chamarApi<{ autorizado: boolean; motivo: string | null }>(
      `/api/v1/students/${id}/ai-analyses/consent`,
    ),
  ]);

  if (!respostaDoAluno.ok || !respostaDoAluno.dados) {
    const codigo = respostaDoAluno.erro?.code ?? 'erro';

    return (
      <section aria-labelledby="titulo-revisao-erro">
        <PageHeader id="titulo-revisao-erro" title="Avaliação" />
        <ProblemDetail
          testId={codigo === 'STUDENT_NOT_FOUND' ? 'aluno-nao-encontrado' : 'erro-do-aluno'}
          problem={{
            ...(respostaDoAluno.erro ?? {
              type: 'about:blank',
              status: 0,
              code: codigo,
              correlationId: '',
            }),
            title:
              codigo === 'STUDENT_NOT_FOUND'
                ? 'Aluno não encontrado nesta academia.'
                : `Não foi possível abrir esta revisão (${codigo}).`,
          }}
        />
      </section>
    );
  }

  const aluno = respostaDoAluno.dados;

  if (!respostaDaSessao.ok || !respostaDaSessao.dados) {
    const codigo = respostaDaSessao.erro?.code ?? 'erro';

    return (
      <section aria-labelledby="titulo-revisao-erro">
        <PageHeader id="titulo-revisao-erro" title={`Avaliação — ${aluno.fullName}`} />
        <ProblemDetail
          testId={codigo === 'SESSION_NOT_FOUND' ? 'sessao-nao-encontrada' : 'erro-da-sessao'}
          problem={{
            ...(respostaDaSessao.erro ?? {
              type: 'about:blank',
              status: 0,
              code: codigo,
              correlationId: '',
            }),
            title:
              codigo === 'SESSION_NOT_FOUND'
                ? 'Avaliação não encontrada.'
                : `Não foi possível carregar os arquivos desta sessão (${codigo}).`,
          }}
        />
        <p>
          <a href={`/students/${id}/health`}>Voltar para a evolução corporal</a>
        </p>
      </section>
    );
  }

  const sessao = respostaDaSessao.dados;
  const linhas = sessao.linhas;

  // URL assinada de cada laudo, para a MINIATURA (ADR-041). Em paralelo: sao
  // consultas independentes, e serializa-las somaria a latencia de tres
  // chamadas ao tempo de abertura da tela.
  //
  // Falha aqui NAO derruba a pagina -- o cartao cai para "sem previa", que e
  // exatamente o mesmo tratamento do arquivo ja expurgado. Os valores da
  // avaliacao, que sao o conteudo principal, nao dependem disso.
  const urls = new Map(
    await Promise.all(
      sessao.arquivos.map(async (arquivo) => {
        const resposta = await chamarApi<{ url: string | null; contentType: string | null }>(
          `/api/v1/assessment-imports/${arquivo.importId}/file-url`,
        );

        return [
          arquivo.importId,
          resposta.ok && resposta.dados
            ? resposta.dados
            : { url: null, contentType: null },
        ] as const;
      }),
    ),
  );

  const cartoes = cartoesDeArquivo(sessao.arquivos, linhas, urls);

  // Evolução corporal e análise de IA são consultas AUXILIARES desta tela --
  // cabeçalho (altura), segmentos, histórico e o painel de análise. Uma
  // falha nelas não pode derrubar a revisão inteira, que é o que importa
  // agora: os painéis auxiliares degradam para vazio/ausente, e a revisão
  // continua funcionando.
  const evolucao = respostaDaEvolucao.ok ? (respostaDaEvolucao.dados ?? null) : null;
  const meses: MesDoHistorico[] = (evolucao?.months ?? []).map((mes) => ({
    assessedAtLocal: mes.assessedAtLocal,
    metrics: mes.metrics.map((m) => ({ type: m.type, value: m.value })),
  }));
  const alturaCm = evolucao ? alturaMaisRecente(evolucao.months) : null;
  const regioes = evolucao ? regioesMaisRecentes(evolucao.months) : null;

  // 404 (`AI_ANALYSIS_NOT_FOUND`) e "nunca houve análise" -- não é erro desta
  // tela, é o estado normal de um aluno sem análise ainda.
  const analise: AnaliseDeAcompanhamento | null =
    respostaDaAnalise.ok && respostaDaAnalise.dados
      ? {
          summary: respostaDaAnalise.dados.analysis.summary,
          positivePoints: respostaDaAnalise.dados.analysis.positivePoints,
          attentionPoints: respostaDaAnalise.dados.analysis.attentionPoints,
          questionsForProfessional: respostaDaAnalise.dados.analysis.questionsForProfessional,
          generatedAt: respostaDaAnalise.dados.generatedAt,
        }
      : null;

  // O cartão do ECG desta sessão -- o painel precisa saber se o arquivo veio,
  // e se veio, se o extrator conseguiu lê-lo.
  const cartaoDoEcg = cartoes.find((cartao) => cartao.tipoDeLaudo === 'ECG');
  const fuso = respostaDoFuso.ok ? (respostaDoFuso.dados?.timezone ?? 'UTC') : 'UTC';

  return (
    <section aria-labelledby="titulo-revisao">
      <PageHeader id="titulo-revisao" title={`Avaliação — ${aluno.fullName}`} />

      {cabecalho}

      <CabecalhoDaSessao
        dados={{
          fullName: aluno.fullName,
          birthDate: aluno.birthDate,
          membershipNumber: aluno.membershipNumber,
          alturaCm,
        }}
        agora={new Date()}
      />

      {/*
        O que fica FORA das abas é o que vale em qualquer uma: de quais
        laudos a avaliação nasceu, o aviso de que os valores foram extraídos
        automaticamente, e a análise. Enfiar o aviso numa aba só o esconderia
        de quem abre as outras três.
      */}
      <CartoesDeArquivo cartoes={cartoes} />

      <AvisoDeExtracao />

      {/*
        UMA PÁGINA, ROLAGEM CONTÍNUA -- sem abas.
        ---------------------------------------------------------------------
        As quatro abas anteriores (`Valores`/`Segmentos`/`Histórico`/`ECG`)
        escondiam três quartos da avaliação atrás de um clique, e deixavam a
        análise ao lado de um conteúdo só. Quem confere um laudo lê tudo na
        mesma passada: o valor extraído, o segmento correspondente, o
        histórico que diz se aquilo é novidade. Aba obriga a decorar a linha
        de cima para comparar com a de baixo.

        A ordem é a da leitura: os 67 campos primeiro (é o que se confere
        contra o papel), depois os segmentos, depois o histórico. A coluna
        direita acompanha a rolagem (`.colunaLateral`) porque é consulta de
        apoio DURANTE a conferência, não leitura anterior a ela.
      */}
      <div className={estilos['tela']}>
        <div className={estilos['conteudo']}>
          <ValoresDaAvaliacao linhas={linhas} />

          <div className={estilos['paineisCompletos']}>
            <PainelDeSegmentos
              titulo="Gordura por segmento"
              regioes={regioes}
              chave="fat"
              testId="painel-gordura"
            />
            <PainelDeSegmentos
              titulo="Massa muscular por segmento"
              regioes={regioes}
              chave="muscle"
              testId="painel-musculo"
            />
          </div>

          <HistoricoDeComposicao meses={meses} />
        </div>

        <div className={estilos['colunaLateral']}>
          <PainelDeAnalise
            analise={analise}
            timeZone={fuso}
            motivoDaAusencia={respostaDoAceite.ok ? (respostaDoAceite.dados?.motivo ?? null) : null}
          />

          {/*
            O achado do ECG sai da aba e vem para cá: é o item que MAIS pede
            ação de quem lê ("exige leitura médica") e era o mais escondido
            dos quatro. Ao lado da análise, ele é visto junto do resto do
            quadro clínico, que é como a conversa com o profissional acontece.
          */}
          <AchadoDoEcg
            atributos={atributosDoAparelho(sessao)}
            {...(cartaoDoEcg === undefined
              ? {}
              : {
                  arquivo: {
                    estado: cartaoDoEcg.estado,
                    motivoDaFalha: cartaoDoEcg.motivoDaFalha,
                  },
                })}
          />

          <MetasEControle deviceReport={recomendacoesDoAparelho(sessao)} />
        </div>
      </div>

      {rodape}
    </section>
  );
}
