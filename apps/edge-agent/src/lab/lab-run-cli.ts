/**
 * CLI do `lab:run` -- MVP 0, cadeia FISICA ponta a ponta.
 *
 * ⚠️ FALA COM HARDWARE REAL: sobe o servidor WebSocket do leitor facial e a
 * ponte da catraca, e ACIONA A CATRACA quando um rosto permitido e
 * reconhecido. Nao roda no CI nem no `pnpm test`. Rode na bancada, com alguem
 * olhando o equipamento e a parada de emergencia a mao.
 *
 * O CALCULO e a ORQUESTRACAO ficam em `lab-run.ts` e `orquestrar-passagem.ts`,
 * puros e testados no CI. Este arquivo so faz o wiring de I/O: sobe a ponte,
 * conecta a catraca, liga `aoReconhecer` na bancada, imprime o resumo.
 *
 * PRE-CONDICOES (as mesmas do runbook da POC):
 *   - catraca e leitor facial apontando para ESTA maquina (cutover feito);
 *   - firewall 3570 de entrada aberto;
 *   - `EasyInnerBridge.exe` compilado (`pnpm bridge:build`);
 *   - enrollid de teste ja cadastrado no leitor (face capturada na camera).
 *
 * USO:
 *   pnpm --filter @arenahub/edge-agent lab:run -- --permitidos 100000000042
 *
 * Encerra com Ctrl+C e imprime p50/p95/max da latencia rosto -> comando.
 *
 * MODO `--headless` (insumo F59 SS5.4): substitui os dois adapters por
 * `FacialSimulator`/`TurnstileSimulator`, dispara reconhecimentos sintéticos
 * sem esperar confirmacao do operador, e grava a evidencia via
 * `escreverEvidencia` ao final. Existe para o `lab:run` rodar no CI --
 * o modo com hardware real nunca roda la (M0-NFR-006).
 */
import { join } from 'node:path';

import pino from 'pino';

import { type SentidoGiro } from '../domain/turnstile.js';
import { type EventoReconhecimento } from '../domain/facial-device.js';
import { TopdataFacialAdapter } from '../adapters/topdata/topdata-facial-adapter.js';
import { TopdataInnerAdapter } from '../adapters/topdata/topdata-inner-adapter.js';
import { PonteEasyInnerProcesso } from '../adapters/topdata/ponte-easyinner-processo.js';
import { FacialSimulator } from '../adapters/facial-simulator.js';
import { TurnstileSimulator } from '../adapters/turnstile-simulator.js';
import { resumirLatencia } from '../application/orquestrar-passagem.js';
import { criarBancadaLab } from './lab-run.js';
import { escreverEvidencia, type TentativaDeEvidencia } from './escritor-de-evidencia.js';

const PORTA_CATRACA = 3570;
const INNER = 1;
const PORTA_FACIAL = 7792;
const CAMINHO_EVIDENCIA = join('data', 'lab-run-evidencia.json');
const ENROLLID_HEADLESS_PERMITIDO = 'lab-headless-permitido-1';
const ENROLLID_HEADLESS_NEGADO = 'lab-headless-negado-1';

