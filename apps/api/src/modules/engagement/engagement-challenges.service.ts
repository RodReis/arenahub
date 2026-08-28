import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import {
  avaliarLimiteDoTemplate,
  desfechoDaParticipacao,
  podeInscrever,
  progressoNoDesafio,
} from './domain/desafio.js';
import {
  PORTA_DE_DESAFIOS,
  type AvisoParaGravar,
  type DesafioDaListagem,
  type PortaDeDesafios,
} from './engagement-challenges.repository.js';

/** Um desafio como o aluno o ve no totem. */
export interface DesafioDoAluno {
  id: string;
  title: string;
  meta: number;
  progresso: number;
  inscrito: boolean;
  startsOn: string;
  endsOn: string;
}

export interface AvisoDoAlunoDto {
  id: string;
  challengeTitle: string;
  kind: 'DISPONIVEL' | 'CONCLUIDO' | 'ENCERRADO_SEM_META';
  lido: boolean;
}

/**
 * Desafios (F34, Slice 5.5, ADR-048).
 *
 * O "agora" entra por parametro em todo metodo publico -- `CLAUDE.md`,
 * "funcoes de calculo puras; o agora entra por parametro". O service e a
 * casca de I/O; a decisao mora em `domain/desafio.ts`.
 */
@Injectable()
export class EngagementChallengesService {
  constructor(
    @Inject(PORTA_DE_DESAFIOS) private readonly porta: PortaDeDesafios,
  ) {}

  /**
   * A secretaria cria o desafio a partir de um template vigente.
   *
   * O teto profissional (`M5-BR-011`) e conferido AQUI, contra a versao do
   * template, e o desafio guarda `templateVersionId` -- editar o template
   * depois nao altera desafio em curso (`M5-BR-009`).
   */
  async criar(
    ctx: TenantContext,
    entrada: {
      templateVersionId: string;
      gymUnitId: string | null;
      title: string;
      targetValue: number;
      startsOn: string;
      endsOn: string;
    },
  ): Promise<{ id: string }> {
    const template = await this.porta.templateVigentePorId(ctx, entrada.templateVersionId);

    if (!template) {
      throw new NotFoundException({
        code: 'CHALLENGE_TEMPLATE_NAO_ENCONTRADO',
        message: 'Template de desafio nao encontrado ou nao vigente',
      });
    }

    const avaliacao = avaliarLimiteDoTemplate(template.limite, {
      inicio: entrada.startsOn,
      fim: entrada.endsOn,
      meta: entrada.targetValue,
    });

    if (!avaliacao.permitido) {
      /*
       * 400 com codigo estavel, o padrao desta base -- nenhum modulo usa 422
       * hoje, e estrear um aqui obrigaria o painel a tratar dois formatos de
       * recusa para o mesmo tipo de erro. O que distingue os casos e o
       * `code`, nao o status.
       */
      throw new BadRequestException({
        code: `CHALLENGE_${avaliacao.motivo}`,
        message: this.mensagemDaRecusa(avaliacao.motivo, template.limite.maxSessoesPorSemana),
      });
    }

    const desafio = await this.porta.criarDesafio(ctx, {
      templateVersionId: template.id,
      gymUnitId: entrada.gymUnitId,
      title: entrada.title,
      targetValue: entrada.targetValue,
      startsOn: entrada.startsOn,
      endsOn: entrada.endsOn,
    });

    return { id: desafio.id };
  }

  /**
   * Os desafios do tenant, para a tela da secretaria.
   *
   * Inclui RASCUNHO: e o estado que ela precisa encontrar para abrir. Sem
   * isto, o desafio criado sumia da tela no refresh e ficava inalcancavel --
   * o dado estava no banco, mas nao havia caminho ate ele.
   */
  async listar(ctx: TenantContext, limite = 50): Promise<DesafioDaListagem[]> {
    return this.porta.listarDoTenant(ctx, limite);
  }

