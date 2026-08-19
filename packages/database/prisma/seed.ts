/**
 * Seed de desenvolvimento local.
 *
 * O CLAUDE.md e categorico: "sem hardcode e sem dado inventado no caminho de
 * producao; dado local de desenvolvimento entra por seed, criado na primeira
 * fatia que precisar". A F6 e essa fatia -- o E2E precisa de um proprietario
 * que consiga entrar.
 *
 *   pnpm --filter @arenahub/database seed
 *
 * REGRA QUE NAO SE NEGOCIA: nunca versionar dado real de aluno aqui. Nem em
 * fixture, nem em golden file, nem em log de erro. O dado abaixo e
 * obviamente falso -- dominio `.test`, reservado pela RFC 2606 justamente
 * para nao existir de verdade.
 *
 * IDEMPOTENTE: roda quantas vezes for preciso sem duplicar. Seed que so
 * funciona em banco vazio obriga a derrubar tudo antes de cada execucao.
 */
import { randomBytes, scrypt, type ScryptOptions } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

// O `.env` vive na raiz do monorepo -- mesma fonte que o docker-compose e o
// `prisma.config.ts` usam. O CLI do Prisma carrega sozinho; `tsx`, nao.
//
// ORDEM IMPORTA: antes do import que abre o client.
carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { criarPrismaClient } from '../src/client.js';

// `promisify(scrypt)` perde a sobrecarga que aceita `ScryptOptions`. O
// wrapper manual preserva os quatro argumentos com tipo -- mesmo motivo do
// `PasswordService` da API.
function derivar(
  senha: string,
  sal: Buffer,
  tamanho: number,
  opcoes: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    scrypt(senha, sal, tamanho, opcoes, (erro, chave) => {
      if (erro) rejeitar(erro);
      else resolver(chave);
    });
  });
}

const TENANT = { slug: 'arena-positiva', legalName: 'Complexo Arena Positiva LTDA', displayName: 'Arena Positiva' };
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };
const UNIDADE = { code: 'MATRIZ', name: 'Unidade Matriz', timezone: 'America/Sao_Paulo' };

/**
 * Mesmo envelope do `PasswordService` da API.
 *
 * Duplicado de proposito: o pacote de banco nao depende da API, e inverter
 * essa dependencia para reaproveitar uma funcao de 15 linhas custaria mais
 * do que resolve. Se um terceiro lugar precisar, extrai para
 * `packages/testing`.
 */
async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await derivar(senha, sal, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });

  return `scrypt$v=1$N=16384$r=8$p=1$${sal.toString('base64url')}$${hash.toString('base64url')}`;
}

const PERMISSOES = [
  'tenant.read',
  'tenant.update',
  'unit.create',
  'unit.read',
  'unit.update',
  'user.manage',
  'role.assign',
  // F7: cadastro de aluno, plano e assinatura manual.
  'student.create',
  'student.read',
  'student.update',
  'plan.manage',
  'plan.read',
  'subscription.manage',
  // F8: consentimento, biometria e sincronizacao de dispositivo.
  //
  // `biometric.*` e separado de `student.*` de proposito: quem cadastra aluno
  // na recepcao nao precisa, por isso, enxergar dado biometrico. Dado
  // sensivel do art. 11 pede permissao propria -- e foi falha de controle de
  // acesso que motivou a suspensao da ANPD no caso PR.
  'consent.manage',
  'consent.read',
  'biometric.enroll',
  'biometric.read',
  'biometric.revoke',
  'device.manage',
  'device.read',
  // F9: decisao de acesso e liberacao manual.
  //
  // `access.override` e separado de tudo: quem opera a recepcao no dia a dia
  // consulta eventos (`access.read`), mas ABRIR a catraca a mao e ato
  // excepcional, auditado, que nem todo perfil precisa ter.
  'access.read',
  'access.override',
  // F12: financeiro. `billing.payment.manual` e separado de
  // `billing.manage` pelo mesmo motivo de `access.override`: reconhecer
  // dinheiro sem passar por provedor e ato excepcional, e nem todo perfil
  // do financeiro precisa dele.
  'billing.read',
  'billing.manage',
  'billing.payment.manual',
  // F15: liberacao financeira excepcional. Separada de `billing.manage` pelo
  // mesmo motivo dos dois acima -- liberar o acesso de quem DEVE, sem o
  // pagamento entrar, e ato excepcional com prazo e nome gravados.
  'billing.override.financial',
  // F16: estorno e conciliacao.
  //
  // `billing.refund` e o terceiro ato excepcional do financeiro, pela mesma
  // logica dos dois acima: quem abre invoice nao precisa poder DEVOLVER o
  // dinheiro que ja entrou. Alem da permissao, o estorno exige step-up MFA
  // na propria requisicao (INV-074).
  //
  // `reconciliation.read` e `reconciliation.resolve` sao separadas porque
  // olhar a fila de divergencia e trabalho de conferencia diario, e fecha-la
  // e decisao que assume a diferenca -- quem confere nem sempre e quem
  // decide.
  'billing.refund',
  'reconciliation.read',
  'reconciliation.resolve',
  'receipt.read',
];


