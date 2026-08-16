/**
 * Smoke operacional de abertura da unidade -- F11, Slice 1.6.
 *
 * O QUE ELE RESPONDE, e a pergunta e literal: **da para abrir a academia
 * hoje?** Roda em dois minutos, antes do primeiro aluno chegar, e diz o que
 * fazer quando algo esta fora.
 *
 * O QUE ELE NAO FAZ, DE PROPOSITO
 * -------------------------------
 * Nao cria aluno, nao cadastra biometria e nao gira catraca. Um smoke que
 * mexe em dado real deixa lixo na base da academia e, no caso de biometria,
 * cria identidade sem consentimento -- que e violacao, nao inconveniente. O
 * plano da fatia previa criar fixture sintetica; isso fica para o ambiente de
 * homologacao, onde o dado e descartavel.
 *
 * Aqui a verificacao e de PRONTIDAO: os servicos respondem, o Edge esta vivo,
 * os dispositivos estao vivos, nao ha alerta critico aberto e a fila nao
 * esta entupida.
 *
 * USO
 * ---
 *   node scripts/smoke/smart-access.mjs --base-url http://localhost:3344 \
 *     --cookie "arenahub_access=..."
 *
 * Sai com codigo 0 quando tudo passa, 1 quando algo reprova. O codigo de
 * saida e o que permite pendurar isto num agendador e receber alerta.
 */

const argumentos = process.argv.slice(2);

function argumento(nome, padrao) {
  const indice = argumentos.indexOf(`--${nome}`);

  return indice >= 0 && argumentos[indice + 1] ? argumentos[indice + 1] : padrao;
}

const BASE_URL = argumento('base-url', 'http://localhost:3344');
const COOKIE = argumento('cookie', process.env.SMOKE_COOKIE ?? '');

/** Resultado de uma verificacao. */
function resultado(nome, ok, detalhe, acao) {
  return { nome, ok, detalhe, acao };
}

async function buscar(caminho) {
  const resposta = await fetch(`${BASE_URL}${caminho}`, {
    headers: COOKIE ? { cookie: COOKIE } : {},
  });

  const texto = await resposta.text();

  let corpo = null;

  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = null;
  }

  return { status: resposta.status, corpo };
}

async function verificarSaude() {
  try {
    const { status, corpo } = await buscar('/health/ready');

    if (status !== 200) {
      return resultado(
        'API pronta',
        false,
        `/health/ready devolveu ${status}`,
        'Verifique se a API subiu e se o banco esta acessivel. Runbook: diagnose.md §1.',
      );
    }

    return resultado('API pronta', true, JSON.stringify(corpo ?? {}), '');
  } catch (erro) {
    return resultado(
      'API pronta',
      false,
      erro instanceof Error ? erro.message : 'falha de rede',
      `A API nao respondeu em ${BASE_URL}. Verifique o servico. Runbook: diagnose.md §1.`,
    );
  }
}

async function verificarVersao() {
  const { status, corpo } = await buscar('/version');

  if (status !== 200) {
    return resultado('Versao da API', false, `status ${status}`, 'Runbook: diagnose.md §1.');
  }

  return resultado('Versao da API', true, corpo?.version ?? 'sem versao', '');
}

