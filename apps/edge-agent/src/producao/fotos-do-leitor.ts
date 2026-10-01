import type { Logger } from 'pino';

import type { SignedCloudClient } from '../cloud/signed-client.js';
import type { FacialDeviceAdapter } from '../domain/facial-device.js';

/**
 * Foto do aluno a partir do leitor facial -- #503 (pedido do PI, 01/10/2026).
 *
 * Roda depois que a base do leitor foi vinculada (#468): a NUVEM diz quem
 * precisa de foto -- numero vinculado a aluno (ou professor, ou funcionario)
 * que ainda nao tem foto -- e o Edge le uma por vez no leitor e envia. Quem ja
 * tem foto nao entra na lista, entao a partir da segunda execucao a
 * importacao e quase nada.
 *
 * UMA POR VEZ, COM PAUSA: cada leitura pausa o leitor (`disabledevice`) por
 * uma fracao de segundo. A pausa entre fotos deixa o leitor reconhecer quem
 * chegar na catraca enquanto a importacao corre -- centenas de leituras em
 * rajada o deixariam ocupado por minutos.
 *
 * A foto NUNCA vai para o log.
 */

/** Pausa entre duas fotos -- folga para o leitor tratar acesso no meio. */
export const PAUSA_ENTRE_FOTOS_MS = 1_000;

/** Falhas SEGUIDAS no leitor que encerram a rodada: o leitor caiu. */
const FALHAS_SEGUIDAS_PARA_PARAR = 3;

const CAMINHO_PENDENTES = '/api/v1/edge/device-users/photos/pending';
const CAMINHO_FOTO = '/api/v1/edge/device-users/photos';

export function ligarImportacaoDeFotos(deps: {
  facial: FacialDeviceAdapter;
  cliente: SignedCloudClient;
  logger: Logger;
  pausaMs?: number;
}): { importar: (serial: string) => void; encerrar: () => void } {
  const { facial, cliente, logger } = deps;
  const pausaMs = deps.pausaMs ?? PAUSA_ENTRE_FOTOS_MS;

  /** Leitor cuja importacao fechou sem falha nesta execucao do agente. */
  const concluidos = new Set<string>();
  const emAndamento = new Set<string>();
  let encerrado = false;

  const rodar = async (serial: string, lerFoto: (n: string) => Promise<string | null>) => {
    const lista = await cliente.post<{ externalUserIds: string[] }>(CAMINHO_PENDENTES, {
      deviceSerial: serial,
    });

    if (!lista.ok || !lista.body) {
      logger.warn({ leitor: serial, status: lista.status }, 'fotos do leitor: pendentes nao chegaram');
      return;
    }

    const pendentes = lista.body.externalUserIds;
    const total = { importadas: 0, jaTinhamFoto: 0, semFotoNoLeitor: 0, falhas: 0 };
    let falhasSeguidas = 0;
    let interrompida = false;

    if (pendentes.length > 0) {
      logger.info({ leitor: serial, pendentes: pendentes.length }, 'importando fotos do leitor');
    }

    for (const numero of pendentes) {
      if (encerrado) {
        interrompida = true;
        break;
      }

      let foto: string | null;
      try {
        foto = await lerFoto(numero);
        falhasSeguidas = 0;
      } catch (erro: unknown) {
        total.falhas += 1;
        falhasSeguidas += 1;
        logger.debug(
          { leitor: serial, numero, erro: erro instanceof Error ? erro.message : String(erro) },
          'foto nao lida no leitor',
        );
        if (falhasSeguidas >= FALHAS_SEGUIDAS_PARA_PARAR) {
          interrompida = true;
          break;
        }
        continue;
      }

      if (foto === null) {
        total.semFotoNoLeitor += 1;
      } else {
        const envio = await cliente.post<{ result: string }>(CAMINHO_FOTO, {
          deviceSerial: serial,
          externalUserId: numero,
          imageBase64: foto,
        });

        if (envio.ok && envio.body?.result === 'IMPORTED') total.importadas += 1;
        else if (envio.ok && envio.body?.result === 'ALREADY_HAS_PHOTO') total.jaTinhamFoto += 1;
        else {
          total.falhas += 1;
          logger.debug({ leitor: serial, numero, status: envio.status }, 'foto nao aceita pela nuvem');
        }
      }

      if (pausaMs > 0) await new Promise((r) => setTimeout(r, pausaMs));
    }

    logger.info(
      {
        leitor: serial,
        pendentes: pendentes.length,
        ...total,
        ...(interrompida ? { interrompida: true } : {}),
      },
      'fotos do leitor importadas',
    );

    // Falhou alguma? A proxima conexao do leitor tenta de novo -- e a nuvem
    // so devolve quem AINDA nao tem foto.
    if (total.falhas === 0 && !interrompida) concluidos.add(serial);
  };

  return {
    importar: (serial) => {
      const lerFoto = facial.lerFoto?.bind(facial);
      if (!lerFoto || encerrado) return;
      if (concluidos.has(serial) || emAndamento.has(serial)) return;

      emAndamento.add(serial);
      rodar(serial, lerFoto)
        .catch((erro: unknown) => {
          logger.warn(
            { leitor: serial, erro: erro instanceof Error ? erro.message : String(erro) },
            'importacao de fotos do leitor falhou',
          );
        })
        .finally(() => emAndamento.delete(serial));
    },
    encerrar: () => {
      encerrado = true;
    },
  };
}
