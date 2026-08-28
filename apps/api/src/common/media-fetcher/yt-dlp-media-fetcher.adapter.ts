import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

import {
  ErroDoExtrator,
  type MediaFetcher,
  type ResultadoDaExtracao,
} from './media-fetcher.port.js';

/**
 * Extracao de midia com `yt-dlp` (ADR-042, Decisao 7).
 *
 * ---------------------------------------------------------------------------
 * `execFile`, NUNCA `exec`.
 * ---------------------------------------------------------------------------
 *
 * `exec` passaria a linha por um SHELL, e a URL viria a ser interpretada por
 * ele. Mesmo com `aceitarLinkDeReel` filtrando antes, depender de UMA camada
 * para seguranca de execucao e frágil: `execFile` entrega os argumentos como
 * vetor, e nao ha shell no caminho para interpretar coisa nenhuma. As duas
 * defesas sao independentes de proposito.
 *
 * ---------------------------------------------------------------------------
 * O DOWNLOAD ACONTECE AQUI, E SO AQUI.
 * ---------------------------------------------------------------------------
 *
 * Trava 1 do ADR: no ato de salvar o bloco, com o gerente olhando -- nunca em
 * runtime, nunca no totem. Este adapter e chamado pelo caso de uso do PAINEL;
 * nenhum caminho do `kiosk` o alcanca.
 *
 * ---------------------------------------------------------------------------
 * PARA DISCO, E NAO PARA `stdout`.
 * ---------------------------------------------------------------------------
 *
 * `yt-dlp -o -` escreveria o MP4 em `stdout`, e `execFile` bufferiza stdout
 * inteiro em memoria -- 40 MB por chamada, mais o overhead de string. Com
 * diretorio temporario o processo escreve arquivo, lemos os bytes uma vez e
 * apagamos. O `finally` garante a limpeza mesmo quando o download falha no
 * meio.
 */

/** Binario invocado. Sobrescrevivel por ambiente -- ver `MediaFetcherModule`. */
const BINARIO_PADRAO = process.env['YTDLP_BIN'] ?? 'yt-dlp';

/**
 * Teto de tempo do processo.
 *
 * Existe porque a Meta as vezes SEGURA a resposta em vez de recusar, e sem
 * limite o pedido do painel ficaria pendurado ate o gerente desistir --
 * exatamente o oposto da trava 1, que promete resposta enquanto ele olha.
 */
const TIMEOUT_MS = 90_000;

/**
 * Trechos que o `yt-dlp` imprime quando o POST nao esta acessivel.
 *
 * Comparacao por texto porque a ferramenta nao expoe codigo de saida
 * distinto entre "nao existe" e "quebrou" -- os dois sao exit 1. E fragil, e
 * a fragilidade e o ponto: quando a Meta mudar as mensagens, isto para de
 * casar e cai em `EXTRATOR_FALHOU`, que o painel mostra como "a ferramenta
 * falhou", NUNCA como "seu link esta errado". O erro degrada para o lado
 * seguro.
 */
const SINAIS_DE_INDISPONIVEL = [
  /*
   * A MENSAGEM QUE O INSTAGRAM REALMENTE DEVOLVE para post inexistente,
   * privado ou que exige login -- verificada contra a ferramenta em
   * 28/08/2026, com `/reel/ZZZZnaoexisteZZ/`.
   *
   * Sem ela, um link errado caia em `EXTRATOR_FALHOU` (503, "a ferramenta
   * quebrou") em vez de 422 ("troque o link"). A lista tinha oito frases
   * plausiveis e nenhuma era esta: teste verde nao prova traducao correta
   * quando o dublê e quem escolhe a mensagem.
   */
  'empty media response',
  'video unavailable',
  'post unavailable',
  'requested content is not available',
  'login required',
  'private',
  'this post is not available',
  'unable to extract shared data',
  'no video formats found',
  'there is no video',
];

@Injectable()
export class YtDlpMediaFetcherAdapter implements MediaFetcher {
  constructor(private readonly binario: string = BINARIO_PADRAO) {}