  async ativar(ctx: TenantContext, challengeId: string): Promise<void> {
    const desafio = await this.porta.desafioPorId(ctx, challengeId);

    if (!desafio) throw this.desafioNaoEncontrado();

    if (desafio.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'CHALLENGE_JA_ATIVADO',
        message: 'Este desafio nao esta em rascunho',
      });
    }

    await this.porta.ativarDesafio(ctx, challengeId);
  }

  /**
   * Os desafios abertos para o aluno, com o progresso dele em cada um.
   *
   * `inscrito: false` e o padrao -- OPT-IN (ADR-048, Decisao 2). A ausencia de
   * participacao significa NAO INSCRITO, o oposto de `participaDoRanking()`.
   */
  async paraOAluno(
    ctx: TenantContext,
    studentId: string,
    gymUnitId: string | null,
    hoje: string,
  ): Promise<DesafioDoAluno[]> {
    const desafios = await this.porta.desafiosAbertos(ctx, gymUnitId, hoje);

    return Promise.all(
      desafios.map(async (desafio) => {
        const participacao = await this.porta.participacao(ctx, desafio.id, studentId);
        const inscrito = participacao?.status === 'JOINED' || participacao?.status === 'COMPLETED';

        /*
         * Progresso so e calculado para quem esta inscrito. Quem nao aderiu
         * ainda ve a meta, nao um numero que ele nao pediu para ser medido --
         * e a leitura de sessao custa uma consulta por desafio.
         */
        const progresso = inscrito
          ? progressoNoDesafio(
              await this.porta.diasTreinadosNaJanela(ctx, studentId, {
                inicio: desafio.startsOn,
                fim: desafio.endsOn,
                gymUnitId: desafio.gymUnitId,
              }),
              { inicio: desafio.startsOn, fim: desafio.endsOn },
            )
          : 0;

        return {
          id: desafio.id,
          title: desafio.title,
          meta: desafio.targetValue,
          progresso,
          inscrito,
          startsOn: desafio.startsOn,
          endsOn: desafio.endsOn,
        };
      }),
    );
  }

  /**
   * Desafios em que ESTE aluno esta inscrito e cuja janela ja fechou.
   *
   * Alimenta a apuracao sob demanda do totem (ADR-048, Decisao 3): sem canal
   * externo nao ha o que "enviar" num horario, entao nao ha agendador -- quem
   * dispara a apuracao e o proprio aluno ao abrir a aba.
   *
   * A varredura e do ALUNO, nao do tenant: um `encerrar()` de todos os
   * desafios vencidos a cada abertura de totem faria o custo crescer com o
   * numero de desafios da academia, nao com o do aluno na frente da tela.
   */
  async pendentesDeApuracao(
    ctx: TenantContext,
    studentId: string,
    hoje: string,
  ): Promise<{ id: string }[]> {
    const vencidos = await this.porta.desafiosVencidosDoAluno(ctx, studentId, hoje);

    return vencidos.map((d) => ({ id: d.id }));
  }

  async inscrever(
    ctx: TenantContext,
    challengeId: string,
    studentId: string,
    hoje: string,
  ): Promise<void> {
    const desafio = await this.porta.desafioPorId(ctx, challengeId);

    if (!desafio) throw this.desafioNaoEncontrado();

    const participacao = await this.porta.participacao(ctx, challengeId, studentId);
    const avaliacao = podeInscrever(
      { status: desafio.status, inicio: desafio.startsOn, fim: desafio.endsOn },
      participacao,
      hoje,
    );

    if (!avaliacao.permitido) {
      throw new ConflictException({
        code: `CHALLENGE_${avaliacao.motivo}`,
        message: this.mensagemDaInscricao(avaliacao.motivo),
      });
    }

    await this.porta.inscrever(ctx, challengeId, studentId);
  }

  /**
   * O aluno sai do desafio (`M5-FR-014`).
   *
   * Nao lanca quando ele ja nao esta inscrito: sair de onde nao se esta e o
   * estado desejado, e um erro aqui so faria a tela do totem mostrar falha
   * para uma acao que nao precisava acontecer.
   */
  async sair(ctx: TenantContext, challengeId: string, studentId: string): Promise<void> {
    const desafio = await this.porta.desafioPorId(ctx, challengeId);

    if (!desafio) throw this.desafioNaoEncontrado();

    await this.porta.sair(ctx, challengeId, studentId);
  }

  /**
   * Encerra o desafio: apura cada participante e grava os avisos.
   *
   * IDEMPOTENTE. Os avisos colidem na unique `(desafio, aluno, tipo)` e sao
   * ignorados no replay; as atualizacoes de participante filtram por
   * `status: 'JOINED'`, entao rodar duas vezes nao reescreve quem ja foi
   * apurado.
   */
  async encerrar(
    ctx: TenantContext,
    challengeId: string,
    agora: Date,
    hoje: string,
  ): Promise<{ concluidos: number; reprovados: number }> {
    const desafio = await this.porta.desafioPorId(ctx, challengeId);

    if (!desafio) throw this.desafioNaoEncontrado();

    const participantes = await this.porta.participantesEmCurso(ctx, challengeId);
    const janelaFechada = hoje > desafio.endsOn;
    const avisos: AvisoParaGravar[] = [];

    let concluidos = 0;
    let reprovados = 0;

    for (const participante of participantes) {
      const dias = await this.porta.diasTreinadosNaJanela(ctx, participante.studentId, {
        inicio: desafio.startsOn,
        fim: desafio.endsOn,
        gymUnitId: desafio.gymUnitId,
      });

      const desfecho = desfechoDaParticipacao({
        progresso: progressoNoDesafio(dias, {
          inicio: desafio.startsOn,
          fim: desafio.endsOn,
        }),
        meta: desafio.targetValue,
        janelaFechada,
      });

      if (desfecho === 'COMPLETED') {
        await this.porta.concluirParticipacao(ctx, participante.participantId, agora);
        avisos.push({
          challengeId,
          studentId: participante.studentId,
          kind: 'CONCLUIDO',
        });
        concluidos += 1;
      } else if (desfecho === 'FAILED') {
        await this.porta.reprovarParticipacao(ctx, participante.participantId);
        avisos.push({
          challengeId,
          studentId: participante.studentId,
          kind: 'ENCERRADO_SEM_META',
        });
        reprovados += 1;
      }
    }

    await this.porta.gravarAvisos(ctx, avisos);

    // O desafio so fecha quando a janela acabou. Apurar no meio conclui quem
    // ja bateu a meta sem impedir os outros de continuarem.
    if (janelaFechada) await this.porta.fecharDesafio(ctx, challengeId, agora);

    return { concluidos, reprovados };
  }

  async avisos(ctx: TenantContext, studentId: string): Promise<AvisoDoAlunoDto[]> {
    const linhas = await this.porta.avisosDoAluno(ctx, studentId);

    return linhas.map((l) => ({
      id: l.id,
      challengeTitle: l.challengeTitle,
      kind: l.kind,
      lido: l.readAt !== null,
    }));
  }

  async marcarComoLidos(ctx: TenantContext, studentId: string, ids: string[]): Promise<void> {
    await this.porta.marcarAvisosComoLidos(ctx, studentId, ids);
  }

  private desafioNaoEncontrado(): NotFoundException {
    return new NotFoundException({
      code: 'CHALLENGE_NAO_ENCONTRADO',
      message: 'Desafio nao encontrado',
    });
  }

  private mensagemDaRecusa(motivo: string, tetoSemanal: number): string {
    switch (motivo) {
      case 'FREQUENCIA_ACIMA_DO_LIMITE':
        return `A meta exige mais de ${String(tetoSemanal)} treinos por semana, acima do limite do template`;
      case 'JANELA_LONGA_DEMAIS':
        return 'A janela e mais longa do que o template permite';
      case 'JANELA_INVALIDA':
        return 'A data final e anterior a inicial';
      default:
        return 'A meta precisa ser um numero inteiro positivo';
    }
  }

  private mensagemDaInscricao(motivo: string): string {
    switch (motivo) {
      case 'JA_INSCRITO':
        return 'Voce ja esta inscrito neste desafio';
      case 'FORA_DA_JANELA':
        return 'Este desafio nao esta no periodo de inscricao';
      default:
        return 'Este desafio nao esta aberto a inscricao';
    }
  }
}
