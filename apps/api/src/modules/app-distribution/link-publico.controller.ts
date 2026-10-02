import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Throttle, minutes } from '@nestjs/throttler';

import { Public } from '../../common/security/public.decorator.js';
import { AppDistributionRepository } from './app-distribution.repository.js';
import { slugDoLinkValido } from './domain/instalador-android.js';

/**
 * Link curto do app (#538) -- `<painel>/baixar/<slug>` pergunta aqui para
 * onde mandar o aluno. Sem login: quem abre e o aluno, pelo WhatsApp ou pelo
 * QR do balcao.
 *
 * Teto ALTO de proposito: a academia inteira baixa pelo mesmo Wi-Fi, atras de
 * um IP so, e o link so revela o endereco de um APK que ja e publico.
 */
@Controller('api/v1/public/app-links')
@Public()
export class LinkPublicoController {
  constructor(private readonly instalador: AppDistributionRepository) {}

  @Get(':slug')
  @Throttle({ default: { ttl: minutes(1), limit: 120 } })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['androidUrl', 'tenantSlug'],
      properties: {
        androidUrl: { type: 'string', nullable: true, description: 'Nulo = final reservado, sem APK no momento.' },
        tenantSlug: { type: 'string' },
      },
    },
  })
  async resolver(
    @Param('slug') slug: string,
  ): Promise<{ androidUrl: string | null; tenantSlug: string }> {
    // Slug fora do formato nem chega ao banco; 404 igual ao inexistente.
    const destino = slugDoLinkValido(slug) ? await this.instalador.destinoDoLink(slug) : null;
    if (!destino) throw new NotFoundException({ code: 'APP_LINK_NOT_FOUND' });

    return destino;
  }
}
