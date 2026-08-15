import { DatabaseSync } from 'node:sqlite';

import { type PermissaoLocal } from '../domain/access-decision.js';

/**
 * Cache local de permissoes -- "cache local de permissoes de laboratorio"
 * (Slice 0.4).
 *
 * O QUE ISTO NAO E
 * ----------------
 * Nao e o Entitlement. A cadeia real e
 * `Pagamento -> Invoice -> Subscription -> Entitlement -> Access Decision`
 * (regra de arquitetura no 1), e ela vive na NUVEM. Isto e um espelho local
 * do que a nuvem ja decidiu, para a catraca continuar funcionando quando a
 * rede cai.
 *
 * A palavra "laboratorio" na spec e literal: no MVP 0 este cache e populado
 * a mao, para a bancada. Quem vai popula-lo de verdade e a sincronizacao
 * com a nuvem, em fatia futura.
 *
 * ⚠️ **Todo snapshot tem prazo.** Um cache sem validade vira permissao
 * eterna: quem foi bloqueado ontem continua entrando hoje porque o agente
 * nunca mais falou com a nuvem. `validoAte` nao e opcional por isso.
 */

export type PermissaoEmCache = {
  externalEnrollId: string;
  /**
   * Ate quando ESTA PERMISSAO vale. Vem da nuvem.
   *
   * Diferente de `snapshotValidoAte`: aqui e o prazo do direito da pessoa;
   * la e o prazo de confiança no cache inteiro.
   */
  validaAte: Date | null;
  /** Quando a nuvem gerou este registro. */
  sincronizadoEm: Date;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS permissoes_cache (
    external_enroll_id TEXT PRIMARY KEY,
    valida_ate         TEXT,
    ultimo_allow_em    TEXT,
    sincronizado_em    TEXT NOT NULL
  );

  -- Uma linha so, com o instante do ultimo sync bem-sucedido. E o que
  -- responde "posso confiar neste cache?".
  CREATE TABLE IF NOT EXISTS cache_meta (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    sincronizado_em TEXT NOT NULL
  );
`;

export class CacheDePermissoes {
  private readonly db: DatabaseSync;
  private fechado = false;

  constructor(caminho: string) {
    this.db = new DatabaseSync(caminho);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  /** Substitui o cache inteiro pelo que a nuvem mandou. */
  substituirPor(permissoes: readonly PermissaoEmCache[], sincronizadoEm: Date): void {
    // Tudo ou nada: um sync que morre no meio nao pode deixar metade das
    // pessoas sem permissao. Sem a transacao, a catraca passaria a negar
    // quem ainda tem direito.
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM permissoes_cache');

      const inserir = this.db.prepare(
        `INSERT INTO permissoes_cache
           (external_enroll_id, valida_ate, ultimo_allow_em, sincronizado_em)
         VALUES (?, ?, NULL, ?)`,
      );

      for (const p of permissoes) {
        inserir.run(
          p.externalEnrollId,
          p.validaAte === null ? null : p.validaAte.toISOString(),
          p.sincronizadoEm.toISOString(),
        );
      }

      this.db
        .prepare(
          `INSERT INTO cache_meta (id, sincronizado_em) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET sincronizado_em = excluded.sincronizado_em`,
        )
        .run(sincronizadoEm.toISOString());

      this.db.exec('COMMIT');
    } catch (erro: unknown) {
      this.db.exec('ROLLBACK');
      throw erro;
    }
  }

  /**
   * Busca a permissao. `null` = a bancada nao conhece essa pessoa.
   *
   * O `ultimoAllowEm` vem daqui porque a janela anti-repique precisa
   * sobreviver ao reinicio: sem isso, reiniciar o agente no meio de uma
   * passagem permitiria a segunda liberacao que a F3 barra.
   */
  buscar(externalEnrollId: string): PermissaoLocal | null {
    const linha = this.db
      .prepare(`SELECT * FROM permissoes_cache WHERE external_enroll_id = ?`)
      .get(externalEnrollId);

    if (!linha) return null;

    const validaAte = linha['valida_ate'];
    const ultimoAllow = linha['ultimo_allow_em'];

    return {
      externalEnrollId,
      ...(typeof validaAte === 'string' ? { validaAte: new Date(validaAte) } : {}),
      ...(typeof ultimoAllow === 'string' ? { ultimoAllowEm: new Date(ultimoAllow) } : {}),
    };
  }

  /** Registra a passagem concedida, para a janela anti-repique. */
  registrarAllow(externalEnrollId: string, em: Date): void {
    this.db
      .prepare(`UPDATE permissoes_cache SET ultimo_allow_em = ? WHERE external_enroll_id = ?`)
      .run(em.toISOString(), externalEnrollId);
  }

  /** Quando a nuvem sincronizou pela ultima vez. `null` = nunca. */
  get sincronizadoEm(): Date | null {
    const linha = this.db.prepare(`SELECT sincronizado_em FROM cache_meta WHERE id = 1`).get();
    const valor = linha?.['sincronizado_em'];

    return typeof valor === 'string' ? new Date(valor) : null;
  }

  /**
   * O snapshot ainda vale?
   *
   * ⚠️ ESTA E A PERGUNTA QUE IMPEDE PERMISSAO ETERNA. Sem prazo, um agente
   * desconectado ha uma semana continua liberando quem a nuvem ja
   * bloqueou.
   *
   * **O que fazer quando vence e decisao de produto, nao daqui.** Negar
   * tudo trava a academia; permitir tudo vira porta aberta. Esta funcao
   * responde o fato; quem decide e o caso de uso -- e, no fim, o PI.
   */
  estaValido(agora: Date, validadeMs: number): boolean {
    const sync = this.sincronizadoEm;
    if (sync === null) return false;

    return agora.getTime() - sync.getTime() <= validadeMs;
  }

  get total(): number {
    const linha = this.db.prepare(`SELECT COUNT(*) AS total FROM permissoes_cache`).get();
    const valor = linha?.['total'];

    return typeof valor === 'number' ? valor : 0;
  }

  /**
   * Fecha. Idempotente -- fechar duas vezes e seguro.
   *
   * Regra de arquitetura no 4 vale aqui tambem: o shutdown gracioso pode
   * fechar, e o `finally` de quem chamou fecha de novo. Explodir no segundo
   * `fechar()` transformaria encerramento limpo em erro.
   */
  fechar(): void {
    if (this.fechado) return;
    this.fechado = true;
    this.db.close();
  }
}
