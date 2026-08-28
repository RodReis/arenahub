import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { StatusDaParticipacao } from './domain/desafio.js';
import type {
  AvisoDoAluno,
  DesafioDaListagem,
  AvisoParaGravar,
  DesafioParaCriar,
  DesafioPersistido,
  ParticipacaoPersistida,
  PortaDeDesafios,
  TemplateVigente,
} from './engagement-challenges.repository.js';

/**
 * Duble de `PortaDeDesafios`, em memoria.
 *
 * ⚠️ INSTANCIE UMA POR TESTE. Este fake guarda estado (desafios, participacoes,
 * avisos), e compartilhar a instancia entre `it`s faz o desafio criado num
 * bloco aparecer no seguinte -- defeito que ja custou tempo nesta base.
 */
export class FakePortaDeDesafios implements PortaDeDesafios {
  private readonly templates = new Map<string, TemplateVigente>();
  private readonly desafios = new Map<string, DesafioPersistido>();
  private readonly participacoes = new Map<string, ParticipacaoPersistida & { studentId: string; challengeId: string }>();
  private readonly avisos: (AvisoDoAluno & { studentId: string })[] = [];
  private readonly diasPorAluno = new Map<string, string[]>();
  private elegiveis: string[] = [];

  private sequencia = 0;

  // --- configuracao do teste ------------------------------------------------

  comTemplate(template: TemplateVigente): this {
    this.templates.set(template.id, template);
    return this;
  }

  comDesafio(desafio: DesafioPersistido): this {
    this.desafios.set(desafio.id, desafio);
    return this;
  }

  comParticipacao(challengeId: string, studentId: string, status: StatusDaParticipacao): this {
    const id = `p-${String(++this.sequencia)}`;
    this.participacoes.set(`${challengeId}:${studentId}`, {
      id,
      status,
      studentId,
      challengeId,
    });
    return this;
  }

  /** Alunos ativos e em dia -- os que a abertura inscreve sozinha. */
  comAlunosElegiveis(ids: string[]): this {
    this.elegiveis = ids;
    return this;
  }

  /** Dias locais em que o aluno treinou -- o que a F24 devolveria. */
  comDiasTreinados(studentId: string, dias: string[]): this {
    this.diasPorAluno.set(studentId, dias);
    return this;
  }

  /** Estado observavel pelo teste: o que ficou gravado. */
  participacaoDe(challengeId: string, studentId: string): ParticipacaoPersistida | null {
    return this.participacoes.get(`${challengeId}:${studentId}`) ?? null;
  }

  avisosGravados(): { studentId: string; kind: string; challengeId: string }[] {
    return this.avisos.map((a) => ({
      studentId: a.studentId,
      kind: a.kind,
      challengeId: a.challengeId,
    }));
  }

  desafioDe(id: string): DesafioPersistido | undefined {
    return this.desafios.get(id);
  }

  // --- porta ----------------------------------------------------------------

  templateVigentePorId(_ctx: TenantContext, id: string): Promise<TemplateVigente | null> {
    return Promise.resolve(this.templates.get(id) ?? null);
  }

  templatesVigentes(_ctx: TenantContext, _agora: Date): Promise<TemplateVigente[]> {
    return Promise.resolve([...this.templates.values()]);
  }

  criarDesafio(_ctx: TenantContext, dados: DesafioParaCriar): Promise<DesafioPersistido> {
    const id = `c-${String(++this.sequencia)}`;
    const desafio: DesafioPersistido = {
      id,
      status: 'DRAFT',
      startsOn: dados.startsOn,
      endsOn: dados.endsOn,
      targetValue: dados.targetValue,
      title: dados.title,
      gymUnitId: dados.gymUnitId,
      templateVersionId: dados.templateVersionId,
    };

    this.desafios.set(id, desafio);
    return Promise.resolve(desafio);
  }

  desafioPorId(_ctx: TenantContext, id: string): Promise<DesafioPersistido | null> {
    return Promise.resolve(this.desafios.get(id) ?? null);
  }

  ativarDesafio(_ctx: TenantContext, id: string): Promise<void> {
    const desafio = this.desafios.get(id);
    if (desafio?.status === 'DRAFT') this.desafios.set(id, { ...desafio, status: 'ACTIVE' });
    return Promise.resolve();
  }

