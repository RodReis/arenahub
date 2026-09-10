/**
 * Importacao da base CORRENTE do Pacto -- F48.
 *
 * A F47 trouxe os 1.926 historicos como `CANCELLED`, sem direito de acesso.
 * Este traz quem treina hoje: atualiza cadastro, grava credencial de
 * equipamento, vincula o plano e libera o acesso.
 *
 *   ARENAHUB_PESSOAS_ATIVAS=/caminho/pessoas-ativas.json \
 *     pnpm --filter @arenahub/database seed:ativos
 *
 * O ARQUIVO NAO ENTRA NO REPOSITORIO (`CLAUDE.md`): e dado real de aluno. O
 * `.gitignore` ja barra `packages/database/prisma/import/*.json`, que e onde
 * ele deve ficar. SEM a variavel o seed NAO falha -- avisa e sai com 0, para
 * poder ficar num pipeline sem quebra-lo em quem nao tem o arquivo.
 *
 * SEPARADO do `seed.ts` de proposito, igual a F47: roda MANUALMENTE, uma
 * vez, contra a `DATABASE_URL` de quem chama. `criarPrismaClient` ja le a
 * variavel do ambiente -- nenhuma URL fica hardcoded aqui.
 *
 * A logica de gravacao mora em `src/import-ativos/importar.ts` -- testavel
 * com client injetado. Este arquivo so le o arquivo, valida a forma dele,
 * resolve tenant/plano/unidade e imprime o relatorio.
 */
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { readFile } from 'node:fs/promises';

import { criarPrismaClient } from '../src/client.js';
import {
  importarPessoasAtivas,
  type RegistroDePessoaAtiva,
} from '../src/import-ativos/importar.js';

const TENANT_SLUG = 'arena-positiva';

/**
 * Plano que recebe as assinaturas da importacao.
 *
 * PARAMETRIZADO em 02/09/2026: o nome do plano NAO E O MESMO em todo
 * ambiente. Em producao a academia cadastrou `Plano Individuais - protocolos
 * e acompanhamento`; o padrao abaixo e o nome usado na bancada. Com o nome
 * fixo, rodar em producao falhava alto -- correto, mas exigia editar codigo
 * para uma diferenca que e de DADO, nao de logica.
 *
 * `ARENAHUB_PLANO` sobrescreve. Continua sem inventar plano: o que nao existe
 * no tenant falha alto, porque importar todo mundo como pendencia silenciosa
 * so apareceria na fila da catraca.
 */
const NOME_DO_PLANO = process.env['ARENAHUB_PLANO'] ?? 'Programa Adultos e Idosos';

/**
 * Periodo do plano para quem o arquivo nao data -- decisao do PI, 02/09/2026.
 *
 * O export atual NAO TRAZ `Data Inicio` nem `Data Fim`. Sem periodo,
 * `gravarPessoa` devolve `aluno sem periodo de plano` e o aluno fica `ACTIVE`
 * SEM direito -- ou seja, a catraca fechada para a base inteira. O PI decidiu
 * que todo aluno ativo do arquivo ganha acesso a partir de 01/09/2026.
 *
 * O FIM E 12 MESES DEPOIS, mesma janela que `MESES_DE_VINCULO` ja aplica a
 * quem entra por vinculo. Direito sem fim nao existe neste sistema: ele
 * expiraria so por alguem lembrar de revogar, e ninguem lembra.
 *
 * So vale como PADRAO: linha que trouxer as datas usa as dela.
 */
const INICIO_PADRAO = '20260901';
const FIM_PADRAO = '20270901';

/**
 * Nomes das colunas COMO O PACTO AS ESCREVE -- com acento, espaco e caixa
 * originais. Mapear aqui, num lugar so, evita espalhar `registro['Data
 * Nascimento']` pelo codigo de gravacao, que trabalha em ingles.
 */
