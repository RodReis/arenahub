import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  MALWARE_SCANNER,
  ErroDoScanner,
  type MalwareScanner,
} from '../../common/antivirus/malware-scanner.port.js';
import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import {
  OBJECT_STORAGE,
  montarChaveDeMidia,
  type ObjectStoragePort,
} from '../../common/storage/object-storage.port.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { CONTENT_TYPE_DE_MIDIA, aceitarMidia } from './domain/midia-do-totem.js';

/** Quantos bytes do inicio bastam para reconhecer o container ISO-BMFF. */
const BYTES_DO_CABECALHO = 16;

export interface MidiaRecebida {
  readonly originalFilename: string;
  readonly contentType: string;
  readonly conteudo: Uint8Array;
}

export interface MidiaEnviada {
  /** O que vai para `blocos.itens[].midiaKey` no rascunho da configuracao. */
  readonly midiaKey: string;
}

/**
 * Upload de midia da tela publica (F51, ADR-042 Decisao 7).
 *
 * A ORDEM DAS OPERACOES E A DEFESA, e ela e herdada do `import.service.ts`
 * da F19 pelo mesmo motivo:
 *
 *   1. tamanho, tipo declarado e ASSINATURA do arquivo;
 *   2. o antivirus escaneia ANTES de qualquer coisa tocar o storage;
 *   3. so entao o arquivo e guardado, com chave gerada pelo SERVIDOR.
 *
 * Inverter 2 e 3 guardaria malware no bucket.
 *
 * DIFERENTE DA F19 num ponto: la o upload nasce como LINHA no banco, com
 * estado (`INFECTED`, `FAILED`), porque um laudo recusado precisa aparecer
 * na lista de falhas para a recepcao digitar a avaliacao a mao. Aqui nao ha
 * fila nem retomada: video recusado e erro devolvido ao gerente, que esta
 * olhando a tela naquele instante. Criar tabela de estado para isso seria
 * armazenar o que ninguem consulta.
 */
@Injectable()
export class KioskMediaService {
  constructor(
    private readonly db: PrismaService,
    @Inject(MALWARE_SCANNER) private readonly antivirus: MalwareScanner,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async enviar(
    contexto: TenantContext,
    kioskDeviceId: string,
    midia: MidiaRecebida,
  ): Promise<MidiaEnviada> {
    const device = await this.exigirDevice(contexto, kioskDeviceId);

    // --- 1. FORMATO ------------------------------------------------------
    const aceitacao = aceitarMidia({
      tamanhoBytes: midia.conteudo.byteLength,
      contentType: midia.contentType,
      cabecalho: midia.conteudo.subarray(0, BYTES_DO_CABECALHO),
    });

    if (!aceitacao.aceito) {
      throw new ErroDeDominio(aceitacao.motivo, 400, 'Mídia recusada.');
    }

    // --- 2. ANTIVIRUS, ANTES DE TOCAR O STORAGE --------------------------
    //
    // O `try` envolve SO a chamada, e nao a decisao sobre o veredito: com o
    // `throw` do infectado dentro do bloco, ele cairia no proprio `catch` e
    // sobreviveria por nao ser `ErroDoScanner` -- funcionando por acidente.
    // Mover uma linha ali dentro depois transformaria "infectado" em
    // "scanner fora do ar", que sao 422 e 503, acoes opostas.
    let veredito;

    try {
      veredito = await this.antivirus.escanear(midia.conteudo);
    } catch (erro) {
      // Scanner FORA DO AR e diferente de arquivo infectado: aqui nao se
      // sabe se o arquivo e seguro, e na duvida ele NAO entra no storage.
      if (erro instanceof ErroDoScanner) {
        throw new ErroDeDominio(erro.codigo, 503, 'Antivírus indisponível. Tente de novo.');
      }

      throw erro;
    }

    if (!veredito.limpo) {
      // A ameaca vai no CODIGO de auditoria, nunca na mensagem ao gerente:
      // nome de assinatura de virus na tela nao ajuda quem esta la e
      // confirma ao remetente qual payload passou pela deteccao.
      throw new ErroDeDominio('FILE_INFECTED', 422, 'Mídia recusada pelo antivírus.');
    }

    // --- 3. STORAGE, so depois de limpo -----------------------------------
    const midiaKey = montarChaveDeMidia(contexto.tenantId, device.gymUnitId, randomUUID());

    await this.storage.putPrivateObject({
      key: midiaKey,
      body: Buffer.from(midia.conteudo),
      contentType: CONTENT_TYPE_DE_MIDIA,
    });

    return { midiaKey };
  }

  /** Device de OUTRO tenant responde 404, nunca 403 -- mesma regra da F50. */
  private async exigirDevice(
    contexto: TenantContext,
    kioskDeviceId: string,
  ): Promise<{ id: string; gymUnitId: string }> {
    const device = await this.db.kioskDevice.findFirst({
      where: { id: kioskDeviceId, tenantId: contexto.tenantId },
      select: { id: true, gymUnitId: true },
    });

    if (!device) {
      throw new NotFoundException({ code: 'KIOSK_DEVICE_NOT_FOUND' });
    }

    return device;
  }
}
