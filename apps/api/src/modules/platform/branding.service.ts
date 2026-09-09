import { Inject, Injectable } from '@nestjs/common';

import {
  MALWARE_SCANNER,
  ErroDoScanner,
  type MalwareScanner,
} from '../../common/antivirus/malware-scanner.port.js';
import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../common/storage/object-storage.port.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  aceitarArquivoDeIdentidade,
  chaveDeIdentidadePertenceA,
  montarChaveDeIdentidade,
  type ContentTypeDeIdentidade,
  type MotivoDeRecusaDeIdentidade,
} from './domain/identidade-visual.js';

export interface ArquivoDeIdentidade {
  readonly contentType: string;
  readonly conteudo: Uint8Array;
}

/** O que a tela de login precisa saber sobre a marca da academia. */
export interface MarcaDoTenant {
  readonly slug: string;
  readonly displayName: string;
  readonly missionText: string | null;
  readonly highlightsText: string | null;
  readonly temLogo: boolean;
  readonly temIcone: boolean;
}

export type PecaDeIdentidade = 'logo' | 'icon';

export class TenantSemIdentidadeError extends ErroDeDominio {
  constructor() {
    super('BRANDING_NOT_FOUND', 404, 'Arquivo não encontrado');
  }
}

/**
 * Identidade visual do tenant -- F62 (ADR-052 §9 e §10).
 *
 * A ORDEM DAS OPERACOES E A DEFESA, herdada do `kiosk-media.service.ts`:
 * formato -> antivirus -> storage. Inverter as duas ultimas guardaria malware
 * no bucket. O que muda aqui e SO a regra de formato -- e ela e mais dura,
 * porque este e o unico upload do produto que aceita SVG (ver
 * `domain/identidade-visual.ts`).
 *
 * ---------------------------------------------------------------------------
 * A LEITURA E PUBLICA, E POR ISSO ELA E ESTREITA.
 * ---------------------------------------------------------------------------
 *
 * `marcaPorSlug` e `lerArquivo` respondem ANTES de existir sessao -- e a
 * unica forma de a tela de login saber de quem ela e. Duas consequencias que
 * moldaram o codigo:
 *
 *   1. SLUG INEXISTENTE E SLUG DE TENANT DESLIGADO devolvem a mesma coisa que
 *      um slug que nunca existiu: `null`. Responder "esse tenant existe mas
 *      esta suspenso" na tela de entrada entregaria a lista de clientes do
 *      ArenaHub a quem tivesse paciencia de tentar nomes -- e diria de quebra
 *      quem esta inadimplente;
 *   2. so estes campos saem. Nada de `cnpj`, `responsavelEmail` ou situacao:
 *      e visao de MARCA, nao o registro do tenant.
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly db: PrismaService,
    @Inject(MALWARE_SCANNER) private readonly antivirus: MalwareScanner,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  /**
   * Substitui o logo ou o icone do tenant.
   *
   * Grava a chave NOVA na coluna e sobrescreve o objeto anterior quando a
   * extensao coincide. Quando nao coincide (PNG virando SVG), o objeto antigo
   * e apagado depois da troca -- sem isso o bucket acumularia um `logo.png`
   * orfao para cada academia que trocou de formato, sem ninguem para
   * encontra-lo depois.
   */
  async substituir(
    tenantId: string,
    peca: PecaDeIdentidade,
    arquivo: ArquivoDeIdentidade,
  ): Promise<{ objectKey: string }> {
    /*
     * O TENANT ANTES DE TUDO. Escanear e gravar no bucket para so entao
     * descobrir que o id nao existe deixaria um objeto orfao sob um prefixo
     * que nenhuma linha referencia -- e ninguem para apaga-lo depois.
     *
     * A leitura tambem traz a chave ANTERIOR, que o passo 3 usa para apagar o
     * arquivo substituido quando a extensao muda.
     */
    const anterior = await this.db.tenant.findUnique({
      where: { id: tenantId },
      select: { logoObjectKey: true, iconObjectKey: true },
    });

    if (!anterior) throw new TenantSemIdentidadeError();

    // --- 1. FORMATO ------------------------------------------------------
    const aceitacao = aceitarArquivoDeIdentidade(arquivo);

    if (!aceitacao.aceito) {
      throw new ErroDeDominio(aceitacao.motivo, 400, MENSAGEM_DE_RECUSA[aceitacao.motivo]);
    }

    // --- 2. ANTIVIRUS, ANTES DE TOCAR O STORAGE --------------------------
    //
    // NAO SUBSTITUI a sanitizacao de SVG, e nem poderia: `<script>` dentro de
    // um vetor nao casa com nenhuma assinatura de virus. Sao duas travas para
    // duas ameacas diferentes -- executavel disfarcado e script embutido.
    let veredito;

    try {
      veredito = await this.antivirus.escanear(arquivo.conteudo);
    } catch (erro) {
      // Scanner FORA DO AR e diferente de arquivo infectado: na duvida o
      // arquivo NAO entra no storage.
      if (erro instanceof ErroDoScanner) {
        throw new ErroDeDominio(erro.codigo, 503, 'Antivírus indisponível. Tente de novo.');
      }

      throw erro;
    }

    if (!veredito.limpo) {
      // A ameaca vai no CODIGO, nunca na mensagem: nome de assinatura na tela
      // confirma ao remetente qual payload passou pela deteccao.
      throw new ErroDeDominio('FILE_INFECTED', 422, 'Arquivo recusado pelo antivírus.');
    }

    // --- 3. STORAGE, so depois de limpo -----------------------------------
    const contentType = arquivo.contentType.toLowerCase() as ContentTypeDeIdentidade;
    const objectKey = montarChaveDeIdentidade(tenantId, peca, contentType);

    await this.storage.putPrivateObject({
      key: objectKey,
      body: Buffer.from(arquivo.conteudo),
      contentType,
    });

    const chaveAntiga = peca === 'logo' ? anterior.logoObjectKey : anterior.iconObjectKey;

    await this.db.tenant.update({
      where: { id: tenantId },
      data: peca === 'logo' ? { logoObjectKey: objectKey } : { iconObjectKey: objectKey },
    });

    /*
     * Apaga o orfao SO depois de a coluna ja apontar para o arquivo novo, e
     * so quando a chave mudou de verdade. Na outra ordem, uma falha entre o
     * delete e o update deixaria a coluna apontando para objeto que nao
     * existe mais -- a tela de login perderia o logo por um erro transitorio.
     */
    if (chaveAntiga !== null && chaveAntiga !== objectKey) {
      await this.storage.deletePrivateObject(chaveAntiga);
    }

    return { objectKey };
  }

  /**
   * A marca da academia daquele slug -- rota PUBLICA, so leitura.
   *
   * `null` cobre tres casos que a tela trata igual: slug que nao existe, slug
   * de tenant fora de operacao, e slug com formato invalido. Ver a nota da
   * classe sobre por que eles nao se distinguem aqui.
   */
  async marcaPorSlug(slug: string): Promise<MarcaDoTenant | null> {
    const tenant = await this.db.tenant.findFirst({
      where: { slug, status: 'ACTIVE' },
      select: {
        slug: true,
        displayName: true,
        missionText: true,
        highlightsText: true,
        logoObjectKey: true,
        iconObjectKey: true,
      },
    });

    if (!tenant) return null;

    return {
      slug: tenant.slug,
      displayName: tenant.displayName,
      missionText: tenant.missionText,
      highlightsText: tenant.highlightsText,
      // BOOLEANO, e nao a chave: a chave e caminho interno do bucket e nao
      // tem por que sair numa resposta publica. Quem quer o arquivo pede o
      // arquivo, pela rota que confere o pertencimento.
      temLogo: tenant.logoObjectKey !== null,
      temIcone: tenant.iconObjectKey !== null,
    };
  }

  /**
   * Os bytes do logo ou do icone daquele slug.
   *
   * CONFERE O PERTENCIMENTO antes de ler. A chave sai de uma coluna do banco,
   * e servir o que a coluna disser -- sem olhar o prefixo -- entregaria a
   * FOTO BIOMETRICA de um aluno por rota publica no dia em que alguem
   * escrevesse `tenants/x/biometrics/...` naquele campo. Mesma disciplina de
   * `chaveDeMidiaPertenceA` na F51.
   */
  async lerArquivo(
    slug: string,
    peca: PecaDeIdentidade,
  ): Promise<{ body: Buffer; contentType: string }> {
    const tenant = await this.db.tenant.findFirst({
      where: { slug, status: 'ACTIVE' },
      select: { id: true, logoObjectKey: true, iconObjectKey: true },
    });

    if (!tenant) throw new TenantSemIdentidadeError();

    const chave = peca === 'logo' ? tenant.logoObjectKey : tenant.iconObjectKey;

    if (chave === null || !chaveDeIdentidadePertenceA(chave, tenant.id)) {
      throw new TenantSemIdentidadeError();
    }

    try {
      return await this.storage.getPrivateObject(chave);
    } catch {
      /*
       * OBJETO SUMIU DO BUCKET (apagado a mao, bucket recriado em dev): a
       * coluna aponta para o que nao existe. Vira 404, e nao 500: para quem
       * abre a tela de login o efeito e o mesmo de nunca ter enviado logo, e
       * a tela cai na marca ArenaHub em vez de quebrar.
       */
      throw new TenantSemIdentidadeError();
    }
  }
}

/**
 * Tipado por `MotivoDeRecusaDeIdentidade`, e nao por `string`: motivo novo no
 * dominio quebra a compilacao AQUI, em vez de chegar a tela como mensagem
 * vazia. Foi por isso que o mapa nao ficou como `Record<string, string>`.
 */
const MENSAGEM_DE_RECUSA: Readonly<Record<MotivoDeRecusaDeIdentidade, string>> = {
  FILE_TOO_LARGE: 'Arquivo grande demais. O limite é 1 MB.',
  FILE_EMPTY: 'Arquivo vazio.',
  FILE_TYPE_NOT_ALLOWED: 'Formato não aceito. Envie SVG ou PNG.',
  FILE_SIGNATURE_MISMATCH: 'O conteúdo do arquivo não corresponde ao formato informado.',
  SVG_UNSAFE_CONTENT:
    'O SVG contém script ou conteúdo executável e foi recusado. Exporte o vetor sem script.',
};
