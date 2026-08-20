/**
 * Nucleo da importacao da base CORRENTE do Pacto -- F48.
 *
 * Separado do script CLI (`prisma/seed-ativos.ts`) pelo mesmo motivo da F47:
 * assim a gravacao e testavel com um client injetado, sem depender de
 * `process.env` nem de arquivo em disco. O script le o arquivo, resolve
 * tenant/plano/unidade e imprime relatorio; a decisao do que gravar mora
 * aqui.
 *
 * A F47 trouxe os 1.926 historicos como `CANCELLED`, sem direito de acesso.
 * Esta fatia traz quem treina HOJE: atualiza o cadastro, grava a credencial
 * do leitor, vincula o plano e -- so entao -- concede o `Entitlement`.
 *
 * REGRAS QUE ESTE ARQUIVO NAO PODE VIOLAR:
 *
 *   - Idempotencia (regra de arquitetura no 4): toda escrita e upsert ou
 *     leitura-antes-de-criar por chave natural. Rodar duas vezes produz o
 *     mesmo banco.
 *   - So `Entitlement` decide acesso (regra no 1). Ativar cadastro NAO e dar
 *     acesso: aluno sem periodo de plano fica ACTIVE e SEM direito.
 *   - `tenantId` em toda entidade de negocio (regra no 2).
 *   - NENHUMA `Invoice`. Vincular plano nao e cobrar -- essas pessoas ja
 *     pagaram no sistema antigo.
 *   - NENHUMA `BiometricIdentity` nem `ConsentRecord` (regra no 7). O numero
 *     do leitor entra como `StudentCredential`, que e identificador de
 *     equipamento; biometria exige consentimento e nao e escopo desta fatia.
 *   - NUNCA cria aluno. Quem nao casa vira pendencia humana.
 *   - Campo vazio no arquivo NAO apaga dado existente no banco.
 */
import type { PrismaClientArenaHub } from '../client.js';
import {
  decidirCasamento,
  nascimentoEhPlausivel,
  normalizarNome,
  origemDoDireito,
  parsearDataDoPacto,
  traduzirPerfil,
  type CandidatoDeAluno,
  type PerfilImportado,
} from './dominio.js';

/**
 * Meses de validade do direito por VINCULO (ADMIN, STAFF, TRAINER).
 *
 * O arquivo do Pacto nao traz periodo para quem nao e aluno. Doze meses
 * forca revalidacao anual: quem sai da academia perde o acesso sozinho, sem
 * depender de alguem lembrar de revogar.
 */
export const MESES_DE_VINCULO = 12;

/**
 * UF fixa. O relatorio do Pacto nao traz UF confiavel -- vem `g`, `Go`,
 * vazio. A academia e de Goias (mesma decisao da F47/ADR-033).
 */
const UF_PADRAO = 'GO';

/** Municipio assumido quando o arquivo nao traz -- a unidade fica em Trindade. */
const MUNICIPIO_PADRAO = 'Trindade';

/**
 * Espelho de `normalizarTelefone` de
 * `apps/api/src/modules/students/domain/identificacao.ts`. Copia deliberada
 * por FRONTEIRA DE PACOTE: `packages/database` tem `rootDir: "."` no
 * `tsconfig.json` e nao alcanca `apps/api` no typecheck. Mesma nota que
 * `dominio.ts` ja carrega para `normalizarCpf`.
 */
function normalizarTelefone(valor: string): string {
  return valor.replace(/\D/g, '');
}

/** Ver nota acima: mesma origem, mesmo motivo de copia. */
function normalizarCpf(valor: string): string {
  return valor.replace(/\D/g, '');
}

/**
 * Uma linha do relatorio de pessoas ativas do Pacto, ja com nome de campo em
 * ingles.
 *
 * Todos os campos sao `string` porque e assim que o extrator entrega -- data
 * como texto, codigo de perfil como texto. Converter no tipo esconderia o
 * formato do Pacto; quem converte e valida e `dominio.ts`.
 */
