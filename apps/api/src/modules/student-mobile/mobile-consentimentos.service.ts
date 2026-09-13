import { Injectable, NotFoundException } from '@nestjs/common';

import { ConsentRepository } from '../privacy/consent.repository.js';
import {
  avaliarConsentimento,
  calcularIdadeEmAnos,
  sujeitoExigido,
} from '../privacy/domain/consentimento.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';
import { tenantContextDoAluno } from './contexto-do-aluno.js';

/**
 * Consentimentos que o ALUNO decide sozinho pelo app -- Slice 4.4,
 * `M4-BR-009`.
 *
 * `BIOMETRIC` NAO esta na lista, e a ausencia e o desenho: o cadastro
 * biometrico acontece presencialmente, com o leitor na frente da pessoa, e o
 * termo e assinado na recepcao (F19). O aluno pode REVOGAR pelo app -- e isso
 * chega numa fatia de biometria, nao aqui, porque revogar implica marcar a
 * identidade para exclusao fisica nos leitores (INV-018/INV-019), que este
 * servico nao faz.
 *
 * `CHALLENGE`, `ENGAGEMENT_PUSH` e `PHYSICAL_EVOLUTION_RANKING` ficam de fora
 * porque estao dormentes no proprio schema ate F33/F34.
 */
export const TIPOS_DO_APP = [
  'TERMS',
  'PRIVACY',
  'HEALTH',
  'AI_ANALYSIS',
  'MARKETING',
  'RANKING',
] as const;

export type TipoDeConsentimentoDoApp = (typeof TIPOS_DO_APP)[number];

/**
 * Um termo OPT-OUT vale enquanto o aluno nao disser o contrario; um OPT-IN so
 * vale com aceite expresso.
 *
 * Importa para a TELA: sem consentimento registrado, o interruptor de
 * `MARKETING` nasce ligado e o de `HEALTH` nasce desligado. Tratar os dois
 * igual faria o app ou pedir de novo o que ja era permitido, ou exibir como
 * concedido o que nunca foi.
 */
const OPT_OUT: ReadonlySet<TipoDeConsentimentoDoApp> = new Set(['MARKETING', 'RANKING']);

export interface ConsentimentoDoAluno {
  readonly tipo: TipoDeConsentimentoDoApp;
  /** Vale AGORA? Unica coisa que a tela usa para posicionar o interruptor. */
  readonly concedido: boolean;
  /**
   * Por que nao vale, quando `concedido` e falso e havia decisao registrada.
   *
   * Nulo quando vale, e tambem quando nunca houve decisao -- "nunca decidiu"
   * nao e um motivo de invalidez, e o app distingue isso por `decididoEm`.
   */
  readonly motivo: string | null;
  /** Instante da ultima decisao. Nulo quando o aluno nunca decidiu. */
  readonly decididoEm: string | null;
  /** Finalidade declarada no termo vigente (art. 11, I). */
  readonly finalidade: string | null;
  /** Versao do termo vigente, para a tela avisar quando ha texto novo. */
  readonly versao: number | null;
  /**
   * O aluno pode decidir sozinho?
   *
   * Falso para menor de 18 (INV-143): a decisao e do responsavel legal, e o
   * app desabilita o interruptor em vez de gravar uma decisao que a regra
   * pura recusaria depois.
   */
  readonly editavel: boolean;
}

export interface RespostaDeConsentimentos {
  readonly asOf: string;
  readonly consentimentos: readonly ConsentimentoDoAluno[];
}

@Injectable()
export class MobileConsentimentosService {
  constructor(
    private readonly db: PrismaService,
    private readonly consentimentos: ConsentRepository,
  ) {}

  /** O que o aluno da SESSAO permitiu, tipo a tipo. */
  async listar(ctx: StudentChannelContext, agora: Date): Promise<RespostaDeConsentimentos> {
    const contexto = tenantContextDoAluno(ctx);
    const idade = await this.idadeDoAluno(ctx, agora);

    const linhas = await Promise.all(
      TIPOS_DO_APP.map((tipo) => this.montarLinha(contexto, ctx.studentId, tipo, idade, agora)),
    );

    return { asOf: agora.toISOString(), consentimentos: linhas };
  }

