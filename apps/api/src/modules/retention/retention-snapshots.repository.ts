import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type {
  AssinaturaDatada,
  FalhaDePagamento,
  InvoiceDatada,
  PausaRegistrada,
  SessaoDeTreino,
} from './domain/features.js';
import type { FatoDatado } from './domain/janela-as-of.js';
import type { SnapshotDeFeatures } from './domain/snapshot.js';
import type { RazaoDeAusencia } from './domain/valor-de-feature.js';

/** Token de injecao da porta -- o modulo Nest liga isto ao repositorio Prisma. */
export const PORTA_DE_RETENCAO = Symbol('PortaDeRetencao');

/** Tudo que o calculo de features precisa de UM aluno, ja datado. */
export interface FatosDoAluno {
  readonly sessoes: readonly SessaoDeTreino[];
  readonly invoices: readonly InvoiceDatada[];
  readonly falhasDePagamento: readonly FalhaDePagamento[];
  readonly pausas: readonly PausaRegistrada[];
  readonly assinatura: AssinaturaDatada | null;
  readonly avaliacoesPublicadas: readonly FatoDatado[];
  readonly atividadeDeEngajamento: readonly FatoDatado[];
  /** Opt-out vigente -- `M6-FR-006`. Suprime a feature de engajamento. */
  readonly engajamentoSuprimido: boolean;
  /** Primeiro fato conhecido do aluno. Decide quais janelas estao cobertas. */
  readonly primeiroFatoEm: Date | null;
}

/** Um aluno elegivel a receber snapshot (PRD §3). */
export interface AlunoElegivel {
  readonly studentId: string;
}

/** O que a gravacao devolve -- se persistiu ou se ja existia identica. */
export interface ResultadoDaGravacao {
  readonly snapshotId: string;
  /** `false` quando a linha ja existia com o MESMO checksum (reexecucao). */
  readonly criado: boolean;
}

export interface PortaDeRetencao {
  alunosElegiveis(contexto: TenantContext, observadoEm: Date): Promise<AlunoElegivel[]>;
  fatosDoAluno(
    contexto: TenantContext,
    studentId: string,
    corteDeConhecimento: Date,
  ): Promise<FatosDoAluno>;
  gravarSnapshot(
    contexto: TenantContext,
    snapshot: SnapshotDeFeatures,
    versoes: { alvoId: string; featuresId: string },
  ): Promise<ResultadoDaGravacao>;
}

/** Erro de reprodutibilidade -- o alarme que o aceite da Slice 6.1 exige. */
export class SnapshotNaoDeterministicoError extends Error {
  constructor(
    readonly studentId: string,
    readonly checksumGravado: string,
    readonly checksumNovo: string,
  ) {
    super(
      `SNAPSHOT_NAO_DETERMINISTICO: aluno ${studentId} recalculado com checksum diferente ` +
        `(gravado ${checksumGravado}, novo ${checksumNovo})`,
    );
    this.name = 'SnapshotNaoDeterministicoError';
  }
}

/**
 * Leitura as-of das fontes (F36, Slice 6.1).
 *
 * ---------------------------------------------------------------------------
 * ESTE ARQUIVO E O UNICO LUGAR ONDE O "ANTES" E RECONSTRUIDO.
 * ---------------------------------------------------------------------------
 *
 * O dominio (`domain/`) e puro e so sabe filtrar fatos datados. Quem decide
 * QUAIS colunas viram fato -- e, portanto, se o snapshot e reproduzivel -- e
 * aqui. Duas regras que este arquivo segue sem excecao:
 *
 *   1. NUNCA ler coluna de estado mutavel para descrever o passado. Nada de
 *      `Invoice.status` ou `Subscription.status`: eles dizem o hoje, e o hoje
 *      nao e o que o snapshot descreve. Em vez disso, as datas imutaveis
 *      (`dueAt`, `paidAt`, `createdAt`, `startsAt`, `publishedAt`) e a
 *      timeline append-only.
 *
 *   2. Todo fato carrega `conhecidoEm` alem de `ocorreuEm`. Sem o segundo, um
 *      fato sincronizado tarde (catraca offline, webhook atrasado) entraria
 *      retroativamente num snapshot que nao podia conhece-lo -- o leakage que
 *      `M6-FR-003` proibe.
 *
 * A UNICA excecao conhecida e `PaymentAttempt`, cujo `status` transita depois
 * do fato. Ela e lida assim mesmo e a feature sai marcada `ESTADO_CORRENTE` --
 * decisao do PI de 31/08/2026, e a marca e o que permite a F40 exclui-la do
 * treino.
 */
