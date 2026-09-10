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
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CONFIG_PADRAO_DO_TOTEM } from '@arenahub/api-contracts';
import { config as carregarEnv } from 'dotenv';

// O `.env` vive na raiz do monorepo -- mesma fonte que o docker-compose e o
// `prisma.config.ts` usam. O CLI do Prisma carrega sozinho; `tsx`, nao.
//
// ORDEM IMPORTA: antes do import que abre o client.
carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { criarPrismaClient } from '../src/client.js';
import { PERMISSOES_DO_OWNER } from '../src/permissoes.js';
import { gerarHash } from '../src/senha.js';

const TENANT = { slug: 'arena-positiva', legalName: 'Complexo Arena Positiva LTDA', displayName: 'Arena Positiva' };
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };
const UNIDADE = { code: 'MATRIZ', name: 'Unidade Matriz', timezone: 'America/Sao_Paulo' };

/**
 * Aluno que o totem identifica na bancada e no E2E da F49.
 *
 * FALSO POR CONSTRUCAO, como o resto deste arquivo: o CPF `000.000.001-91` e
 * o menor numero cujos digitos verificadores fecham, e o nome nao pertence a
 * ninguem. Nenhum dado real de aluno entra aqui -- nem em fixture, nem em
 * golden file (CLAUDE.md).
 *
 * `ACTIVE` e sem invoice em aberto: a jornada de aceite quer a faixa "Plano
 * ativo". Pendencia e o outro caminho da mesma tela e nao precisa de aluno
 * proprio no seed base.
 */
const ALUNO_DO_TOTEM = {
  // Matricula FORA da faixa que a API emite (`AP-{ano}-{8 digitos}`): o banco
  // de desenvolvimento ja tinha um `AP-2026-00000001` cadastrado pela tela, e
  // o upsert por chave natural teria sobrescrito o CPF e o status dele. Um
  // prefixo proprio garante que este aluno nunca colide com um cadastrado de
  // verdade -- e deixa obvio, na lista de alunos, de onde ele veio.
  membershipNumber: 'SEED-TOTEM-0001',
  fullName: 'Aluno de Bancada do Totem',
  cpf: '00000000191',
  birthDate: '1990-05-20',
};

/**
 * Credencial HMAC do totem para DESENVOLVIMENTO LOCAL.
 *
 * ISTO NAO E SEGREDO DE PRODUCAO E NUNCA PODE VIRAR UM. Esta em texto claro
 * num arquivo versionado, o que e a definicao de segredo publicado. Existe
 * por um motivo so: sem credencial, a ponte do totem nao assina, TODA
 * identificacao cai na mensagem neutra, e a jornada nao funciona nem por
 * acidente -- entao nao havia como rodar o E2E da fatia.
 *
 * A F50 entrega o provisionamento pelo painel, com segredo gerado e exibido
 * uma vez. Quando ela chegar, este bloco continua valendo so para a bancada.
 *
 * O prefixo `dev-` no `keyId` e proposital: uma credencial com esse nome num
 * banco que nao seja de desenvolvimento e um achado de auditoria, nao uma
 * duvida.
 */
const CREDENCIAL_DO_TOTEM = {
  keyId: 'dev-totem01',
  segredo: 'segredo-de-bancada-do-totem-nao-use-em-producao',
};

// Lista movida para `src/permissoes.ts` -- o bootstrap de tenant real (F58)
// precisa exatamente das mesmas, e a copia que ele tinha deixou o OWNER de
// producao sem enxergar o proprio dashboard.
const PERMISSOES = PERMISSOES_DO_OWNER;

/**
 * Dono do SaaS -- o Super Admin da F61.
 *
 * NAO E DONO DE TENANT: nao tem `TenantMembership` nem papel, e nao aparece
 * em `/users` de academia nenhuma. O que o define e a linha em
 * `platform_admins`, que o `AuthGuard` le para montar `PlatformContext`.
 *
 * `dono@arenahub.test` e nao `@arena-positiva.test`: o dominio diz de quem o
 * usuario e. Confundir os dois num seed que cria os dois seria convite a
 * testar a jornada errada.
 *
 * O SEGREDO TOTP E FIXO E ESTA PUBLICADO AQUI. Como a credencial do totem
 * logo abaixo: isto e bancada, nunca producao. O `mfaStatus` nasce `ENABLED`,
 * entao o login pede codigo em vez de oferecer inscricao -- e o seed imprime
 * o base32 para quem quiser cadastrar no autenticador e entrar a mao.
 */
const SUPER_ADMIN = {
  email: 'dono@arenahub.test',
  senha: 'senha-de-bancada-do-dono-do-saas',
  // 20 bytes, o mesmo tamanho que `TotpService.gerarSegredo` emite. Texto
  // legivel em vez de aleatorio: o segredo e publico de qualquer forma, e
  // assim fica obvio, olhando o banco, que aquela linha e de bancada.
  segredoTotp: 'arenahub-seed-mfa-01',
};

