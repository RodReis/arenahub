import { Injectable } from '@nestjs/common';

import {
  EngagementChallengesService,
  type AvisoDoAlunoDto,
  type DesafioDoAluno,
} from '../engagement/engagement-challenges.service.js';
import type { AlunoDaSessao } from './kiosk-area-do-aluno.service.js';

/** O que o totem mostra na aba de desafios. */
export interface DesafiosDoTotem {
  desafios: DesafioDoAluno[];
  avisos: AvisoDoAlunoDto[];
}

/**
 * Fuso da UNIDADE nao chega ate `AlunoDaSessao` -- so `tenantId`/`gymUnitId`.
 *
 * Mesma constante e mesma razao de `kiosk-xp.service.ts`: toda unidade
 * semeada nesta base usa `America/Sao_Paulo`. Se um dia houver unidade em
 * outro fuso, este e o ponto a ajustar -- ler o fuso real exigiria uma
 * consulta a mais so para nomear o dia.
 */
const FUSO_PADRAO = 'America/Sao_Paulo';

/**
 * `AAAA-MM-DD` do dia local da unidade.
 *
 * `en-CA` porque o formato dele JA e `AAAA-MM-DD` -- montar a string na mao a
 * partir de `getFullYear`/`getMonth` usaria o fuso do PROCESSO, nao o da
 * unidade, e o totem viraria o dia na hora errada.
 */
function diaLocal(agora: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_PADRAO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

/**
 * Desafios do aluno no totem (F34, Slice 5.5, ADR-048).
 *
 * REUSA `EngagementChallengesService` (regra de arquitetura no 9): nenhuma
 * leitura direta de `Challenge`/`ChallengeParticipant`/`ChallengeNotice`
 * aqui. `aluno.contexto` ja e o `TenantContext` que o service publico exige,
 * montado por `KioskAreaDoAlunoService.resolver()`.
 *
 * ---------------------------------------------------------------------------
 * APURACAO SOB DEMANDA, SEM AGENDADOR.
 * ---------------------------------------------------------------------------
 *
 * Nao ha job nem fila: quando o aluno abre a aba, os desafios com janela
 * vencida sao apurados na hora. Coerente com a Decisao 3 do ADR-048 (nao ha
 * canal externo, entao nao ha nada a "enviar" num horario) e com o
 * `CLAUDE.md`, que so admite Redis/BullMQ "quando comprovadamente
 * necessario".
 *
 * O custo e limitado: so desafios em que o PROPRIO aluno esta inscrito e cuja
 * janela ja fechou, e `encerrar()` e idempotente -- a segunda passada nao
 * encontra ninguem `JOINED` para apurar.
 */
@Injectable()
export class KioskDesafiosService {
  constructor(private readonly desafios: EngagementChallengesService) {}

  async listar(aluno: AlunoDaSessao, agora: Date): Promise<DesafiosDoTotem> {
    const hoje = diaLocal(agora);

    /*
     * APURA ANTES DE LER, e a ordem importa: apurar depois mostraria a lista
     * de hoje com os avisos de ontem, e o aluno que acabou de bater a meta
     * veria "em curso" ate voltar ao totem outra vez.
     *
     * `pendentesDeApuracao` devolve so os desafios em que ESTE aluno esta
     * inscrito e cuja janela ja fechou -- nao e uma varredura do tenant.
     */
    for (const desafio of await this.desafios.pendentesDeApuracao(
      aluno.contexto,
      aluno.studentId,
      hoje,
    )) {
      await this.desafios.encerrar(aluno.contexto, desafio.id, agora, hoje);
    }

    const [desafios, avisos] = await Promise.all([
      this.desafios.paraOAluno(aluno.contexto, aluno.studentId, aluno.gymUnitId, hoje),
      this.desafios.avisos(aluno.contexto, aluno.studentId),
    ]);

    return { desafios, avisos };
  }

  async inscrever(aluno: AlunoDaSessao, challengeId: string, agora: Date): Promise<void> {
    await this.desafios.inscrever(
      aluno.contexto,
      challengeId,
      aluno.studentId,
      diaLocal(agora),
    );
  }

  async sair(aluno: AlunoDaSessao, challengeId: string): Promise<void> {
    await this.desafios.sair(aluno.contexto, challengeId, aluno.studentId);
  }

  async marcarAvisosComoLidos(aluno: AlunoDaSessao, ids: string[]): Promise<void> {
    await this.desafios.marcarComoLidos(aluno.contexto, aluno.studentId, ids);
  }
}