@Injectable()
export class RetentionSnapshotsRepository implements PortaDeRetencao {
  constructor(private readonly db: PrismaService) {}

  /**
   * A populacao elegivel do PRD §3: assinatura `ACTIVE` ou `PAST_DUE`, ao
   * menos 30 dias de historico, sem pedido de exclusao pendente.
   *
   * Aqui o status CORRENTE e legitimo -- a pergunta e "quem devo pontuar
   * hoje", que e sobre o presente. O passado so aparece nas features.
   */
  async alunosElegiveis(contexto: TenantContext, observadoEm: Date): Promise<AlunoElegivel[]> {
    const trintaDiasAntes = new Date(observadoEm.getTime() - 30 * 86_400_000);

    const assinaturas = await this.db.subscription.findMany({
      where: {
        tenantId: contexto.tenantId,
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        startsAt: { lte: trintaDiasAntes },
        student: { status: { not: 'ARCHIVED' } },
      },
      select: { studentId: true },
      distinct: ['studentId'],
      orderBy: { studentId: 'asc' },
    });

    return assinaturas.map((linha) => ({ studentId: linha.studentId }));
  }

  async fatosDoAluno(
    contexto: TenantContext,
    studentId: string,
    corteDeConhecimento: Date,
  ): Promise<FatosDoAluno> {
    const escopo = { tenantId: contexto.tenantId, studentId };

    const [sessoes, invoices, tentativas, pausas, assinatura, avaliacoes, xp, optOut] =
      await Promise.all([
        this.db.studentAttendanceSession.findMany({
          where: { ...escopo, createdAt: { lte: corteDeConhecimento } },
          select: { sessionDate: true, firstPassageAt: true, createdAt: true },
          orderBy: { sessionDate: 'asc' },
        }),

        /*
         * SEM `status`. As tres datas bastam e nunca mudam -- "estava vencida
         * em D" e aritmetica sobre elas. `createdAt <= corte` porque uma
         * invoice aberta depois do corte nao era conhecida.
         */
        this.db.invoice.findMany({
          where: { ...escopo, createdAt: { lte: corteDeConhecimento } },
          select: { createdAt: true, dueAt: true, paidAt: true },
        }),

        /*
         * A EXCECAO. `status` e mutavel e nao ha trilha da transicao, entao
         * `requestedAt` e a melhor aproximacao de quando se soube. A feature
         * sai marcada `ESTADO_CORRENTE` por causa disto.
         */
        this.db.paymentAttempt.findMany({
          where: {
            tenantId: contexto.tenantId,
            status: 'FAILED',
            requestedAt: { lte: corteDeConhecimento },
            invoice: { studentId },
          },
          select: { requestedAt: true },
        }),

        /*
         * Timeline append-only: a pausa de julho continua registrada mesmo com
         * a assinatura ativa hoje. Ler `Subscription.status` apagaria toda
         * pausa ja retomada -- justamente o sinal procurado.
         */
        this.db.studentTimelineEvent.findMany({
          where: { ...escopo, type: 'SUBSCRIPTION_PAUSED', occurredAt: { lte: corteDeConhecimento } },
          select: { occurredAt: true },
        }),

        /*
         * ORDENACAO ESTAVEL, e o `id` NAO e decorativo.
         *
         * Um aluno tem varias assinaturas ao longo do tempo (troca de plano,
         * renovacao, cancelamento e volta) e `Subscription` nao e unica por
         * aluno. Duas nascidas no MESMO `startsAt` -- migracao de plano
         * processada num evento so -- empatam, e o desempate cairia na ordem
         * fisica do Postgres, que muda depois de um UPDATE na tabela.
         *
         * O snapshot passaria a depender de quando o banco foi compactado:
         * `SNAPSHOT_NAO_DETERMINISTICO` dispararia por ordenacao, escondendo
         * o alarme que existe para pegar leitura de estado mutavel. Ja
         * aconteceu neste repo com consentimento e com `include` sem
         * `orderBy`.
         */
        this.db.subscription.findFirst({
          where: { ...escopo, createdAt: { lte: corteDeConhecimento } },
          select: { startsAt: true, endsAt: true },
          orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
        }),

        /*
         * So a DATA de publicacao. Nenhuma medida corporal atravessa esta
         * fronteira -- regra de arquitetura no 8 e PRD §9.
         */
        this.db.bodyAssessment.findMany({
          where: {
            ...escopo,
            status: 'PUBLISHED',
            publishedAt: { not: null, lte: corteDeConhecimento },
          },
          select: { publishedAt: true },
        }),

        this.db.xpLedgerEntry.findMany({
          where: { ...escopo, type: 'GRANT', createdAt: { lte: corteDeConhecimento } },
          select: { createdAt: true },
        }),

        /*
         * Engajamento e OPT-OUT (F30, ADR-046): a AUSENCIA de linha significa
         * que o aluno participa. Por isso a consulta procura a recusa, e nao
         * a aceitacao -- inverter isto suprimiria a feature de todo mundo.
         */
        this.db.consentRecord.findFirst({
          where: {
            ...escopo,
            decision: 'REFUSED',
            document: { type: 'RANKING' },
          },
          select: { id: true },
        }),
      ]);

    const sessoesDatadas: SessaoDeTreino[] = sessoes.map((linha) => ({
      diaLocal: linha.sessionDate.toISOString().slice(0, 10),
      ocorreuEm: linha.firstPassageAt,
      conhecidoEm: linha.createdAt,
    }));

    const avaliacoesDatadas: FatoDatado[] = avaliacoes
      .filter((linha): linha is { publishedAt: Date } => linha.publishedAt !== null)
      .map((linha) => ({ ocorreuEm: linha.publishedAt, conhecidoEm: linha.publishedAt }));

    const candidatosAPrimeiroFato = [
      ...sessoesDatadas.map((item) => item.ocorreuEm),
      ...invoices.map((item) => item.createdAt),
      assinatura?.startsAt,
    ].filter((data): data is Date => data instanceof Date);

    return {
      sessoes: sessoesDatadas,
      invoices: invoices.map((linha) => ({
        criadaEm: linha.createdAt,
        venceEm: linha.dueAt,
        paganaEm: linha.paidAt,
      })),
      falhasDePagamento: tentativas.map((linha) => ({
        ocorreuEm: linha.requestedAt,
        conhecidoEm: linha.requestedAt,
      })),
      pausas: pausas.map((linha) => ({
        ocorreuEm: linha.occurredAt,
        conhecidoEm: linha.occurredAt,
      })),
      assinatura:
        assinatura === null
          ? null
          : { iniciaEm: assinatura.startsAt, terminaEm: assinatura.endsAt },
      avaliacoesPublicadas: avaliacoesDatadas,
      atividadeDeEngajamento: xp.map((linha) => ({
        ocorreuEm: linha.createdAt,
        conhecidoEm: linha.createdAt,
      })),
      engajamentoSuprimido: optOut !== null,
      primeiroFatoEm:
        candidatosAPrimeiroFato.length === 0
          ? null
          : new Date(Math.min(...candidatosAPrimeiroFato.map((data) => data.getTime()))),
    };
  }

