import { validarExternalEnrollId } from '../domain/external-enroll-id.js';
import { type FacialDeviceAdapter, type ExternalEnrollId } from '../domain/facial-device.js';
import { type DeviceUserRepository } from '../persistence/device-user-repository.js';

/**
 * Casos de uso do ciclo de vida facial -- Slice 0.2.
 *
 * O padrao e sempre o mesmo, e nao e acidente:
 *
 *   1. registrar a INTENCAO localmente;
 *   2. mandar para o dispositivo;
 *   3. marcar o resultado.
 *
 * Se o processo morre entre 1 e 2, sobra `pendente_*` -- que a reconciliacao
 * encontra e retenta. Se mandassemos primeiro e registrassemos depois, a
 * morte no meio produziria dado ORFAO no dispositivo: existe la, ninguem
 * sabe aqui. O aceite da Slice 0.2 exige justamente "sem deixar dado orfao".
 *
 * O "agora" entra por parametro (CLAUDE.md -> Convencoes).
 */

export type ResultadoSync = { ok: true } | { ok: false; razao: string };

export async function cadastrarIdentidade(
  deps: { repo: DeviceUserRepository; dispositivo: FacialDeviceAdapter },
  entrada: {
    pessoaId: string;
    externalEnrollId: ExternalEnrollId;
    dispositivoId: string;
    rotulo: string;
  },
  agora: Date,
): Promise<ResultadoSync> {
  // Rede de seguranca contra identificador derivado de CPF. Falha aqui e
  // barata; falha depois do dado estar no equipamento, nao.
  validarExternalEnrollId(entrada.externalEnrollId);

  // REENROLLMENT: a mesma pessoa recebendo um externalEnrollId novo.
  //
  // Acontece de verdade -- recaptura facial, ou correcao de cadastro. Sem
  // este bloco, o id ANTIGO ficava no dispositivo para sempre: o registro
  // local passava a apontar so para o novo, e `cadastrar` e aditivo. Orfao
  // criado pelo fluxo normal, nao por falha de processo -- exatamente o que
  // o aceite da Slice 0.2 proibe.
  //
  // Remover ANTES de cadastrar o novo, e nao depois: se o processo morrer no
  // meio, sobra a pessoa sem identidade no dispositivo (recuperavel pela
  // fila de pendentes) em vez de duas identidades para a mesma pessoa
  // (indistinguiveis sem intervencao).
  const anterior = deps.repo.buscar(entrada.pessoaId, entrada.dispositivoId);

  if (anterior && anterior.externalEnrollId !== entrada.externalEnrollId) {
    const remocao = await deps.dispositivo.remover(anterior.externalEnrollId);

    if (!remocao.confirmado) {
      deps.repo.marcarEstado(
        entrada.pessoaId,
        entrada.dispositivoId,
        'falha',
        agora,
        `nao foi possivel remover o enroll anterior: ${remocao.razao}`,
      );
      return {
        ok: false,
        razao: `enroll anterior nao pode ser removido: ${remocao.razao}`,
      };
    }
  }

  deps.repo.registrarIntencaoDeCadastro(
    entrada.pessoaId,
    entrada.externalEnrollId,
    entrada.dispositivoId,
    agora,
  );

  const resultado = await deps.dispositivo.cadastrar({
    externalEnrollId: entrada.externalEnrollId,
    rotulo: entrada.rotulo,
  });

  if (!resultado.confirmado) {
    deps.repo.marcarEstado(
      entrada.pessoaId,
      entrada.dispositivoId,
      'falha',
      agora,
      resultado.razao,
    );
    return { ok: false, razao: resultado.razao };
  }

  deps.repo.marcarEstado(entrada.pessoaId, entrada.dispositivoId, 'cadastrado', agora);
  return { ok: true };
}

export async function removerIdentidade(
  deps: { repo: DeviceUserRepository; dispositivo: FacialDeviceAdapter },
  entrada: { pessoaId: string; dispositivoId: string },
  agora: Date,
): Promise<ResultadoSync> {
  const registro = deps.repo.buscar(entrada.pessoaId, entrada.dispositivoId);

  if (!registro) {
    // Nao ha o que remover, e isso e sucesso: o estado desejado -- ausencia
    // -- ja vale.
    return { ok: true };
  }

  deps.repo.marcarEstado(entrada.pessoaId, entrada.dispositivoId, 'pendente_remocao', agora);

  const resultado = await deps.dispositivo.remover(registro.externalEnrollId);

  if (!resultado.confirmado) {
    deps.repo.marcarEstado(
      entrada.pessoaId,
      entrada.dispositivoId,
      'falha',
      agora,
      resultado.razao,
    );
    return { ok: false, razao: resultado.razao };
  }

  deps.repo.marcarEstado(entrada.pessoaId, entrada.dispositivoId, 'removido', agora);
  return { ok: true };
}

/**
 * Identidade que existe NO DISPOSITIVO sem correspondencia local.
 *
 * O aceite da Slice 0.2 exige "sem deixar dado orfao no dispositivo".
 * Detectar e o primeiro passo -- o que fazer com o orfao (remover? alertar?)
 * e decisao de produto, e nao esta nesta fatia.
 */
export async function detectarOrfaos(
  deps: { repo: DeviceUserRepository; dispositivo: FacialDeviceAdapter },
  dispositivoId: string,
): Promise<readonly ExternalEnrollId[]> {
  const noDispositivo = await deps.dispositivo.listar();
  const esperados = new Set(
    deps.repo.listarEsperados(dispositivoId).map((d) => d.externalEnrollId),
  );

  return noDispositivo
    .map((i) => i.externalEnrollId)
    .filter((id) => !esperados.has(id));
}
