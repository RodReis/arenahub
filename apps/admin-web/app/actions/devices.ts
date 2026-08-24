'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';

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

export interface EstadoDoDispositivo {
  erro?: string;
  sucesso?: { id: string; serial: string };
  valores?: Record<string, string>;
}

const MENSAGEM: Record<string, string> = {
  VALIDATION_FAILED: 'Confira os dados informados.',
  FORBIDDEN: 'Seu perfil não tem permissão para cadastrar dispositivos.',
  GYM_UNIT_NOT_FOUND: 'Unidade não encontrada nesta academia.',
  /*
   * O ERRO MAIS PROVÁVEL desta tela, e por isso a frase diz o que fazer.
   *
   * A lista de homologação tem UM modelo hoje (Topdata Inner Fit, o da
   * bancada do MVP 0). Toda catraca e todo leitor de outra marca são
   * recusados — e "não foi possível cadastrar" mandaria a recepção conferir
   * série e modelo à procura de um erro de digitação que não existe.
   */
  DEVICE_UNSUPPORTED_HARDWARE:
    'Este modelo ainda não é homologado. Só o leitor facial Topdata Inner Fit está liberado — os demais dependem do gate de hardware.',
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