  /**
   * Grava o snapshot -- ou confirma que o ja gravado bate.
   *
   * A CHAVE UNICA E QUEM DECIDE, NAO UM `if`.
   *
   * Duas execucoes do mesmo dia (retry do worker, reprocessamento manual)
   * competem pela mesma chave `(tenant, aluno, observacao, alvo, catalogo,
   * revisao)`. Ler-antes-de-escrever perderia a corrida por construcao -- a
   * mesma licao da F32 e do indice parcial da F31. Entao: tenta inserir, e
   * trata a colisao.
   *
   * Na colisao, COMPARA O CHECKSUM em vez de ignorar:
   *
   *   - igual  -> reexecucao legitima, nada a fazer (`criado: false`);
   *   - difere -> `SNAPSHOT_NAO_DETERMINISTICO`. Alguma feature leu estado
   *               corrente em vez de fato datado, e o aceite da Slice 6.1
   *               ("um snapshot passado pode ser reproduzido") esta quebrado.
   *
   * Sobrescrever silenciosamente apagaria justamente a evidencia de que o
   * pipeline nao e reproduzivel -- que e o que se quer descobrir.
   */
  async gravarSnapshot(
    contexto: TenantContext,
    snapshot: SnapshotDeFeatures,
    versoes: { alvoId: string; featuresId: string },
  ): Promise<ResultadoDaGravacao> {
    const chave = {
      tenantId: contexto.tenantId,
      studentId: snapshot.studentId,
      observedAt: snapshot.observadoEm,
      targetVersionId: versoes.alvoId,
      featureSetVersionId: versoes.featuresId,
      revision: 1,
    };

    const jaGravado = await this.lerGravado(chave);

    if (jaGravado !== null) return this.conferirChecksum(jaGravado, snapshot);

    try {
      /*
       * Snapshot e valores na MESMA transacao: um snapshot sem valores seria
       * lido pelo dashboard como completude zero -- indistinguivel de um
       * aluno sem nenhum dado.
       */
      const gravado = await this.db.studentFeatureSnapshot.create({
        data: {
          ...chave,
          knowledgeCutoffAt: snapshot.corteDeConhecimento,
          completeness: snapshot.completude,
          checksum: snapshot.checksum,
          values: {
            create: snapshot.valores.map((valor) => ({
              tenantId: contexto.tenantId,
              name: valor.nome,
              value: valor.valor,
              missingReason: paraRazaoDoBanco(valor.razao),
              provenance: valor.procedencia === 'AS_OF' ? 'AS_OF' : 'CURRENT_STATE',
            })),
          },
        },
        select: { id: true },
      });

      return { snapshotId: gravado.id, criado: true };
    } catch (erro: unknown) {
      /*
       * O `findUnique` acima NAO e a guarda -- e so um atalho para o caso
       * comum. A guarda de verdade e a chave unica, e este catch e o que a
       * torna util: dois workers (retry do job + reprocessamento manual, ou
       * duas replicas do mesmo cron) podem passar os dois pelo `findUnique`
       * antes de qualquer `create` commitar. Sem este bloco, o segundo
       * derrubaria o job com P2002 cru -- justamente na reexecucao que este
       * metodo promete ser inofensiva.
       *
       * Ler-antes-de-escrever perde a corrida por construcao; quem decide e
       * o banco. Mesma licao da F31 e da F32.
       */
      if (!erroDeUnicidade(erro)) throw erro;

      const vencedor = await this.lerGravado(chave);

      // Sumiu entre o P2002 e a releitura: so por delecao concorrente, que
      // nao existe neste fluxo. Relancar diz a verdade em vez de inventar.
      if (vencedor === null) throw erro;

      return this.conferirChecksum(vencedor, snapshot);
    }
  }