/**
 * Catalogo de planos da Arena Positiva.
 *
 * Valores em CENTAVOS (INV-065): R$ 150,00 = 15000. Nunca float.
 *
 * Os beneficios saem dos encartes impressos que o PI forneceu em
 * 18/08/2026. A periodicidade da bioimpedancia e o que diferencia os dois
 * programas -- 30 dias no de adultos e idosos, 60 no de protocolos
 * especificos -- e por isso ela e CAMPO, nao prosa: o MVP 3 vai ler para
 * saber quando a proxima avaliacao vence.
 *
 * "Teste de ECG" entra como `UNDER_REVIEW`: o encarte imprime "em
 * avaliacao", que nao e incluso nem ausente.
 */
const BENEFICIOS_COMUNS = [
  { item: 'Cafe com e sem acucar', detail: 'Disponivel aos alunos' },
  { item: 'Fone de ouvido disponivel', detail: 'Disponivel aos alunos' },
  { item: 'Toalha de higiene pessoal', detail: 'Disponivel aos alunos' },
  { item: 'Consulta inicial (anamnese)', detail: 'Consulta inicial' },
  { item: 'Definicao dos objetivos', detail: 'Definicao individual dos objetivos' },
  { item: 'Treino disponivel no aplicativo', detail: 'Acesso ao treino pelo aplicativo' },
  { item: 'Atualizacoes periodicas do treino', detail: 'Atualizacoes conforme acompanhamento' },
];

const CATALOGO = [
  {
    name: 'Programa Adultos e Idosos',
    description:
      'Para adultos e idosos que desejam preservar forca, autonomia e qualidade de vida.',
    amountMinor: 15_000,
    memberLimit: null,
    beneficios: [
      ...BENEFICIOS_COMUNS,
      { item: 'Avaliacao funcional', detail: 'Equilibrio, mobilidade, forca e autonomia' },
      { item: 'Bioimpedancia', detail: 'Inicial + uma bioimpedancia a cada 30 dias', everyDays: 30 },
      { item: 'Prescricao do treinamento', detail: 'Treinamento prescrito conforme avaliacao' },
      { item: 'Afericao de pressao arterial', detail: 'Acompanhamento previsto no programa' },
      {
        item: 'Aplicacao de protocolos especificos',
        detail: '50+, 60+, 70+: dor no joelho, obesidade, osteopenia, osteoporose',
      },
      {
        item: 'Teste de ECG',
        detail: 'O projeto registra: avaliar se e possivel inserir',
        status: 'UNDER_REVIEW' as const,
      },
    ],
  },
  {
    name: 'Clinica de Musculacao',
    description:
      'Para alunos que necessitam de protocolos especificos e acompanhamento tecnico ampliado.',
    amountMinor: 15_000,
    memberLimit: null,
    beneficios: [
      ...BENEFICIOS_COMUNS,
      { item: 'Bioimpedancia', detail: 'Inicial + uma bioimpedancia a cada 60 dias', everyDays: 60 },
      { item: 'Prescricao do treinamento', detail: 'Treinamento prescrito conforme avaliacao' },
      { item: 'Consulta tecnica aprofundada', detail: 'Acompanhamento tecnico ampliado' },
      { item: 'Adaptacoes do treinamento', detail: 'Conforme idade, condicao clinica e limitacoes' },
    ],
  },
  {
    name: 'Plano Familia',
    description: 'Plano familiar com ate 3 membros.',
    amountMinor: 20_000,
    memberLimit: 3,
    beneficios: BENEFICIOS_COMUNS,
  },
  {
    name: 'Diaria',
    description: 'Acesso avulso de um dia.',
    amountMinor: 3_000,
    memberLimit: null,
    beneficios: [{ item: 'Acesso a academia', detail: 'Um dia' }],
  },
];

