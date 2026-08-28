import { Injectable } from '@nestjs/common';

import { EngagementService, type PreferenciasDoAluno } from '../engagement/engagement.service.js';
import type {
  ContestacaoGravada,
  PerfilPublicoDoAluno,
} from '../engagement/engagement.repository.js';
import type { AssuntoDaContestacao } from '../engagement/domain/contestacao.js';
import type { AlunoDaSessao } from './kiosk-area-do-aluno.service.js';

/**
 * Preferencia de engajamento e identidade publica no totem (F30, Task 6).
 *
 * REUSA `EngagementService` (regra de arquitetura no 9): nenhuma leitura
 * direta de `ConsentRecord` nem `PublicProfile` aqui -- `aluno.contexto` ja
 * e o `TenantContext` que o service publico exige, montado por
 * `KioskAreaDoAlunoService.resolver()` com `modulo: 'ranking'`.
 */
@Injectable()
export class KioskEngajamentoService {
  constructor(private readonly engajamento: EngagementService) {}

  async obterPreferencias(aluno: AlunoDaSessao): Promise<PreferenciasDoAluno> {
    return this.engajamento.obterPreferencias(aluno.contexto, aluno.studentId);
  }

  async atualizarPreferencia(
    aluno: AlunoDaSessao,
    participa: boolean,
    idempotencyKey: string,
    agora: Date,
  ): Promise<PreferenciasDoAluno> {
    return this.engajamento.atualizarPreferencia(
      aluno.contexto,
      {
        studentId: aluno.studentId,
        // So `RANKING` chega ate aqui -- o boundary Zod recusa qualquer
        // outra finalidade antes do controller montar esta chamada.
        finalidade: 'RANKING',
        participa,
        idempotencyKey,
      },
      agora,
    );
  }

  async definirAliasPublico(
    aluno: AlunoDaSessao,
    identityChoice: 'PRIMEIRO_NOME' | 'APELIDO' | 'ANONIMO',
    alias: string | null,
    version: number | null,
    agora: Date,
  ): Promise<PerfilPublicoDoAluno> {
    return this.engajamento.definirAliasPublico(
      aluno.contexto,
      { studentId: aluno.studentId, identityChoice, alias, version },
      agora,
    );
  }

  /**
   * O aluno abre uma contestacao pelo totem (`M5-FR-016`, F35).
   *
   * O `studentId` vem da SESSAO, nunca do corpo: quem esta logado no totem e
   * quem contesta. Aceitar o id do corpo deixaria qualquer aluno abrir
   * contestacao em nome de outro.
   */
  async abrirContestacao(
    aluno: AlunoDaSessao,
    subject: AssuntoDaContestacao,
    descricao: string,
  ): Promise<ContestacaoGravada> {
    return this.engajamento.abrirContestacao(aluno.contexto.tenantId, aluno.studentId, {
      subject,
      descricao,
    });
  }

  /** As contestacoes do proprio aluno -- acompanhamento, nao fila. */
  async minhasContestacoes(aluno: AlunoDaSessao): Promise<readonly ContestacaoGravada[]> {
    return this.engajamento.contestacoesDoAluno(aluno.contexto.tenantId, aluno.studentId);
  }
}
