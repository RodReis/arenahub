import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Inbox local de comandos de sincronizacao executados -- #469.
 *
 * `device-sync-worker.ts` exige saber, ANTES de tocar no leitor, se um
 * comando ja foi executado: a nuvem reenvia quando o relato dela nao chega,
 * e sem este registro o mesmo `DEVICE_USER_UPSERT` rodaria de novo a cada
 * retry. Precisa sobreviver a reinicio do processo -- em memoria nao basta.
 *
 * So guarda SUCESSO. Falha nao entra como "executado": o worker trata tipo
 * desconhecido e payload invalido como erro permanente por outro caminho
 * (`registrarExecucao(id, false)` em `device-sync-worker.ts`), e aqui isso
 * nao pode virar "ja fiz, nao repita" -- se a nuvem corrigir o comando e
 * reenviar com o mesmo id, o worker precisa poder tentar de novo.
 */
export class CommandInbox {
  private readonly db: DatabaseSync;
  private fechado = false;

  constructor(caminho: string) {
    // Mesma causa do #406 em MaquinaDeAcesso: pasta de instalacao nova nao
    // existe, e DatabaseSync nao a cria sozinho.
    mkdirSync(dirname(caminho), { recursive: true });

    this.db = new DatabaseSync(caminho);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS executed_commands (
        command_id    TEXT PRIMARY KEY,
        executado_em  TEXT NOT NULL
      );
    `);
  }

  jaExecutado(commandId: string): boolean {
    const linha = this.db
      .prepare('SELECT 1 FROM executed_commands WHERE command_id = ?')
      .get(commandId);

    return linha !== undefined;
  }

  registrarExecucao(commandId: string, sucesso: boolean): void {
    if (!sucesso) return;

    this.db
      .prepare(
        `INSERT INTO executed_commands (command_id, executado_em)
         VALUES (?, ?)
         ON CONFLICT (command_id) DO NOTHING`,
      )
      .run(commandId, new Date().toISOString());
  }

  /** Idempotente -- fechar duas vezes e seguro (mesma regra de arquitetura no 4). */
  fechar(): void {
    if (this.fechado) return;
    this.fechado = true;
    this.db.close();
  }
}