function lerPermitidos(argv: readonly string[]): string[] {
  const i = argv.indexOf('--permitidos');
  if (i === -1 || !argv[i + 1]) return [];
  return argv[i + 1]!.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Se a catraca deve girar com as funcoes invertidas. Depende da ORIENTACAO
 * FISICA da instalacao -- o manual e explicito que se descobre testando, nao
 * se deduz. Sintoma de `invertido` errado: a catraca destrava para o sentido
 * oposto ao desejado (seta verde apontando para o lado errado).
 */
function lerInvertido(argv: readonly string[]): boolean {
  return argv.includes('--invertido');
}

/**
 * Sentido do giro: `entrada` (default), `saida` ou `ambos`. Qual gira
 * fisicamente para dentro se descobre TESTANDO nesta catraca -- combinado com
 * `--invertido`, sao quatro possibilidades a experimentar na bancada.
 */
function lerSentido(argv: readonly string[]): SentidoGiro {
  const i = argv.indexOf('--sentido');
  const v = i === -1 ? undefined : argv[i + 1];
  if (v === 'saida' || v === 'ambos' || v === 'entrada') return v;
  return 'entrada';
}

/** Roda sem hardware, com simuladores, para o CI (insumo F59 SS5.4). */
function lerHeadless(argv: readonly string[]): boolean {
  return argv.includes('--headless');
}

/**
 * Fio da bancada sem hardware -- simuladores no lugar dos adapters reais.
 *
 * Processa dois reconhecimentos sinteticos (um permitido, um negado) para o
 * arquivo de evidencia sempre carregar as duas decisoes, encerra sozinho
 * (sem esperar Ctrl+C) e grava a evidencia via `escreverEvidencia`.
 *
 * Chama `bancada.processar` DIRETAMENTE em vez de rotear por
 * `facial.simularReconhecimento` + `aoReconhecer`: o objetivo aqui e gerar
 * evidencia deterministica, nao exercitar o wiring do simulador de leitor.
 * Rotear pelo callback tornaria o resultado dependente de quando o
 * `.then()` resolve -- so daria para saber que as duas tentativas
 * terminaram esperando um tempo fixo, o que e frágil sob CI com CPU
 * variavel (pode gravar evidencia incompleta com exit code 0, sem sinal de
 * erro). Chamando `processar` direto, o `await` de cada chamada e a propria
 * garantia de termino -- sem timer.
 */
async function rodarHeadless(logger: pino.Logger, permitidosArg: readonly string[]): Promise<void> {
  const permitidos = permitidosArg.length > 0 ? permitidosArg : [ENROLLID_HEADLESS_PERMITIDO];

  const catraca = new TurnstileSimulator();
  const facial = new FacialSimulator();

  const bancada = criarBancadaLab({
    catraca,
    permitidos,
    agoraMonotonicoMs: () => Number(process.hrtime.bigint() / 1_000_000n),
    nomeDoLeitor: facial.nome,
  });

  const eventoPermitido: EventoReconhecimento = {
    externalEnrollId: permitidos[0]!,
    ocorridoEm: new Date(),
    recebidoEm: new Date(),
    metodo: 'facial',
  };
  const eventoNegado: EventoReconhecimento = {
    externalEnrollId: ENROLLID_HEADLESS_NEGADO,
    ocorridoEm: new Date(),
    recebidoEm: new Date(),
    metodo: 'facial',
  };

  const [resultadoPermitido, resultadoNegado] = await Promise.all([
    bancada.processar(eventoPermitido, 'lab-headless-1', new Date()),
    bancada.processar(eventoNegado, 'lab-headless-2', new Date()),
  ]);

  const tentativas: TentativaDeEvidencia[] = [
    {
      externalEnrollId: eventoPermitido.externalEnrollId,
      decisao: resultadoPermitido.decisao.resultado,
      latenciaMs: resultadoPermitido.latenciaDecisaoMs,
    },
    {
      externalEnrollId: eventoNegado.externalEnrollId,
      decisao: resultadoNegado.decisao.resultado,
      latenciaMs: resultadoNegado.latenciaDecisaoMs,
    },
  ];

  const resumo = resumirLatencia(bancada.latencias());
  escreverEvidencia(CAMINHO_EVIDENCIA, {
    executadoEm: new Date().toISOString(),
    modo: { facial: 'simulador', catraca: 'simulador' },
    tentativas,
    percentis: resumo ? { p50: resumo.p50, p95: resumo.p95, max: resumo.max } : { p50: 0, p95: 0, max: 0 },
  });

  logger.info({ caminho: CAMINHO_EVIDENCIA, tentativas: tentativas.length }, 'evidencia headless gravada');

  await facial.encerrar();
  await catraca.encerrar();
}

async function main(): Promise<void> {
  const logger = pino({ level: 'info' });

  const permitidos = lerPermitidos(process.argv);

  if (lerHeadless(process.argv)) {
    await rodarHeadless(logger, permitidos);
    process.exit(0);
  }

  if (permitidos.length === 0) {
    logger.error('informe ao menos um enrollid: --permitidos 100000000042');
    process.exit(1);
  }

  const exe = join(
    process.cwd(),
    'native',
    'easyinner-bridge',
    'bin',
    'EasyInnerBridge.exe',
  );

  const invertido = lerInvertido(process.argv);
  const sentido = lerSentido(process.argv);

  logger.info({ exe, invertido, sentido }, 'subindo a ponte da catraca');
  const ponte = PonteEasyInnerProcesso.lancar({ comando: exe });
  const catraca = new TopdataInnerAdapter(ponte, logger, INNER, invertido);

  // Inicializacao online COMPLETA: abre a porta e roda ConfigurarAcionamento1
  // (o rele como catraca). Sem isto o `liberar` volta `retorno 1`. Achado de
  // campo 17/08/2026 -- `testarConexao` sozinho nao habilita o giro.
  await catraca.conectar(PORTA_CATRACA, 10);

  // A catraca e cliente: apos o `conectar` ela ainda leva alguns segundos para
  // discar de volta. So entao o `liberar` encontra a sessao online.
  logger.info('aguardando a catraca discar para a ponte...');
  let catracaOk = false;
  for (let i = 0; i < 15; i += 1) {
    if (await catraca.testarConexao()) {
      catracaOk = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!catracaOk) {
    logger.error('a catraca nao discou -- verifique ipServer=.190 e firewall 3570. Abortando.');
    process.exit(1);
  }
  logger.info('catraca conectada');

  const facial = new TopdataFacialAdapter(logger, PORTA_FACIAL);

  const bancada = criarBancadaLab({
    catraca,
    permitidos,
    agoraMonotonicoMs: () => Number(process.hrtime.bigint() / 1_000_000n),
    sentido,
    nomeDoLeitor: facial.nome,
    // Relogio errado precisa APARECER na bancada. Em 17/08 o `ocorridoEm`
    // congelado so foi notado na analise do relatorio, depois da janela.
    aoDetectarRelogioImplausivel: (a) =>
      logger.warn(
        {
          dispositivo: a.dispositivo,
          razao: a.razao,
          ocorridoEm: Number.isNaN(a.ocorridoEm.getTime()) ? 'invalido' : a.ocorridoEm.toISOString(),
          recebidoEm: a.recebidoEm.toISOString(),
        },
        'relogio do equipamento implausivel -- ordenando pelo recebimento',
      ),
  });

  let seq = 0;
  facial.aoReconhecer((evento) => {
    const correlationId = `lab-${Date.now()}-${(seq += 1)}`;
    void bancada
      .processar(evento, correlationId, new Date())
      .then((r) => {
        logger.info(
          {
            enrollid: evento.externalEnrollId,
            decisao: r.decisao.resultado,
            relogioImplausivel: r.relogioImplausivel,
            desfecho: r.desfecho,
            latenciaDecisaoMs: r.latenciaDecisaoMs,
            duracaoPassagemMs: r.duracaoPassagemMs,
          },
          r.decisao.resultado === 'ALLOW' ? '*** ALLOW -> catraca acionada ***' : 'DENY (nao aciona)',
        );
      })
      .catch((e: unknown) => logger.error({ erro: (e as Error).message }, 'falha ao processar'));
  });

  await facial.iniciar();
  logger.info(
    { permitidos },
    'lab:run de pe. Passe um rosto PERMITIDO e cadastrado. Ctrl+C para encerrar e ver o resumo.',
  );

  const encerrar = async (sinal: string): Promise<void> => {
    logger.info({ sinal }, 'encerrando');
    const resumo = resumirLatencia(bancada.latencias());
    if (resumo) {
      logger.info(
        { p50: resumo.p50, p95: resumo.p95, max: resumo.max, n: resumo.n },
        '=== RESUMO latencia rosto -> comando (M0-NFR-001) ===',
      );
    } else {
      logger.warn('nenhuma passagem ALLOW coletada -- nada a resumir');
    }
    await facial.encerrar();
    process.exit(0);
  };

  process.once('SIGINT', () => void encerrar('SIGINT'));
  process.once('SIGTERM', () => void encerrar('SIGTERM'));
}

void main();
