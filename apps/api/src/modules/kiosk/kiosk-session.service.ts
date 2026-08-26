import { randomBytes, createHash } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';

import { calcularHashDeCpf } from '../students/domain/identificacao.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';
import { KioskConfigService } from './kiosk-config.service.js';
import { calcularExpiracao, estender } from './domain/sessao.js';

export interface SessaoAberta {
  readonly sessionId: string;
  readonly token: string;
  readonly nome: string;
  readonly plano: { readonly ativo: boolean; readonly pendenciaEmCentavos: number | null };
  readonly expiraEm: string;
}

/**
 * Sessao efemera do aluno no totem.
 *
 * A busca e por `cpfHash` ESCOPADO POR TENANT, e o tenant vem da credencial
 * do dispositivo. E dai que sai o aceite da fatia: o totem de um tenant nao
 * consegue nem FORMULAR a pergunta sobre o aluno de outro -- a chave de busca
 * e diferente. Nao ha checagem a esquecer.
 */
@Injectable()
export class KioskSessionService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: KioskConfigService,
  ) {}

  async abrir(contexto: ContextoDoKiosk, cpf: string, agora: Date): Promise<SessaoAberta> {
    const { config } = await this.config.resolverParaDispositivo(contexto);

    const aluno = await this.db.student.findFirst({
      where: {
        tenantId: contexto.tenantId,
        cpfHash: calcularHashDeCpf(contexto.tenantId, cpf),
        // SUSPENDED entra: e exatamente o aluno inadimplente que o totem
        // precisa identificar para mostrar a pendencia. BLOCKED, CANCELLED,
        // ARCHIVED e LEAD caem na mensagem neutra unica abaixo.
        status: { in: ['ACTIVE', 'TRIAL', 'SUSPENDED'] },
      },
      select: { id: true, fullName: true },
    });

    // Decisao 4 do PI: mensagem UNICA para nao-encontrado, outro tenant,
    // status nao elegivel e erro. Distinguir aqui diria a qualquer um se
    // fulano treina nesta academia.
    if (!aluno) {
      throw new NotFoundException({ code: 'KIOSK_IDENTIFICATION_FAILED' });
    }

    const token = randomBytes(32).toString('base64url');
    const expiraEm = calcularExpiracao(agora, config.sessao.duracaoSegundos);

    const sessao = await this.db.kioskSession.create({
      data: {
        tenantId: contexto.tenantId,
        kioskDeviceId: contexto.kioskDeviceId,
        studentId: aluno.id,
        tokenHash: this.hash(token),
        expiresAt: expiraEm,
      },
    });

    return {
      sessionId: sessao.id,
      token,
      nome: aluno.fullName,
      plano: await this.estadoDoPlano(contexto.tenantId, aluno.id),
      expiraEm: expiraEm.toISOString(),
    };
  }

  async estenderSessao(
    contexto: ContextoDoKiosk,
    sessionId: string,
    token: string,
    agora: Date,
  ): Promise<{ expiraEm: string }> {
    const { config } = await this.config.resolverParaDispositivo(contexto);
    const sessao = await this.viva(contexto, sessionId, token, agora);

    const novo = estender(
      sessao.expiresAt,
      agora,
      config.sessao.incrementoSegundos,
      config.sessao.tetoSegundos,
    );

    await this.db.kioskSession.update({
      where: { id: sessao.id },
      data: { expiresAt: novo },
    });

    return { expiraEm: novo.toISOString() };
  }

  async encerrar(
    contexto: ContextoDoKiosk,
    sessionId: string,
    token: string,
    motivo: string,
    agora: Date,
  ): Promise<void> {
    const sessao = await this.viva(contexto, sessionId, token, agora);

    await this.db.kioskSession.update({
      where: { id: sessao.id },
      data: { endedAt: agora, endedReason: motivo },
    });
  }

  /**
   * Sessao viva DESTE dispositivo, autorizada pelo TOKEN do aluno.
   *
   * Fecha o ciclo que faltava: sem isto, `tokenHash` era gravado e nunca
   * lido -- expirar ou encerrar a sessao nao tinha efeito nenhum sobre o
   * que o token autorizava, porque nada consumia o token. Token em maos
   * so autoriza se (1) bater o hash, (2) `endedAt` for nulo, e (3)
   * `expiresAt` ainda nao passou de `agora` -- as tres, sempre.
   *
   * `kioskDeviceId` no filtro nao e zelo: sem ele, um totem estenderia ou
   * encerraria a sessao aberta em outro totem do MESMO tenant.
   */
  /**
   * O PORTAO DE TODO DADO DE ALUNO NO TOTEM (F52).
   *
   * Devolve o `studentId` DA SESSAO -- e e por isso que ela existe. Todo
   * endpoint de dado de aluno resolve o aluno POR AQUI, nunca por um id
   * vindo da URL ou do corpo: com id na URL, quem tem uma sessao valida lê a
   * avaliacao e a fatura de QUALQUER aluno do tenant trocando um UUID, e o
   * isolamento que a F49 provou vira decoracao.
   *
   * As tres condicoes de `viva()` continuam valendo inteiras: hash do token,
   * `endedAt` nulo e `expiresAt` no futuro.
   */
  async exigirSessaoViva(
    contexto: ContextoDoKiosk,
    sessionId: string,
    token: string,
    agora: Date,
  ): Promise<{ id: string; studentId: string }> {
    const sessao = await this.viva(contexto, sessionId, token, agora);

    return { id: sessao.id, studentId: sessao.studentId };
  }

  private async viva(contexto: ContextoDoKiosk, sessionId: string, token: string, agora: Date) {
    const sessao = await this.db.kioskSession.findFirst({
      where: {
        id: sessionId,
        tenantId: contexto.tenantId,
        kioskDeviceId: contexto.kioskDeviceId,
        tokenHash: this.hash(token),
        endedAt: null,
      },
    });

    if (!sessao || sessao.expiresAt <= agora) {
      throw new NotFoundException({ code: 'KIOSK_SESSION_NOT_FOUND' });
    }

    return sessao;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async estadoDoPlano(
    tenantId: string,
    studentId: string,
  ): Promise<SessaoAberta['plano']> {
    // OVERDUE tambem e pendencia -- e justamente a fatura vencida que o
    // totem precisa mostrar, nao so a que ainda esta no prazo.
    const emAberto = await this.db.invoice.findFirst({
      where: { tenantId, studentId, status: { in: ['OPEN', 'OVERDUE'] } },
      orderBy: [{ dueAt: 'asc' }],
      select: { totalMinor: true },
    });

    return {
      ativo: emAberto === null,
      pendenciaEmCentavos: emAberto?.totalMinor ?? null,
    };
  }
}