const COLUNAS = {
  nome: 'Nome',
  cartao: 'Cartao',
  identificadorFacial: 'Identificador Facial',
  // `Codigo Perfil` E LIXO DO PACTO -- confirmado pelo PI, 04/09/2026: quem
  // diz o papel de verdade e `Permissoes de Acesso`. O valor bruto do CSV
  // (1/3/4) e traduzido em `traduzirCodigoDePermissao` para o codigo que
  // `traduzirPerfil` (em `dominio.ts`) ja entende -- sem tocar no mapa
  // existente nem nos testes que o cobrem.
  codigoPerfil: 'Permissoes de Acesso',
  dataNascimento: 'Data Nascimento',
  endereco: 'Endereco',
  bairro: 'Bairro',
  cep: 'Cep',
  municipio: 'Municipio',
  uf: 'Uf',
  /*
   * TELEFONE E CELULAR SAO A MESMA COLUNA no export atual (confirmado pelo
   * PI, 02/09/2026): o Pacto passou a exportar `Telefone/Celular` unico. Os
   * dois campos apontam para ela de proposito -- `gravarContato` grava
   * `PHONE` e `WHATSAPP` com o mesmo numero, que e o que a recepcao precisa
   * (ela liga e manda mensagem para o mesmo aparelho).
   *
   * Nao e duplicacao acidental: apontar so um deixaria o outro canal vazio,
   * e o painel oferece os dois.
   */
  telefone: 'Telefone/Celular',
  celular: 'Telefone/Celular',
  cpf: 'Cpf',
  // AUSENTES do export atual -- caem em `INICIO_PADRAO`/`FIM_PADRAO`. Ficam
  // mapeadas para a linha que um dia as traga voltar a mandar sozinha.
  dataInicio: 'Data Inicio',
  dataFim: 'Data Fim',
  email: 'Email',
} as const satisfies Record<keyof RegistroDePessoaAtiva, string>;

/**
 * Le uma coluna como texto, tolerando ausencia e numero.
 *
 * O extrator entrega `Cartao` ora como `"0012"`, ora como `12` -- e zero a
 * esquerda importa numa chave de equipamento, entao numero vira texto sem
 * reformatacao. Coluna ausente vira string vazia, que o nucleo ja trata como
 * "o arquivo nao trouxe" e nao apaga nada no banco.
 */
function lerTexto(linha: Record<string, unknown>, coluna: string): string {
  const valor = linha[coluna];

  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number') return String(valor);

  return '';
}

/**
 * CSV do Pacto em linhas-objeto, com o cabecalho como chave.
 *
 * SEPARADOR `;` e SEM ASPAS -- e o que o Pacto exporta, conferido no arquivo
 * real (348 linhas, 15 campos em todas, zero aspas). Por isso `split`, e nao
 * uma biblioteca: campo com virgula, aspas ou quebra de linha embutida nao
 * existe aqui, e uma dependencia nova para 15 linhas de codigo seria peso
 * sem contrapartida.
 *
 * SE O FORMATO MUDAR (ganhar aspas ou campo com `;` dentro), este parser
 * passa a errar CALADO -- a contagem de campos por linha e a defesa: linha
 * com numero de campos diferente do cabecalho vira erro, nao registro torto.
 */
function lerCsv(conteudo: string): Record<string, unknown>[] {
  const linhas = conteudo
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha !== '');

  const cabecalho = linhas.shift();

  if (cabecalho === undefined) throw new Error('CSV vazio.');

  const colunas = cabecalho.split(';').map((coluna) => coluna.trim());

  return linhas.map((linha, indice) => {
    const campos = linha.split(';');

    if (campos.length !== colunas.length) {
      throw new Error(
        `Linha ${String(indice + 2)} do CSV tem ${String(campos.length)} campos, ` +
          `e o cabecalho tem ${String(colunas.length)}.`,
      );
    }

    return Object.fromEntries(colunas.map((coluna, i) => [coluna, campos[i]?.trim() ?? '']));
  });
}

/**
 * `Permissoes de Acesso` do CSV (1/3/4, os unicos valores que o export real
 * traz) para o codigo que `traduzirPerfil` em `dominio.ts` ja entende
 * (0=ADMIN, 1=STUDENT, 2=STAFF, 3=TRAINER). Confirmado pelo PI, 04/09/2026.
 *
 * NAO HA STAFF nesta base: os 72 registros com valor 3 sao majoritariamente
 * personal trainer (email com "personal", nome de profissional), e o valor 4
 * (2 registros) inclui um treinador reconhecivel -- por isso os dois caem
 * respectivamente em TRAINER e ADMIN, sem terceiro valor para STAFF. Codigo
 * desconhecido vira string vazia, que `traduzirPerfil` ja trata como perfil
 * desconhecido (pendencia), em vez de adivinhar.
 */
const CODIGO_POR_PERMISSAO: Record<string, string> = {
  '1': '1', // STUDENT
  '3': '3', // TRAINER
  '4': '0', // ADMIN
};

function traduzirCodigoDePermissao(valor: string): string {
  return CODIGO_POR_PERMISSAO[valor.trim()] ?? '';
}

/**
 * `unknown` antes de validar dado externo (`CLAUDE.md`). O arquivo vem de um
 * extrator de terceiro: confiar na forma dele aqui seria confiar num arquivo
 * que ninguem versiona.
 */