export interface RegistroDePessoaAtiva {
  readonly nome: string;
  readonly cartao: string;
  readonly identificadorFacial: string;
  readonly codigoPerfil: string;
  readonly dataNascimento: string;
  readonly endereco: string;
  readonly bairro: string;
  readonly cep: string;
  readonly municipio: string;
  readonly telefone: string;
  readonly celular: string;
  readonly cpf: string;
  readonly dataInicio: string;
  readonly dataFim: string;
  readonly email: string;
}

/** Motivo pelo qual uma linha nao virou (ou virou so em parte) cadastro ativo. */
export type MotivoDePendencia =
  | 'perfil desconhecido'
  | 'mais de um candidato no cadastro'
  | 'nao encontrado no cadastro'
  | 'nascimento implausivel'
  | 'aluno sem periodo de plano'
  | 'credencial ja pertence a outro aluno';

export interface Pendencia {
  readonly nome: string;
  readonly motivo: MotivoDePendencia;
}

/** Quantos dos casados tinham cada campo. Ver a nota em `ResultadoDaAtivacao`. */
export interface PreenchimentoPorCampo {
  nascimento: number;
  cartao: number;
  facial: number;
  telefone: number;
  email: number;
  endereco: number;
}

/**
 * O que a execucao fez, em numero.
 *
 * O `preenchimento` NAO e enfeite: foi um `logradouro 0/1934` que denunciou
 * um extrator quebrado na F47. Importacao que so diz "sucesso" e como dado
 * vira lixo sem ninguem perceber.
 */
export interface ResultadoDaAtivacao {
  /** Linhas lidas do arquivo, antes de qualquer filtro. */
  lidos: number;
  /** Linhas descartadas por serem registro de teste do Pacto. */
  descartados: number;
  /** Linhas que casaram com um aluno ja cadastrado. */
  casados: number;
  /** Casados por CPF valido e unico -- o casamento forte. */
  casadosPorCpf: number;
  /** Casados por nome normalizado unico -- o casamento fraco. */
  casadosPorNome: number;
  /** Casados que terminaram com direito por plano / por vinculo. */
  direitosPorPlano: number;
  direitosPorVinculo: number;
  preenchimento: PreenchimentoPorCampo;
  pendencias: Pendencia[];
}

export interface AlvoDaAtivacao {
  readonly tenantId: string;
  readonly planId: string;
  readonly planName: string;
  /** Unidades do tenant. Vira `gymUnitIds` do snapshot congelado. */
  readonly gymUnitIds: readonly string[];
}

/**
 * Registro de teste do Pacto: nome vazio, nome que e so numero, ou marcador
 * de POC. Ativar essas linhas daria acesso a alguem que nao existe.
 */
export function ehRegistroDeTeste(nome: string): boolean {
  const limpo = nome.trim();

  return limpo === '' || /^\d+$/.test(limpo) || limpo.toLowerCase().startsWith('teste');
}

