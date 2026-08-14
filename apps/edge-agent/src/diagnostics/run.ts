import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import {
  esquemaInventario,
  pendenciasDoGate,
  type Inventario,
} from '../bancada/inventory-schema.js';
import { carregarConfig, descreverConfig, ConfigInvalidaError } from '../config/env.js';

/**
 * Script de diagnostico da bancada -- entrega da Slice 0.1.
 *
 *   pnpm --filter @arenahub/edge-agent diagnostico
 *
 * SOMENTE LEITURA, e isto nao e detalhe.
 *
 * O equipamento da bancada esta INSTALADO e em teste, e comandar a catraca
 * tem efeito fisico imediato. Um diagnostico que enviasse comando nao seria
 * diagnostico. Aqui so se abre socket TCP e se fecha: nenhum comando,
 * nenhuma escrita, nenhum efeito.
 *
 * "Script de diagnostico SEM SEGREDOS" (Slice 0.1): a saida passa por
 * `descreverConfig`, que mascara segredo. O que este script imprime pode ser
 * colado num chamado sem revisao.
 */

type Resultado = {
  nome: string;
  estado: 'ok' | 'falha' | 'aviso' | 'pulado';
  detalhe: string;
};

const SIMBOLO = { ok: 'ok  ', falha: 'FALHA', aviso: 'aviso', pulado: '-   ' } as const;

/**
 * Tenta abrir socket TCP e fecha imediatamente. Nao envia byte algum.
 *
 * Handshake TCP nao e comando: nao muda estado do equipamento, nao aparece
 * como tentativa de acesso e nao mexe na base.
 */
function alcancaPorta(host: string, porta: number, timeoutMs = 3000): Promise<Resultado> {
  return new Promise((resolvePromise) => {
    const nome = `alcance de ${host}:${porta}`;
    const socket = connect({ host, port: porta, timeout: timeoutMs });

    const encerrar = (estado: Resultado['estado'], detalhe: string) => {
      socket.destroy();
      resolvePromise({ nome, estado, detalhe });
    };

    socket.once('connect', () => encerrar('ok', 'porta aceita conexao'));
    socket.once('timeout', () => encerrar('falha', `sem resposta em ${timeoutMs} ms`));
    socket.once('error', (erro: NodeJS.ErrnoException) =>
      encerrar('falha', erro.code ?? erro.message),
    );
  });
}

function lerInventario(caminho: string): Resultado & { inventario?: Inventario } {
  const nome = 'inventario da bancada';

  let bruto: unknown;
  try {
    bruto = parseYaml(readFileSync(caminho, 'utf8'));
  } catch (erro: unknown) {
    const causa = erro instanceof Error ? erro.message : String(erro);
    return { nome, estado: 'falha', detalhe: `nao foi possivel ler ${caminho}: ${causa}` };
  }

  const validacao = esquemaInventario.safeParse(bruto);
  if (!validacao.success) {
    const problemas = validacao.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return { nome, estado: 'falha', detalhe: problemas };
  }

  const inv = validacao.data;
  return {
    nome,
    estado: 'ok',
    detalhe: `${inv.dispositivos.length} dispositivo(s), atualizado em ${inv.atualizadoEm}`,
    inventario: inv,
  };
}

async function main(): Promise<number> {
  const resultados: Resultado[] = [];

  console.info('Diagnostico da bancada — ArenaHub edge-agent');
  console.info('Somente leitura: nenhum comando e enviado ao equipamento.\n');

  // --- configuracao --------------------------------------------------------
  let config;
  try {
    config = carregarConfig();
    resultados.push({ nome: 'configuracao', estado: 'ok', detalhe: 'valida' });
  } catch (erro: unknown) {
    if (erro instanceof ConfigInvalidaError) {
      resultados.push({ nome: 'configuracao', estado: 'falha', detalhe: erro.problemas.join('; ') });
      imprimir(resultados);
      console.error('\nSem configuracao valida nao ha o que diagnosticar.');
      return 1;
    }
    throw erro;
  }

  console.info('Configuracao efetiva (segredos mascarados):');
  for (const [chave, valor] of Object.entries(descreverConfig(config))) {
    console.info(`  ${chave}=${valor}`);
  }
  console.info('');

  // --- inventario ----------------------------------------------------------
  const caminhoInv = resolve(process.cwd(), '../..', config.INVENTORY_PATH);
  const leitura = lerInventario(caminhoInv);
  resultados.push({ nome: leitura.nome, estado: leitura.estado, detalhe: leitura.detalhe });

  const inventario = leitura.inventario;

  // --- alcance de rede -----------------------------------------------------
  if (!inventario) {
    resultados.push({
      nome: 'alcance dos dispositivos',
      estado: 'pulado',
      detalhe: 'inventario ilegivel',
    });
  } else {
    for (const d of inventario.dispositivos) {
      const ip = d.rede?.ip;
      if (!ip) {
        resultados.push({
          nome: `alcance de ${d.id}`,
          estado: 'pulado',
          detalhe: 'sem IP no inventario',
        });
        continue;
      }
      // 80: web server do equipamento. Alcance, nao uso.
      resultados.push(await alcancaPorta(ip, 80));
    }
  }

  imprimir(resultados);

  // --- gate ----------------------------------------------------------------
  if (inventario) {
    const pendentes = pendenciasDoGate(inventario);
    if (pendentes.length > 0) {
      console.warn(`\nGate de entrada do MVP 0 — ${pendentes.length} de 7 item(ns) em aberto:`);
      for (const p of pendentes) console.warn(`  - ${p}`);
      console.warn('\nPRD §4: sem esses itens a POC fica BLOQUEADA para as fatias que dependem');
      console.warn('de hardware. F1 (bancada) nao depende; F2 e F3 dependem.');
    }

    if (!inventario.rede.isolada) {
      console.warn('\nA rede da bancada nao e isolada (PRD §4 pede isolada).');
      console.warn('A base do ArenaHub e propria e separada da do software de fabrica, entao');
      console.warn('escrever nela nao afeta o que esta instalado. O que continua exigindo');
      console.warn('cuidado e COMANDAR A CATRACA: o efeito e fisico e imediato.');
    }
  }

  const houveFalha = resultados.some((r) => r.estado === 'falha');
  return houveFalha ? 1 : 0;
}

function imprimir(resultados: readonly Resultado[]): void {
  console.info('Verificacoes:');
  for (const r of resultados) {
    console.info(`  [${SIMBOLO[r.estado]}] ${r.nome}: ${r.detalhe}`);
  }
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((erro: unknown) => {
    console.error('Diagnostico falhou:', erro instanceof Error ? erro.message : erro);
    process.exit(1);
  });
