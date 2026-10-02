import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { PrismaService } from '../../persistence/prisma.service.js';

/**
 * So o DONO da academia mexe no perfil Dono -- #523.
 *
 * Decisao do PI (02/10/2026): o gerente passou a ter `user.manage` para
 * administrar a equipe, mas o perfil Dono continua protegido. Sem esta guarda,
 * quem convida poderia convidar alguem (ou a si mesmo, por outro e-mail) como
 * Dono, e quem revoga poderia tirar um dono enquanto houvesse outro.
 */
export class SoDonoMexeEmDonoError extends ErroDeDominio {
  constructor() {
    super(
      'SO_DONO_MEXE_EM_DONO',
      403,
      'Só o dono da academia pode convidar ou revogar alguém com o perfil Dono',
    );
  }
}

/** O ator tem o perfil Dono neste tenant? */
export async function ehDono(
  db: PrismaService,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const papel = await db.userRole.findFirst({
    where: { tenantId, userId, role: { name: 'OWNER' } },
    select: { roleId: true },
  });

  return papel !== null;
}
