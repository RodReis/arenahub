import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { PrismaService } from '../../persistence/prisma.service.js';
import { EdgeAuthService } from './edge-auth.service.js';

export type ResultadoDeTroca =
  | { estado: 'trocado'; keyId: string; secret: string }
  | { estado: 'recusado' };

/**
 * Troca codigo de pareamento de uso unico por credencial de Edge (ADR-011).
 *
 * Autenticacao desta troca NAO e HMAC -- e o proprio codigo, de alta
 * entropia e TTL curto. Faz sentido: o agente ainda nao tem `keyId`/
 * `secret` neste ponto, entao nao ha o que assinar.
 */
@Injectable()
export class PairingService {
  constructor(
    private readonly db: PrismaService,
    private readonly edgeAuth: EdgeAuthService,
  ) {}

  /**
   * Troca um codigo de pareamento por credencial nova. Uso unico: o codigo
   * morre na troca, valida ou invalida -- reapresentar o mesmo codigo depois
   * de usado e SEMPRE recusado, mesmo que o uso anterior tenha sido
   * bem-sucedido (ADR-011).
   *
   * Mensagem de recusa NUNCA diferencia "nao existe" de "expirado" de "ja
   * usado" -- um atacante tentando codigos nao aprende qual dos tres motivos
   * causou a recusa.
   */
  async trocar(codigoEmClaro: string): Promise<ResultadoDeTroca> {
    const hash = createHash('sha256').update(codigoEmClaro).digest('hex');

    const codigo = await this.db.edgePairingCode.findFirst({
      where: { codeHash: hash, usedAt: null, expiresAt: { gt: new Date() } },
    });

    if (!codigo) return { estado: 'recusado' };

    // Marca usado ANTES de gerar a credencial: se o processo morrer entre as
    // duas escritas, o pior caso e um codigo queimado sem credencial -- nunca
    // uma credencial sem o codigo marcado como usado (que permitiria reuso).
    //
    // O `updateMany` condicionado a `usedAt: null` e o indice de exclusao
    // mutua que decide qual requisicao concorrente vence -- nunca confiar em
    // `if` isolado para exclusividade, a condicao vai na propria escrita.
    const atualizados = await this.db.edgePairingCode.updateMany({
      where: { id: codigo.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Corrida: outra requisicao venceu entre o findFirst e o updateMany.
    if (atualizados.count === 0) return { estado: 'recusado' };

    const keyId = randomBytes(16).toString('base64url');
    const secret = randomBytes(32).toString('base64url');

    await this.db.edgeCredential.create({
      data: {
        tenantId: codigo.tenantId,
        edgeNodeId: codigo.edgeNodeId,
        keyId,
        encryptedSecret: this.edgeAuth.cifrarSegredo(secret),
        activeFrom: new Date(),
      },
    });

    return { estado: 'trocado', keyId, secret };
  }
}