  desafiosAbertos(
    _ctx: TenantContext,
    gymUnitId: string | null,
    hoje: string,
  ): Promise<DesafioPersistido[]> {
    return Promise.resolve(
      [...this.desafios.values()].filter(
        (d) =>
          d.status === 'ACTIVE' &&
          d.startsOn <= hoje &&
          d.endsOn >= hoje &&
          (d.gymUnitId === null || d.gymUnitId === gymUnitId),
      ),
    );
  }

  listarDoTenant(_ctx: TenantContext, limite: number): Promise<DesafioDaListagem[]> {
    return Promise.resolve(
      [...this.desafios.values()]
        .reverse()
        .slice(0, limite)
        .map((d) => ({
          ...d,
          templateName: 'Modelo de teste',
          participantes: [...this.participacoes.values()].filter(
            (p) => p.challengeId === d.id && p.status !== 'LEFT',
          ).length,
        })),
    );
  }

  participacao(
    _ctx: TenantContext,
    challengeId: string,
    studentId: string,
  ): Promise<ParticipacaoPersistida | null> {
    const linha = this.participacoes.get(`${challengeId}:${studentId}`);
    return Promise.resolve(linha ? { id: linha.id, status: linha.status } : null);
  }

  inscrever(_ctx: TenantContext, challengeId: string, studentId: string): Promise<void> {
    const chave = `${challengeId}:${studentId}`;
    const existente = this.participacoes.get(chave);

    // Reusa a linha, como o `upsert` na unique faz -- nunca cria a segunda.
    this.participacoes.set(chave, {
      id: existente?.id ?? `p-${String(++this.sequencia)}`,
      status: 'JOINED',
      studentId,
      challengeId,
    });

    return Promise.resolve();
  }

  sair(_ctx: TenantContext, challengeId: string, studentId: string): Promise<void> {
    const chave = `${challengeId}:${studentId}`;
    const existente = this.participacoes.get(chave);

    if (existente?.status === 'JOINED') {
      this.participacoes.set(chave, { ...existente, status: 'LEFT' });
    }

    return Promise.resolve();
  }

  diasTreinadosNaJanela(
    _ctx: TenantContext,
    studentId: string,
    janela: { inicio: string; fim: string; gymUnitId: string | null },
  ): Promise<string[]> {
    const dias = this.diasPorAluno.get(studentId) ?? [];

    // O repositorio real filtra no SQL; aqui o filtro e explicito para que o
    // teste veja a janela sendo aplicada.
    return Promise.resolve(dias.filter((d) => d >= janela.inicio && d <= janela.fim));
  }

  participantesEmCurso(
    _ctx: TenantContext,
    challengeId: string,
  ): Promise<{ studentId: string; participantId: string }[]> {
    return Promise.resolve(
      [...this.participacoes.values()]
        .filter((p) => p.challengeId === challengeId && p.status === 'JOINED')
        .map((p) => ({ studentId: p.studentId, participantId: p.id })),
    );
  }

  desafiosVencidosDoAluno(
    _ctx: TenantContext,
    studentId: string,
    hoje: string,
  ): Promise<{ id: string }[]> {
    return Promise.resolve(
      [...this.desafios.values()]
        .filter(
          (d) =>
            d.status === 'ACTIVE' &&
            d.endsOn < hoje &&
            this.participacoes.get(`${d.id}:${studentId}`)?.status === 'JOINED',
        )
        .map((d) => ({ id: d.id })),
    );
  }

  alunosElegiveis(_ctx: TenantContext, _gymUnitId: string | null): Promise<string[]> {
    return Promise.resolve([...this.elegiveis]);
  }

  inscreverEmLote(
    _ctx: TenantContext,
    challengeId: string,
    studentIds: readonly string[],
  ): Promise<string[]> {
    const novos: string[] = [];

    for (const studentId of studentIds) {
      const chave = `${challengeId}:${studentId}`;

      // Pula quem ja tem linha -- inclusive `LEFT`, como a producao faz.
      if (this.participacoes.has(chave)) continue;

      this.participacoes.set(chave, {
        id: `p-${String(++this.sequencia)}`,
        status: 'JOINED',
        studentId,
        challengeId,
      });
      novos.push(studentId);
    }

    return Promise.resolve(novos);
  }

