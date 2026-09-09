import { Controller, Get, Header, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../../common/security/public.decorator.js';
import { BrandingService } from './branding.service.js';

const ESQUEMA_DA_MARCA = {
  type: 'object',
  required: ['slug', 'displayName', 'temLogo', 'temIcone'],
  properties: {
    slug: { type: 'string' },
    displayName: { type: 'string' },
    missionText: { type: 'string', nullable: true },
    highlightsText: { type: 'string', nullable: true },
    temLogo: { type: 'boolean' },
    temIcone: { type: 'boolean' },
  },
};

/**
 * Formato do slug aceito na rota.
 *
 * Recusar aqui, e ANTES de tocar o banco, evita transformar a tela de login
 * em oraculo de consulta: sem isto, cada palpite de slug vira um `SELECT`, e
 * a rota publica passa a ser um jeito barato de varrer nomes.
 *
 * O mesmo alfabeto que o cadastro de tenant aceita -- minusculas, digitos e
 * hifen.
 */
const SLUG_VALIDO = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Cache do arquivo de marca no navegador.
 *
 * Cinco minutos, e `public` porque nao ha nada de privado num logo: a mesma
 * imagem e servida a todo mundo que abre aquela tela de login. Curto de
 * proposito -- o Super Admin que troca o logo quer ver a troca no mesmo
 * expediente, nao no dia seguinte.
 */
const CACHE_DO_ARQUIVO = 'public, max-age=300';

/**
 * A marca da academia, ANTES da autenticacao -- F62 (ADR-052 §10).
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM CONTROLLER SEPARADO DO `PlatformController`.
 * ---------------------------------------------------------------------------
 *
 * Aquele e `@PlatformRoute()` na CLASSE, e o comentario dele diz por que:
 * "cada rota nova aqui nasce protegida, sem depender de alguem lembrar de
 * decorar o metodo". Pendurar uma rota `@Public()` la dentro inverteria
 * exatamente essa garantia -- passaria a existir um metodo que escapa da
 * protecao da classe, e o proximo a ser escrito ao lado dele herdaria a
 * duvida. Aqui o padrao da classe e "publico", e nao ha excecao a lembrar.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA ROTA NAO PODE FAZER: DIZER QUE UM SLUG NAO EXISTE.
 * ---------------------------------------------------------------------------
 *
 * `GET /branding/{slug}` responde 200 com a marca ArenaHub tanto para slug
 * inexistente quanto para tenant fora de operacao. Um 404 aqui entregaria,
 * a quem tivesse paciencia de tentar nomes, a lista de clientes do ArenaHub
 * -- e, de quebra, quais deles estao suspensos. E o aceite da issue #285:
 * "slug inexistente cai na marca ArenaHub sem vazar que o slug nao existe".
 *
 * O ARQUIVO e a excecao coerente: `GET /branding/{slug}/logo` de um slug
 * desconhecido responde 404, como responderia um tenant real que nunca
 * enviou logo. Os dois casos sao indistinguiveis de fora, que e o ponto.
 */
@Controller('api/v1/branding')
@Public()
export class BrandingPublicoController {
  constructor(private readonly branding: BrandingService) {}

  @Get(':slug')
  @ApiOkResponse({ schema: ESQUEMA_DA_MARCA })
  async marca(@Param('slug') slug: string): Promise<{
    slug: string;
    displayName: string;
    missionText: string | null;
    highlightsText: string | null;
    temLogo: boolean;
    temIcone: boolean;
  }> {
    const encontrada = SLUG_VALIDO.test(slug) ? await this.branding.marcaPorSlug(slug) : null;

    if (encontrada) return encontrada;

    /*
     * A MARCA ARENAHUB como resposta, e nao 404. Ver a nota da classe: o
     * status da resposta nao pode distinguir "nao existe" de "existe e esta
     * desligado" -- e o corpo tambem nao, por isso ele e literalmente o
     * mesmo que a tela sem slug ja mostra.
     */
    return {
      slug: '',
      displayName: 'ArenaHub',
      missionText: null,
      highlightsText: null,
      temLogo: false,
      temIcone: false,
    };
  }

  /**
   * Os bytes do logo ou do icone.
   *
   * ---------------------------------------------------------------------------
   * OS TRES CABECALHOS SAO A DEFESA, E NENHUM DELES E DECORATIVO.
   * ---------------------------------------------------------------------------
   *
   * SVG servido de dominio proprio EXECUTA script na origem que o serviu. A
   * sanitizacao no upload ja recusa o arquivo com script (`identidade-visual.
   * ts`), e estes cabecalhos sao a segunda trava -- para o arquivo que entrou
   * antes desta fatia existir, ou por um caminho que ninguem previu:
   *
   *   - `Content-Security-Policy: default-src 'none'; ...` -- mesmo que um
   *     script escape, ele nao carrega, nao busca e nao envia nada;
   *   - `sandbox` na mesma diretiva tira do documento a origem e a execucao
   *     de script;
   *   - `X-Content-Type-Options: nosniff` impede o navegador de decidir
   *     sozinho que aquele arquivo e outra coisa;
   *   - `Content-Disposition: inline` sem nome de arquivo, porque o objetivo
   *     e desenhar na tela, nao baixar.
   *
   * O `content-type` sai do STORAGE, e nao do que o cliente pedir: e o que
   * foi gravado no upload, depois de a assinatura dos bytes ter sido
   * conferida contra ele.
   */
  @Get(':slug/:peca')
  /*
   * SCHEMA BINARIO, e nao JSON: esta e a unica rota do produto que devolve
   * bytes de imagem. A guarda de contrato (`openapi.int-spec.ts`) exige que
   * TODA rota nova declare a forma da resposta -- e declarar um objeto vazio
   * aqui faria o snapshot afirmar que a rota devolve JSON, que e justamente o
   * tipo de mentira que aquela guarda existe para impedir.
   */
  @ApiOkResponse({
    content: {
      'image/svg+xml': { schema: { type: 'string', format: 'binary' } },
      'image/png': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @Header('Cache-Control', CACHE_DO_ARQUIVO)
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  @Header('Content-Disposition', 'inline')
  async arquivo(
    @Param('slug') slug: string,
    @Param('peca') peca: string,
    @Res() resposta: Response,
  ): Promise<void> {
    if ((peca !== 'logo' && peca !== 'icon') || !SLUG_VALIDO.test(slug)) {
      throw new NotFoundException({ code: 'BRANDING_NOT_FOUND' });
    }

    const arquivo = await this.branding.lerArquivo(slug, peca);

    resposta.type(arquivo.contentType).send(arquivo.body);
  }
}
