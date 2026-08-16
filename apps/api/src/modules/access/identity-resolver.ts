import { Injectable } from '@nestjs/common';
import type { StudentStatus } from '@arenahub/access-policy';

import type { ContextoDoEdge } from '../edge-auth/edge-auth.service.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * De um `externalUserId` de leitor ate o aluno -- `M1-FR-019`.
 *
 * A cadeia e `Edge autenticado -> Device -> DeviceUser -> BiometricIdentity
 * ATIVA -> Student`, e CADA elo carrega o mesmo escopo de tenant e unidade.
 * Nao ha busca global em lugar nenhum deste arquivo: o `enrollid` 42 existe
 * em todo leitor do mundo, e resolver sem escopo devolveria o aluno de outra
 * academia com a mesma naturalidade com que devolve o certo.
 *
 * Identidade que nao resolve NAO e erro -- e um `DENY` que precisa ser
 * registrado. O leitor viu alguem; quem, nao sabemos. Esse evento e
 * justamente o que interessa investigar (cadastro de fabrica sobrando,
 * identidade revogada ainda no equipamento), entao ele volta como resultado
 * normal, nao como excecao.
 */

export type IdentidadeResolvida =
  | {
      readonly resolvida: true;
      readonly deviceId: string;
      readonly studentId: string;
      readonly identityId: string;
      readonly studentStatus: StudentStatus;
    }
  | {
      readonly resolvida: false;
      /** Codigo estavel para o `detail` do evento -- nunca vai para a tela. */
      readonly motivo:
        | 'DEVICE_NOT_IN_SCOPE'
        | 'UNKNOWN_EXTERNAL_USER'
        | 'IDENTITY_NOT_ACTIVE'
        | 'DEVICE_USER_NOT_ACTIVE';
      /** Preenchido quando deu para chegar ao aluno apesar da recusa. */
      readonly deviceId?: string;
      readonly studentId?: string;
    };

@Injectable()
export class IdentityResolver {
  constructor(private readonly db: PrismaService) {}

  /**
   * @param edge contexto da assinatura HMAC -- e ELE quem define tenant e
   *   unidade. O corpo da requisicao nao participa dessa decisao (regra de
   *   arquitetura no 2).
   */
  async resolver(
    edge: ContextoDoEdge,
    deviceId: string,
    externalUserId: string,
  ): Promise<IdentidadeResolvida> {
    // O dispositivo precisa pertencer AO MESMO tenant, A MESMA unidade e AO
    // MESMO Edge que assinou. Um Edge comprometido nao consegue decidir por
    // dispositivo de outra unidade nem que saiba o UUID dele.
    const dispositivo = await this.db.device.findFirst({
      where: {
        id: deviceId,
        tenantId: edge.tenantId,
        gymUnitId: edge.gymUnitId,
        edgeNodeId: edge.edgeNodeId,
      },
      select: { id: true },
    });

    if (!dispositivo) return { resolvida: false, motivo: 'DEVICE_NOT_IN_SCOPE' };

    const deviceUser = await this.db.deviceUser.findFirst({
      where: {
        deviceId: dispositivo.id,
        externalUserId,
        tenantId: edge.tenantId,
      },
      select: {
        state: true,
        studentId: true,
        identityId: true,
        identity: { select: { state: true } },
        student: { select: { status: true } },
      },
    });

    if (!deviceUser) {
      return { resolvida: false, motivo: 'UNKNOWN_EXTERNAL_USER', deviceId: dispositivo.id };
    }

    // Biometria revogada bloqueia NA HORA, mesmo com a exclusao fisica ainda
    // pendente no equipamento (`M1-BR-005`, INV-018). O leitor continua
    // reconhecendo a pessoa por mais alguns minutos ate o job de exclusao
    // rodar -- e este `if` e o que impede esses minutos de virarem acesso.
    if (deviceUser.identity.state !== 'ACTIVE') {
      return {
        resolvida: false,
        motivo: 'IDENTITY_NOT_ACTIVE',
        deviceId: dispositivo.id,
        studentId: deviceUser.studentId,
      };
    }

    // `REMOVED` no leitor significa que mandamos apagar. Se ainda assim o
    // equipamento reconheceu, a exclusao falhou -- e um cadastro fantasma
    // nao abre catraca.
    if (deviceUser.state === 'REMOVED') {
      return {
        resolvida: false,
        motivo: 'DEVICE_USER_NOT_ACTIVE',
        deviceId: dispositivo.id,
        studentId: deviceUser.studentId,
      };
    }

    return {
      resolvida: true,
      deviceId: dispositivo.id,
      studentId: deviceUser.studentId,
      identityId: deviceUser.identityId,
      // Sem cast: `StudentStatus` do Prisma e do motor puro coincidem, e o
      // compilador so aceita esta linha enquanto continuarem coincidindo.
      // Um cast aqui silenciaria exatamente o alarme que interessa.
      studentStatus: deviceUser.student.status,
    };
  }
}