  participantesAtivos(_ctx: TenantContext, challengeId: string): Promise<number> {
    return Promise.resolve(
      [...this.participacoes.values()].filter(
        (p) => p.challengeId === challengeId && p.status !== 'LEFT',
      ).length,
    );
  }

  atualizarDesafio(
    _ctx: TenantContext,
    challengeId: string,
    dados: { title: string; targetValue: number; startsOn: string; endsOn: string },
  ): Promise<void> {
    const desafio = this.desafios.get(challengeId);

    if (desafio) {
      this.desafios.set(challengeId, {
        ...desafio,
        title: dados.title,
        targetValue: dados.targetValue,
        startsOn: dados.startsOn,
        endsOn: dados.endsOn,
      });
    }

    return Promise.resolve();
  }

  excluirDesafio(_ctx: TenantContext, challengeId: string): Promise<void> {
    this.desafios.delete(challengeId);

    // O banco apaga em cascata (`onDelete: Cascade`); o fake precisa fazer o
    // mesmo, senao um teste passaria com adesao orfa que a producao nao tem.
    for (const [chave, p] of this.participacoes) {
      if (p.challengeId === challengeId) this.participacoes.delete(chave);
    }

    return Promise.resolve();
  }

  cancelarDesafio(_ctx: TenantContext, challengeId: string, _quando: Date): Promise<void> {
    const desafio = this.desafios.get(challengeId);

    if (desafio?.status === 'DRAFT' || desafio?.status === 'ACTIVE') {
      this.desafios.set(challengeId, { ...desafio, status: 'CANCELLED' });
    }

    return Promise.resolve();
  }

  concluirParticipacao(
    _ctx: TenantContext,
    participantId: string,
    _quando: Date,
  ): Promise<void> {
    return this.mudarStatusDoParticipante(participantId, 'COMPLETED');
  }

  reprovarParticipacao(_ctx: TenantContext, participantId: string): Promise<void> {
    return this.mudarStatusDoParticipante(participantId, 'FAILED');
  }

  fecharDesafio(_ctx: TenantContext, challengeId: string, _quando: Date): Promise<void> {
    const desafio = this.desafios.get(challengeId);
    if (desafio?.status === 'ACTIVE') {
      this.desafios.set(challengeId, { ...desafio, status: 'CLOSED' });
    }
    return Promise.resolve();
  }

  gravarAvisos(_ctx: TenantContext, avisos: AvisoParaGravar[]): Promise<void> {
    for (const aviso of avisos) {
      /*
       * `skipDuplicates` da unique `(desafio, aluno, tipo)`. Sem isto o fake
       * aceitaria o replay que o banco recusa, e o teste de idempotencia
       * passaria contra um duble mais permissivo que a producao.
       */
      const jaExiste = this.avisos.some(
        (a) =>
          a.challengeId === aviso.challengeId &&
          a.studentId === aviso.studentId &&
          a.kind === aviso.kind,
      );

      if (jaExiste) continue;

      this.avisos.push({
        id: `n-${String(++this.sequencia)}`,
        challengeId: aviso.challengeId,
        challengeTitle: this.desafios.get(aviso.challengeId)?.title ?? '',
        kind: aviso.kind,
        createdAt: new Date(),
        readAt: null,
        studentId: aviso.studentId,
      });
    }

    return Promise.resolve();
  }

  avisosDoAluno(_ctx: TenantContext, studentId: string): Promise<AvisoDoAluno[]> {
    return Promise.resolve(this.avisos.filter((a) => a.studentId === studentId));
  }

  marcarAvisosComoLidos(
    _ctx: TenantContext,
    studentId: string,
    ids: string[],
  ): Promise<void> {
    for (const aviso of this.avisos) {
      if (aviso.studentId === studentId && ids.includes(aviso.id) && aviso.readAt === null) {
        aviso.readAt = new Date();
      }
    }

    return Promise.resolve();
  }

  private mudarStatusDoParticipante(
    participantId: string,
    status: StatusDaParticipacao,
  ): Promise<void> {
    for (const [chave, linha] of this.participacoes) {
      // Filtra por `JOINED` como o `updateMany` real: reprocessar nao
      // reescreve quem ja foi apurado.
      if (linha.id === participantId && linha.status === 'JOINED') {
        this.participacoes.set(chave, { ...linha, status });
      }
    }

    return Promise.resolve();
  }
}