  async baixar(url: string, tetoBytes: number): Promise<ResultadoDaExtracao> {
    const pasta = await mkdtemp(join(tmpdir(), 'arenahub-reel-'));
    const destino = join(pasta, 'midia.mp4');

    try {
      await this.executar([
        // Nao segue playlist: um link de perfil ou de colecao baixaria N
        // videos, e o bloco guarda UM.
        '--no-playlist',
        '--no-warnings',
        // Aborta em vez de baixar 400 MB para recusar depois. O teto e o
        // mesmo `TAMANHO_MAXIMO_DE_MIDIA_BYTES` que o upload de MP4 aplica.
        '--max-filesize',
        String(tetoBytes),
        // MP4 -- e o que a tela publica toca e o que `aceitarMidia` aceita.
        '-f',
        'mp4/best[ext=mp4]/best',
        '-o',
        destino,
        // `--` encerra as opcoes: sem ele, uma URL que comecasse com `-`
        // seria lida como flag. `aceitarLinkDeReel` ja o impede, e esta e a
        // segunda camada.
        '--',
        url,
      ]);
    } catch (erro) {
      await rm(pasta, { recursive: true, force: true });

      return this.traduzir(erro);
    }

    try {
      const conteudo = await readFile(destino);

      /*
       * `--max-filesize` ABORTA o download, mas a ferramenta nem sempre o
       * respeita quando o servidor omite `Content-Length` -- e ai o arquivo
       * chega inteiro. Conferir o tamanho DEPOIS de ler e a checagem que
       * nao depende do comportamento da ferramenta.
       */
      if (conteudo.byteLength > tetoBytes) {
        return { extraido: false, motivo: 'MIDIA_GRANDE_DEMAIS' };
      }

      return {
        extraido: true,
        conteudo: new Uint8Array(conteudo),
        /*
         * `video/mp4` FIXO, e nao derivado do nome do arquivo: o
         * content-type declarado aqui nao e prova de nada -- quem prova o
         * formato e `aceitarMidia`, lendo a assinatura dos bytes. Declarar
         * o que se pediu (`-f mp4`) e honesto; adivinhar pela extensao
         * seria teatro.
         */
        contentType: 'video/mp4',
      };
    } catch {
      /*
       * O processo saiu com sucesso mas nao ha arquivo: e o caso do
       * `--max-filesize` que abortou, e tambem o do post sem faixa de video.
       * Os dois sao "nao deu para trazer midia", nao falha de ferramenta.
       */
      return { extraido: false, motivo: 'MIDIA_SEM_VIDEO' };
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  }

  private executar(argumentos: readonly string[]): Promise<void> {
    return new Promise((resolver, rejeitar) => {
      execFile(
        this.binario,
        [...argumentos],
        { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        // `execFile` sempre entrega `ExecFileException` (um `Error`) no
        // caminho de falha -- a checagem existe para o contrato de rejeitar
        // SEMPRE com `Error`, e o `else` e inalcancavel na pratica. Nao ha
        // `String(erro)` aqui: um objeto que nao e `Error` viraria
        // "[object Object]", que esconde a causa em vez de mostra-la.
        (erro) =>
          erro
            ? rejeitar(erro instanceof Error ? erro : new Error('Extrator falhou.'))
            : resolver(),
      );
    });
  }

  /**
   * Erro do processo -> veredito ou `ErroDoExtrator`.
   *
   * A distincao e a razao de a porta existir: "seu reel nao esta la" o
   * gerente resolve trocando o link; "a ferramenta quebrou" ninguem resolve
   * pela tela. Confundir os dois faria o gerente caçar um defeito que nao e
   * dele.
   */
  private traduzir(erro: unknown): ResultadoDaExtracao {
    const falha = erro as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };

    if (falha?.code === 'ENOENT') {
      throw new ErroDoExtrator(
        'EXTRATOR_INDISPONIVEL',
        `Extrator de midia nao encontrado (${this.binario}).`,
      );
    }

    // `killed` marca a morte pelo timeout do `execFile`.
    if (falha?.killed === true || falha?.code === 'ETIMEDOUT') {
      throw new ErroDoExtrator('EXTRATOR_TIMEOUT', 'Extrator de midia passou do tempo.');
    }

    const saida = String(falha?.stderr ?? falha?.message ?? '').toLowerCase();

    if (SINAIS_DE_INDISPONIVEL.some((sinal) => saida.includes(sinal))) {
      return { extraido: false, motivo: 'MIDIA_INDISPONIVEL' };
    }

    // NAO reconhecido = ferramenta quebrou. Degrada para o lado seguro: o
    // painel dira que a extracao falhou, nao que o link esta errado.
    throw new ErroDoExtrator('EXTRATOR_FALHOU', 'Extrator de midia falhou.');
  }
}
