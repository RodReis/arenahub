import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';

/**
 * Nao ha usuario do painel agindo -- quem age e o proprio aluno, pelo app.
 *
 * `audit_logs.actor_id` e anulavel exatamente para isto, e a conversao mora
 * aqui, com nome, em vez de um `as unknown as string` solto: a divergencia
 * entre o tipo (`string`) e a coluna (`uuid NULL`) fica visivel para quem le.
 * Mesma decisao e mesmo motivo de `kiosk-area-do-aluno.service.ts` -- pondo
 * um id que nao esta em `users` ali, o INSERT de auditoria viola a FK e
 * derruba a transacao inteira.
 */
const SEM_USUARIO = null as unknown as string;

/**
 * `StudentChannelContext` -> `TenantContext`, para chamar caso de uso publico
 * de outro modulo (regra de arquitetura no 9 -- nunca a tabela dele).
 *
 * `permissions` VAZIO, de proposito: o aluno nao e usuario do painel e nao
 * herda papel nenhum. Os casos de uso que este canal chama sao os que NAO
 * checam permissao internamente -- a checagem deles vive no
 * `@RequirePermissions` do controller do painel, que este caminho nao
 * atravessa. Conjunto povoado aqui seria um papel inventado.
 *
 * `allowedUnitIds: 'ALL'` e a DIFERENCA em relacao ao totem, e ela e
 * deliberada: o totem e fisico e pertence a uma recepcao so, mas o aluno com
 * o app na mao pode ter treinado em qualquer unidade da rede. Restringir a
 * uma unidade aqui sumiria com a frequencia de quem treina na matriz e na
 * filial -- e o sumico seria silencioso, porque um periodo sem sessao e uma
 * resposta valida.
 *
 * O ISOLAMENTO NAO VEM DAQUI: vem do `tenantId` da sessao (que o guard
 * resolve) e do `studentId`, que todo chamador passa a partir do contexto --
 * nunca da URL.
 */
export function tenantContextDoAluno(ctx: StudentChannelContext): TenantContext {
  return {
    tenantId: ctx.tenantId,
    actorId: SEM_USUARIO,
    sessionId: ctx.sessionId,
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  };
}

/**
 * Sessao valida apontando para aluno que nao existe mais no tenant.
 *
 * 404 com codigo PROPRIO do canal, e nao o `UNAVAILABLE` da Home: a Home e o
 * shell e tem de abrir mesmo sem conteudo, mas perfil e engajamento sao telas
 * de DADO -- responder 200 com campos vazios faria o app exibir um perfil em
 * branco como se fosse o do aluno.
 */
export class AlunoDaSessaoNaoEncontradoError extends ErroDeDominio {
  constructor() {
    super('MOBILE_STUDENT_NOT_FOUND', 404, 'Aluno nao encontrado');
  }
}