/**
 * Refresh token da sessao de plataforma que o E2E usa para entrar.
 *
 * POR QUE ELE EXISTE. O login do Super Admin exige segundo fator (INV-007), e
 * o painel ainda nao tem tela de MFA -- entao nao ha como o Playwright entrar
 * pelo formulario. Gerar TOTP dentro do teste tambem nao serve: o codigo vira
 * a cada 30 s e o algoritmo mora na API, nao no painel.
 *
 * O QUE ELE NAO E: um atalho que forja sessao. O refresh token do ArenaHub e
 * opaco -- 32 bytes aleatorios cujo SHA-256 o banco guarda (`TokenService`).
 * Semear a linha da sessao com o hash de um valor conhecido nao inventa
 * credencial nenhuma: quem emite o token de acesso continua sendo a API, em
 * `POST /auth/refresh`, com a chave dela e para esta sessao. O teste so
 * apresenta o cookie; o proxy do painel faz o resto, pelo mesmo caminho que
 * renova a sessao de qualquer usuario.
 *
 * USO UNICO, e isso e do produto, nao do seed: o refresh ROTACIONA a cada
 * uso, e reapresentar um ja rotacionado derruba a familia inteira (detecao de
 * reuso). Por isso a sessao e reposta a cada execucao do seed -- e o
 * `pretest:e2e` roda o seed antes de toda suite.
 */
const SESSAO_DE_PLATAFORMA = {
  refresh: 'refresh-de-bancada-do-super-admin-e2e',
  // Generoso de proposito: a suite E2E roda em minutos, e sessao expirada
  // daria 401 com cara de bug de permissao.
  validoPorDias: 30,
};

/**
 * A SEGUNDA sessao de plataforma, para a jornada da F62 (issue #285).
 *
 * UMA SESSAO POR JORNADA, e nao uma compartilhada: o refresh e de USO UNICO --
 * ele rotaciona ao ser usado, e reapresentar um ja rotacionado derruba a
 * familia inteira por detecao de reuso (`auth.service.ts`). Duas jornadas
 * partindo do mesmo token fariam a segunda a rodar falhar com erro de sessao,
 * escondendo o defeito que ela deveria acusar -- e o Playwright roda os testes
 * de um arquivo em ordem, mas em paralelo com os de outros.
 *
 * Cada jornada nova de plataforma ganha a propria linha aqui. E barato: uma
 * `Session` a mais no banco de E2E.
 */
const SESSAO_DE_PLATAFORMA_DA_MARCA = {
  refresh: 'refresh-de-bancada-do-super-admin-e2e-marca',
  validoPorDias: 30,
};

/**
 * A TERCEIRA sessao de plataforma, para a jornada da F63 (issue #286):
 * cadastrar plano SaaS, abrir contrato, fechar e baixar o PDF.
 *
 * Linha propria pela mesma razao das duas acima -- o refresh e de uso unico.
 */
const SESSAO_DE_PLATAFORMA_DO_CONTRATO = {
  refresh: 'refresh-de-bancada-do-super-admin-e2e-contrato',
  validoPorDias: 30,
};

/**
 * A QUARTA sessao de plataforma, para a jornada da F64 (issue #287): emitir a
 * fatura da plataforma e registrar o pagamento.
 *
 * Linha propria pela mesma razao das tres acima -- o refresh e de uso unico.
 */
const SESSAO_DE_PLATAFORMA_DA_FATURA = {
  refresh: 'refresh-de-bancada-do-super-admin-e2e-fatura',
  validoPorDias: 30,
};

/**
 * Ids FIXOS do plano e do contrato de bancada -- F64.
 *
 * Fixos e nao sorteados porque o seed e idempotente: `upsert` por id
 * reencontra o que ja existe, e um uuid novo a cada execucao criaria um plano
 * por rodada ate a lista da tela virar lixo.
 */