  /**
   * Concede ou revoga, e o efeito e IMEDIATO (ADR-008).
   *
   * Imediato por CONSTRUCAO, nao por diligencia: `registrarDecisao` marca a
   * decisao anterior como substituida na MESMA transacao em que grava a nova,
   * e `avaliarConsentimento` recusa toda decisao com `supersededAt`. Nao ha
   * estado intermediario "pedido em analise" -- a leitura seguinte ja nega.
   */
  async decidir(
    ctx: StudentChannelContext,
    tipo: TipoDeConsentimentoDoApp,
    conceder: boolean,
    correlationId: string,
    agora: Date,
  ): Promise<ConsentimentoDoAluno> {
    const contexto = tenantContextDoAluno(ctx);
    const idade = await this.idadeDoAluno(ctx, agora);

    // Menor de idade nao decide sozinho (INV-143). Recusar aqui e o que
    // impede o app de gravar uma decisao que a regra pura invalidaria na
    // leitura seguinte -- a linha existiria, sem efeito nenhum, e a tela
    // mostraria concedido o que nao vale.
    if (sujeitoExigido(idade) === 'LEGAL_GUARDIAN') {
      throw new NotFoundException({ code: 'CONSENT_REQUIRES_LEGAL_GUARDIAN' });
    }

    const documento = await this.consentimentos.encontrarDocumentoVigente(contexto, tipo, agora);

    if (documento === null) {
      throw new NotFoundException({ code: 'CONSENT_DOCUMENT_NOT_FOUND' });
    }

    await this.consentimentos.registrarDecisao(
      contexto,
      {
        studentId: ctx.studentId,
        documentId: documento.id,
        documentType: tipo,
        decision: conceder ? 'ACCEPTED' : 'REFUSED',
        subjectKind: 'STUDENT',
        subjectAgeYears: idade,
        evidence: { canal: 'MOBILE' },
      },
      correlationId,
      agora,
    );

    return this.montarLinha(contexto, ctx.studentId, tipo, idade, agora);
  }

  private async montarLinha(
    contexto: ReturnType<typeof tenantContextDoAluno>,
    studentId: string,
    tipo: TipoDeConsentimentoDoApp,
    idade: number,
    agora: Date,
  ): Promise<ConsentimentoDoAluno> {
    const [documento, decisao] = await Promise.all([
      this.consentimentos.encontrarDocumentoVigente(contexto, tipo, agora),
      this.consentimentos.encontrarDecisaoVigente(contexto, studentId, tipo),
    ]);

    const avaliacao = avaliarConsentimento(decisao, idade);

    return {
      tipo,
      // Sem decisao registrada, OPT-OUT vale e OPT-IN nao. Com decisao, quem
      // manda e a regra pura -- inclusive para OPT-OUT: uma recusa expressa de
      // marketing e o caso que este ramo existe para respeitar.
      concedido: decisao === null ? OPT_OUT.has(tipo) : avaliacao.valido,
      motivo: decisao === null || avaliacao.valido ? null : avaliacao.motivo,
      decididoEm: decisao?.occurredAt.toISOString() ?? null,
      finalidade: documento?.purpose ?? null,
      versao: documento?.version ?? null,
      editavel: sujeitoExigido(idade) === 'STUDENT',
    };
  }

  /**
   * Idade HOJE, nao a congelada na decisao.
   *
   * `avaliarConsentimento` compara a idade atual com o sujeito da decisao
   * para pegar a virada dos 18 (INV-143) -- passar a congelada faria um
   * consentimento dado pelo responsavel continuar valendo depois da
   * maioridade.
   */
  private async idadeDoAluno(ctx: StudentChannelContext, agora: Date): Promise<number> {
    const aluno = await this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id: ctx.studentId, tenantId: ctx.tenantId },
        select: { birthDate: true },
      }),
    );

    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    // Sem data de nascimento cadastrada o aluno e tratado como maior: o
    // cadastro nao exige o campo, e bloquear todo consentimento de quem nao o
    // preencheu deixaria o app inutil para uma base legada inteira. A idade
    // congelada na decisao registra o que se sabia no momento.
    if (aluno.birthDate === null) return 18;

    return calcularIdadeEmAnos(aluno.birthDate, agora);
  }
}
