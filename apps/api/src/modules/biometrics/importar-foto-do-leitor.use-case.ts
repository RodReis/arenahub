import { Injectable, NotFoundException } from '@nestjs/common';

import type { ContextoDoEdge } from '../edge-auth/edge-auth.service.js';
import { DeviceRepository } from '../devices/device.repository.js';
import { StudentPhotoService } from '../students/student-photo.service.js';
import { BiometricIdentityRepository } from './biometric-identity.repository.js';

/**
 * Foto do aluno a partir do leitor facial -- issue #503 (pedido do PI,
 * 01/10/2026; base: ADR-064).
 *
 * O leitor guarda a foto de cadastro de cada pessoa (`getuserinfo`,
 * `backupnum: 50`). O Edge pergunta QUEM precisa de foto e manda uma por
 * vez: so numero ja VINCULADO a aluno (#468), e so aluno SEM foto -- reenviar
 * a base inteira a cada reinicio do agente custaria minutos de leitor ocupado
 * para nao mudar nada.
 */
@Injectable()
export class ImportarFotoDoLeitorUseCase {
  constructor(
    private readonly dispositivos: DeviceRepository,
    private readonly identidades: BiometricIdentityRepository,
    private readonly fotos: StudentPhotoService,
  ) {}

  /** Numeros deste leitor cujo aluno ainda nao tem foto. */
  async pendentes(edge: ContextoDoEdge, deviceSerial: string): Promise<string[]> {
    const leitor = await this.resolverLeitor(edge, deviceSerial);
    const vinculos = await this.identidades.vinculosDoDispositivo(edge.tenantId, leitor.id);
    const semFoto = await this.fotos.semFoto(
      edge.tenantId,
      vinculos.map((v) => v.studentId),
    );

    return vinculos.filter((v) => semFoto.has(v.studentId)).map((v) => v.externalUserId);
  }

  async importar(
    edge: ContextoDoEdge,
    entrada: { deviceSerial: string; externalUserId: string; conteudo: Uint8Array },
  ): Promise<'IMPORTED' | 'ALREADY_HAS_PHOTO'> {
    const leitor = await this.resolverLeitor(edge, entrada.deviceSerial);
    const studentId = await this.identidades.alunoDoNumero(
      edge.tenantId,
      leitor.id,
      entrada.externalUserId,
    );

    // Numero sem vinculo: nao ha de quem seja a foto. Nunca adivinhar pelo
    // cadastro -- e o vinculo (#468) que decide quem e esta pessoa.
    if (!studentId) throw new NotFoundException({ code: 'DEVICE_USER_NOT_LINKED' });

    return this.fotos.importarDoLeitor(edge.tenantId, studentId, entrada.conteudo);
  }

  private async resolverLeitor(edge: ContextoDoEdge, serial: string): Promise<{ id: string }> {
    const leitor = await this.dispositivos.resolverDoEdgePorSerial(edge, serial);

    if (!leitor) throw new NotFoundException({ code: 'DEVICE_NOT_IN_SCOPE' });

    return leitor;
  }
}