function converter(bruto: unknown): RegistroDePessoaAtiva[] {
  if (!Array.isArray(bruto)) {
    throw new Error('O arquivo de pessoas ativas nao e uma lista JSON.');
  }

  return bruto.map((linha: unknown, indice: number): RegistroDePessoaAtiva => {
    if (typeof linha !== 'object' || linha === null || Array.isArray(linha)) {
      throw new Error(`Linha ${String(indice)} do arquivo nao e um objeto.`);
    }

    const registro = linha as Record<string, unknown>;

    return {
      nome: lerTexto(registro, COLUNAS.nome),
      cartao: lerTexto(registro, COLUNAS.cartao),
      identificadorFacial: lerTexto(registro, COLUNAS.identificadorFacial),
      codigoPerfil: traduzirCodigoDePermissao(lerTexto(registro, COLUNAS.codigoPerfil)),
      dataNascimento: lerTexto(registro, COLUNAS.dataNascimento),
      endereco: lerTexto(registro, COLUNAS.endereco),
      bairro: lerTexto(registro, COLUNAS.bairro),
      cep: lerTexto(registro, COLUNAS.cep),
      municipio: lerTexto(registro, COLUNAS.municipio),
      uf: lerTexto(registro, COLUNAS.uf),
      telefone: lerTexto(registro, COLUNAS.telefone),
      celular: lerTexto(registro, COLUNAS.celular),
      cpf: lerTexto(registro, COLUNAS.cpf),
      // O PADRAO SO ENTRA QUANDO O ARQUIVO NAO TRAZ (`||`, sobre string
      // vazia). Linha datada usa a data dela -- o padrao existe para o
      // export atual, que nao traz nenhuma, e nao para sobrescrever quem tem.
      dataInicio: lerTexto(registro, COLUNAS.dataInicio) || INICIO_PADRAO,
      dataFim: lerTexto(registro, COLUNAS.dataFim) || FIM_PADRAO,
      email: lerTexto(registro, COLUNAS.email),
    };
  });
}

/**
 * Preenchimento NO ARQUIVO, antes de qualquer gravacao.
 *
 * Vem primeiro de proposito: comparado com o preenchimento no banco, ele
 * separa "o extrator nao trouxe" de "a gravacao nao gravou". Foi um
 * `logradouro 0/1934` que denunciou um extrator quebrado na F47.
 */
function relatorioDoArquivo(
  registros: readonly RegistroDePessoaAtiva[],
): { campo: string; preenchidos: number; total: number }[] {
  const total = registros.length;
  const contar = (ler: (r: RegistroDePessoaAtiva) => string): number =>
    registros.filter((r) => ler(r).trim() !== '').length;

  return [
    { campo: 'cpf', preenchidos: contar((r) => r.cpf), total },
    { campo: 'cartao', preenchidos: contar((r) => r.cartao), total },
    { campo: 'identificadorFacial', preenchidos: contar((r) => r.identificadorFacial), total },
    { campo: 'codigoPerfil', preenchidos: contar((r) => r.codigoPerfil), total },
    { campo: 'dataNascimento', preenchidos: contar((r) => r.dataNascimento), total },
    { campo: 'dataInicio', preenchidos: contar((r) => r.dataInicio), total },
    { campo: 'dataFim', preenchidos: contar((r) => r.dataFim), total },
    { campo: 'telefone', preenchidos: contar((r) => r.telefone), total },
    { campo: 'celular', preenchidos: contar((r) => r.celular), total },
    { campo: 'email', preenchidos: contar((r) => r.email), total },
    { campo: 'endereco', preenchidos: contar((r) => r.endereco), total },
    { campo: 'cep', preenchidos: contar((r) => r.cep), total },
    { campo: 'municipio', preenchidos: contar((r) => r.municipio), total },
    { campo: 'uf', preenchidos: contar((r) => r.uf), total },
  ];
}

