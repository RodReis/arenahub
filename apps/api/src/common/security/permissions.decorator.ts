import { SetMetadata } from '@nestjs/common';

export const PERMISSOES_EXIGIDAS = 'permissoes_exigidas';

/**
 * Exige TODAS as permissoes listadas -- conjuncao, nao disjuncao.
 *
 * "Qualquer uma serve" e a escolha que parece conveniente e vira brecha:
 * quem tem a permissao mais fraca da lista passa pela porta que a mais forte
 * deveria guardar.
 */
export const RequirePermissions = (...codigos: string[]) =>
  SetMetadata(PERMISSOES_EXIGIDAS, codigos);
