import { Injectable } from '@nestjs/common';
import {
  assinar,
  assinaturaConfere,
  calcularHashDoNonce,
  timestampEstaNaJanela,
  type MotivoDeRecusa,
} from '@arenahub/api-contracts';

import { carregarConfig } from '../../config/env.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { CifradorDeSegredo } from '../auth/segredo-cifrado.js';

/** Identidade do Edge, resolvida EXCLUSIVAMENTE da credencial. */
export interface ContextoDoEdge {
  tenantId: string;
  gymUnitId: string;
  edgeNodeId: string;
  keyId: string;
}

export type ResultadoDaVerificacao =
  | { ok: true; contexto: ContextoDoEdge }
  | { ok: false; motivo: MotivoDeRecusa };

/** O que chega no fio, ja extraido dos cabecalhos. */
export interface RequisicaoAssinadaRecebida {
  keyId: string;
  timestamp: string;
  nonce: string;
  signature: string;
  method: string;
  pathAndQuery: string;
  body: string;
}

/**
 * Verifica requisicao assinada do Edge.
 *
 * A ORDEM DAS CHECAGENS IMPORTA e nao e estetica:
 *
 *   1. formato e janela de relogio -- barato, e descarta ruido antes de
 *      tocar o banco;
 *   2. credencial ativa -- uma consulta;
 *   3. assinatura -- so depois de ter o segredo;
 *   4. nonce -- POR ULTIMO, e dentro de transacao. Gravar nonce antes de
 *      validar a assinatura deixaria qualquer um encher a tabela mandando
 *      lixo assinado com chave inventada.
 */
@Injectable()
export class EdgeAuthService {
  private readonly cifrador: CifradorDeSegredo;

  constructor(private readonly db: PrismaService) {
    // Mesma chave do segredo TOTP: e a chave de segredo simetrico da
    // aplicacao, e ter duas gera duas chances de perder uma.
    this.cifrador = new CifradorDeSegredo(carregarConfig().mfa.chave);
  }

  async verificar(
    recebida: RequisicaoAssinadaRecebida,
    agora: Date,
  ): Promise<ResultadoDaVerificacao> {
    if (!recebida.keyId || !recebida.signature || !recebida.nonce || !recebida.timestamp) {
      return { ok: false, motivo: 'EDGE_SIGNATURE_MISSING' };
    }

    const timestamp = Number(recebida.timestamp);

    if (!Number.isInteger(timestamp)) {
      return { ok: false, motivo: 'EDGE_SIGNATURE_INVALID' };
    }

    // Antes do banco: relogio torto e o erro mais comum em campo, e nao
    // merece uma consulta.
    if (!timestampEstaNaJanela(timestamp, Math.floor(agora.getTime() / 1000))) {
      return { ok: false, motivo: 'EDGE_TIMESTAMP_OUT_OF_WINDOW' };
    }

    const credencial = await this.db.edgeCredential.findUnique({
      where: { keyId: recebida.keyId },
      include: { edgeNode: { select: { id: true, tenantId: true, gymUnitId: true, status: true } } },
    });

    if (!credencial) return { ok: false, motivo: 'EDGE_KEY_UNKNOWN' };

    // Revogacao e IMEDIATA (nao espera expirar), e Edge suspenso nao fala.
    if (credencial.revokedAt !== null || credencial.edgeNode.status !== 'ACTIVE') {
      return { ok: false, motivo: 'EDGE_KEY_REVOKED' };
    }

    if (credencial.activeFrom > agora) {
      return { ok: false, motivo: 'EDGE_KEY_UNKNOWN' };
    }

    // Credencial vencida nao autentica -- ADR-011: "a credencial de uso e de
    // vida curta e o agente a renova sozinho".
    //
    // `expiresAt` NULO significa "sem prazo", nao "prazo desconhecido":
    // credencial criada em F8, antes da coluna existir, continua valendo.
    // Tratar nulo como vencido derrubaria a catraca de quem ja esta
    // instalado no primeiro deploy desta fatia.
    //
    // Reusa `EDGE_KEY_REVOKED`: para quem opera, vencida e revogada pedem a
    // mesma acao -- emitir credencial nova. Um codigo proprio distinguiria
    // dois casos que levam ao mesmo botao.
    if (credencial.expiresAt !== null && credencial.expiresAt <= agora) {
      return { ok: false, motivo: 'EDGE_KEY_REVOKED' };
    }

    const segredo = this.decifrarSegredo(credencial.encryptedSecret);

    const esperada = assinar(
      {
        keyId: recebida.keyId,
        timestamp,
        nonce: recebida.nonce,
        method: recebida.method,
        pathAndQuery: recebida.pathAndQuery,
        body: recebida.body,
      },
      segredo,
    );

    if (!assinaturaConfere(esperada, recebida.signature)) {
      return { ok: false, motivo: 'EDGE_SIGNATURE_INVALID' };
    }

    // Assinatura valida: agora sim o nonce pode ser gravado.
    const inedito = await this.registrarNonce(
      credencial.edgeNodeId,
      recebida.keyId,
      recebida.nonce,
      agora,
    );

    if (!inedito) return { ok: false, motivo: 'EDGE_REPLAY_DETECTED' };

    return {
      ok: true,
      contexto: {
        // Tenant e unidade saem da CREDENCIAL, nunca do corpo -- regra de
        // arquitetura no 2. Um Edge nao consegue afirmar ser de outra
        // unidade nem mandando o id certo no payload.
        tenantId: credencial.edgeNode.tenantId,
        gymUnitId: credencial.edgeNode.gymUnitId,
        edgeNodeId: credencial.edgeNodeId,
        keyId: recebida.keyId,
      },
    };
  }

