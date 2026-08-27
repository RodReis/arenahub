import { ConflictException, NotFoundException } from '@nestjs/common';
import type { StudentStatus } from '@arenahub/database';

import type { DecisaoDeEngajamento, FinalidadeDeEngajamento } from './domain/participacao.js';
import type { StatusDoPerfilPublico } from './domain/exposicao.js';
import type {
  AlunoParaExposicao,
  EntradaDeModeracaoNoBanco,
  EntradaDeRegistro,
  EntradaDeSalvamento,
  PerfilPublicoDoAluno,
  PortaDeEngajamento,
} from './engagement.repository.js';

/** Aluno como o dublê aceita cadastrar -- so o que os testes precisam. */
export interface AlunoDeTeste {
  id: string;
  tenantId: string;
  name: string;
  status: StudentStatus;
}

/** Linha de decisao guardada em memoria, no formato de ConsentRecord. */
interface DecisaoGuardada {
  id: string;
  tenantId: string;
  studentId: string;
  finalidade: FinalidadeDeEngajamento;
  decision: 'ACCEPTED' | 'REFUSED';
  occurredAt: Date;
  supersededAt: Date | null;
  idempotencyKey: string | undefined;
}

/**
 * Dublê de `PortaDeEngajamento` em memoria.
 *
 * Vive no boundary (docs/TESTING.md §3), nunca dentro do dominio. Guarda
 * alunos, decisoes e perfis em Map. `decisoesDe` e auxiliar SO do dublê,
 * para o teste inspecionar o historico.
 */
export class RepositorioEmMemoria implements PortaDeEngajamento {
  private readonly alunos = new Map<string, AlunoDeTeste>();
  private readonly decisoes: DecisaoGuardada[] = [];
  private readonly perfis = new Map<string, PerfilPublicoDoAluno & { tenantId: string; studentId: string }>();
  /** Documentos "publicados" -- espelha o que o seed grava no banco real. */
  private readonly documentosPublicados = new Set<string>();
  private proximoId = 1;

  cadastrarAluno(aluno: AlunoDeTeste): void {
    this.alunos.set(aluno.id, aluno);
  }

  /** So do dublê: registra o documento de uma finalidade como publicado
   * para o tenant, espelhando o seed real -- sem isso `registrarDecisao`
   * recusa com `NotFoundException`. */
  publicarDocumento(tenantId: string, finalidade: FinalidadeDeEngajamento): void {
    this.documentosPublicados.add(`${tenantId}:${finalidade}`);
  }

  /** So do dublê: historico ordenado por occurredAt crescente, em copia. */
  decisoesDe(studentId: string, finalidade: FinalidadeDeEngajamento): DecisaoGuardada[] {
    return this.decisoes
      .filter((d) => d.studentId === studentId && d.finalidade === finalidade)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .map((d) => ({ ...d }));
  }

  buscarAluno(tenantId: string, studentId: string): Promise<AlunoParaExposicao | null> {
    const aluno = this.alunos.get(studentId);
    if (!aluno || aluno.tenantId !== tenantId) return Promise.resolve(null);

    return Promise.resolve({
      id: aluno.id,
      tenantId: aluno.tenantId,
      fullName: aluno.name,
      status: aluno.status,
      // Sem uso de idade nesta fatia no dublê -- data arbitraria, adulta.
      birthDate: new Date('2000-01-01T00:00:00.000Z'),
    });
  }