async function ativar(): Promise<void> {
  const caminho = process.env['ARENAHUB_PESSOAS_ATIVAS'];

  if (!caminho) {
    console.info(
      '[seed-ativos] ARENAHUB_PESSOAS_ATIVAS nao definida -- nada a importar. ' +
        'Aponte para o JSON da base ativa do Pacto; ele nunca entra no ' +
        'repositorio (CLAUDE.md).',
    );

    return;
  }

  const conteudo = await readFile(caminho, 'utf8');
  // CSV OU JSON, decidido pela EXTENSAO e nao pelo conteudo: adivinhar pelo
  // primeiro caractere faria um JSON malformado ser lido como CSV e produzir
  // 300 registros vazios em vez de um erro de parse.
  const ehCsv = caminho.toLowerCase().endsWith('.csv');
  // `unknown` antes de validar dado externo (`CLAUDE.md`): o arquivo vem de um
  // extrator de terceiro que ninguem versiona.
  const bruto: unknown = ehCsv ? lerCsv(conteudo) : JSON.parse(conteudo);
  const registros = converter(bruto);

  console.info(`[seed-ativos] ${String(registros.length)} registros lidos de ${caminho}`);
  console.info('[seed-ativos] preenchimento NO ARQUIVO (antes de gravar):');
  console.table(relatorioDoArquivo(registros));

  const db = criarPrismaClient();

  try {
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { slug: TENANT_SLUG },
      select: { id: true },
    });

    const plano = await db.plan.findFirst({
      where: { tenantId: tenant.id, name: NOME_DO_PLANO },
      select: { id: true, name: true },
    });

    if (!plano) {
      // Falha ALTA, e nao importacao parcial: sem plano, todo aluno viraria
      // pendencia silenciosa e ninguem descobriria ate a fila na catraca.
      throw new Error(
        `Plano "${NOME_DO_PLANO}" nao existe no tenant "${TENANT_SLUG}". ` +
          'Rode o seed base antes.',
      );
    }

    const unidades = await db.gymUnit.findMany({
      where: { tenantId: tenant.id },
      select: { id: true },
    });

    if (unidades.length === 0) {
      throw new Error(`Tenant "${TENANT_SLUG}" nao tem unidade. Rode o seed base antes.`);
    }

    const resultado = await importarPessoasAtivas(
      db,
      {
        tenantId: tenant.id,
        planId: plano.id,
        planName: plano.name,
        gymUnitIds: unidades.map((unidade) => unidade.id),
      },
      registros,
      new Date(),
    );

    console.info('\n[seed-ativos] === resultado ===');
    console.table([
      { medida: 'lidos', valor: resultado.lidos },
      { medida: 'descartados (teste)', valor: resultado.descartados },
      { medida: 'casados', valor: resultado.casados },
      { medida: 'casados por CPF', valor: resultado.casadosPorCpf },
      { medida: 'casados por nome', valor: resultado.casadosPorNome },
      // F49: na SEGUNDA execucao este numero tem de ser 0 e `casados` sobe
      // na mesma medida. Se `criados` repetir o valor da primeira, a
      // idempotencia quebrou e o relatorio mostra isso sem consultar o banco.
      { medida: 'criados (nao existiam no cadastro)', valor: resultado.criados },
      { medida: 'direitos por plano', valor: resultado.direitosPorPlano },
      { medida: 'direitos por vinculo', valor: resultado.direitosPorVinculo },
      { medida: 'pendencias', valor: resultado.pendencias.length },
    ]);

    // Preenchimento cobre casados E criados: os dois passam pela mesma
    // gravacao, e dividir por `casados` so daria porcentagem acima de 100%.
    const total = resultado.casados + resultado.criados;
    const { preenchimento } = resultado;

    // Campo a campo, escrito na mao em vez de `Object.entries`: a ordem fica
    // estavel e o compilador reclama se um campo do relatorio sumir do
    // resultado -- que e exatamente o defeito que este relatorio existe para
    // pegar.
    console.info('[seed-ativos] preenchimento GRAVADO (sobre casados + criados):');
    console.table([
      { campo: 'nascimento', preenchidos: preenchimento.nascimento, total },
      { campo: 'cartao', preenchidos: preenchimento.cartao, total },
      { campo: 'identificadorFacial', preenchidos: preenchimento.facial, total },
      { campo: 'telefone', preenchidos: preenchimento.telefone, total },
      { campo: 'email', preenchidos: preenchimento.email, total },
      { campo: 'endereco', preenchidos: preenchimento.endereco, total },
    ]);

    // A lista completa, nao um resumo: cada linha aqui e uma pessoa que a
    // recepcao vai ter de resolver na mao, e um contador nao diz quem.
    // DESTAQUE SEPARADO, antes da lista geral: cadastro com `1900-01-01` e
    // uma pessoa no banco com data que ninguem escolheu. Perdida no meio de
    // dezenas de outras pendencias, ninguem corrige -- e uma data falsa
    // indistinguivel de data real e exatamente o que nao pode passar calado.
    const semNascimento = resultado.pendencias.filter(
      (p) => p.motivo === 'cadastrado sem data de nascimento',
    );

    if (semNascimento.length > 0) {
      console.warn(
        `[seed-ativos] ATENCAO: ${String(semNascimento.length)} pessoa(s) cadastrada(s) com ` +
          'data de nascimento PLACEHOLDER (1900-01-01). A recepcao precisa corrigir:',
      );
      console.table(semNascimento.map((p) => ({ nome: p.nome })));
    }

    console.info(`[seed-ativos] pendencias (${String(resultado.pendencias.length)}):`);
    console.table(resultado.pendencias);
  } finally {
    await db.$disconnect();
  }
}

try {
  await ativar();
} catch (erro: unknown) {
  console.error('[seed-ativos] falhou:', erro);
  process.exitCode = 1;
}
