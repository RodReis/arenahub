import { Injectable } from '@nestjs/common';

import {
  type ErroDoExtrator,
  type MediaFetcher,
  type MotivoDeFalhaDeExtracao,
  type ResultadoDaExtracao,
} from './media-fetcher.port.js';

/**
 * Dublê do extrator de midia, no BOUNDARY (`docs/TESTING.md`).
 *
 * Existe porque o adapter real depende de um binario externo e da rede: um
 * teste que baixasse reel de verdade falharia quando a Meta mudasse algo,
 * transformando quebra de terceiro em CI vermelho sem defeito nosso.
 *
 * DEVOLVE MP4 PLAUSIVEL POR PADRAO -- cabecalho `ftyp` real, nao bytes
 * aleatorios. `aceitarMidia` (`domain/midia-do-totem.ts`) confere assinatura
 * de arquivo, entao um dublê que devolvesse lixo faria o teste do caminho
 * feliz falhar na validacao de formato, e a correcao obvia seria afrouxar a
 * validacao -- exatamente a garantia que nao se quer perder.
 */

/**
 * Cabecalho de MP4 (`ftypisom`) seguido de enchimento.
 *
 * Os primeiros 4 bytes sao o tamanho do box; os 4 seguintes, `ftyp`. E o que
 * `aceitarMidia` procura.
 */
function mp4Plausivel(tamanhoBytes = 4096): Uint8Array {
  const bytes = new Uint8Array(tamanhoBytes);

  bytes.set([0x00, 0x00, 0x00, 0x20], 0);
  bytes.set(new TextEncoder().encode('ftypisom'), 4);

  return bytes;
}

@Injectable()
export class FakeMediaFetcherAdapter implements MediaFetcher {
  /** Falha da FERRAMENTA -- diferente de midia indisponivel. */
  private erroProgramado: ErroDoExtrator | null = null;
  private motivoProgramado: MotivoDeFalhaDeExtracao | null = null;
  private tamanhoProgramado: number | null = null;

  /** So do dublê: a proxima chamada lanca (extrator fora do ar/timeout). */
  programarErro(erro: ErroDoExtrator): void {
    this.erroProgramado = erro;
  }

  /** So do dublê: a proxima chamada devolve falha de EXTRACAO, sem lancar. */
  programarFalha(motivo: MotivoDeFalhaDeExtracao): void {
    this.motivoProgramado = motivo;
  }

  /** So do dublê: o tamanho do MP4 devolvido -- para exercitar o teto. */
  programarTamanho(bytes: number): void {
    this.tamanhoProgramado = bytes;
  }

  resetar(): void {
    this.erroProgramado = null;
    this.motivoProgramado = null;
    this.tamanhoProgramado = null;
  }

  baixar(_url: string, tetoBytes: number): Promise<ResultadoDaExtracao> {
    if (this.erroProgramado) {
      return Promise.reject(this.erroProgramado);
    }

    if (this.motivoProgramado) {
      return Promise.resolve({ extraido: false, motivo: this.motivoProgramado });
    }

    const tamanho = this.tamanhoProgramado ?? 4096;

    // O teto e checado AQUI tambem, e nao so no caso de uso: o adapter real
    // aborta o download ao passar do limite (nao adianta baixar 400 MB para
    // recusar depois), e o dublê que ignorasse isso deixaria passar um teste
    // que a producao reprovaria.
    if (tamanho > tetoBytes) {
      return Promise.resolve({ extraido: false, motivo: 'MIDIA_GRANDE_DEMAIS' });
    }

    return Promise.resolve({
      extraido: true,
      conteudo: mp4Plausivel(tamanho),
      contentType: 'video/mp4',
    });
  }
}