const PLANO_SAAS_DE_BANCADA = '00000000-0000-4000-8000-0000000f6401';
const CONTRATO_SAAS_DE_BANCADA = '00000000-0000-4000-8000-0000000f6402';


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

    const unidade = await db.gymUnit.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: UNIDADE.code } },
      create: { ...UNIDADE, tenantId: tenant.id, openingHours: {} },
      update: {},
    });

    /*
     * MODALIDADE PADRAO DA UNIDADE (F60).
     *
     * A mesma que a migration atribuiu aos alunos ja existentes. Sem ela o
     * cadastro de aluno em ambiente novo nasceria travado: o wizard exige ao
     * menos uma modalidade, e a lista viria vazia.
     *
     * As demais (quadras de areia, cross fit, box) a academia cadastra pela
     * tela -- o seed nao inventa o catalogo esportivo de ninguem.
     */
    await db.gymUnitModality.upsert({
      where: {
        gymUnitId_name: {
          gymUnitId: unidade.id,
          name: 'Academia - Clínica de Musculação',
        },
      },
      create: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        name: 'Academia - Clínica de Musculação',
      },
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

      /*
       * UNIDADE E JANELA SAO PARTE DO PLANO, NAO ENFEITE (issue #188).
       *
       * Sem elas o snapshot de politica sai vazio: o entitlement nasce ATIVO,
       * a ficha diz que o aluno tem acesso e a catraca nega. `POST /plans`
       * exige as duas (`min(1)`), e o seed escrevia pelo client -- contornando
       * a validacao e produzindo um estado que a API recusa criar.
       *
       * Apaga e reescreve, como os beneficios logo abaixo: nao ha chave
       * natural, e reescrever mantem o seed idempotente sem inventar id.
       */
      await db.planUnit.deleteMany({ where: { planId: plano.id } });
      await db.planUnit.create({
        data: { tenantId: tenant.id, planId: plano.id, gymUnitId: unidade.id },
      });

      // Segunda a sexta, 06:00-22:00 (360 a 1320) -- o mesmo horario que a
      // bancada ja usa nos planos criados pela tela.
      await db.planAccessWindow.deleteMany({ where: { planId: plano.id } });
      await db.planAccessWindow.createMany({
        data: [1, 2, 3, 4, 5].map((dia) => ({
          tenantId: tenant.id,
          planId: plano.id,
          gymUnitId: unidade.id,
          dayOfWeek: dia,
          startMinute: 360,
          endMinute: 1320,
        })),
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

    await semearTotem(db, tenant.id, unidade.id);
    // Depois do totem (precisa do dispositivo) e ANTES do aceite de IA, que
    // varre os alunos ativos -- inclusive este.
    await semearAlunoECredencialDoTotem(db, tenant.id, unidade.id);
    await semearAceiteDaAnalise(db, tenant.id);
    await semearDocumentosDeEngajamento(db, tenant.id);
    await semearCatalogoDeXpEConquistas(db, tenant.id);
    await semearTemplatesDeDesafio(db, tenant.id);
    // Por ultimo e sem depender do tenant: o dono do SaaS existe FORA de
    // qualquer academia. So esta na mesma funcao porque o seed e um so.
    await semearSuperAdmin(db);
    await semearContratoParaFaturar(db, tenant.id);

    console.info(`[seed] tenant "${TENANT.slug}" pronto, com dono ${DONO.email}.`);
  } finally {
    // Sem `$disconnect` o pool segura o processo de pe -- o `client.ts`
    // avisa disso explicitamente.
    await db.$disconnect();
  }
}

/**
 * Aceite da analise por IA para TODOS os alunos ativos.
 *
 * A tela de saude mostrava "a analise nao foi gerada: o aluno ainda nao
 * aceitou" para todo mundo, porque `consent_documents` estava vazia -- sem
 * documento publicado, ninguem tem o que aceitar, e nenhuma analise roda.
 * Isso deixava a coluna de analise permanentemente vazia em desenvolvimento.
 *
 * Cria o documento `AI_ANALYSIS` do tenant e uma assinatura `ACCEPTED` por
 * aluno `ACTIVE`. Dado de desenvolvimento, como manda o `CLAUDE.md`: entra
 * por seed, nunca por hardcode no caminho de producao.
 *
 * IDEMPOTENTE como o resto do arquivo: o documento tem chave natural
 * (`tenantId`, `type`, `version`) e a assinatura so e criada para aluno que
 * ainda nao a tem.
 */
async function semearAceiteDaAnalise(
  db: Awaited<ReturnType<typeof criarPrismaClient>>,
  tenantId: string,
): Promise<void> {
  const CONTEUDO =
    'Autorizo o uso dos meus dados de avaliacao fisica para gerar analise ' +
    'de acompanhamento assistida por inteligencia artificial, destinada a ' +
    'conversa com o profissional que me acompanha. A analise nao e ' +
    'diagnostico e nao substitui avaliacao medica.';

  // `createHash` e do mesmo `node:crypto` ja importado no topo.
  const { createHash } = await import('node:crypto');
  const sha = createHash('sha256').update(CONTEUDO, 'utf8').digest('hex');

  const documento = await db.consentDocument.upsert({
    where: { tenantId_type_version: { tenantId, type: 'AI_ANALYSIS', version: 1 } },
    create: {
      tenantId,
      type: 'AI_ANALYSIS',
      version: 1,
      purpose: 'Analise de acompanhamento assistida por IA sobre avaliacoes fisicas',
      content: CONTEUDO,
      contentSha256: sha,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
    update: {},
  });

  const ativos = await db.student.findMany({
    where: { tenantId, status: 'ACTIVE' },
    select: { id: true, birthDate: true },
  });

  const jaTemAceite = new Set(
    (
      await db.consentRecord.findMany({
        where: { tenantId, documentId: documento.id },
        select: { studentId: true },
      })
    ).map((registro) => registro.studentId),
  );

  const agora = new Date();
  const novos = ativos.filter((aluno) => !jaTemAceite.has(aluno.id));

  if (novos.length > 0) {
    await db.consentRecord.createMany({
      data: novos.map((aluno) => ({
        tenantId,
        studentId: aluno.id,
        documentId: documento.id,
        decision: 'ACCEPTED' as const,
        subjectKind: 'STUDENT' as const,
        // `subjectAgeYears` e a idade CONGELADA na data da decisao -- o
        // schema exige o campo, entao calculamos a partir do nascimento em
        // vez de inventar um numero.
        subjectAgeYears: idadeEmAnos(aluno.birthDate, agora),
        occurredAt: agora,
      })),
    });
  }

  console.info(
    `[seed] aceite de analise por IA: ${String(novos.length)} novo(s), ` +
      `${String(ativos.length)} aluno(s) ativo(s) no total.`,
  );
}

/**
 * Documento de consentimento das quatro finalidades de ENGAJAMENTO
 * (ADR-046), um por tenant -- `tenantId` REAL, nunca `null`.
 *
 * F30 tentou criar este documento sob demanda dentro de `registrarDecisao`
 * (`findFirst` + `create`): corrida real, porque `@@unique([tenantId, type,
 * version])` nao protege quando `tenantId` e `null` -- em Postgres, `NULL`
 * nao colide com `NULL` em indice unico comum, entao duas decisoes
 * concorrentes da mesma finalidade criavam duas linhas `version: 1` e o
 * `orderBy: version desc` escolhia uma indeterminadamente. O documento saiu
 * do caminho de escrita: sem linha aqui, `registrarDecisao` recusa com
 * `NotFoundException` (`DOCUMENTO_DE_ENGAJAMENTO_AUSENTE`) em vez de criar
 * silenciosamente.
 *
 * Nao e termo juridico -- e so o registro do que o aluno esta decidindo.
 * `purpose`/`content` curtos e honestos, em pt-BR.
 */
async function semearDocumentosDeEngajamento(
  db: Awaited<ReturnType<typeof criarPrismaClient>>,
  tenantId: string,
): Promise<void> {
  const { createHash } = await import('node:crypto');

  const FINALIDADES = [
    {
      type: 'RANKING' as const,
      purpose: 'Participacao no ranking publico da academia',
      content:
        'Seu nome (ou apelido aprovado) pode aparecer no ranking publico ' +
        'exibido na academia e no totem. Voce pode sair a qualquer momento.',
    },
    {
      type: 'CHALLENGE' as const,
      purpose: 'Participacao em desafios de engajamento',
      content:
        'Seus resultados em desafios da academia podem ser exibidos ' +
        'publicamente para outros alunos. Voce pode sair a qualquer momento.',
    },
    {
      type: 'ENGAGEMENT_PUSH' as const,
      purpose: 'Recebimento de notificacoes de engajamento',
      content:
        'A academia pode enviar notificacoes sobre metas, sequencias e ' +
        'conquistas. Voce pode sair a qualquer momento.',
    },
    {
      type: 'PHYSICAL_EVOLUTION_RANKING' as const,
      purpose: 'Participacao no ranking de evolucao fisica',
      content:
        'Sua evolucao fisica (comparativo de avaliacoes) pode aparecer num ' +
        'ranking publico de progresso. Voce pode sair a qualquer momento.',
    },
  ];

  for (const finalidade of FINALIDADES) {
    const sha = createHash('sha256').update(finalidade.content, 'utf8').digest('hex');

    await db.consentDocument.upsert({
      where: { tenantId_type_version: { tenantId, type: finalidade.type, version: 1 } },
      create: {
        tenantId,
        type: finalidade.type,
        version: 1,
        purpose: finalidade.purpose,
        content: finalidade.content,
        contentSha256: sha,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
      update: {},
    });
  }

  console.info(`[seed] documentos de engajamento: ${String(FINALIDADES.length)} finalidade(s).`);
}

/**
 * Catalogo v1 de XP e conquistas (F31, ADR-047 Decisao 3).
 *
 * Numeros propostos pelo Code; o PI revisa depois, e revisar e CRIAR VERSAO
 * NOVA -- nunca editar esta (`M5-BR-009`). Idempotente pela chave natural
 * (`tenantId`, `code`, `version`), como o resto do arquivo.
 */
async function semearCatalogoDeXpEConquistas(
  db: Awaited<ReturnType<typeof criarPrismaClient>>,
  tenantId: string,
): Promise<void> {
  const VIGENCIA_INICIAL = new Date('2026-01-01T00:00:00.000Z');

  await db.xpRuleVersion.upsert({
    where: { tenantId_code_version: { tenantId, code: 'treino-diario', version: 1 } },
    update: {},
    create: {
      tenantId,
      code: 'treino-diario',
      version: 1,
      trigger: 'SESSAO_CONFIRMADA',
      points: 10,
      status: 'APPROVED',
      effectiveFrom: VIGENCIA_INICIAL,
    },
  });

  const MARCOS = [
    { code: 'primeiro-treino', titulo: 'Primeiro treino', limiar: 1 },
    { code: 'dez-treinos', titulo: '10 treinos', limiar: 10 },
    { code: 'cinquenta-treinos', titulo: '50 treinos', limiar: 50 },
    { code: 'cem-treinos', titulo: '100 treinos', limiar: 100 },
  ];

  for (const marco of MARCOS) {
    await db.achievementDefinitionVersion.upsert({
      where: { tenantId_code_version: { tenantId, code: marco.code, version: 1 } },
      update: {},
      create: {
        tenantId,
        code: marco.code,
        version: 1,
        title: marco.titulo,
        criterionKind: 'SESSOES_ACUMULADAS',
        threshold: marco.limiar,
        effectiveFrom: VIGENCIA_INICIAL,
      },
    });
  }

  console.info(`[seed] catalogo de XP: 1 regra e ${String(MARCOS.length)} conquista(s).`);
}

/**
 * Catalogo v1 de templates de desafio (F34, Slice 5.5, ADR-048).
 *
 * O TEMPLATE E O LIMITE DE SEGURANCA (`M5-BR-011`): a secretaria escolhe
 * template, janela e meta, e o teto de frequencia vem daqui -- ela nao
 * escreve regra. Sem template no banco nao ha desafio a criar, entao este
 * seed nao e conveniencia de demonstracao: e o catalogo minimo do produto.
 *
 * Numeros propostos pelo Code, mesma nota do catalogo de XP: o PI revisa
 * depois, e revisar e CRIAR VERSAO NOVA -- nunca editar esta (`M5-BR-009`),
 * porque desafio em curso aponta para a VERSAO e nao para o codigo.
 *
 * Idempotente pela chave natural (`tenantId`, `code`, `version`).
 */
async function semearTemplatesDeDesafio(
  db: Awaited<ReturnType<typeof criarPrismaClient>>,
  tenantId: string,
): Promise<void> {
  const VIGENCIA_INICIAL = new Date('2026-01-01T00:00:00.000Z');

  /*
   * Os tres tetos sao deliberadamente diferentes, e a diferenca e o ponto:
   * um teto unico para todos os templates tornaria o campo decorativo.
   *
   * `maxSessoesPorSemana` 3/4/5 cobre iniciante, intermediario e avancado --
   * 6 ou 7 seria treino sem dia de descanso, que e exatamente o que o
   * `M5-BR-011` existe para impedir.
   */
  const TEMPLATES = [
    {
      code: 'constancia-iniciante',
      name: 'Constancia iniciante',
      maxSessionsPerWeek: 3,
      maxWindowDays: 30,
    },
    {
      code: 'assiduidade-semanal',
      name: 'Assiduidade semanal',
      maxSessionsPerWeek: 4,
      maxWindowDays: 60,
    },
    {
      code: 'ritmo-avancado',
      name: 'Ritmo avancado',
      maxSessionsPerWeek: 5,
      maxWindowDays: 90,
    },
  ];

  for (const template of TEMPLATES) {
    await db.challengeTemplateVersion.upsert({
      where: { tenantId_code_version: { tenantId, code: template.code, version: 1 } },
      update: {},
      create: {
        tenantId,
        code: template.code,
        version: 1,
        name: template.name,
        metric: 'SESSOES_NA_JANELA',
        maxSessionsPerWeek: template.maxSessionsPerWeek,
        maxWindowDays: template.maxWindowDays,
        effectiveFrom: VIGENCIA_INICIAL,
      },
    });
  }

  console.info(`[seed] templates de desafio: ${String(TEMPLATES.length)}.`);
}

/**
 * Totem `TOTEM01` da unidade, com a configuracao de UNIDADE (versao 1) ja
 * publicada -- o padrao que a F49 le enquanto a F50 nao existe para
 * escrever (ADR-042, Decisao 0).
 *
 * `kioskConfiguration.upsert` com `kioskDeviceId: null` na chave composta
 * NAO compila: o tipo gerado pelo Prisma para uma chave unica composta
 * exige `string` em cada campo, mesmo quando a coluna e nullable no schema
 * -- atrito conhecido do Prisma com `null` em `@@unique`. A saida e
 * `findFirst` (que aceita `null` num filtro comum) seguido de `create`
 * condicional; perde a atomicidade do upsert, mas o seed roda sempre
 * sozinho e sequencial, entao a corrida entre leitura e escrita nao existe
 * aqui.
 */
async function semearTotem(
  db: Awaited<ReturnType<typeof criarPrismaClient>>,
  tenantId: string,
  gymUnitId: string,
): Promise<void> {
  await db.kioskDevice.upsert({
    where: { tenantId_code: { tenantId, code: 'TOTEM01' } },
    update: {},
    create: { tenantId, gymUnitId, code: 'TOTEM01' },
  });

  const configuracaoExistente = await db.kioskConfiguration.findFirst({
    where: { tenantId, gymUnitId, kioskDeviceId: null, version: 1 },
  });

  if (!configuracaoExistente) {
    await db.kioskConfiguration.create({
      data: {
        tenantId,
        gymUnitId,
        version: 1,
        publishedAt: new Date(),
        payload: {
          ...CONFIG_PADRAO_DO_TOTEM,
          blocos: {
            ...CONFIG_PADRAO_DO_TOTEM.blocos,
            itens: [
              /*
               * Reel REAL da Clinica da Musculacao, para o totem local abrir
               * com conteudo de verdade (ADR-042, Decisao 7).
               *
               * `midiaKey: null` de proposito: o seed NAO baixa o video --
               * download e ato do painel, com o gerente olhando (trava 1 do
               * ADR), e um seed que fosse a rede falharia em maquina offline
               * e em CI. O bloco nasce com o LINK preenchido e o gerente
               * clica em "Copiar video do Instagram" para trazer a midia.
               */
              {
                id: 'video-instagram',
                tipo: 'VIDEO',
                habilitado: true,
                titulo: 'Acompanhe a Clínica no Instagram',
                legenda: 'Reel da semana — reproduz sem som, com legenda.',
                midiaKey: null,
                linkExterno: 'https://www.instagram.com/reel/DbtoWkFR6l6/',
              },
              {
                id: 'perfil-instagram',
                tipo: 'INSTAGRAM',
                habilitado: true,
                perfil: '@clinicadamusculacao',
                chamada: 'Siga e acompanhe os treinos da unidade.',
              },
              /*
               * DESAFIO EM CARTAZ -- F34 (ADR-048, emenda 2).
               *
               * O bloco so diz QUE a academia quer mostrar desafio na parede;
               * o conteudo (titulo, meta, prazo) vem do heartbeat e muda
               * sozinho conforme a campanha. Mesmo desenho do bloco de
               * INFORMACOES: congelar o titulo aqui obrigaria a republicar a
               * config a cada desafio novo.
               *
               * `habilitado: true` e seguro: sem desafio aberto o bloco SAI
               * do carrossel (`blocosVisiveis`), entao ele nao ocupa espaco
               * na tela de quem ainda nao criou campanha nenhuma.
               */
              {
                id: 'desafio-em-cartaz',
                tipo: 'DESAFIO',
                habilitado: true,
                titulo: 'Desafio do mês',
              },
            ],
          },
        },
      },
    });
  }

  console.info('[seed] totem "TOTEM01" com configuracao de unidade v1 publicada.');
}

/**
 * Hash do CPF, com pimenta por tenant.
 *
 * DUPLICADO de `apps/api/src/modules/students/domain/identificacao.ts`, pelo
 * mesmo motivo que `gerarHash` acima duplica o `PasswordService`: este pacote
 * NAO depende da API, e inverter a dependencia para reaproveitar uma linha
 * custaria mais do que resolve. Se um terceiro lugar precisar, extrai para
 * `packages/testing`.
 *
 * A formula tem de bater EXATAMENTE com a da API -- e ela que a busca do
 * totem usa. Divergir aqui nao daria erro: daria "aluno nao encontrado", que
 * a tela mostra como a mensagem neutra, indistinguivel de CPF errado.
 */
function hashDeCpf(tenantId: string, cpf: string): string {
  return createHash('sha256').update(`${tenantId}:${cpf.replace(/\D/g, '')}`).digest('hex');
}

/**
 * Cifra o segredo do totem no MESMO envelope que a API decifra:
 * AES-256-GCM em `{ivBase64}:{tagBase64}:{ciphertextBase64}`.
 *
 * Duas origens, e vale distinguir para quem for conferir: a PRIMITIVA
 * AES-256-GCM e o `CifradorDeSegredo`
 * (`apps/api/src/modules/auth/segredo-cifrado.ts`); o ENVELOPE de tres
 * campos separados por `:` e montado e lido em
 * `apps/api/src/modules/kiosk-auth/kiosk-auth.service.ts`
 * (`cifrarSegredo` / `decifrarSegredo`). E o segundo que define o formato
 * gravado na coluna, e portanto o que esta funcao precisa reproduzir.
 *
 * DUPLICADO, e nao importado: `packages/database` nao depende de `apps/api`
 * e nao pode passar a depender -- a seta aponta ao contrario. A alternativa seria mover
 * o cifrador para um pacote compartilhado, o que arrastaria a API inteira
 * atras de 15 linhas de `node:crypto` que nao mudam ha meses.
 *
 * IV novo a cada cifragem (nunca reutilizar em GCM) e tag junto, porque
 * decifrar exige os tres.
 */
function cifrarSegredo(chave: Buffer, segredo: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  const ciphertext = Buffer.concat([cifra.update(segredo, 'utf8'), cifra.final()]);

  return [
    iv.toString('base64'),
    cifra.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Aluno e credencial que fazem a jornada do totem existir na bancada.
 *
 * A CREDENCIAL DEPENDE DE `MFA_ENCRYPTION_KEY`. Ela e a chave de segredo
 * simetrico da aplicacao, e em desenvolvimento e EFEMERA por padrao -- a API
 * gera uma nova a cada arranque. Ciphertext gravado sob uma chave que morreu
 * no reinicio anterior nao decifra, e o sintoma seria 401 em toda chamada do
 * totem, sem nada apontando para a causa.
 *
 * Por isso a credencial e PULADA quando a chave nao esta fixada, com um aviso
 * que diz o que fazer -- em vez de gravar uma linha que nunca vai funcionar.
 * O aluno e criado de qualquer forma: ele nao depende de chave nenhuma.
 */
async function semearAlunoECredencialDoTotem(
  db: Awaited<ReturnType<typeof criarPrismaClient>>,
  tenantId: string,
  gymUnitId: string,
): Promise<void> {
  await db.student.upsert({
    where: {
      tenantId_membershipNumber: {
        tenantId,
        membershipNumber: ALUNO_DO_TOTEM.membershipNumber,
      },
    },
    create: {
      tenantId,
      gymUnitId,
      membershipNumber: ALUNO_DO_TOTEM.membershipNumber,
      fullName: ALUNO_DO_TOTEM.fullName,
      birthDate: new Date(ALUNO_DO_TOTEM.birthDate),
      cpf: ALUNO_DO_TOTEM.cpf,
      cpfHash: hashDeCpf(tenantId, ALUNO_DO_TOTEM.cpf),
      status: 'ACTIVE',
    },
    // O `cpfHash` entra tambem no update: a pimenta e o `tenantId`, entao um
    // banco recriado com tenant novo precisa do hash recalculado -- sem isso
    // o aluno existiria com hash de um tenant que nao existe mais.
    update: {
      cpfHash: hashDeCpf(tenantId, ALUNO_DO_TOTEM.cpf),
      status: 'ACTIVE',
    },
  });

  // A MATRICULA no log, nunca o CPF. O numero aqui e falso, mas log que
  // imprime CPF vira padrao copiado para onde o dado e real (CLAUDE.md:
  // "nunca logar PII"). Quem precisa do CPF le a constante logo acima.
  console.info(
    `[seed] aluno do totem "${ALUNO_DO_TOTEM.membershipNumber}" (dado falso, de bancada).`,
  );

  const chaveBase64 = process.env['MFA_ENCRYPTION_KEY'];

  if (!chaveBase64) {
    console.warn(
      '[seed] credencial do totem PULADA: MFA_ENCRYPTION_KEY nao esta fixada.\n' +
        '       Sem ela a API gera chave nova a cada arranque e nao decifraria\n' +
        '       o segredo gravado agora. Descomente a linha no seu `.env`\n' +
        '       (veja `.env.example`) e rode o seed de novo.',
    );
    return;
  }

  const chave = Buffer.from(chaveBase64, 'base64');

  if (chave.length !== 32) {
    throw new Error(
      `MFA_ENCRYPTION_KEY precisa de 32 bytes em base64; recebeu ${String(chave.length)}.`,
    );
  }

  const dispositivo = await db.kioskDevice.findUniqueOrThrow({
    where: { tenantId_code: { tenantId, code: 'TOTEM01' } },
    select: { id: true },
  });

  // `activeFrom` no passado: a credencial precisa valer AGORA, e um valor
  // exatamente igual a `new Date()` perde para o `>` da verificacao quando o
  // relogio do banco esta alguns ms atras do da aplicacao.
  const credencial = {
    tenantId,
    kioskDeviceId: dispositivo.id,
    encryptedSecret: cifrarSegredo(chave, CREDENCIAL_DO_TOTEM.segredo),
    activeFrom: new Date(Date.now() - 60_000),
    expiresAt: null,
    revokedAt: null,
  };

  // Re-cifra no update: a chave pode ter mudado desde a ultima execucao, e
  // manter o ciphertext antigo daria 401 num seed que diz ter rodado bem.
  await db.kioskCredential.upsert({
    where: { keyId: CREDENCIAL_DO_TOTEM.keyId },
    create: { ...credencial, keyId: CREDENCIAL_DO_TOTEM.keyId },
    update: credencial,
  });

  console.info(
    `[seed] credencial de totem "${CREDENCIAL_DO_TOTEM.keyId}" -- ` +
      'DESENVOLVIMENTO, segredo publicado no repositorio.',
  );
}

/**
 * Base32 sem padding, o mesmo alfabeto que `TotpService.paraBase32` usa.
 *
 * Existe aqui, e nao importado, porque `packages/database` NAO depende de
 * `apps/api` -- a seta aponta ao contrario, e a mesma razao que ja obrigou o
 * `cifrarSegredo` do totem a morar neste arquivo.
 */
function paraBase32(bytes: Buffer): string {
  const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let valor = 0;
  let saida = '';

  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];

  return saida;
}

/**
 * O dono do SaaS e a sessao de plataforma que o E2E da F61 consome.
 *
 * TRES COISAS, e cada uma existe por um motivo diferente:
 *
 * 1. O USUARIO e a linha em `platform_admins` -- sem ela ninguem abre
 *    `/platform`, porque `@PlatformRoute()` recusa quem nao e dono do SaaS.
 * 2. O SEGREDO TOTP cifrado, com `mfaStatus: ENABLED` -- para o login a mao
 *    pedir codigo em vez de oferecer inscricao. Depende de
 *    `MFA_ENCRYPTION_KEY` fixada pelo mesmo motivo da credencial do totem: a
 *    API gera chave nova a cada arranque quando ela falta, e o ciphertext
 *    gravado agora nao decifraria depois.
 * 3. A SESSAO DE PLATAFORMA (`tenantId: null`), com o hash do refresh de
 *    bancada. E o unico caminho que o E2E tem para entrar -- ver o comentario
 *    de `SESSAO_DE_PLATAFORMA`.
 *
 * REPOE a sessao em vez de so criar: o refresh e de uso unico e rotaciona ao
 * ser usado, entao a execucao anterior da suite deixou a linha `ROTATED`.
 * Semear por cima devolve o estado inicial, que e o que um seed idempotente
 * deve fazer.
 */
async function semearSuperAdmin(
  db: Awaited<ReturnType<typeof criarPrismaClient>>,
): Promise<void> {
  const usuario = await db.user.upsert({
    where: { email: SUPER_ADMIN.email },
    create: { email: SUPER_ADMIN.email, passwordHash: await gerarHash(SUPER_ADMIN.senha) },
    update: { status: 'ACTIVE' },
  });

  await db.platformAdmin.upsert({
    where: { userId: usuario.id },
    create: { userId: usuario.id },
    // `revokedAt: null` no update: um banco onde a revogacao foi exercitada
    // voltaria do seed com o dono do SaaS ainda de fora.
    update: { revokedAt: null },
  });

  const chaveBase64 = process.env['MFA_ENCRYPTION_KEY'];

  if (chaveBase64) {
    const chave = Buffer.from(chaveBase64, 'base64');

    if (chave.length !== 32) {
      throw new Error(
        `MFA_ENCRYPTION_KEY precisa de 32 bytes em base64; recebeu ${String(chave.length)}.`,
      );
    }

    const segredo = Buffer.from(SUPER_ADMIN.segredoTotp, 'utf8');
    const iv = randomBytes(12);
    const cifra = createCipheriv('aes-256-gcm', chave, iv);
    const ciphertext = Buffer.concat([cifra.update(segredo), cifra.final()]);

    await db.user.update({
      where: { id: usuario.id },
      data: {
        mfaStatus: 'ENABLED',
        // `Uint8Array` explicito: o tipo do Prisma 7 nao aceita `Buffer`
        // direto, apesar de `Buffer` ser subclasse dele.
        mfaSecretCiphertext: new Uint8Array(ciphertext),
        mfaSecretIv: new Uint8Array(iv),
        mfaSecretTag: new Uint8Array(cifra.getAuthTag()),
        // Zera o contador de replay: o codigo do passo atual precisa ser
        // aceito num banco recriado, e um contador herdado o recusaria.
        mfaLastCounter: null,
      },
    });

    console.info(
      `[seed] super admin ${SUPER_ADMIN.email} -- TOTP base32 ${paraBase32(segredo)} ` +
        '(DESENVOLVIMENTO, segredo publicado no repositorio).',
    );
  } else {
    console.warn(
      '[seed] segredo TOTP do super admin PULADO: MFA_ENCRYPTION_KEY nao esta\n' +
        '       fixada. O E2E nao depende dele (entra pela sessao semeada abaixo),\n' +
        '       mas o login a mao nao funciona sem a chave.',
    );
  }

  /*
   * Uma linha por jornada. `familyId` PROPRIO em cada uma: familia
   * compartilhada faria a rotacao de uma revogar a outra, que e exatamente o
   * problema que duas sessoes existem para evitar.
   */
  for (const semente of [
    SESSAO_DE_PLATAFORMA,
    SESSAO_DE_PLATAFORMA_DA_MARCA,
    SESSAO_DE_PLATAFORMA_DO_CONTRATO,
    SESSAO_DE_PLATAFORMA_DA_FATURA,
  ]) {
    const tokenHash = createHash('sha256').update(semente.refresh).digest('hex');

    const sessao = {
      userId: usuario.id,
      // NULO: sessao de PLATAFORMA nao tem tenant. E isto que faz o `AuthGuard`
      // montar `PlatformContext` em vez de contexto de tenant.
      tenantId: null,
      status: 'ACTIVE' as const,
      rotatedAt: null,
      revokedAt: null,
      revokedReason: null,
      expiresAt: new Date(Date.now() + semente.validoPorDias * 24 * 60 * 60 * 1000),
    };

    await db.session.upsert({
      where: { tokenHash },
      create: { ...sessao, tokenHash, familyId: randomUUID() },
      update: sessao,
    });
  }

  console.info(
    '[seed] quatro sessoes de plataforma repostas para os E2E da F61, da F62, da F63 e da F64.',
  );
}

/**
 * Plano e contrato VIGENTE da Arena Positiva -- para a jornada da fatura (F64).
 *
 * ---------------------------------------------------------------------------
 * POR QUE O CONTRATO NASCE `ACTIVE` AQUI, e nao pelo caso de uso.
 * ---------------------------------------------------------------------------
 *
 * `TenantContractUseCase.ativar` gera o PDF e o GRAVA no bucket, e o runner do
 * CI sobe so Postgres (sem MinIO): passar por ele mataria o seed com
 * `ECONNREFUSED 127.0.0.1:9000`, por falta de servico e nao por defeito. Pela
 * mesma razao a jornada da F63 para no rascunho.
 *
 * A `documentObjectKey` e gravada porque o CHECK
 * `tenant_contracts_ativo_tem_documento` a exige -- e o OBJETO nao existe, o
 * que e inofensivo aqui: a tela de faturas nunca le o PDF do contrato. Quem
 * precisa dele e a rota `/contracts/:id/document`, que esta jornada nao toca.
 *
 * IDEMPOTENTE como o resto do arquivo: o indice parcial
 * `tenant_contracts_um_ativo_por_tenant` recusa um segundo contrato vigente, e
 * reexecutar o seed tem de reencontrar o que ja existe em vez de estourar.
 */
async function semearContratoParaFaturar(
  db: Awaited<ReturnType<typeof criarPrismaClient>>,
  tenantId: string,
): Promise<void> {
  const jaVigente = await db.tenantContract.findFirst({
    where: { tenantId, status: 'ACTIVE' },
    select: { id: true },
  });

  if (jaVigente) return;

  const plano = await db.saasPlan.upsert({
    where: { id: PLANO_SAAS_DE_BANCADA },
    create: {
      id: PLANO_SAAS_DE_BANCADA,
      name: 'Plataforma por aluno',
      model: 'PER_STUDENT',
      // R$ 5,00 e R$ 2,50 -- os padroes do ADR-052 §5, em CENTAVOS.
      activeStudentPriceMinor: 500,
      inactiveStudentPriceMinor: 250,
    },
    update: {},
  });

  const id = CONTRATO_SAAS_DE_BANCADA;

  await db.tenantContract.create({
    data: {
      id,
      tenantId,
      planId: plano.id,
      // COPIA dos valores, como faz o caso de uso (ADR-052 §8).
      model: plano.model,
      activeStudentPriceMinor: plano.activeStudentPriceMinor,
      inactiveStudentPriceMinor: plano.inactiveStudentPriceMinor,
      indexCode: 'IPCA',
      baseDate: new Date('2026-01-01T00:00:00.000Z'),
      anniversaryDay: 1,
      anniversaryMonth: 1,
      issueDay: 1,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      status: 'ACTIVE',
      // Ver o comentario da funcao: a chave existe, o objeto nao.
      documentObjectKey: `tenants/${tenantId}/contracts/${id}.pdf`,
    },
  });

  console.info('[seed] contrato SaaS vigente reposto para o E2E da fatura (F64).');
}

/** Idade em anos completos numa data de referencia. */
function idadeEmAnos(nascimento: Date, referencia: Date): number {
  let idade = referencia.getUTCFullYear() - nascimento.getUTCFullYear();
  const mes = referencia.getUTCMonth() - nascimento.getUTCMonth();

  if (mes < 0 || (mes === 0 && referencia.getUTCDate() < nascimento.getUTCDate())) idade -= 1;

  return idade;
}

try {
  await semear();
} catch (erro: unknown) {
  console.error('[seed] falhou:', erro);
  process.exitCode = 1;
}
