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
import {
  createCipheriv,
  createHash,
  randomBytes,
  scrypt,
  type ScryptOptions,
} from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CONFIG_PADRAO_DO_TOTEM } from '@arenahub/api-contracts';
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
  // Emitir recibo CONSOME numeracao sequencial imutavel -- e escrita, e nao
  // pode ser autorizada pela permissao de leitura.
  'receipt.issue',
  // F17: avaliacao fisica manual e contexto de saude.
  //
  // Separadas de `student.*` pelo mesmo motivo de `biometric.*`: composicao
  // corporal e dado de saude (art. 11), e quem atende a recepcao nao precisa
  // ver o percentual de gordura de ninguem para matricular.
  //
  // `health.assess` e do AVALIADOR, nao da recepcao (ADR-037): quem registra
  // fator de contexto e quem mede, porque o fator so faz sentido junto da
  // medicao que ele explica.
  'health.read',
  'health.assess',
  // ANEXAR sem ver nem editar dado de saude (ADR-039). E o que a recepcao
  // recebe: ela anexa o laudo do aluno, o sistema extrai e publica sozinho,
  // e ela nunca ve o percentual de gordura de ninguem. Mantem a separacao do
  // ADR-037 de pe com o fluxo automatico.
  'health.upload',
  // F54: painel financeiro gerencial.
  //
  // Separada de `billing.read` pelo mesmo motivo de `biometric.*`: o que a
  // RECEPCAO precisa e achar a fatura de UM aluno no balcao. O painel
  // consolida o tenant inteiro -- faturamento, ticket medio e taxa de
  // inadimplencia --, e quem atende na porta nao precisa disso para
  // trabalhar. Decisao do PI em 25/08/2026 (`SPEC-054` §8, pergunta 3).
  'billing.dashboard',
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

    const unidade = await db.gymUnit.upsert({
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
      await db.planUnit.create({ data: { planId: plano.id, gymUnitId: unidade.id } });

      // Segunda a sexta, 06:00-22:00 (360 a 1320) -- o mesmo horario que a
      // bancada ja usa nos planos criados pela tela.
      await db.planAccessWindow.deleteMany({ where: { planId: plano.id } });
      await db.planAccessWindow.createMany({
        data: [1, 2, 3, 4, 5].map((dia) => ({
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
        payload: CONFIG_PADRAO_DO_TOTEM,
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
