import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import {
  atividadeDeEngajamento,
  diasDesdeUltimaAvaliacao,
  diasDesdeUltimaPassagem,
  diasEmAtraso,
  diasParaTerminoDaAssinatura,
  diasTreinados,
  falhasDePagamento,
  idadeDaAssinatura,
  invoicesVencidas,
  pausasNaJanela,
  variacaoDeFrequencia,
} from './domain/features.js';
import { diasEntre, type RecorteDeSnapshot } from './domain/janela-as-of.js';
import { montarSnapshot, type SnapshotDeFeatures } from './domain/snapshot.js';
import { ausente, type ValorDeFeature } from './domain/valor-de-feature.js';
import { PORTA_DE_RETENCAO, type FatosDoAluno, type PortaDeRetencao } from './retention-snapshots.repository.js';

/** SHA-256 do texto canonico -- o checksum que prova a reprodutibilidade. */
const digest = (texto: string): string => createHash('sha256').update(texto).digest('hex');

/**
 * Calculo do snapshot diario de features (F36, Slice 6.1).
 *
 * ---------------------------------------------------------------------------
 * "JANELA COBERTA" E A DECISAO QUE SEPARA AUSENTE DE ZERO.
 * ---------------------------------------------------------------------------
 *
 * Toda feature de janela recebe `janelaCoberta`: `true` quando o aluno tem
 * historico suficiente para que o numero SIGNIFIQUE alguma coisa. Sem isso,
 * quem entrou ha 3 dias teria `attendance_days_90d = 0` e apareceria tao
 * ausente quanto quem sumiu por tres meses -- `M6-BR-002`, e o motivo pelo
 * qual a fila nao pode ligar para o recem-matriculado.
 *
 * A cobertura vem do PRIMEIRO FATO conhecido do aluno, nao da data de
 * matricula: matricular nao gera historico, e usar a matricula daria janela
 * "coberta" a quem nunca apareceu.
 */
@Injectable()
export class RetentionSnapshotsService {
  constructor(@Inject(PORTA_DE_RETENCAO) private readonly porta: PortaDeRetencao) {}

  /**
   * Materializa o snapshot de um aluno.
   *
   * `corteDeConhecimento` separado de `observadoEm` e o que permite a
   * reconstrucao auditada: refazer "a quarta como ela era na quarta", em vez
   * de refazer a quarta com o que se sabe hoje.
   */
  async calcular(
    contexto: TenantContext,
    studentId: string,
    recorte: RecorteDeSnapshot,
    versoes: { alvo: string; features: string },
  ): Promise<SnapshotDeFeatures> {
    const fatos = await this.porta.fatosDoAluno(contexto, studentId, recorte.corteDeConhecimento);

    return montarSnapshot(
      {
        tenantId: contexto.tenantId,
        studentId,
        versaoDeAlvo: versoes.alvo,
        versaoDeFeatures: versoes.features,
        observadoEm: recorte.observadoEm,
        corteDeConhecimento: recorte.corteDeConhecimento,
      },
      calcularValores(fatos, recorte),
      digest,
    );
  }

  /** Os alunos que recebem snapshot nesta data (PRD §3). */
  async elegiveis(contexto: TenantContext, observadoEm: Date): Promise<string[]> {
    const alunos = await this.porta.alunosElegiveis(contexto, observadoEm);

    return alunos.map((aluno) => aluno.studentId);
  }
}

/**
 * As 13 features, na ordem do PRD §9.
 *
 * Exportada para teste direto: o calculo e puro dado os fatos, e testa-lo sem
 * Nest evita que a suite precise de container so para provar aritmetica.
 */
export function calcularValores(
  fatos: FatosDoAluno,
  recorte: RecorteDeSnapshot,
): ValorDeFeature[] {
  const cobre = (dias: number): boolean =>
    fatos.primeiroFatoEm !== null && diasEntre(fatos.primeiroFatoEm, recorte.observadoEm) >= dias;

  return [
    diasTreinados('attendance_days_7d', fatos.sessoes, recorte, 7, cobre(7)),
    diasTreinados('attendance_days_30d', fatos.sessoes, recorte, 30, cobre(30)),
    diasTreinados('attendance_days_90d', fatos.sessoes, recorte, 90, cobre(90)),
    variacaoDeFrequencia(fatos.sessoes, recorte, cobre(60)),
    diasDesdeUltimaPassagem(fatos.sessoes, recorte),

    ...assinatura(fatos, recorte),

    invoicesVencidas(fatos.invoices, recorte),
    diasEmAtraso(fatos.invoices, recorte),
    falhasDePagamento(fatos.falhasDePagamento, recorte, cobre(90)),

    pausasNaJanela(fatos.pausas, recorte, cobre(180)),
    diasDesdeUltimaAvaliacao(fatos.avaliacoesPublicadas, recorte),
    atividadeDeEngajamento(fatos.atividadeDeEngajamento, recorte, fatos.engajamentoSuprimido),
  ];
}

/**
 * As duas features de assinatura.
 *
 * Aluno elegivel SEMPRE tem assinatura -- mas a leitura pode nao encontra-la
 * quando o corte de conhecimento e anterior a criacao dela (reconstrucao de
 * uma data em que o aluno ainda nao existia). `FONTE_INDISPONIVEL` e nao
 * `SEM_HISTORICO`: nao e que o aluno seja novo, e que a fonte nao respondeu
 * para aquele recorte, e o dashboard conta os dois casos separado.
 */
function assinatura(fatos: FatosDoAluno, recorte: RecorteDeSnapshot): ValorDeFeature[] {
  if (fatos.assinatura === null) {
    return [
      ausente('subscription_age_days', 'FONTE_INDISPONIVEL'),
      ausente('days_to_subscription_end', 'FONTE_INDISPONIVEL'),
    ];
  }

  return [
    idadeDaAssinatura(fatos.assinatura, recorte),
    diasParaTerminoDaAssinatura(fatos.assinatura, recorte),
  ];
}