async function semear(): Promise<void> {
  const db = criarPrismaClient();

  try {
    const tenant = await db.tenant.upsert({
      where: { slug: TENANT.slug },
      create: TENANT,
      update: {},
    });

    const usuario = await db.user.upsert({
      where: { email: DONO.email },
      create: { email: DONO.email, passwordHash: await gerarHash(DONO.senha) },
      update: {},
    });

    await db.tenantMembership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: usuario.id } },
      create: { tenantId: tenant.id, userId: usuario.id },
      update: { status: 'ACTIVE' },
    });

    const papel = await db.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: 'OWNER' } },
      create: { tenantId: tenant.id, name: 'OWNER', isSystem: true },
      update: {},
    });

    for (const code of PERMISSOES) {
      const permissao = await db.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });

      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: papel.id, permissionId: permissao.id } },
        create: { roleId: papel.id, permissionId: permissao.id },
        update: {},
      });
    }

    const jaTemPapel = await db.userRole.findFirst({
      where: { tenantId: tenant.id, userId: usuario.id, roleId: papel.id, gymUnitId: null },
    });

    if (!jaTemPapel) {
      await db.userRole.create({
        data: { tenantId: tenant.id, userId: usuario.id, roleId: papel.id },
      });
    }

    await db.gymUnit.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: UNIDADE.code } },
      create: { ...UNIDADE, tenantId: tenant.id, openingHours: {} },
      update: {},
    });


    // Vigencia do preco: ancorada no passado para que qualquer invoice de
    // desenvolvimento encontre preco vigente. Reajuste futuro entra como
    // LINHA NOVA com `validFrom` proprio -- nunca editando esta.
    const VIGENCIA_INICIAL = new Date('2026-01-01T00:00:00Z');

    for (const definicao of CATALOGO) {
      const plano = await db.plan.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: definicao.name } },
        create: { tenantId: tenant.id, name: definicao.name, description: definicao.description },
        update: { description: definicao.description },
      });

      await db.planPrice.upsert({
        where: { planId_validFrom: { planId: plano.id, validFrom: VIGENCIA_INICIAL } },
        create: {
          tenantId: tenant.id,
          planId: plano.id,
          amountMinor: definicao.amountMinor,
          validFrom: VIGENCIA_INICIAL,
        },
        update: { amountMinor: definicao.amountMinor },
      });

      // Beneficio nao tem chave natural estavel alem de (plano, item):
      // apaga e reescreve mantem o seed idempotente sem inventar id.
      await db.planBenefit.deleteMany({ where: { planId: plano.id } });
      await db.planBenefit.createMany({
        data: definicao.beneficios.map((beneficio, posicao) => ({
          tenantId: tenant.id,
          planId: plano.id,
          item: beneficio.item,
          detail: beneficio.detail,
          status: 'status' in beneficio ? beneficio.status : ('INCLUDED' as const),
          everyDays: 'everyDays' in beneficio ? beneficio.everyDays : null,
          position: posicao,
        })),
      });
    }

    await db.billingSettings.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, dueDay: 10, graceDays: 5 },
      update: {},
    });

    console.info(`[seed] catalogo com ${String(CATALOGO.length)} planos e precos vigentes.`);

    console.info(`[seed] tenant "${TENANT.slug}" pronto, com dono ${DONO.email}.`);
  } finally {
    // Sem `$disconnect` o pool segura o processo de pe -- o `client.ts`
    // avisa disso explicitamente.
    await db.$disconnect();
  }
}

try {
  await semear();
} catch (erro: unknown) {
  console.error('[seed] falhou:', erro);
  process.exitCode = 1;
}
