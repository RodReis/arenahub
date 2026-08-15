import { SetMetadata } from '@nestjs/common';

export const ROTA_PUBLICA = 'rota_publica';

/**
 * Marca rota que dispensa autenticacao.
 *
 * O guard e GLOBAL, entao o padrao e "protegido" e a excecao e explicita --
 * o inverso (proteger rota a rota) faz de cada rota nova uma chance de
 * esquecer. Sao poucas: health, version, login, refresh e aceite de convite.
 */
export const Public = () => SetMetadata(ROTA_PUBLICA, true);
