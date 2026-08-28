import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  MALWARE_SCANNER,
  ErroDoScanner,
  type MalwareScanner,
} from '../../common/antivirus/malware-scanner.port.js';
import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import {
  MEDIA_FETCHER,
  ErroDoExtrator,
  type MediaFetcher,
} from '../../common/media-fetcher/media-fetcher.port.js';
import {
  OBJECT_STORAGE,
  montarChaveDeMidia,
  type ObjectStoragePort,
} from '../../common/storage/object-storage.port.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { CONTENT_TYPE_DE_MIDIA, TAMANHO_MAXIMO_DE_MIDIA_BYTES, aceitarMidia } from './domain/midia-do-totem.js';
import { aceitarLinkDeReel } from './domain/link-de-reel.js';

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

export interface MidiaIngerida extends MidiaEnviada {
  /**
   * A URL CANONICA do reel -- o que o bloco guarda em `linkExterno`.
   *
   * Devolvida junto da chave porque o painel precisa gravar a forma
   * normalizada, nao a que o gerente colou: senao o mesmo reel copiado de
   * dois lugares vira dois links no banco.
   */
  readonly linkExterno: string;
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
    @Inject(MEDIA_FETCHER) private readonly extrator: MediaFetcher,
  ) {}

  /**
   * Baixa um reel do Instagram e o guarda como midia da tela publica
   * (ADR-042, Decisao 7).
   *
   * DESAGUA EM `enviar`, e essa e a decisao inteira: formato, antivirus e
   * storage acontecem UMA vez, no mesmo lugar do upload de MP4. Um caminho
   * proprio para o link teria de repetir as tres travas, e a primeira que
   * alguem esquecesse viraria o buraco -- midia de TERCEIRO entrando no
   * bucket sem escaneamento e pior que arquivo que o gerente escolheu.
   *
   * A validacao do LINK acontece antes de tudo, inclusive antes de tocar o
   * banco: a URL vira argumento de um processo que baixa o que ela apontar,
   * e host livre e SSRF (ver `domain/link-de-reel.ts`).
   *
   * Trava 1 do ADR: isto roda no ato de salvar o bloco, no PAINEL, com o
   * gerente olhando. Nenhum caminho do totem chega aqui.
   */
  async ingerirDeLink(
    contexto: TenantContext,
    kioskDeviceId: string,
    link: string,
  ): Promise<MidiaIngerida> {
    const aceitacao = aceitarLinkDeReel(link);

    if (!aceitacao.aceito) {
      throw new ErroDeDominio(
        aceitacao.motivo,
        400,
        'Link inválido. Cole o endereço de um reel ou post do Instagram.',
      );
    }

    // O device ANTES do download: baixar 25 MB para descobrir que o totem e
    // de outro tenant gastaria rede e tempo do gerente por nada.
    await this.exigirDevice(contexto, kioskDeviceId);

    let extracao;

    try {
      extracao = await this.extrator.baixar(aceitacao.url, TAMANHO_MAXIMO_DE_MIDIA_BYTES);
    } catch (erro) {
      /*
       * FERRAMENTA QUEBRADA E 503, NUNCA ERRO DO LINK.
       *
       * E a distincao que o ADR exige por escrito: no dia em que a Meta
       * mudar e a extracao parar para TODO reel, o painel tem de dizer "a
       * ferramenta falhou". Dizer "seu link esta errado" faria o gerente
       * trocar de link para sempre, atras de um defeito que nao e dele.
       */
      if (erro instanceof ErroDoExtrator) {
        throw new ErroDeDominio(
          erro.codigo,
          503,
          'Não foi possível copiar o vídeo do Instagram agora. Envie um MP4 ou tente mais tarde.',
        );
      }

      throw erro;
    }

    if (!extracao.extraido) {
      // 422 e nao 400: o link esta bem formado, o conteudo e que nao veio.
      // A acao do gerente e outra -- trocar o reel, nao corrigir a URL.
      throw new ErroDeDominio(
        extracao.motivo,
        422,
        'Não foi possível copiar esse vídeo. Confira se o post é público e tem vídeo.',
      );
    }

    const { midiaKey } = await this.enviar(contexto, kioskDeviceId, {
      originalFilename: `${aceitacao.codigo}.mp4`,
      contentType: extracao.contentType,
      conteudo: extracao.conteudo,
    });

    return { midiaKey, linkExterno: aceitacao.url };
  }

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
    // O `try` envolve SO a chamada, e nao a decisao sobre o veredito.
    //
    // HONESTIDADE SOBRE O QUE ISTO GARANTE, medida por mutacao em
    // 26/08/2026: pôr o `throw` do infectado DENTRO do `try` NAO muda o
    // comportamento hoje -- ele cai no proprio `catch`, nao e
    // `ErroDoScanner`, e sai relancado intacto. Nenhum teste distingue as
    // duas formas, porque nao ha entrada que as separe.
    //
    // O que a separacao compra e o PROXIMO `catch`: no dia em que este
    // bloco tratar mais um tipo de erro -- ou o `if (erro instanceof ...)`
    // virar um `else` generico --, "infectado" (422) passaria a ser
    // respondido como "scanner fora do ar" (503), que sao acoes opostas.
    // E disciplina contra o futuro, nao correcao de defeito presente.
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