type JanelaDoSnapshot = {
  gymUnitId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

/**
 * Copia congelada da politica, gravada em `Entitlement.policySnapshot`.
 *
 * `type` e nao `interface`, e sem `readonly` nos arrays, para satisfazer o
 * `InputJsonObject` do Prisma -- ele exige assinatura de indice implicita
 * (que `interface` nao gera) e recusa array somente-leitura. Nao e
 * preferencia de estilo: `interface` aqui nao compila na coluna `Json`.
 */
type SnapshotDePolitica = {
  planId: string | null;
  planName: string;
  snapshotVersion: 1;
  gymUnitIds: string[];
  janelas: JanelaDoSnapshot[];
};

/**
 * Mesma forma que `montarSnapshotDeVinculo` produz em
 * `apps/api/src/modules/membership/domain/entitlement.ts`. Replicada, e nao
 * importada, pela FRONTEIRA DE PACOTE explicada no topo do arquivo: o pacote
 * de banco nao alcanca `apps/api` no typecheck, e inverter essa dependencia
 * por um objeto de cinco campos custaria mais do que resolve. `seed-demo.ts`
 * ja carrega a mesma nota para o snapshot de plano.
 *
 * Janela livre -- sete dias, do minuto zero ao 1440. Funcionario que abre a
 * academia as 5h e professor que fecha as 23h nao cabem numa grade
 * comercial, e inventar uma criaria a negacao que a recepcao teria de
 * contornar na mao todo dia.
 */
function montarSnapshotDeVinculo(
  perfil: PerfilImportado,
  gymUnitIds: readonly string[],
): SnapshotDePolitica {
  const unidades = [...gymUnitIds].sort();

  const janelas: JanelaDoSnapshot[] = unidades.flatMap((gymUnitId) =>
    [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
      gymUnitId,
      dayOfWeek,
      startMinute: 0,
      endMinute: 1440,
    })),
  );

  return {
    planId: null,
    planName: `Vinculo ${perfil}`,
    snapshotVersion: 1,
    gymUnitIds: unidades,
    janelas,
  };
}

/**
 * Snapshot do direito que vem de PLANO. Mesma forma que
 * `montarSnapshotDePolitica` -- ver a nota de replicacao acima.
 *
 * Sem janela de horario: o plano importado do Pacto nao traz grade, e
 * inventar uma negaria acesso que a pessoa ja tem hoje. `janelas: []` e como
 * o motor le "sem restricao de horario" (e o que `seed-demo.ts` ja grava).
 */
function montarSnapshotDePlano(
  planId: string,
  planName: string,
  gymUnitIds: readonly string[],
): SnapshotDePolitica {
  return {
    planId,
    planName,
    snapshotVersion: 1,
    gymUnitIds: [...gymUnitIds].sort(),
    janelas: [],
  };
}

/** So os delegates que a gravacao usa -- o teste injeta o client inteiro. */
type Escritor = Pick<
  PrismaClientArenaHub,
  | 'student'
  | 'studentCredential'
  | 'studentContact'
  | 'studentAddress'
  | 'subscription'
  | 'entitlement'
  | 'entitlementUnitWindow'
>;

/**
 * Grava a credencial do leitor.
 *
 * A chave natural e `(tenantId, kind, externalId)` -- o indice unico do
 * schema, que existe porque dois alunos dividindo o mesmo numero seria a
 * catraca abrindo para a pessoa errada.
 *
 * `null` = o arquivo nao trouxe numero. `false` = o numero ja pertence a
 * OUTRO aluno, e a linha vira pendencia em vez de roubar a credencial:
 * reatribuir calado trocaria o dono de um cartao sem ninguem ver.
 */
async function gravarCredencial(
  db: Escritor,
  tenantId: string,
  studentId: string,
  kind: 'TURNSTILE_CARD' | 'FACIAL_ENROLL_ID',
  valor: string,
): Promise<boolean | null> {
  const externalId = valor.trim();

  if (externalId === '') return null;

  const existente = await db.studentCredential.findUnique({
    where: { tenantId_kind_externalId: { tenantId, kind, externalId } },
    select: { studentId: true },
  });

  if (existente) return existente.studentId === studentId;

  await db.studentCredential.create({ data: { tenantId, studentId, kind, externalId } });

  return true;
}

/**
 * Grava contato, sem duplicar e sem apagar.
 *
 * Idempotencia por leitura previa em `(studentId, type, value)`: o schema
 * nao tem indice unico ai de proposito (o aluno pode ter dois telefones),
 * entao a chave natural e o proprio trio, conferido antes de criar.
 */
