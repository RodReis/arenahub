import { Injectable } from '@nestjs/common';

import { EngagementService, type PreferenciasDoAluno } from '../engagement/engagement.service.js';
import type { PerfilPublicoDoAluno } from '../engagement/engagement.repository.js';
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
}
