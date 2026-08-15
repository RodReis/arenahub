import { spawn, type ChildProcess } from 'node:child_process';

import {
  type PonteEasyInner,
  type ComandoPonte,
  type RespostaPonte,
  esquemaComandoPonte,
  esquemaRespostaPonte,
} from './easyinner-ponte.js';

/**
 * Implementacao de `PonteEasyInner` sobre um processo Windows externo.
 *
 * A `EasyInner.dll` e Windows x86, binaria e nao thread-safe (ver
 * `docs/vendor/topdata/PROTOCOLO-CATRACA.md`). Node nao a chama: um processo
 * .NET x86 (`EasyInnerBridge.exe`) carrega a DLL e conversa por **stdio** --
 * uma linha JSON por comando, uma linha JSON por resposta.
 *
 * A DLL e serial (uma thread dedicada do lado do .exe), entao o casamento
 * comando<->resposta e FIFO: cada comando enfileira um resolver, cada linha
 * de stdout resolve o mais antigo pendente.
 *
 * Decisao do PI (15/08/2026, emenda ao ADR-010): transporte stdio, runtime
 * .NET Framework 4.x x86.
 */
export class PonteEasyInnerProcesso implements PonteEasyInner {
  readonly nome = 'ponte-easyinner-processo';

  private buffer = '';
  private readonly pendentes: Array<(r: RespostaPonte) => void> = [];

  private constructor(private readonly processo: ChildProcess) {
    processo.stdout?.setEncoding('utf8');
    processo.stdout?.on('data', (chunk: string) => this.consumir(chunk));
  }

  /** Recebe um processo ja criado -- usado nos testes com processo-eco. */
  static comProcesso(processo: ChildProcess): PonteEasyInnerProcesso {
    return new PonteEasyInnerProcesso(processo);
  }

  /** Lanca o `.exe` da ponte. Uso em producao/bancada. */
  static lancar(opcoes: { comando: string; args?: readonly string[] }): PonteEasyInnerProcesso {
    return new PonteEasyInnerProcesso(
      spawn(opcoes.comando, [...(opcoes.args ?? [])], { stdio: 'pipe' }),
    );
  }

  private consumir(chunk: string): void {
    this.buffer += chunk;
    let quebra: number;
    while ((quebra = this.buffer.indexOf('\n')) >= 0) {
      const linha = this.buffer.slice(0, quebra).trim();
      this.buffer = this.buffer.slice(quebra + 1);
      if (!linha) continue;

      const resolver = this.pendentes.shift();
      if (!resolver) continue;

      resolver(this.interpretar(linha));
    }
  }

  private interpretar(linha: string): RespostaPonte {
    let bruto: unknown;
    try {
      bruto = JSON.parse(linha);
    } catch {
      return { tipo: 'falha-da-ponte', mensagem: `resposta nao e JSON: ${linha}` };
    }

    const parse = esquemaRespostaPonte.safeParse(bruto);
    return parse.success
      ? parse.data
      : { tipo: 'falha-da-ponte', mensagem: `resposta invalida: ${linha}` };
  }

  executar(comando: ComandoPonte): Promise<RespostaPonte> {
    const validado = esquemaComandoPonte.parse(comando);
    return new Promise<RespostaPonte>((resolve) => {
      this.pendentes.push(resolve);
      this.processo.stdin?.write(JSON.stringify(validado) + '\n');
    });
  }

  async encerrar(): Promise<void> {
    this.processo.stdin?.end();
    this.processo.kill();
  }
}