async function gravarContato(
  db: Escritor,
  tenantId: string,
  studentId: string,
  type: 'PHONE' | 'WHATSAPP' | 'EMAIL',
  valor: string,
): Promise<boolean> {
  const cru = valor.trim();

  if (cru === '') return false;
  // E-mail sem arroba nao e e-mail. O Pacto guarda lixo nesse campo ("nao
  // tem", "-"), e gravar isso encheria a base de contato que nunca recebe
  // nada -- e depois some no meio dos contatos bons.
  if (type === 'EMAIL' && !cru.includes('@')) return false;

  const value = type === 'EMAIL' ? cru.toLowerCase() : normalizarTelefone(cru);

  if (value === '') return false;

  const existente = await db.studentContact.findFirst({
    where: { studentId, type, value },
    select: { id: true },
  });

  if (!existente) {
    await db.studentContact.create({
      data: { tenantId, studentId, type, value, isPrimary: false },
    });
  }

  return true;
}

/**
 * Cria o direito com as janelas do snapshot.
 *
 * As janelas vao para `EntitlementUnitWindow` ALEM do snapshot: o motor de
 * decisao le a tabela, e o snapshot e a copia congelada para auditoria. Sem
 * as linhas, o direito existe no banco e a catraca continua fechada.
 */
async function criarDireito(
  db: Escritor,
  dados: {
    tenantId: string;
    studentId: string;
    source: 'SUBSCRIPTION' | 'EMPLOYEE' | 'PERSONAL_TRAINER';
    subscriptionId: string | null;
    startsAt: Date;
    endsAt: Date;
    reason: string;
    snapshot: SnapshotDePolitica;
  },
): Promise<void> {
  const direito = await db.entitlement.create({
    data: {
      tenantId: dados.tenantId,
      studentId: dados.studentId,
      source: dados.source,
      subscriptionId: dados.subscriptionId,
      status: 'ACTIVE',
      startsAt: dados.startsAt,
      endsAt: dados.endsAt,
      reason: dados.reason,
      // O tipo do snapshot e nosso e ate mais estrito que `InputJsonValue`,
      // que exige assinatura de indice; a conversao so declara isso ao
      // compilador. `{ ... }` literal (como em `seed-demo.ts`) passaria
      // direto, ao custo de perder o tipo nomeado.
      policySnapshot: { ...dados.snapshot },
    },
    select: { id: true },
  });

  if (dados.snapshot.janelas.length > 0) {
    await db.entitlementUnitWindow.createMany({
      data: dados.snapshot.janelas.map((janela) => ({ entitlementId: direito.id, ...janela })),
    });
  }
}

/**
 * Ativa as pessoas que treinam hoje.
 *
 * `agora` entra por parametro (`CLAUDE.md`): o fim do direito por vinculo
 * sai dele, e ler o relogio aqui dentro tornaria o teste de fronteira
 * impossivel de escrever sem congelar o tempo global.
 *
 * NAO abre transacao por registro, de proposito. Cada gravacao ja e
 * idempotente por conta propria, entao uma interrupcao no meio deixa o banco
 * num estado que a proxima execucao completa -- transacao por linha daria
 * atomicidade que nao muda o resultado de nenhuma re-execucao, ao custo de
 * segurar uma conexao por pessoa.
 */
