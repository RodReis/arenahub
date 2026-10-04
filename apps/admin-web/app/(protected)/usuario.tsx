import Link from 'next/link';

import estilos from './usuario.module.css';

interface Props {
  readonly email: string;
}

/** Duas primeiras letras do e-mail, maiúsculas -- sem foto, é o que a topbar tem. */
export function iniciais(email: string): string {
  const local = email.split('@')[0] ?? '';
  const partes = local.split(/[.\-_]/).filter(Boolean);
  const letras = partes.length >= 2 ? [partes[0], partes[1]] : [local, ''];

  return letras
    .map((parte) => parte?.[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Avatar do usuário logado na topbar -- DS-PAINEL.md v2 §4.1/§4.19.
 *
 * Sem foto de perfil no domínio ainda: iniciais sobre o gradiente de accent é
 * o que a spec pede como piso, e o círculo acompanha o accent do tenant como
 * qualquer outro uso de `--ah-accent-*`.
 *
 * O chip leva a `/perfil` (SPEC-084): é o único lugar do painel onde a pessoa
 * se vê, e o caminho natural de quem procura "minha conta".
 */
export function Usuario({ email }: Props) {
  return (
    <Link href="/perfil" className={estilos['chip']} data-testid="link-do-perfil">
      <span className={estilos['avatar']} aria-hidden="true">
        {iniciais(email)}
      </span>
      <span className={estilos['email']} data-testid="usuario-logado">
        {email}
      </span>
    </Link>
  );
}
