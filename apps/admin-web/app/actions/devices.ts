'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Cadastro de dispositivo — a metade que faltava.
 *
 * `POST /api/v1/devices` existe na API com validação de hardware homologado
 * e auditoria, e nunca teve um chamador no painel. Não há seed de
 * dispositivo e o edge-agent não se auto-registra: até aqui, um leitor só
 * entrava no sistema por `curl`. A tela dizia "Nenhum dispositivo
 * cadastrado" e continuaria dizendo para sempre.
 */
const esquemaDeDispositivo = z.object({
  gymUnitId: z.string().uuid('Selecione a unidade do dispositivo'),
  kind: z.enum(['FACIAL_READER', 'TURNSTILE']),
  model: z.string().trim().min(2, 'Informe o modelo').max(80, 'Modelo longo demais'),
  serial: z.string().trim().min(1, 'Informe o número de série').max(80, 'Série longa demais'),
  firmware: z.string().trim().max(40, 'Firmware longo demais').optional(),
});

/**
 * Edição de dispositivo.
 *
 * SÓ situação e firmware, porque é só isso que `PATCH /api/v1/devices/:id`
 * aceita — e o recorte é do domínio, não da tela: unidade, tipo, modelo e
 * série identificam o equipamento FÍSICO que está parafusado na parede.
 * Trocá-los no cadastro faria o histórico de acesso apontar para um
 * equipamento que nunca leu aquele rosto.
 */
const esquemaDeEdicaoDeDispositivo = z.object({
  deviceId: z.string().uuid(),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']),
  firmware: z.string().trim().max(40, 'Firmware longo demais').optional(),
});

export interface EstadoDoDispositivo {
  erro?: string;
  sucesso?: { id: string; serial: string };
  valores?: Record<string, string>;
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados informados.',
  FORBIDDEN: 'Seu perfil não tem permissão para cadastrar dispositivos.',
  GYM_UNIT_NOT_FOUND: 'Unidade não encontrada nesta academia.',
  /*
   * A frase diz O QUE FAZER, e não só que deu errado.
   *
   * A lista de homologação tem os dois equipamentos da bancada do MVP 0
   * (leitor facial e catraca Topdata Inner). Qualquer outro é recusado — e
   * "não foi possível cadastrar" mandaria a recepção conferir série e modelo
   * à procura de um erro de digitação que não existe.
   */
  DEVICE_UNSUPPORTED_HARDWARE:
    'Este modelo ainda não é homologado. Só os equipamentos testados na bancada são aceitos — os demais dependem do gate de hardware.',
  DEVICE_SERIAL_TAKEN: 'Já existe um dispositivo com este número de série.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export async function cadastrarDispositivo(
  _anterior: EstadoDoDispositivo,
  formulario: FormData,
): Promise<EstadoDoDispositivo> {
  const valores = {
    gymUnitId: texto(formulario, 'gymUnitId'),
    kind: texto(formulario, 'kind'),
    model: texto(formulario, 'model'),
    serial: texto(formulario, 'serial'),
    firmware: texto(formulario, 'firmware'),
  };

  const validado = esquemaDeDispositivo.safeParse(valores);

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  const resposta = await chamarApi<{ id: string; serial: string }>('/api/v1/devices', {
    metodo: 'POST',
    corpo: {
      gymUnitId: validado.data.gymUnitId,
      kind: validado.data.kind,
      model: validado.data.model,
      serial: validado.data.serial,
      /*
       * `.strict()` na API: campo desconhecido derruba a requisição inteira.
       * Firmware vazio precisa SUMIR do corpo, não viajar como string vazia
       * -- o schema o declara `.max(40).optional()`, e `''` passaria como
       * valor informado.
       */
      ...(validado.data.firmware ? { firmware: validado.data.firmware } : {}),
    },
  });

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: frase(resposta.erro?.code ?? '', 'Não foi possível cadastrar o dispositivo'),
      valores,
    };
  }

  revalidatePath('/operations/devices');

  return { sucesso: { id: resposta.dados.id, serial: resposta.dados.serial } };
}

/**
 * Edição de dispositivo — situação e firmware.
 *
 * `PATCH /api/v1/devices/:id` existe desde sempre e nunca teve chamador: a
 * tabela de equipamentos não tinha ação de linha nenhuma, e um leitor só
 * mudava de situação por `curl` (issue #241, mesmo defeito da #178).
 */
export async function editarDispositivo(
  _anterior: EstadoDoDispositivo,
  formulario: FormData,
): Promise<EstadoDoDispositivo> {
  const valores = {
    deviceId: texto(formulario, 'deviceId'),
    status: texto(formulario, 'status'),
    firmware: texto(formulario, 'firmware'),
  };

  const validado = esquemaDeEdicaoDeDispositivo.safeParse(valores);

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.', valores };
  }

  /*
   * APOSENTAR NÃO PASSA POR AQUI. O formulário de edição não oferece
   * `RETIRED` na lista, e esta guarda existe para o caso de o valor chegar
   * por outro caminho: aposentar é ação sensível (DS-PAINEL.md §5.1) e exige
   * motivo, que este formulário não coleta. Sem ela, a API recusaria com
   * `VALIDATION_FAILED` -- correto, mas mudo sobre o que fazer.
   */
  if (validado.data.status === 'RETIRED') {
    return { erro: 'Para aposentar um dispositivo, use a ação "Aposentar".', valores };
  }

  const resposta = await chamarApi<{ id: string; serial: string }>(
    `/api/v1/devices/${validado.data.deviceId}`,
    {
      metodo: 'PATCH',
      corpo: {
        status: validado.data.status,
        /*
         * Firmware vazio SOME do corpo, como no cadastro: `.strict()` na API
         * recusaria a chave desconhecida, e `''` passaria como valor
         * informado -- apagando o firmware de quem tinha um.
         */
        ...(validado.data.firmware ? { firmware: validado.data.firmware } : {}),
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: frase(resposta.erro?.code ?? '', 'Não foi possível salvar o dispositivo'),
      valores,
    };
  }

  revalidatePath('/operations/devices');

  return { sucesso: { id: resposta.dados.id, serial: resposta.dados.serial } };
}

/**
 * Aposentadoria de dispositivo — o mais perto de "excluir" que existe.
 *
 * NÃO HÁ `DELETE /devices/:id`, e não deve haver: `AccessEvent` referencia o
 * dispositivo, e apagá-lo levaria junto o registro de quem passou na catraca.
 * `status: RETIRED` tira o equipamento de operação e preserva o histórico.
 *
 * Ação sensível (DS-PAINEL.md §5.1): motivo obrigatório, e o motivo é
 * gravado -- vai para o `metadata` do `AuditLog`. Coletar e descartar seria
 * teatro de auditoria.
 */
export async function aposentarDispositivo(
  _anterior: EstadoDoDispositivo,
  formulario: FormData,
): Promise<EstadoDoDispositivo> {
  const deviceId = texto(formulario, 'deviceId');
  const motivo = texto(formulario, 'reason').trim();

  if (motivo.length < 10) {
    return { erro: 'Escreva o motivo da aposentadoria (ao menos 10 caracteres).' };
  }

  const resposta = await chamarApi<{ id: string; serial: string }>(
    `/api/v1/devices/${deviceId}`,
    { metodo: 'PATCH', corpo: { status: 'RETIRED', reason: motivo } },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível aposentar o dispositivo') };
  }

  revalidatePath('/operations/devices');

  return { sucesso: { id: resposta.dados.id, serial: resposta.dados.serial } };
}
