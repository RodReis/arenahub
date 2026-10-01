import type { Logger } from 'pino';

import type { FacialDeviceAdapter } from '../domain/facial-device.js';
import type { SignedCloudClient } from '../cloud/signed-client.js';

/**
 * Leva a base do leitor para a nuvem vincular os alunos -- #468.
 *
 * Dois caminhos, porque o leitor informa sua base de dois jeitos:
 *
 *   - no REGISTRO, o Edge LISTA tudo o que o leitor tem (`getuserlist`). E o
 *     que cobre a base legada: o leitor so reenvia `senduser` do que ainda
 *     nao foi confirmado -- visto em campo, 424 na primeira conexao e nenhum
 *     depois --, entao esperar o `senduser` perderia a base inteira;
 *   - a cada `senduser`, o cadastro feito DIRETO no leitor. Junta os numeros
 *     por uma janela curta: a rajada da primeira conexao vira uma chamada.
 *
 * Quem decide o vinculo e a nuvem (regra de arquitetura no 3). Daqui so sai
 * o NUMERO -- nunca nome nem foto. A foto sobe depois, por outro caminho e so
 * para numero ja vinculado (`fotos-do-leitor.ts`, #503).
 */

/** Espera sem `senduser` novo antes de mandar o lote. */
export const JANELA_DE_CADASTROS_MS = 2_000;

/**
 * Intervalo minimo entre duas tentativas de vincular a base do MESMO leitor
 * -- #488. Cada tentativa faz `listar`, que pausa o leitor (`disabledevice`);
 * com falha persistente (leitor nao cadastrado no painel) e o leitor
 * reconectando sozinho, sem isto a base seria listada a cada reconexao.
 */
export const INTERVALO_ENTRE_TENTATIVAS_MS = 60_000;

/**
 * Numeros por chamada. A API aceita ate 1.000, mas cada aluno novo custa uma
 * transacao de consentimento e outra de identidade: na Arena Positiva
 * (01/10/2026), 428 numeros numa chamada so passaram dos 15 s do cliente e o
 * vinculo voltou `status 0`. Com 50, cada chamada fecha em poucos segundos, e
 * a que falhar so refaz o proprio lote na tentativa seguinte.
 */
export const TAMANHO_DO_LOTE = 50;

const CAMINHO = '/api/v1/edge/device-users/legacy-links';

interface RespostaDoVinculo {
  linked: number;
  alreadyLinked: number;
  withoutStudent: string[];
  ambiguous: string[];
  studentAlreadyLinked: string[];
  withoutConsentDocument: string[];
  refusedOrRevoked: string[];
}

