'use server';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Liberação manual da catraca — `M1-FR-023`, `M1-AC-008`.
 *
 * A validação daqui NÃO substitui a da API: ela existe para o operador ver o
 * erro sem perder o que digitou. A API valida de novo, e é ela que manda —
 * Server Action é superfície pública tanto quanto um endpoint.
 */
const esquemaDoFormulario = z.object({
  gymUnitId: z.string().uuid('Selecione a unidade'),
  deviceId: z.string().uuid('Selecione a catraca'),
  studentId: z.string().uuid().optional().or(z.literal('')),
  visitorDescription: z.string().max(120).optional().or(z.literal('')),
  reason: z
    .string()
    .min(10, 'Descreva o motivo com pelo menos 10 caracteres — a auditoria depende disso')
    .max(300, 'Motivo longo demais'),
});

export interface EstadoDoOverride {
  erro?: string;
  sucesso?: {
    accessEventId: string;
    /** `true` quando a mesma liberação já tinha sido registrada. */
    repetido: boolean;
  };
  /** Devolvidos para o formulário não perder o preenchimento em erro. */
  valores?: {
    studentId?: string;
    visitorDescription?: string;
    reason?: string;
  };
}

/**
 * Códigos da API traduzidos.
 *
 * O código é estável e serve à correlação; a frase é de interface. Sem a
 * tradução, a recepção veria `ACCESS_OVERRIDE_SUBJECT_REQUIRED` e abriria
 * chamado para descobrir o que fazer.
 */
const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  ACCESS_OVERRIDE_SUBJECT_REQUIRED:
    'Informe o aluno OU a descrição do visitante — um dos dois, não os dois.',
  DEVICE_NOT_FOUND: 'Esta catraca não pertence à unidade selecionada.',
  STUDENT_NOT_FOUND: 'Aluno não encontrado nesta academia.',
  GYM_UNIT_NOT_FOUND: 'Você não tem acesso a esta unidade.',
  FORBIDDEN: 'Seu perfil não tem permissão para liberar a catraca.',
  ACCESS_IDEMPOTENCY_CONFLICT:
    'Já existe uma liberação registrada com esta identificação, com dados diferentes.',
};

/**
 * Lê um campo de texto do formulário.
 *
 * `FormData.get` devolve `File` quando o campo é um upload, e `String(file)`
 * viraria `[object Object]` — um "motivo" que passa na validação de tamanho
 * e não diz nada. Campo que não é texto vira string vazia e é recusado pela
 * validação, como qualquer outro campo ausente.
 */
function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

export async function liberarAcessoManual(
  _anterior: EstadoDoOverride,
  formulario: FormData,
): Promise<EstadoDoOverride> {
  const bruto = {
    gymUnitId: texto(formulario, 'gymUnitId'),
    deviceId: texto(formulario, 'deviceId'),
    studentId: texto(formulario, 'studentId'),
    visitorDescription: texto(formulario, 'visitorDescription'),
    reason: texto(formulario, 'reason'),
  };

  const valores = {
    studentId: bruto.studentId,
    visitorDescription: bruto.visitorDescription,
    reason: bruto.reason,
  };

  const validado = esquemaDoFormulario.safeParse(bruto);

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  const temAluno = bruto.studentId !== '';
  const temVisitante = bruto.visitorDescription !== '';

  if (temAluno === temVisitante) {
    return {
      erro:
        MENSAGEM['ACCESS_OVERRIDE_SUBJECT_REQUIRED'] ??
        'Informe o aluno ou a descrição do visitante.',
      valores,
    };
  }

  // A chave nasce NO SERVIDOR, a cada submissão.
  //
  // Gerá-la no cliente permitiria que uma página aberta há uma hora reenviasse
  // a chave antiga; gerá-la aqui garante que uma submissão deliberada é uma
  // liberação. O que a chave protege é o retry da MESMA submissão -- clique
  // duplo, rede lenta -- e para isso ela precisa existir por submissão, não
  // por sessão.
  const resposta = await chamarApi<{
    overrideId: string;
    accessEventId: string;
    replayed: boolean;
  }>('/api/v1/access/manual-overrides', {
    metodo: 'POST',
    corpo: {
      gymUnitId: validado.data.gymUnitId,
      deviceId: validado.data.deviceId,
      ...(temAluno ? { studentId: bruto.studentId } : {}),
      ...(temVisitante ? { visitorDescription: bruto.visitorDescription } : {}),
      reason: validado.data.reason,
      idempotencyKey: randomUUID(),
      confirm: true,
    },
  });

  if (!resposta.ok || !resposta.dados) {
    const codigo = resposta.erro?.code ?? '';

    return {
      // Nunca reporta passagem otimista: se a API recusou, a catraca não
      // abriu, e dizer o contrário mandaria o operador embora achando que
      // resolveu.
      erro: MENSAGEM[codigo] ?? `Não foi possível liberar o acesso (${codigo || 'erro'}).`,
      valores,
    };
  }

  return {
    sucesso: {
      accessEventId: resposta.dados.accessEventId,
      repetido: resposta.dados.replayed,
    },
  };
}