  private async lerGravado(
    chave: ChaveDeSnapshot,
  ): Promise<{ id: string; checksum: string } | null> {
    return this.db.studentFeatureSnapshot.findUnique({
      where: {
        tenantId_studentId_observedAt_targetVersionId_featureSetVersionId_revision: chave,
      },
      select: { id: true, checksum: true },
    });
  }

  /**
   * Confere o que ja esta gravado contra o recem-calculado.
   *
   * Igual  -> reexecucao legitima, nada a fazer.
   * Difere -> `SNAPSHOT_NAO_DETERMINISTICO`. Alguma feature leu estado
   *           corrente em vez de fato datado, e o aceite da Slice 6.1 esta
   *           quebrado. Sobrescrever apagaria essa evidencia.
   */
  private conferirChecksum(
    gravado: { id: string; checksum: string },
    snapshot: SnapshotDeFeatures,
  ): ResultadoDaGravacao {
    if (gravado.checksum !== snapshot.checksum) {
      throw new SnapshotNaoDeterministicoError(
        snapshot.studentId,
        gravado.checksum,
        snapshot.checksum,
      );
    }

    return { snapshotId: gravado.id, criado: false };
  }
}

/** A chave unica de um snapshot -- o que o banco usa para decidir a corrida. */
interface ChaveDeSnapshot {
  tenantId: string;
  studentId: string;
  observedAt: Date;
  targetVersionId: string;
  featureSetVersionId: string;
  revision: number;
}

/**
 * Violacao de unicidade do Prisma (P2002).
 *
 * Checagem estrutural em vez de `instanceof PrismaClientKnownRequestError`:
 * `code` e contrato publico e estavel, e importar a classe amarraria o
 * repositorio ao ORM. Mesmo helper da F14 (`cobrar-assinatura-no-cartao`).
 */
function erroDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}

/**
 * Traduz a razao do dominio para o enum do banco.
 *
 * Os nomes divergem de proposito: o dominio fala portugues como o resto do
 * codigo de negocio, o schema fala ingles como todo identificador persistido
 * (`CLAUDE.md`, "codigo e identificadores em ingles"). O `switch` exaustivo e
 * o que faz o compilador cobrar a traducao quando uma razao nova nascer.
 */
function paraRazaoDoBanco(
  razao: RazaoDeAusencia | null,
): 'NO_HISTORY' | 'SOURCE_UNAVAILABLE' | 'NOT_APPLICABLE' | 'SUPPRESSED' | null {
  switch (razao) {
    case null:
      return null;
    case 'SEM_HISTORICO':
      return 'NO_HISTORY';
    case 'FONTE_INDISPONIVEL':
      return 'SOURCE_UNAVAILABLE';
    case 'NAO_APLICAVEL':
      return 'NOT_APPLICABLE';
    case 'SUPRIMIDA':
      return 'SUPPRESSED';
  }
}