  decisaoVigente(
    tenantId: string,
    studentId: string,
    finalidade: FinalidadeDeEngajamento,
  ): Promise<DecisaoDeEngajamento | null> {
    const vigentes = this.decisoes
      .filter(
        (d) =>
          d.tenantId === tenantId &&
          d.studentId === studentId &&
          d.finalidade === finalidade &&
          d.supersededAt === null,
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

    const vigente = vigentes[0];
    if (!vigente) return Promise.resolve(null);

    return Promise.resolve({ decision: vigente.decision, supersededAt: vigente.supersededAt });
  }

  registrarDecisao(entrada: EntradaDeRegistro, agora: Date): Promise<void> {
    if (!this.documentosPublicados.has(`${entrada.tenantId}:${entrada.finalidade}`)) {
      throw new NotFoundException({
        code: 'DOCUMENTO_DE_ENGAJAMENTO_AUSENTE',
        message: `Nenhum documento de consentimento publicado para ${entrada.finalidade}`,
      });
    }

    if (entrada.idempotencyKey) {
      const desde = agora.getTime() - 24 * 60 * 60 * 1000;
      const existente = this.decisoes.find(
        (d) =>
          d.tenantId === entrada.tenantId &&
          d.studentId === entrada.studentId &&
          d.finalidade === entrada.finalidade &&
          d.idempotencyKey === entrada.idempotencyKey &&
          d.occurredAt.getTime() >= desde,
      );

      if (existente) return Promise.resolve();
    }

    for (const decisao of this.decisoes) {
      if (
        decisao.tenantId === entrada.tenantId &&
        decisao.studentId === entrada.studentId &&
        decisao.finalidade === entrada.finalidade &&
        decisao.supersededAt === null
      ) {
        decisao.supersededAt = agora;
      }
    }

    this.decisoes.push({
      id: `dec-${this.proximoId++}`,
      tenantId: entrada.tenantId,
      studentId: entrada.studentId,
      finalidade: entrada.finalidade,
      decision: entrada.decision,
      occurredAt: agora,
      supersededAt: null,
      idempotencyKey: entrada.idempotencyKey,
    });

    return Promise.resolve();
  }

  perfilDoAluno(tenantId: string, studentId: string): Promise<PerfilPublicoDoAluno | null> {
    for (const perfil of this.perfis.values()) {
      if (perfil.tenantId === tenantId && perfil.studentId === studentId) {
        return Promise.resolve(semTenantEAluno(perfil));
      }
    }

    return Promise.resolve(null);
  }

  perfilPorId(tenantId: string, perfilId: string): Promise<PerfilPublicoDoAluno | null> {
    const perfil = this.perfis.get(perfilId);
    if (!perfil || perfil.tenantId !== tenantId) return Promise.resolve(null);

    return Promise.resolve(semTenantEAluno(perfil));
  }

  salvarPerfil(entrada: EntradaDeSalvamento, _agora: Date): Promise<PerfilPublicoDoAluno> {
    let existente: (PerfilPublicoDoAluno & { tenantId: string; studentId: string }) | undefined;
    for (const perfil of this.perfis.values()) {
      if (perfil.tenantId === entrada.tenantId && perfil.studentId === entrada.studentId) {
        existente = perfil;
        break;
      }
    }

    if (entrada.version !== null) {
      if (!existente || existente.version !== entrada.version) {
        throw new ConflictException('Perfil publico foi alterado por outra edicao');
      }
    }

    const id = existente?.id ?? `perfil-${this.proximoId++}`;
    const novaVersao = existente ? existente.version + 1 : 1;

    const salvo: PerfilPublicoDoAluno & { tenantId: string; studentId: string } = {
      id,
      tenantId: entrada.tenantId,
      studentId: entrada.studentId,
      identityChoice: entrada.identityChoice,
      alias: entrada.alias,
      status: 'PENDING',
      screeningSignals: [...entrada.screeningSignals],
      rejectionReason: null,
      version: novaVersao,
    };

    this.perfis.set(id, salvo);

    return Promise.resolve(semTenantEAluno(salvo));
  }

  moderarPerfil(entrada: EntradaDeModeracaoNoBanco, _agora: Date): Promise<PerfilPublicoDoAluno> {
    const perfil = this.perfis.get(entrada.perfilId);
    if (!perfil || perfil.tenantId !== entrada.tenantId) {
      throw new NotFoundException('Perfil publico nao encontrado');
    }

    if (entrada.status === 'APPROVED') {
      this.verificarColisaoDeAliasAprovado(entrada.tenantId, perfil.id, perfil.alias);
    }

    const atualizado = { ...perfil, status: entrada.status, rejectionReason: entrada.rejectionReason };
    this.perfis.set(perfil.id, atualizado);

    return Promise.resolve(semTenantEAluno(atualizado));
  }

  listarPorStatus(
    tenantId: string,
    status: StatusDoPerfilPublico,
    limite: number,
  ): Promise<PerfilPublicoDoAluno[]> {
    const resultado = [...this.perfis.values()]
      .filter((p) => p.tenantId === tenantId && p.status === status)
      .slice(0, limite)
      .map(semTenantEAluno);

    return Promise.resolve(resultado);
  }

  /** Espelha o indice parcial: alias unico so entre APPROVED, ao aprovar. */
  private verificarColisaoDeAliasAprovado(
    tenantId: string,
    ignorarId: string,
    alias: string | null,
  ): void {
    if (!alias) return;

    for (const perfil of this.perfis.values()) {
      if (perfil.id === ignorarId) continue;
      if (perfil.tenantId !== tenantId) continue;
      if (perfil.status !== 'APPROVED') continue;
      if (perfil.alias === alias) {
        throw new ConflictException({
          code: 'ALIAS_JA_APROVADO_PARA_OUTRO_ALUNO',
          message: 'Este apelido ja foi aprovado para outro aluno',
        });
      }
    }
  }
}

function semTenantEAluno(
  perfil: PerfilPublicoDoAluno & { tenantId: string; studentId: string },
): PerfilPublicoDoAluno {
  return {
    id: perfil.id,
    identityChoice: perfil.identityChoice,
    alias: perfil.alias,
    status: perfil.status,
    screeningSignals: perfil.screeningSignals,
    rejectionReason: perfil.rejectionReason,
    version: perfil.version,
  };
}
