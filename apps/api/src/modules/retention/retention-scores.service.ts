import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { avaliarBaseline } from './domain/avaliar-baseline.js';
import { avaliarElegibilidade } from './domain/elegibilidade.js';
import { RetentionMonitoringService } from './retention-monitoring.service.js';
import {
  PORTA_DE_SCORES,
  type PortaDeScores,
  type SnapshotParaPontuar,
} from './retention-scores.repository.js';

/** O que uma rodada de scoring fez. Serve ao log de operacao e ao teste. */
export interface ResumoDaRodada {
  readonly pontuados: number;
  readonly pulados: number;
}

/**
 * Calculo do score explicavel do dia (F37, Slice 6.2).
 *
 * ---------------------------------------------------------------------------
 * DUAS DECISOES, NAO UMA
 * ---------------------------------------------------------------------------
 *
 * "Quanto risco tem este aluno" e "este aluno pode ser pontuado" sao perguntas
 * diferentes, e a segunda vem antes. Misturadas, a resposta natural para o
 * inelegivel seria score `0` -- e score `0` poe o suprimido no mesmo balde do
 * aluno saudavel, alem de fazer uma decisao de governanca parecer uma medicao
 * de risco baixo.
 *
 * Por isso o inelegivel produz uma LINHA DE PULO com a razao, nunca um score.
 * Sem essa linha, "nao pontuado" seria indistinguivel de "o job nao rodou", e as
 * duas exigem acoes opostas de quem opera.
 *
 * ---------------------------------------------------------------------------
 * O CATALOGO VEM DO BANCO, AS FAIXAS TAMBEM
 * ---------------------------------------------------------------------------
 *
 * O dominio tem faixas padrao, mas quem manda e a VERSAO carregada: mover o
 * corte de ALTO muda quem entra na fila sem mudar nenhum peso, e essa mudanca
 * precisa ficar gravada junto do score que ela produziu. Score antigo continua
 * explicavel pelas regras e pelos cortes que o produziram.
 */
@Injectable()
export class RetentionScoresService {
  constructor(
    @Inject(PORTA_DE_SCORES) private readonly porta: PortaDeScores,
    private readonly monitoramento: RetentionMonitoringService,
  ) {}

  /**
   * Pontua todos os snapshots de um dia.
   *
   * `observadoEm` entra por parametro -- funcao de calculo nao le relogio
   * (`CLAUDE.md`), e reprocessar um dia passado tem de dar o mesmo resultado
   * que a rodada original deu (`M6-AC-002`).
   */
  async pontuarDia(contexto: TenantContext, observadoEm: Date): Promise<ResumoDaRodada> {
    // KILL SWITCH (F41, `M6-FR-017`). Sai ANTES de carregar o catálogo: com o
    // scoring desligado não há por que ler nada.
    //
    // Não registra pulo. A linha de pulo existe para dizer POR QUE um aluno não
    // foi pontuado -- cancelado, suprimido, sem histórico --, e "o scoring está
    // desligado" não é propriedade do aluno. Gravar uma linha por aluno a cada
    // rodada encheria a tabela de ruído que perde o sentido quando religarem.
    //
    // O que NÃO para: scores já gravados seguem legíveis com marca de idade
    // (F37) e tarefas abertas seguem tratáveis (`M6-NFR-009`).
    if (!(await this.monitoramento.scoringLigado(contexto))) {
      return { pontuados: 0, pulados: 0 };
    }

    const catalogo = await this.porta.carregarCatalogo(contexto);
    const snapshots = await this.porta.snapshotsDoDia(contexto, observadoEm);

    let pontuados = 0;
    let pulados = 0;

    for (const snapshot of snapshots) {
      const resultado = avaliarBaseline(snapshot.valores, catalogo.regras, catalogo.faixas);

      const elegibilidade = avaliarElegibilidade(
        {
          statusDoAluno: snapshot.statusDoAluno,
          statusDaAssinatura: snapshot.statusDaAssinatura,
          completude: resultado.completude,
          supressoesVigentes: snapshot.supressoesVigentes,
        },
        { completudeMinima: catalogo.completudeMinima },
      );

      if (!elegibilidade.elegivel) {
        await this.porta.registrarPulo(contexto, {
          snapshotId: snapshot.snapshotId,
          studentId: snapshot.studentId,
          observadoEm: snapshot.observadoEm,
          razao: elegibilidade.razao,
        });
        pulados += 1;
        continue;
      }

      await this.porta.gravarScore(contexto, {
        snapshotId: snapshot.snapshotId,
        studentId: snapshot.studentId,
        versaoDeRegrasId: catalogo.versaoId,
        observadoEm: snapshot.observadoEm,
        valor: resultado.score,
        faixa: resultado.faixa,
        completude: resultado.completude,
        // Sempre nula na baseline -- PRD §16, nao mostrar probabilidade sem
        // calibracao. A F40 preenche quando (e se) calibrar.
        probabilidadeCalibrada: resultado.probabilidadeCalibrada,
        fatores: resultado.fatores.map((fator, indice) => ({
          posicao: indice + 1,
          regraId: fator.regraId,
          feature: fator.feature,
          valorObservado: fator.valor,
          contribuicao: fator.contribuicao,
          direcao: fator.direcao,
          rotulo: fator.rotulo,
        })),
      });
      pontuados += 1;
    }

    return { pontuados, pulados };
  }
}

export type { SnapshotParaPontuar };