export async function importarPessoasAtivas(
  db: PrismaClientArenaHub,
  alvo: AlvoDaAtivacao,
  registros: readonly RegistroDePessoaAtiva[],
  agora: Date,
): Promise<ResultadoDaAtivacao> {
  const pendencias: Pendencia[] = [];
  const preenchimento: PreenchimentoPorCampo = {
    nascimento: 0,
    cartao: 0,
    facial: 0,
    telefone: 0,
    email: 0,
    endereco: 0,
  };

  let descartados = 0;
  let casados = 0;
  let casadosPorCpf = 0;
  let casadosPorNome = 0;
  let direitosPorPlano = 0;
  let direitosPorVinculo = 0;

  // A lista de candidatos e lida UMA vez e nao muda durante o laco: este
  // seed nunca cria aluno, entao nao ha candidato novo para aparecer no
  // meio. Reler por linha custaria uma consulta por pessoa sem mudar nada.
  const alunos = await db.student.findMany({
    where: { tenantId: alvo.tenantId },
    select: { id: true, fullName: true, cpf: true },
  });

  const candidatos: CandidatoDeAluno[] = alunos.map((aluno) => ({
    id: aluno.id,
    nomeNormalizado: normalizarNome(aluno.fullName),
    cpfNormalizado: aluno.cpf === null ? null : normalizarCpf(aluno.cpf),
  }));

  for (const registro of registros) {
    if (ehRegistroDeTeste(registro.nome)) {
      descartados += 1;
      continue;
    }

    const perfil = traduzirPerfil(registro.codigoPerfil);

    if (perfil === null) {
      pendencias.push({ nome: registro.nome, motivo: 'perfil desconhecido' });
      continue;
    }

    const casamento = decidirCasamento({ nome: registro.nome, cpf: registro.cpf }, candidatos);

    if (casamento.tipo === 'AMBIGUO') {
      pendencias.push({ nome: registro.nome, motivo: 'mais de um candidato no cadastro' });
      continue;
    }

    if (casamento.tipo === 'NAO_ENCONTRADO') {
      // NUNCA cria aluno novo. A base ja tem os 1.926 da F47: adivinhar aqui
      // produz o duplicado que a recepcao descobre seis meses depois, com
      // dois historicos pela metade.
      pendencias.push({ nome: registro.nome, motivo: 'nao encontrado no cadastro' });
      continue;
    }

    const { studentId } = casamento;

    casados += 1;
    if (casamento.tipo === 'CPF') casadosPorCpf += 1;
    else casadosPorNome += 1;

    // --- cadastro ---------------------------------------------------------
    const nascimento = parsearDataDoPacto(registro.dataNascimento);
    const nascimentoBom = nascimento !== null && nascimentoEhPlausivel(nascimento, agora);

    if (nascimento !== null && !nascimentoBom) {
      pendencias.push({ nome: registro.nome, motivo: 'nascimento implausivel' });
    }

    if (nascimentoBom) preenchimento.nascimento += 1;

    await db.student.update({
      where: { id: studentId },
      data: {
        profile: perfil,
        status: 'ACTIVE',
        // Ausente ou implausivel NAO apaga o que ja esta no banco.
        ...(nascimentoBom ? { birthDate: nascimento } : {}),
      },
    });

    // --- credenciais do leitor --------------------------------------------
    const cartao = await gravarCredencial(
      db,
      alvo.tenantId,
      studentId,
      'TURNSTILE_CARD',
      registro.cartao,
    );
    const facial = await gravarCredencial(
      db,
      alvo.tenantId,
      studentId,
      'FACIAL_ENROLL_ID',
      registro.identificadorFacial,
    );

    if (cartao === true) preenchimento.cartao += 1;
    if (facial === true) preenchimento.facial += 1;

    if (cartao === false || facial === false) {
      pendencias.push({ nome: registro.nome, motivo: 'credencial ja pertence a outro aluno' });
    }

    // --- contatos ----------------------------------------------------------
    const telefone = await gravarContato(db, alvo.tenantId, studentId, 'PHONE', registro.telefone);
    const celular = await gravarContato(db, alvo.tenantId, studentId, 'WHATSAPP', registro.celular);
    const email = await gravarContato(db, alvo.tenantId, studentId, 'EMAIL', registro.email);

    if (telefone || celular) preenchimento.telefone += 1;
    if (email) preenchimento.email += 1;

    // --- endereco ----------------------------------------------------------
    //
    // So grava com logradouro E CEP. Endereco pela metade nao entrega carta
    // nem localiza ninguem, e ocuparia o lugar do endereco bom que a
    // recepcao digitaria depois.
    const street = registro.endereco.trim();
    const postalCode = registro.cep.trim();

    if (street !== '' && postalCode !== '') {
      const jaTem = await db.studentAddress.findFirst({
        where: { studentId },
        select: { id: true },
      });

      if (!jaTem) {
        const municipio = registro.municipio.trim();

        await db.studentAddress.create({
          data: {
            tenantId: alvo.tenantId,
            studentId,
            street,
            district: registro.bairro.trim() || null,
            city: municipio === '' ? MUNICIPIO_PADRAO : municipio,
            state: UF_PADRAO,
            postalCode,
          },
        });
      }

      preenchimento.endereco += 1;
    }

    // --- direito de acesso --------------------------------------------------
    const source = origemDoDireito(perfil);

    if (perfil === 'STUDENT') {
      const inicio = parsearDataDoPacto(registro.dataInicio);
      const fim = parsearDataDoPacto(registro.dataFim);

      if (inicio === null || fim === null) {
        // ATIVAR CADASTRO NAO E DAR ACESSO (regra de arquitetura no 1). Sem
        // periodo nao ha o que congelar no snapshot, entao nao ha direito --
        // o cadastro fica ACTIVE e a catraca continua fechada ate alguem
        // resolver a pendencia.
        pendencias.push({ nome: registro.nome, motivo: 'aluno sem periodo de plano' });
        continue;
      }

      // Idempotencia por chave natural `(tenantId, studentId, planId,
      // startsAt)`: mesma pessoa, mesmo plano, mesma data de inicio e a mesma
      // assinatura -- nao uma segunda a cada execucao.
      const assinatura = await db.subscription.findFirst({
        where: { tenantId: alvo.tenantId, studentId, planId: alvo.planId, startsAt: inicio },
        select: { id: true },
      });

      const subscriptionId =
        assinatura?.id ??
        (
          await db.subscription.create({
            data: {
              tenantId: alvo.tenantId,
              studentId,
              planId: alvo.planId,
              status: 'ACTIVE',
              startsAt: inicio,
              endsAt: fim,
              // SEM Invoice: vincular plano nao e cobrar. Essas pessoas ja
              // pagaram no sistema antigo.
              lastReason: 'Importacao da base ativa do Pacto (F48)',
            },
            select: { id: true },
          })
        ).id;

      const jaTemDireito = await db.entitlement.findFirst({
        where: { tenantId: alvo.tenantId, studentId, source, startsAt: inicio },
        select: { id: true },
      });

      if (!jaTemDireito) {
        await criarDireito(db, {
          tenantId: alvo.tenantId,
          studentId,
          source,
          subscriptionId,
          startsAt: inicio,
          endsAt: fim,
          reason: 'Importacao da base ativa do Pacto (F48)',
          snapshot: montarSnapshotDePlano(alvo.planId, alvo.planName, alvo.gymUnitIds),
        });
      }

      direitosPorPlano += 1;
      continue;
    }

    // Vinculo (ADMIN, STAFF, TRAINER): periodo nao vem do arquivo.
    // Idempotencia por `(tenantId, studentId, source)` -- uma pessoa tem um
    // direito por vinculo, nao um por execucao do seed.
    const jaTemVinculo = await db.entitlement.findFirst({
      where: { tenantId: alvo.tenantId, studentId, source },
      select: { id: true },
    });

    if (!jaTemVinculo) {
      const fimDoVinculo = new Date(agora);

      fimDoVinculo.setUTCMonth(fimDoVinculo.getUTCMonth() + MESES_DE_VINCULO);

      await criarDireito(db, {
        tenantId: alvo.tenantId,
        studentId,
        source,
        subscriptionId: null,
        startsAt: agora,
        endsAt: fimDoVinculo,
        reason: `Vinculo (perfil ${perfil}) -- importacao da base ativa do Pacto (F48)`,
        snapshot: montarSnapshotDeVinculo(perfil, alvo.gymUnitIds),
      });
    }

    direitosPorVinculo += 1;
  }

  return {
    lidos: registros.length,
    descartados,
    casados,
    casadosPorCpf,
    casadosPorNome,
    direitosPorPlano,
    direitosPorVinculo,
    preenchimento,
    pendencias,
  };
}
