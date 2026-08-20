/* eslint-disable no-console -- programa de linha de comando: console e a interface, nao debug esquecido (mesma excecao de prisma/seed.ts e prisma/import-pacto.ts). */
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
const NOME_DO_PLANO = 'Programa Adultos e Idosos';

/**
 * Nomes das colunas COMO O PACTO AS ESCREVE -- com acento, espaco e caixa
 * originais. Mapear aqui, num lugar so, evita espalhar `registro['Data
 * Nascimento']` pelo codigo de gravacao, que trabalha em ingles.
 */
const COLUNAS = {
  nome: 'Nome',
  cartao: 'Cartao',
  identificadorFacial: 'Identificador Facial',
  codigoPerfil: 'Codigo Perfil',
  dataNascimento: 'Data Nascimento',
  endereco: 'Endereco',
  bairro: 'Bairro',
  cep: 'Cep',
  municipio: 'Municipio',
  telefone: 'Telefone',
  celular: 'Celular',
  cpf: 'Cpf',
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
 * `unknown` antes de validar dado externo (`CLAUDE.md`). O JSON vem de um
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
      codigoPerfil: lerTexto(registro, COLUNAS.codigoPerfil),
      dataNascimento: lerTexto(registro, COLUNAS.dataNascimento),
      endereco: lerTexto(registro, COLUNAS.endereco),
      bairro: lerTexto(registro, COLUNAS.bairro),
      cep: lerTexto(registro, COLUNAS.cep),
      municipio: lerTexto(registro, COLUNAS.municipio),
      telefone: lerTexto(registro, COLUNAS.telefone),
      celular: lerTexto(registro, COLUNAS.celular),
      cpf: lerTexto(registro, COLUNAS.cpf),
      dataInicio: lerTexto(registro, COLUNAS.dataInicio),
      dataFim: lerTexto(registro, COLUNAS.dataFim),
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
  // `unknown` antes de validar dado externo (`CLAUDE.md`): o JSON vem de um
  // extrator de terceiro que ninguem versiona.
  const bruto: unknown = JSON.parse(conteudo);
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
      { medida: 'direitos por plano', valor: resultado.direitosPorPlano },
      { medida: 'direitos por vinculo', valor: resultado.direitosPorVinculo },
      { medida: 'pendencias', valor: resultado.pendencias.length },
    ]);

    const total = resultado.casados;
    const { preenchimento } = resultado;

    // Campo a campo, escrito na mao em vez de `Object.entries`: a ordem fica
    // estavel e o compilador reclama se um campo do relatorio sumir do
    // resultado -- que e exatamente o defeito que este relatorio existe para
    // pegar.
    console.info('[seed-ativos] preenchimento GRAVADO (sobre os casados):');
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
