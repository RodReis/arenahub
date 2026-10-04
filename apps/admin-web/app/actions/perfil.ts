'use server';

import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Troca da propria senha -- SPEC-084.
 *
 * MINIMO 8: o mesmo numero de `actions/usuarios.ts`, do `esquemaDeAceite` e
 * do `esquemaDeTrocaDeSenha` na API (decisao do PI em 05/09/2026, #281).
 * Repetido aqui para dar a frase certa sem round-trip; mudou la, muda aqui.
 */
const MINIMO_DE_SENHA = 8;

const esquema = z
  .object({
    senhaAtual: z.string().min(1, 'Informe a senha atual').max(1024),
    novaSenha: z
      .string()
      .min(MINIMO_DE_SENHA, `A nova senha precisa ter ao menos ${MINIMO_DE_SENHA} caracteres`)
      .max(1024, 'Senha longa demais'),
    confirmacao: z.string(),
  })
  // A confirmacao e so da tela -- a API nao a recebe.
  .refine((d) => d.novaSenha === d.confirmacao, { message: 'As senhas não conferem' })
  .refine((d) => d.novaSenha !== d.senhaAtual, {
    message: 'A nova senha precisa ser diferente da atual',
  });

const MENSAGEM_POR_CODIGO: Record<string, string> = {
  AUTH_CURRENT_PASSWORD_INVALID: 'Senha atual incorreta.',
  AUTH_PASSWORD_UNCHANGED: 'A nova senha precisa ser diferente da atual',
  AUTH_PASSWORD_CHANGE_RATE_LIMITED: 'Muitas tentativas. Aguarde um minuto e tente de novo.',
  AUTH_PASSWORD_CHANGE_IN_SUPPORT: 'Em sessão de suporte não é possível trocar a senha.',
};

const MENSAGEM_GENERICA = 'Não foi possível trocar a senha. Tente de novo.';

export interface EstadoDaSenha {
  erro?: string;
  /**
   * Carimbo da troca bem-sucedida. Numero e nao booleano: duas trocas
   * seguidas precisam ser dois valores diferentes, senao o efeito que limpa
   * os campos e mostra o toast nao dispara na segunda.
   */
  sucesso?: number;
}

export async function alterarSenha(
  _anterior: EstadoDaSenha,
  formulario: FormData,
): Promise<EstadoDaSenha> {
  const texto = (campo: string): string => {
    const valor = formulario.get(campo);

    return typeof valor === 'string' ? valor : '';
  };

  const validado = esquema.safeParse({
    senhaAtual: texto('senhaAtual'),
    novaSenha: texto('novaSenha'),
    confirmacao: texto('confirmacao'),
  });

  // Nunca devolve senha no estado: prop serializada volta no HTML da pagina.
  if (!validado.success) return { erro: validado.error.issues[0]?.message ?? MENSAGEM_GENERICA };

  try {
    const resposta = await chamarApi('/api/v1/auth/password', {
      metodo: 'POST',
      corpo: { currentPassword: validado.data.senhaAtual, newPassword: validado.data.novaSenha },
    });

    if (!resposta.ok) {
      return { erro: MENSAGEM_POR_CODIGO[resposta.erro?.code ?? ''] ?? MENSAGEM_GENERICA };
    }
  } catch {
    return { erro: MENSAGEM_GENERICA };
  }

  return { sucesso: Date.now() };
}
