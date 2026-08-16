/**
 * Politica de retentativa da sincronizacao com o leitor.
 *
 * Funcoes puras: sem banco, sem relogio. O "agora" entra por parametro
 * (`CLAUDE.md`, Convencoes de codigo) -- e o que permite testar a quinta
 * tentativa sem esperar dezenove minutos.
 */

/**
 * Backoff em minutos, por numero de tentativas ja feitas.
 *
 * 1, 2, 3, 5, 8 -- Fibonacci truncado, como o plano de apoio define. A
 * escolha nao e estetica: leitor de academia cai por motivo passageiro
 * (rede, reboot, cabo), e um backoff curto no comeco resolve a maioria antes
 * de alguem notar; o alongamento evita martelar equipamento que esta
 * realmente fora.
 */
export const BACKOFF_EM_MINUTOS = [1, 2, 3, 5, 8] as const;

/** Tentativas antes de a dead letter engolir o job. */
export const MAXIMO_DE_TENTATIVAS = BACKOFF_EM_MINUTOS.length;

/**
 * Erros que NAO adianta repetir.
 *
 * Distinguir permanente de transitorio e o que impede duas patologias
 * opostas: retentar para sempre um comando que o leitor nunca vai aceitar, e
 * desistir na primeira falha de rede.
 */
export const ERROS_PERMANENTES = [
  /** O modelo nao suporta a operacao pedida. */
  'DEVICE_OPERATION_UNSUPPORTED',
  /** A imagem nao serve: rosto nao detectado, resolucao insuficiente. */
  'DEVICE_ENROLLMENT_REJECTED',
  /** O dispositivo saiu do inventario entre o job e a execucao. */
  'DEVICE_NOT_FOUND',
] as const;

export type ErroPermanente = (typeof ERROS_PERMANENTES)[number];

export function ehErroPermanente(codigo: string): boolean {
  return (ERROS_PERMANENTES as readonly string[]).includes(codigo);
}

/** Proximo estado do job depois de uma tentativa que falhou. */
export type DecisaoDeRetentativa =
  | { estado: 'RETRYING'; proximaTentativaEm: Date }
  | { estado: 'FAILED' };

/**
 * O que fazer depois de uma falha.
 *
 * `FAILED` e a dead letter: o job para de tentar e fica VISIVEL no painel de
 * pendencia. Nao some -- sumir e o que faz a operacao descobrir o problema
 * pelo aluno reclamando na catraca.
 */
export function decidirRetentativa(
  tentativasFeitas: number,
  codigoDoErro: string,
  agora: Date,
): DecisaoDeRetentativa {
  // Erro permanente vai direto para a dead letter, sem gastar as cinco
  // tentativas repetindo o que ja se sabe que falha.
  if (ehErroPermanente(codigoDoErro)) return { estado: 'FAILED' };

  if (tentativasFeitas >= MAXIMO_DE_TENTATIVAS) return { estado: 'FAILED' };

  const minutos = BACKOFF_EM_MINUTOS[tentativasFeitas - 1] ?? BACKOFF_EM_MINUTOS[0];

  return {
    estado: 'RETRYING',
    proximaTentativaEm: new Date(agora.getTime() + minutos * 60_000),
  };
}

/**
 * Chave logica do trabalho: `{identityId}:{deviceId}:{operacao}`.
 *
 * E o que impede o outbox reprocessado de virar dois jobs para o mesmo
 * trabalho (regra de arquitetura no 4). Reexecutar e sempre seguro.
 */
export function montarChaveDeIdempotencia(
  identityId: string,
  deviceId: string,
  operacao: 'UPSERT' | 'DELETE',
): string {
  return `${identityId}:${deviceId}:${operacao}`;
}

/**
 * Acao recomendada para quem opera, por codigo de erro.
 *
 * O painel de pendencia mostra isto ao lado do job. Codigo sozinho manda a
 * recepcao abrir chamado para descobrir o que fazer; a frase resolve na
 * hora os casos triviais.
 */
export function acaoRecomendada(codigoDoErro: string | null): string | null {
  if (!codigoDoErro) return null;

  switch (codigoDoErro) {
    case 'DEVICE_UNREACHABLE':
      return 'Verifique se o leitor esta ligado e conectado a rede.';
    case 'DEVICE_ENROLLMENT_REJECTED':
      return 'A foto foi recusada pelo leitor. Refaca o cadastro com nova captura.';
    case 'DEVICE_OPERATION_UNSUPPORTED':
      return 'O modelo do leitor nao suporta esta operacao. Acione o suporte.';
    case 'DEVICE_NOT_FOUND':
      return 'O dispositivo saiu do inventario. Recadastre-o antes de repetir.';
    case 'EDGE_OFFLINE':
      return 'O agente da academia esta fora do ar. Verifique o PC do Edge.';
    default:
      return 'Repita a sincronizacao. Se persistir, acione o suporte.';
  }
}