  /**
   * Grava o nonce e devolve `false` se ele ja existia.
   *
   * O INSERT E a checagem: a unique constraint decide. Consultar antes e
   * inserir depois deixaria a corrida aberta -- duas copias da mesma
   * requisicao chegando juntas veriam "nao existe" as duas.
   */
  private async registrarNonce(
    edgeNodeId: string,
    keyId: string,
    nonce: string,
    agora: Date,
  ): Promise<boolean> {
    try {
      await this.db.replayNonce.create({
        data: {
          edgeNodeId,
          keyId,
          // Guarda o hash: o valor bruto nao serve para mais nada depois de
          // verificado.
          nonceHash: calcularHashDoNonce(nonce),
          // Fora da janela de relogio, repetir o nonce ja seria barrado pelo
          // timestamp -- entao a linha pode ser limpa depois disso.
          expiresAt: new Date(agora.getTime() + 300_000),
        },
      });

      return true;
    } catch {
      // Violacao de unique: o nonce ja foi usado.
      return false;
    }
  }

  /** `{ivBase64}:{tagBase64}:{ciphertextBase64}` em coluna unica. */
  private decifrarSegredo(guardado: string): string {
    const [iv, tag, ciphertext] = guardado.split(':');

    if (!iv || !tag || !ciphertext) {
      throw new Error('Credencial de Edge com formato invalido.');
    }

    return this.cifrador
      .decifrar({
        iv: Buffer.from(iv, 'base64'),
        tag: Buffer.from(tag, 'base64'),
        ciphertext: Buffer.from(ciphertext, 'base64'),
      })
      .toString('utf8');
  }

  /** Cifra o segredo para gravar. Usado na criacao e na rotacao. */
  cifrarSegredo(segredo: string): string {
    const cifrado = this.cifrador.cifrar(Buffer.from(segredo, 'utf8'));

    return [
      cifrado.iv.toString('base64'),
      cifrado.tag.toString('base64'),
      cifrado.ciphertext.toString('base64'),
    ].join(':');
  }
}