async function verificarOperacao() {
  const { status, corpo } = await buscar('/api/v1/operations/overview');

  if (status === 401) {
    return resultado(
      'Panorama operacional',
      false,
      'sessao ausente ou expirada',
      'Passe `--cookie` com uma sessao valida, ou rode `--base-url` apontando para o ambiente certo.',
    );
  }

  if (status !== 200 || !corpo) {
    return resultado('Panorama operacional', false, `status ${status}`, 'Runbook: diagnose.md §2.');
  }

  const verificacoes = [];

  const edges = corpo.edges ?? [];
  const dispositivos = corpo.dispositivos ?? [];

  // 90 s: mesmo limite das regras de alerta do servidor.
  const LIMITE_MS = 90_000;
  const agora = Date.now();

  const silencioso = (iso) => !iso || agora - new Date(iso).getTime() > LIMITE_MS;

  const edgesMudos = edges.filter((e) => silencioso(e.ultimoHeartbeat));

  verificacoes.push(
    resultado(
      'Edge respondendo',
      edges.length > 0 && edgesMudos.length === 0,
      edges.length === 0
        ? 'nenhum Edge cadastrado'
        : `${edges.length - edgesMudos.length} de ${edges.length} respondendo`,
      // Sem operacao offline (ADR-012), Edge fora = catraca parada.
      'Sem Edge, a catraca nao decide nada. Verifique o PC da academia: energia, rede e o servico ArenaHub Edge. Runbook: diagnose.md §3.',
    ),
  );

  const ativos = dispositivos.filter((d) => d.status === 'ACTIVE');
  const mudos = ativos.filter((d) => silencioso(d.ultimoHeartbeat));

  verificacoes.push(
    resultado(
      'Dispositivos respondendo',
      ativos.length > 0 && mudos.length === 0,
      ativos.length === 0
        ? 'nenhum dispositivo ativo'
        : `${ativos.length - mudos.length} de ${ativos.length} respondendo`,
      'Verifique energia e cabo de rede do leitor e da catraca. Runbook: diagnose.md §4.',
    ),
  );

  const sync = corpo.sync ?? {};

  verificacoes.push(
    resultado(
      'Fila de sincronizacao',
      (sync.deadLetters ?? 0) === 0,
      `${sync.pendentes ?? 0} pendentes, ${sync.deadLetters ?? 0} em dead letter`,
      'Dead letter nao se resolve sozinha. Revise no painel e decida entre reprocessar ou descartar. Runbook: diagnose.md §5.',
    ),
  );

  return verificacoes;
}

async function verificarAlertas() {
  const { status, corpo } = await buscar('/api/v1/operations/alerts?open=true&limit=50');

  if (status !== 200 || !Array.isArray(corpo)) {
    return resultado('Alertas abertos', false, `status ${status}`, 'Runbook: diagnose.md §2.');
  }

  const criticos = corpo.filter((a) => a.severity === 'CRITICAL');

  return resultado(
    'Sem alerta critico',
    criticos.length === 0,
    criticos.length === 0
      ? 'nenhum alerta critico'
      : criticos.map((a) => `${a.code}: ${a.impact}`).join(' | '),
    criticos.length === 0 ? '' : criticos.map((a) => a.recommendedAction).join(' | '),
  );
}

async function main() {
  process.stdout.write('Smoke de abertura -- ArenaHub Smart Access\n');
  process.stdout.write(`Alvo: ${BASE_URL}\n\n`);

  const verificacoes = [];

  verificacoes.push(await verificarSaude());
  verificacoes.push(await verificarVersao());

  const operacao = await verificarOperacao();

  verificacoes.push(...(Array.isArray(operacao) ? operacao : [operacao]));

  verificacoes.push(await verificarAlertas());

  let reprovadas = 0;

  for (const item of verificacoes) {
    const marca = item.ok ? 'OK  ' : 'FALHA';

    process.stdout.write(`[${marca}] ${item.nome}: ${item.detalhe}\n`);

    if (!item.ok) {
      reprovadas += 1;

      // A acao vem junto da falha, nao num apendice: quem roda isto as 6h da
      // manha precisa saber o que fazer sem procurar noutro documento.
      if (item.acao) process.stdout.write(`         -> ${item.acao}\n`);
    }
  }

  process.stdout.write('\n');

  if (reprovadas > 0) {
    process.stdout.write(
      `${reprovadas} verificacao(oes) reprovada(s). NAO abra a unidade sem tratar ou sem plano de contingencia.\n`,
    );
    process.exit(1);
  }

  process.stdout.write('Tudo pronto para abrir.\n');
}

main().catch((erro) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
  process.exit(1);
});
