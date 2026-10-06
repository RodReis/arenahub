import { Inject, Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { CifradorDeSegredo } from './segredo-cifrado.js';
import { TotpService } from './totp.service.js';

export const CIFRADOR_DE_MFA = Symbol('CIFRADOR_DE_MFA');

const EMISSOR = 'ArenaHub';

export class MfaObrigatorioError extends ErroDeDominio {
  constructor() {
    super('MFA_REQUIRED', 403, 'Segundo fator obrigatorio para este perfil');
  }
}

export class CodigoMfaInvalidoError extends ErroDeDominio {
  constructor() {
    super('MFA_CODE_INVALID', 401, 'Codigo invalido');
  }
}

export class CodigoMfaReutilizadoError extends ErroDeDominio {
  constructor() {
    // Codigo proprio: reuso nao e "tente de novo", e sinal de que alguem
    // interceptou o codigo. O operador precisa distinguir isso no log.
    super('MFA_CODE_REPLAYED', 401, 'Codigo ja utilizado');
  }
}

@Injectable()
export class MfaService {
  constructor(
    private readonly db: PrismaService,
    private readonly totp: TotpService,
    @Inject(CIFRADOR_DE_MFA) private readonly cifrador: CifradorDeSegredo,
  ) {}

  /**
   * Inicia a inscricao. O segredo ja nasce cifrado no banco, com estado
   * `PENDING` -- so vira `ENABLED` depois que o usuario provar que consegue
   * gerar um codigo valido.
   *
   * Ativar direto deixaria o usuario trancado fora da propria conta se o
   * autenticador nao tivesse lido o segredo direito.
   *
   * Reaproveita segredo `PENDING` ja existente em vez de gerar outro: a tela
   * chama esta rota de novo a cada reload/remount, e gerar segredo novo toda
   * vez troca a chave debaixo do usuario que acabou de cadastrar a anterior
   * no autenticador -- o codigo dele nunca bate porque o app tem a chave
   * velha e o banco ja tem outra.
   *
   * Trocar um fator `ENABLED` exige um codigo do fator ATUAL (`codigoAtual`).
   * Sem isso, quem tem so a sessao de um usuario com `billing.refund` trocaria
   * o autenticador dele e passaria o step-up do INV-074 -- que existe
   * justamente para proteger contra sessao roubada.
   */
  async iniciarInscricao(
    userId: string,
    email: string,
    codigoAtual?: string,
  ): Promise<{ uri: string; base32: string }> {
    const usuario = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        mfaStatus: true,
        mfaSecretCiphertext: true,
        mfaSecretIv: true,
        mfaSecretTag: true,
      },
    });

    if (usuario.mfaStatus === 'ENABLED') {
      if (!codigoAtual) throw new MfaObrigatorioError();

      await this.verificar(userId, codigoAtual);
    }

    if (
      usuario.mfaStatus === 'PENDING' &&
      usuario.mfaSecretCiphertext &&
      usuario.mfaSecretIv &&
      usuario.mfaSecretTag
    ) {
      const segredoExistente = this.cifrador.decifrar({
        ciphertext: Buffer.from(usuario.mfaSecretCiphertext),
        iv: Buffer.from(usuario.mfaSecretIv),
        tag: Buffer.from(usuario.mfaSecretTag),
      });
      const base32Existente = this.totp.paraBase32Publico(segredoExistente);

      return {
        uri: this.totp.montarUri(EMISSOR, email, base32Existente),
        base32: base32Existente,
      };
    }

    const segredo = this.totp.gerarSegredo();
    const cifrado = this.cifrador.cifrar(segredo.bytes);

    await this.db.user.update({
      where: { id: userId },
      data: {
        mfaStatus: 'PENDING',
        // `Uint8Array` explicito: o tipo do Prisma 7 nao aceita `Buffer`
        // diretamente, apesar de `Buffer` ser subclasse.
        mfaSecretCiphertext: new Uint8Array(cifrado.ciphertext),
        mfaSecretIv: new Uint8Array(cifrado.iv),
        mfaSecretTag: new Uint8Array(cifrado.tag),
        mfaLastCounter: null,
      },
    });

    return {
      uri: this.totp.montarUri(EMISSOR, email, segredo.base32),
      base32: segredo.base32,
    };
  }

  /** Confirma a inscricao com um codigo valido e ativa o segundo fator. */
  async confirmarInscricao(userId: string, codigo: string): Promise<void> {
    const contador = await this.conferirCodigo(userId, codigo, false);

    await this.gravarContador(userId, contador, { mfaStatus: 'ENABLED' });
  }

  /**
   * Verifica no login e no step-up. Grava o contador para barrar o reuso.
   *
   * So vale para fator `ENABLED`: um segredo `PENDING` ainda nao foi provado
   * pelo dono, entao um codigo dele nao e prova de nada.
   */
  async verificar(userId: string, codigo: string): Promise<void> {
    const contador = await this.conferirCodigo(userId, codigo, true);

    await this.gravarContador(userId, contador, {});
  }

  /**
   * Grava o contador SO se ele ainda for maior que o ultimo. Ler e depois
   * gravar sem condicao deixava dois envios simultaneos do mesmo codigo
   * passarem: os dois liam o contador antigo e os dois gravavam.
   */
  private async gravarContador(
    userId: string,
    contador: bigint,
    extra: { mfaStatus?: 'ENABLED' },
  ): Promise<void> {
    const { count } = await this.db.user.updateMany({
      where: {
        id: userId,
        OR: [{ mfaLastCounter: null }, { mfaLastCounter: { lt: contador } }],
      },
      data: { ...extra, mfaLastCounter: contador },
    });

    if (count === 0) throw new CodigoMfaReutilizadoError();
  }

  private async conferirCodigo(
    userId: string,
    codigo: string,
    exigirAtivo: boolean,
  ): Promise<bigint> {
    const usuario = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        mfaStatus: true,
        mfaSecretCiphertext: true,
        mfaSecretIv: true,
        mfaSecretTag: true,
        mfaLastCounter: true,
      },
    });

    if (!usuario?.mfaSecretCiphertext || !usuario.mfaSecretIv || !usuario.mfaSecretTag) {
      throw new CodigoMfaInvalidoError();
    }

    if (exigirAtivo && usuario.mfaStatus !== 'ENABLED') throw new CodigoMfaInvalidoError();

    const segredo = this.cifrador.decifrar({
      ciphertext: Buffer.from(usuario.mfaSecretCiphertext),
      iv: Buffer.from(usuario.mfaSecretIv),
      tag: Buffer.from(usuario.mfaSecretTag),
    });

    const resultado = this.totp.verificar(
      segredo,
      codigo,
      Math.floor(Date.now() / 1000),
      usuario.mfaLastCounter,
    );

    if (resultado.motivo === 'REPLAY') throw new CodigoMfaReutilizadoError();
    if (!resultado.valido || resultado.contador === null) throw new CodigoMfaInvalidoError();

    return resultado.contador;
  }
}
