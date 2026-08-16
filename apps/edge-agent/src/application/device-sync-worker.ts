import type { FacialDeviceAdapter } from '../domain/facial-device.js';
import type { DeviceUserRepository } from '../persistence/device-user-repository.js';
import { cadastrarIdentidade, removerIdentidade } from './sincronizar-identidade.js';

/**
 * Executa comandos de sincronizacao vindos da nuvem.
 *
 * A nuvem e a fonte da verdade; o Edge e executor fisico (regra de
 * arquitetura no 3). Este worker traduz comando em chamada ao adapter da
 * F2 -- e nao reimplementa o ciclo de vida facial, que ja existe em
 * `sincronizar-identidade.ts` com a garantia de nao deixar dado orfao.
 *
 * NENHUM import de SDK entra aqui: o adapter e a fronteira.
 */

/** Comando como a nuvem o entrega. */
export interface ComandoDaNuvem {
  id: string;
  sequence: string;
  /**
   * `DEVICE_USER_UPSERT` ou `DEVICE_USER_DELETE` hoje.
   *
   * Tipado como `string`, e nao como uniao fechada, de proposito: a nuvem
   * pode passar a mandar um tipo que este agente ainda nao conhece -- um
   * Edge em campo demora a ser atualizado. `executarComando` trata o
   * desconhecido como erro permanente em vez de estourar.
   */
  type: string;
  payload: {
    deviceSerial?: string;
    externalUserId?: string;
    identityId?: string;
    enrollmentObjectKey?: string | null;
  };
  correlationId: string;
}

/** Resultado a reportar de volta. */
export interface ResultadoDeComando {
  commandId: string;
  success: boolean;
  errorCode?: string;
  /** Relogio do EDGE no instante da execucao, preservado pela nuvem. */
  deviceTimestamp: string;
}

export interface DependenciasDoWorker {
  repo: DeviceUserRepository;
  dispositivo: FacialDeviceAdapter;
  /** Marca o comando como executado ANTES de reportar. */
  registrarExecucao: (commandId: string, sucesso: boolean) => void;
  /** Ja executamos este comando? Sobrevive a reinicio do processo. */
  jaExecutado: (commandId: string) => boolean;
}

/**
 * Executa um comando.
 *
 * A ORDEM E A DEFESA CONTRA CRASH, e e a mesma da F2:
 *
 *   1. checar se ja executamos (o inbox local sobrevive a reinicio);
 *   2. executar no dispositivo pelo caso de uso da F2;
 *   3. registrar localmente ANTES de reportar a nuvem.
 *
 * Se o processo morre entre 2 e 3, o passo 1 do proximo ciclo NAO barra --
 * e o comando roda de novo no leitor. Isso e aceitavel porque a operacao
 * fisica e idempotente por natureza: cadastrar quem ja esta cadastrado
 * sobrescreve, remover quem nao existe e sucesso (a F2 trata os dois casos).
 * O que NAO pode acontecer e o efeito fisico sumir -- e nao some.
 */
export async function executarComando(
  deps: DependenciasDoWorker,
  comando: ComandoDaNuvem,
  agora: Date,
): Promise<ResultadoDeComando> {
  const carimbo = agora.toISOString();

  // Reexecutar comando ja concluido nao toca o leitor: a nuvem so repetiu o
  // envio porque o resultado dela nao chegou.
  if (deps.jaExecutado(comando.id)) {
    return { commandId: comando.id, success: true, deviceTimestamp: carimbo };
  }

  const { externalUserId, identityId } = comando.payload;

  if (!externalUserId || !identityId) {
    // Comando malformado nao adianta retentar -- a nuvem precisa corrigir.
    deps.registrarExecucao(comando.id, false);

    return {
      commandId: comando.id,
      success: false,
      errorCode: 'DEVICE_OPERATION_UNSUPPORTED',
      deviceTimestamp: carimbo,
    };
  }

  if (comando.type === 'DEVICE_USER_UPSERT') {
    const resultado = await cadastrarIdentidade(
      { repo: deps.repo, dispositivo: deps.dispositivo },
      {
        pessoaId: identityId,
        externalEnrollId: externalUserId,
        dispositivoId: comando.payload.deviceSerial ?? 'desconhecido',
        // Rotulo NAO carrega nome nem CPF: o que vai ao equipamento e o
        // identificador tecnico (INV-012, INV-022).
        rotulo: externalUserId,
      },
      agora,
    );

    deps.registrarExecucao(comando.id, resultado.ok);

    return resultado.ok
      ? { commandId: comando.id, success: true, deviceTimestamp: carimbo }
      : {
          commandId: comando.id,
          success: false,
          errorCode: 'DEVICE_ENROLLMENT_REJECTED',
          deviceTimestamp: carimbo,
        };
  }

  if (comando.type === 'DEVICE_USER_DELETE') {
    const resultado = await removerIdentidade(
      { repo: deps.repo, dispositivo: deps.dispositivo },
      { pessoaId: identityId, dispositivoId: comando.payload.deviceSerial ?? 'desconhecido' },
      agora,
    );

    deps.registrarExecucao(comando.id, resultado.ok);

    return resultado.ok
      ? { commandId: comando.id, success: true, deviceTimestamp: carimbo }
      : {
          commandId: comando.id,
          success: false,
          errorCode: 'DEVICE_UNREACHABLE',
          deviceTimestamp: carimbo,
        };
  }

  // Tipo desconhecido: erro PERMANENTE. Retentar um comando que este agente
  // nao sabe executar so gasta as cinco tentativas da nuvem.
  deps.registrarExecucao(comando.id, false);

  return {
    commandId: comando.id,
    success: false,
    errorCode: 'DEVICE_OPERATION_UNSUPPORTED',
    deviceTimestamp: carimbo,
  };
}

/**
 * Executa um lote, na ordem de sequencia.
 *
 * Sequencial, nao paralelo: o protocolo facial nao tem operacao em lote
 * (INV-023), e disparar dez cadastros simultaneos num leitor que atende um
 * por vez produz timeout em cascata.
 *
 * Um comando que estoura NAO interrompe o lote -- vira resultado de falha e
 * o proximo segue. Parar tudo por causa de um faria um leitor com problema
 * bloquear a fila inteira da academia.
 */
export async function executarLote(
  deps: DependenciasDoWorker,
  comandos: readonly ComandoDaNuvem[],
  agora: Date,
): Promise<ResultadoDeComando[]> {
  const resultados: ResultadoDeComando[] = [];

  for (const comando of comandos) {
    try {
      resultados.push(await executarComando(deps, comando, agora));
    } catch {
      resultados.push({
        commandId: comando.id,
        success: false,
        errorCode: 'DEVICE_UNREACHABLE',
        deviceTimestamp: agora.toISOString(),
      });
    }
  }

  return resultados;
}
