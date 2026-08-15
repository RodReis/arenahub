import { DatabaseSync } from 'node:sqlite';

import { type ExternalEnrollId } from '../domain/facial-device.js';

/**
 * Tabela local de mapeamento e estado de sincronizacao -- entrega da
 * Slice 0.2.
 *
 * `M0-FR-002` exige "persistir a correlacao interna/externa": qual pessoa do
 * ArenaHub corresponde a qual identidade no dispositivo. Sem isso, um evento
 * de reconhecimento e um identificador solto, e dado orfao no equipamento
 * fica indetectavel.
 *
 * Usa `node:sqlite`, nativo desde o Node 22 -- sem dependencia nova e sem
 * binario por plataforma, o que importa num agente que roda em Windows.
 *
 * A NUVEM E A FONTE DA VERDADE (regra de arquitetura no 3). Esta tabela e
 * banco operacional temporario: o que vale e o que a nuvem diz, e este
 * arquivo pode ser reconstruido a partir dela.
 */

/**
 * Estado da sincronizacao entre o que queremos e o que o dispositivo tem.
 *
 * Modelado como estado explicito, e nao como booleano `sincronizado`, porque
 * "ainda nao mandei" e "mandei e falhou" pedem acoes diferentes: uma espera,
 * a outra investiga.
 */
export type EstadoSync =
  | 'pendente_cadastro'
  | 'cadastrado'
  | 'pendente_remocao'
  | 'removido'
  | 'falha';

export type DeviceUser = {
  /** Id da pessoa no ArenaHub -- o lado interno da correlacao. */
  pessoaId: string;
  /** Id da pessoa no dispositivo -- o lado externo. */
  externalEnrollId: ExternalEnrollId;
  /** Qual dispositivo. Uma pessoa pode existir em mais de um. */
  dispositivoId: string;
  estado: EstadoSync;
  /** Ultima falha, para diagnostico. NUNCA PII. */
  ultimaFalha: string | null;
  atualizadoEm: string;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS device_users (
    pessoa_id           TEXT NOT NULL,
    external_enroll_id  TEXT NOT NULL,
    dispositivo_id      TEXT NOT NULL,
    estado              TEXT NOT NULL,
    ultima_falha        TEXT,
    atualizado_em       TEXT NOT NULL,
    PRIMARY KEY (pessoa_id, dispositivo_id)
  );

  -- Colisao de externalEnrollId no mesmo dispositivo e o que o aceite da
  -- Slice 0.2 chama de "sem colisao". Garantir por indice e melhor que
  -- garantir por convencao: o banco recusa, em vez de o teste torcer.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_device_users_enroll
    ON device_users (dispositivo_id, external_enroll_id);
`;

export class DeviceUserRepository {
  private readonly db: DatabaseSync;
  private fechado = false;

  constructor(caminho: string) {
    this.db = new DatabaseSync(caminho);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  /**
   * Registra a intencao de cadastrar. Ainda nao tocou no dispositivo -- por
   * isso `pendente_cadastro`.
   *
   * Idempotente por `(pessoa_id, dispositivo_id)`: reprocessar e seguro
   * (regra de arquitetura no 4).
   */
  registrarIntencaoDeCadastro(
    pessoaId: string,
    externalEnrollId: ExternalEnrollId,
    dispositivoId: string,
    agora: Date,
  ): void {
    this.db
      .prepare(
        `INSERT INTO device_users
           (pessoa_id, external_enroll_id, dispositivo_id, estado, ultima_falha, atualizado_em)
         VALUES (?, ?, ?, 'pendente_cadastro', NULL, ?)
         ON CONFLICT (pessoa_id, dispositivo_id) DO UPDATE SET
           external_enroll_id = excluded.external_enroll_id,
           estado             = 'pendente_cadastro',
           ultima_falha       = NULL,
           atualizado_em      = excluded.atualizado_em`,
      )
      .run(pessoaId, externalEnrollId, dispositivoId, agora.toISOString());
  }

  marcarEstado(
    pessoaId: string,
    dispositivoId: string,
    estado: EstadoSync,
    agora: Date,
    falha: string | null = null,
  ): void {
    this.db
      .prepare(
        `UPDATE device_users
            SET estado = ?, ultima_falha = ?, atualizado_em = ?
          WHERE pessoa_id = ? AND dispositivo_id = ?`,
      )
      .run(estado, falha, agora.toISOString(), pessoaId, dispositivoId);
  }

  buscar(pessoaId: string, dispositivoId: string): DeviceUser | null {
    const linha = this.db
      .prepare(`SELECT * FROM device_users WHERE pessoa_id = ? AND dispositivo_id = ?`)
      .get(pessoaId, dispositivoId);

    return linha ? paraDeviceUser(linha) : null;
  }

  /** Quem o dispositivo DEVERIA ter, segundo o estado local. */
  listarEsperados(dispositivoId: string): readonly DeviceUser[] {
    return this.db
      .prepare(
        `SELECT * FROM device_users
          WHERE dispositivo_id = ? AND estado IN ('cadastrado', 'pendente_cadastro')`,
      )
      .all(dispositivoId)
      .map(paraDeviceUser);
  }

  /** O que ficou pelo caminho e precisa de nova tentativa. */
  listarPendentes(dispositivoId: string): readonly DeviceUser[] {
    return this.db
      .prepare(
        `SELECT * FROM device_users
          WHERE dispositivo_id = ?
            AND estado IN ('pendente_cadastro', 'pendente_remocao', 'falha')
          ORDER BY atualizado_em`,
      )
      .all(dispositivoId)
      .map(paraDeviceUser);
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

/**
 * Toda coluna do schema e TEXT, entao tudo que volta e string ou null. O
 * `String()` cru sobre `unknown` viraria "[object Object]" silenciosamente
 * se o schema mudasse -- aqui a conversao e explicita e falha alto.
 */
function texto(valor: unknown, coluna: string): string {
  if (typeof valor !== 'string') {
    throw new TypeError(`coluna ${coluna} deveria ser TEXT, veio ${typeof valor}`);
  }
  return valor;
}

function paraDeviceUser(linha: Record<string, unknown>): DeviceUser {
  return {
    pessoaId: texto(linha['pessoa_id'], 'pessoa_id'),
    externalEnrollId: texto(linha['external_enroll_id'], 'external_enroll_id'),
    dispositivoId: texto(linha['dispositivo_id'], 'dispositivo_id'),
    estado: texto(linha['estado'], 'estado') as EstadoSync,
    ultimaFalha:
      linha['ultima_falha'] === null ? null : texto(linha['ultima_falha'], 'ultima_falha'),
    atualizadoEm: texto(linha['atualizado_em'], 'atualizado_em'),
  };
}