export function ligarVinculoLegado(deps: {
  facial: FacialDeviceAdapter;
  cliente: SignedCloudClient;
  logger: Logger;
  janelaMs?: number;
  intervaloEntreTentativasMs?: number;
  /** Relogio injetavel: o 'agora' entra por parametro (CLAUDE.md). */
  agoraMs?: () => number;
  /**
   * Chamado quando a base do leitor CHEGOU na nuvem -- #503: e a deixa para
   * importar as fotos, que so existem para numero ja vinculado.
   */
  aposVincular?: (serial: string) => void;
}): { encerrar: () => void } {
  const { facial, cliente, logger } = deps;
  const janelaMs = deps.janelaMs ?? JANELA_DE_CADASTROS_MS;
  const intervaloMs = deps.intervaloEntreTentativasMs ?? INTERVALO_ENTRE_TENTATIVAS_MS;
  const agoraMs = deps.agoraMs ?? Date.now;

  /** `true` quando TODOS os lotes chegaram na nuvem. */
  const informar = async (serial: string, numeros: readonly string[]): Promise<boolean> => {
    let todosChegaram = true;
    const total = { vinculados: 0, jaVinculados: 0, pendentes: [] as string[] };

    for (let i = 0; i < numeros.length; i += TAMANHO_DO_LOTE) {
      const lote = numeros.slice(i, i + TAMANHO_DO_LOTE);
      const resposta = await cliente.post<RespostaDoVinculo>(CAMINHO, {
        deviceSerial: serial,
        externalUserIds: lote,
      });

      if (!resposta.ok || !resposta.body) {
        logger.warn(
          { leitor: serial, numeros: lote.length, status: resposta.status },
          'vinculo da base do leitor nao chegou na nuvem',
        );
        todosChegaram = false;
        continue;
      }

      const r = resposta.body;
      total.vinculados += r.linked;
      total.jaVinculados += r.alreadyLinked;
      total.pendentes.push(
        ...r.withoutStudent,
        ...r.ambiguous,
        ...r.studentAlreadyLinked,
        ...r.withoutConsentDocument,
        ...r.refusedOrRevoked,
      );

      // Detalhe por lote so em `debug`: com lote de 50, a base da Arena
      // Positiva virava nove linhas longas e escondia o resto do log. As
      // listas sao o que a recepcao usa para corrigir cadastro -- numero de
      // leitor e chave de equipamento, nao PII.
      logger.debug(
        {
          leitor: serial,
          vinculados: r.linked,
          jaVinculados: r.alreadyLinked,
          semAluno: r.withoutStudent,
          numeroRepetido: r.ambiguous,
          alunoComOutroNumero: r.studentAlreadyLinked,
          semTermoBiometrico: r.withoutConsentDocument,
          recusouOuRevogado: r.refusedOrRevoked,
        },
        'lote da base do leitor',
      );
    }

    // UMA linha por base, com o que importa no teste de campo: quantos estao
    // prontos para a catraca e quantos ficaram de fora.
    logger.info(
      {
        leitor: serial,
        numeros: numeros.length,
        prontosNaCatraca: total.vinculados + total.jaVinculados,
        novos: total.vinculados,
        semVinculo: total.pendentes.length,
        ...(todosChegaram ? {} : { aviso: 'parte nao chegou na nuvem -- tenta de novo' }),
      },
      'base do leitor vinculada',
    );

    return todosChegaram;
  };

  /*
   * UM envio por vez. A listagem do registro e o lote de `senduser` da
   * primeira conexao carregam os MESMOS numeros e saem quase juntos: em
   * paralelo, as duas chamadas disputariam o mesmo vinculo na nuvem.
   */
  let fila: Promise<void> = Promise.resolve();
  const enfileirar = (tarefa: () => Promise<void>, falha: string, serial: string): void => {
    fila = fila.then(tarefa).catch((erro: unknown) => {
      logger.warn({ leitor: serial, erro: erro instanceof Error ? erro.message : erro }, falha);
    });
  };

  // Uma listagem BEM-SUCEDIDA por leitor por execucao: `listar` pausa o
  // leitor (`disabledevice`), e a base nao muda por reconectar. Cadastro novo
  // chega pelo `senduser`.
  //
  // So conta como feita quando chegou na nuvem (#488): na Arena Positiva a
  // nuvem respondeu 404 e a base ficou marcada como feita, sem nova tentativa
  // ate o agente reiniciar. Falha libera a proxima tentativa -- no proximo
  // registro do leitor.
  const listados = new Set<string>();
  const ultimaTentativa = new Map<string, number>();

  facial.aoRegistrar?.((serial) => {
    if (listados.has(serial)) return;

    // Falha libera a proxima tentativa, mas nao antes do intervalo minimo.
    const agora = agoraMs();
    const ultima = ultimaTentativa.get(serial);
    if (ultima !== undefined && agora - ultima < intervaloMs) {
      logger.debug({ leitor: serial }, 'vinculo da base do leitor ja tentado ha pouco -- aguardando');
      return;
    }

    ultimaTentativa.set(serial, agora);
    listados.add(serial);

    enfileirar(
      async () => {
        try {
          const base = await facial.listar();
          const chegou = await informar(
            serial,
            base.map((i) => i.externalEnrollId),
          );
          if (!chegou) listados.delete(serial);
          else deps.aposVincular?.(serial);
        } catch (erro: unknown) {
          listados.delete(serial);
          throw erro;
        }
      },
      'nao foi possivel listar a base do leitor',
      serial,
    );
  });

  const pendentes = new Map<string, Set<string>>();
  let temporizador: NodeJS.Timeout | null = null;

  const descarregar = (): void => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
    for (const [serial, numeros] of pendentes) {
      pendentes.delete(serial);
      enfileirar(
        async () => {
          await informar(serial, [...numeros]);
        },
        'vinculo de cadastro novo do leitor falhou',
        serial,
      );
    }
  };

  facial.aoInformarCadastro?.(({ serial, externalUserId }) => {
    const numeros = pendentes.get(serial) ?? new Set<string>();
    numeros.add(externalUserId);
    pendentes.set(serial, numeros);

    // Lote cheio sai na hora: esperar a janela so adiaria o envio.
    if (numeros.size >= TAMANHO_DO_LOTE) {
      descarregar();
      return;
    }

    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(descarregar, janelaMs);
  });

  return {
    encerrar: () => {
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
      pendentes.clear();
    },
  };
}
