import { z } from 'zod';

/**
 * Configuracao do edge-agent, validada no boundary.
 *
 * `M0-NFR-005`: credenciais sao carregadas externamente e mascaradas. Nada
 * de segredo em codigo, e nada de segredo em log -- `descreverConfig` existe
 * exatamente para dar uma visao segura da config sem vazar valor.
 *
 * Zod no boundary, `unknown` antes de validar (CLAUDE.md -> Convencoes).
 */

/** Marca um valor como segredo, para o mascaramento nao depender do nome. */
const segredo = z.string().min(1).brand<'Segredo'>();

/** Inteiro de 0 a `max`; ausente ou vazio (`VAR=`) vira `undefined`, nunca 0. */
function numeroOpcional(max: number) {
  return z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(0).max(max).optional(),
  );
}

export const esquemaConfig = z.object({
  /**
   * Identidade deste agente na bancada. `M0-FR-001` exige identificar
   * unicamente cada dispositivo -- este e o lado do agente; o lado do
   * equipamento vem do inventario.
   */
  EDGE_AGENT_ID: z.string().min(1),

  /** Tenant e unidade que este agente atende (regra de arquitetura no 2). */
  TENANT_ID: z.string().uuid(),
  GYM_UNIT_ID: z.string().uuid(),

  /** Caminho do inventario da bancada. Ver infra/bancada/README.md. */
  INVENTORY_PATH: z.string().min(1).default('infra/bancada/inventory.yaml'),

  /** SQLite local. O Edge e executor; a nuvem e a fonte da verdade. */
  SQLITE_PATH: z.string().min(1).default('data/edge-agent.sqlite'),

  /** Coletor na nuvem. Ausente = modo bancada, sem envio. */
  COLLECTOR_URL: z.url().optional(),
  COLLECTOR_HMAC_SECRET: segredo.optional(),

  /**
   * API do ArenaHub, para buscar comando de sincronizacao (F8).
   *
   * Ausente = modo bancada: o agente nao busca comando e a fila da nuvem
   * simplesmente nao existe para ele. E o que permite rodar F1-F5 sem
   * depender da API.
   */
  CLOUD_API_URL: z.url().optional(),
  /** `keyId` da credencial. Publico: identifica, nao autentica. */
  CLOUD_EDGE_KEY_ID: z.string().min(1).optional(),
  /** Segredo HMAC. NUNCA em log, nem mascarado. */
  CLOUD_EDGE_SECRET: segredo.optional(),

  /** Codigo de pareamento de uso unico, gerado no painel (ADR-011). */
  EDGE_PAIRING_CODE: z.string().min(8).optional(),

  /** Intervalo de busca por comando, em ms. */
  SYNC_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(15_000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Um flag por dispositivo (decisao do PI, insumo F59 SS4 no2). Substitui
   * o antigo `USE_SIMULATOR` booleano -- permite ensaiar o facial real com
   * catraca simulada, sem girar nada.
   *
   * `M0-NFR-006`: o padrao de ambos e simulador -- CI roda sem hardware.
   */
  FACIAL_MODE: z.enum(['real', 'simulador']).default('simulador'),
  CATRACA_MODE: z.enum(['real', 'simulador']).default('simulador'),

  /**
   * Se a instalacao fisica exige as funcoes de liberacao invertidas.
   *
   * So se descobre testando na bancada -- ver o comentario do
   * `TopdataInnerAdapter`. Achado de campo, Arena Positiva, 30/09/2026
   * (issue #407): sem isto a catraca girava para o sentido errado.
   */
  CATRACA_INVERTIDA: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Segundos que a catraca fica destravada depois de liberar. O equipamento
   * aceita de 1 a 50 (`ConfigurarAcionamento1`).
   *
   * Era 5 fixo na ponte. Arena Positiva, 01/10/2026: tirando a latencia da
   * decisao, sobravam ~4,5 s para empurrar, e a passagem fechou em 4.992 ms
   * sem giro. Com o leitor segurando a mesma pessoa por ~2 min, perder a
   * janela deixa o aluno travado na frente da catraca.
   */
  CATRACA_TEMPO_LIBERADA_S: z.coerce.number().int().min(1).max(50).default(10),

  /**
   * Serial da catraca como esta cadastrado no painel (o display dela mostra
   * em "Serial") -- #522. Com ele, a catraca entra no heartbeat enquanto
   * responde ao ping, e o alerta DEVICE_OFFLINE dela passa a ser verdadeiro.
   * Sem ele, a catraca fica fora do heartbeat, como antes.
   */
  CATRACA_SERIAL: z.string().min(1).max(64).optional(),

  /**
   * Modo de acesso gravado NA CATRACA a cada conexao -- #507. Os tres juntos
   * ou nenhum (`carregarConfig` recusa parcial). Sem eles o agente nao grava
   * nada e a catraca segue com o que tem: ela perde a configuracao quando e
   * desligada da tomada (o TopFace regravava; foi desativado em #504).
   *
   * Arena Positiva: 4 / 0 / 6. Leitor: 0 desabilitado, 1 so entrada, 2 so
   * saida, 3 entrada e saida, 4 entrada e saida invertido, 5 so entrada
   * invertido, 6 so saida invertido. Acionamento: 0 desabilitado, 1 libera
   * entrada e saida, 2 entrada, 3 saida, 4 sirene, 5 revista, 6 giro de
   * saida livre, 7 giro de entrada livre, 8 ambos livres. O tempo do
   * acionamento vem de `CATRACA_TEMPO_LIBERADA_S`.
   */
  CATRACA_LEITOR1: numeroOpcional(6),
  CATRACA_LEITOR2: numeroOpcional(6),
  CATRACA_ACIONAMENTO1: numeroOpcional(8),
});

export type Config = z.infer<typeof esquemaConfig>;

/** Campos que nunca aparecem em log, diagnostico ou mensagem de erro. */
const CAMPOS_SECRETOS = [
  'COLLECTOR_HMAC_SECRET',
  'CLOUD_EDGE_SECRET',
  'EDGE_PAIRING_CODE',
] as const satisfies readonly (keyof Config)[];

export class ConfigInvalidaError extends Error {
  readonly code = 'EDGE_CONFIG_INVALIDA';

  constructor(readonly problemas: readonly string[]) {
    super(`Configuracao invalida:\n${problemas.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigInvalidaError';
  }
}

/**
 * Valida a configuracao. Falha alto e com a lista inteira de problemas --
 * corrigir um erro por vez, reiniciando o processo a cada tentativa, e o
 * que faz alguem desistir do runbook.
 *
 * A mensagem de erro NAO inclui o valor recebido: um segredo malformado
 * ainda e um segredo.
 */
export function carregarConfig(bruto: unknown = process.env): Config {
  const resultado = esquemaConfig.safeParse(bruto);

  if (!resultado.success) {
    throw new ConfigInvalidaError(
      resultado.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
    );
  }

  const config = resultado.data;
  const definidos = [
    config.CATRACA_LEITOR1,
    config.CATRACA_LEITOR2,
    config.CATRACA_ACIONAMENTO1,
  ].filter((v) => v !== undefined).length;
  if (definidos !== 0 && definidos !== 3) {
    throw new ConfigInvalidaError([
      'CATRACA_LEITOR1, CATRACA_LEITOR2 e CATRACA_ACIONAMENTO1: defina os tres ou nenhum',
    ]);
  }

  return config;
}

/**
 * Visao da config segura para log e diagnostico.
 *
 * Segredo presente vira `'***'`; ausente vira `'(nao definido)'`. A
 * diferenca importa: "nao configurei" e "configurei errado" sao problemas
 * distintos, e esconder os dois do mesmo jeito atrapalha o diagnostico sem
 * proteger nada a mais.
 */
export function descreverConfig(config: Config): Record<string, string> {
  const visao: Record<string, string> = {};

  // Itera sobre as chaves do SCHEMA, nao sobre as presentes no objeto. Campo
  // opcional ausente nao aparece em Object.entries -- e some da visao
  // justamente quando dizer "(nao definido)" seria mais util.
  for (const chave of Object.keys(esquemaConfig.shape)) {
    const valor = (config as Record<string, unknown>)[chave];

    if (valor === undefined) {
      visao[chave] = '(nao definido)';
      continue;
    }

    if ((CAMPOS_SECRETOS as readonly string[]).includes(chave)) {
      visao[chave] = '***';
      continue;
    }

    // Nunca `String(valor)` cru: sobre objeto isso vira "[object Object]",
    // que num diagnostico e pior que campo ausente -- parece informacao e
    // nao e. Toda config e primitiva; o `else` existe para o dia em que
    // alguem adicionar um campo composto e o diagnostico avisar em vez de
    // mentir.
    visao[chave] =
      typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean'
        ? String(valor)
        : JSON.stringify(valor);
  }

  return visao;
}
