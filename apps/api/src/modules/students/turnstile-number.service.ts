import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { DeviceReaderNumberRepository } from '../devices/device-reader-number.repository.js';
import { DeviceRepository } from '../devices/device.repository.js';
import { proximoNumeroLivre } from '../devices/domain/proximo-numero-livre.js';
import {
  CredencialJaAtribuidaError,
  StudentCredentialRepository,
} from './student-credential.repository.js';

const MAXIMO_DE_TENTATIVAS = 5;

/**
 * Numero de catraca automatico -- o aluno nasce com ele e a recepcao so
 * digita no leitor o que a tela mostra (spec 2026-10-03).
 *
 * IDEMPOTENTE POR ALUNO, nesta ordem:
 *   1. quem ja tem `FACIAL_ENROLL_ID` recebe o mesmo numero;
 *   2. senao, quem ja esta vivo no leitor (`DeviceUser` SYNCED -- aluno
 *      legado, vinculado sem credencial facial) recebe o numero do vinculo,
 *      e NADA e gravado;
 *   3. senao, gera.
 * Trocar em silencio deixaria a face ja cadastrada no leitor sob o numero
 * antigo -- a catraca passaria a recusar a pessoa, ou a recepcao cadastraria
 * uma segunda face. Cartao (`TURNSTILE_CARD`) NAO conta como numero do
 * leitor: numero de cartao RFID pode nao ser um enrollid.
 *
 * Corrida entre geracoes e decidida pelo UNIQUE do banco: a perdedora
 * recalcula. O calculo e deterministico (menor numero livre), entao N
 * chamadas simultaneas disputam o MESMO numero e a ultima precisa de ate N
 * tentativas -- por isso o teto e `MAXIMO_DE_TENTATIVAS`, nao uma so.
 * Esgotadas, sobe o erro de credencial ocupada.
 */
@Injectable()
export class TurnstileNumberService {
  constructor(
    private readonly credenciais: StudentCredentialRepository,
    private readonly numerosDoLeitor: DeviceReaderNumberRepository,
    private readonly dispositivos: DeviceRepository,
  ) {}

  async proximoLivre(tenantId: string): Promise<string> {
    const [doLeitor, deCredencial, vinculados] = await Promise.all([
      this.numerosDoLeitor.listarNumerosDoTenant(tenantId),
      this.credenciais.listarNumerosDoTenant(tenantId),
      this.dispositivos.listarNumerosVinculadosDoTenant(tenantId),
    ]);

    return proximoNumeroLivre(new Set([...doLeitor, ...deCredencial, ...vinculados]));
  }

  async gerar(
    contexto: TenantContext,
    studentId: string,
  ): Promise<{ externalId: string; created: boolean }> {
    const atuais = await this.credenciais.listarPorAluno(contexto, studentId);
    const facial = atuais.find((c) => c.kind === 'FACIAL_ENROLL_ID');
    if (facial) return { externalId: facial.externalId, created: false };

    const vinculado = await this.dispositivos.numeroVinculadoDoAluno(contexto.tenantId, studentId);
    if (vinculado !== null) return { externalId: vinculado, created: false };

    for (let tentativa = 0; ; tentativa += 1) {
      const numero = await this.proximoLivre(contexto.tenantId);
      try {
        const criada = await this.credenciais.definir(
          contexto,
          studentId,
          'FACIAL_ENROLL_ID',
          numero,
        );
        return { externalId: criada.externalId, created: true };
      } catch (erro: unknown) {
        const colidiu =
          erro instanceof CredencialJaAtribuidaError ||
          (typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002');
        if (!colidiu || tentativa >= MAXIMO_DE_TENTATIVAS - 1) throw erro;
      }
    }
  }
}
