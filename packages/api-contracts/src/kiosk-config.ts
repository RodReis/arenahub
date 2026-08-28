import { z } from 'zod';

/**
 * Contrato de configuracao do totem.
 *
 * Cobre o `DS-TOTEM.md` §7.2 INTEIRO, embora a F49 so leia: a F50 escreve
 * nele, e um contrato parcial obrigaria a reabrir a tabela (ADR-042,
 * Decisao 0).
 *
 * O que NAO entra aqui e tao importante quanto o que entra -- a lista
 * fechada do nao-configuravel esta na Decisao 6 do ADR-042: tipografia,
 * escala, alvo de toque, contraste 7:1, light mode, comportamento de
 * encerramento, a frase publica de DENY, a assinatura do ArenaHub.
 */

/** Escolha entre quatro, nunca hex livre (ADR-042, Decisao 6). */
export const ACCENTS_DO_TOTEM = ['AZUL', 'VERDE', 'LARANJA', 'ROXO'] as const;

/** Os cinco tipos de bloco da tela publica (F51, issue #152). */
export const TIPOS_DE_BLOCO = [
  'VIDEO',
  'EVENTOS',
  'MATERIAL',
  'INSTAGRAM',
  'INFORMACOES',
] as const;

export type TipoDeBloco = (typeof TIPOS_DE_BLOCO)[number];

/** Tempo por bloco no rodizio -- lista fechada (`M3.5-FR-004`). */
export const TEMPOS_POR_BLOCO = [8, 12, 20, 30] as const;

/** Ate 6 marcas por unidade (ADR-042, Decisao 4). */
export const MAXIMO_DE_PATROCINADORES = 6;

/** Rotulo obrigatorio da faixa -- vazio cai neste padrao, nunca em nada. */
export const ROTULO_PADRAO_DE_PATROCINIO = 'Espaço patrocinado';

const blocoBaseSchema = z.object({
  /** Estavel entre publicacoes: e a chave de React e o alvo do reordenar. */
  id: z.string().min(1),
  habilitado: z.boolean(),
});

/**
 * Video da tela publica.
 *
 * `midiaKey` e `linkExterno` sao ORIGENS ALTERNATIVAS, nao um par: a chave
 * aponta para o MP4 ja no object storage; o link e o reel do Instagram, que
 * na F51 nao tem adapter (decisao 1 do PI de 26/08/2026) e fica gravado
 * esperando a fatia INFRA. O contrato ja o aceita para que a chegada do
 * adapter nao mexa em tabela, contrato nem tela (ADR-042, Decisao 0).
 *
 * `legenda` nao e opcional por acidente: `DS-TOTEM.md` §4 exige video SEM SOM
 * e COM LEGENDA -- a recepcao nao tem audio confiavel. Campo opcional
 * produziria video mudo e sem texto, que nao comunica nada.
 */
const blocoVideoSchema = blocoBaseSchema.extend({
  tipo: z.literal('VIDEO'),
  titulo: z.string().min(1),
  legenda: z.string().min(1),
  midiaKey: z.string().nullable(),
  linkExterno: z.string().url().nullable(),
  /**
   * URL assinada, preenchida pela API no BOOT e nunca gravada.
   *
   * Campo separado de `midiaKey` -- e nao a chave sobrescrita com a URL --
   * porque os dois tem donos opostos: a CHAVE e escrita pelo painel e vive
   * na versao publicada; a URL e derivada, expira em uma hora e nao pertence
   * a configuracao. Sobrescrever a chave faria o proximo `PUT` do painel
   * gravar uma URL expirada onde deveria haver chave, e o video sumiria da
   * tela sem que ninguem tivesse mexido nele.
   *
   * Opcional no schema porque o PAINEL nunca o envia: so a resposta do
   * `GET /api/v1/kiosk/config` o traz.
   */
  midiaUrl: z.string().nullable().optional(),
});

const blocoEventosSchema = blocoBaseSchema.extend({
  tipo: z.literal('EVENTOS'),
  titulo: z.string().min(1),
  itens: z
    .array(
      z.object({
        /** Data em ISO `YYYY-MM-DD`: o totem so a formata, nunca a calcula. */
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        titulo: z.string().min(1),
        informacao: z.string(),
      }),
    )
    .max(4),
});

const blocoMaterialSchema = blocoBaseSchema.extend({
  tipo: z.literal('MATERIAL'),
  titulo: z.string().min(1),
  resumo: z.string(),
  /** Vira QR na tela -- quem le, le no proprio celular. */
  urlDoQr: z.string().url(),
});

const blocoInstagramSchema = blocoBaseSchema.extend({
  tipo: z.literal('INSTAGRAM'),
  perfil: z.string().min(1),
  chamada: z.string(),
});

/**
 * Indicadores da unidade.
 *
 * NAO carrega valor: o numero vem do heartbeat (`IndicadoresDaUnidade`) e
 * expira com ele. Guardar numero na config publicada congelaria um valor de
 * ontem numa versao imutavel -- e o gerente teria de republicar para o
 * contador andar.
 */
const blocoInformacoesSchema = blocoBaseSchema.extend({
  tipo: z.literal('INFORMACOES'),
  titulo: z.string().min(1),
  mostrarCheckinsDeHoje: z.boolean(),
  mostrarTreinandoAgora: z.boolean(),
});

export const blocoDaTelaPublicaSchema = z.discriminatedUnion('tipo', [
  blocoVideoSchema,
  blocoEventosSchema,
  blocoMaterialSchema,
  blocoInstagramSchema,
  blocoInformacoesSchema,
]);

export type BlocoDaTelaPublica = z.infer<typeof blocoDaTelaPublicaSchema>;

/**
 * Uma linha do placar publico -- SEM `studentId` (M5-AC-001).
 *
 * Fonte unica do formato: `EngagementRankingService` (apps/api) importa e
 * reexporta este mesmo tipo, em vez de declarar uma copia estrutural. O
 * placar e dado publico que atravessa o heartbeat ate a tela do totem
 * (F51), e duas definicoes do mesmo formato divergem na primeira mudanca.
 */
export const entradaPublicaDoPlacarSchema = z.object({
  position: z.number().int().positive(),
  nomeExibido: z.string().min(1),
  points: z.number().int(),
});

export type EntradaPublicaDoPlacar = z.infer<typeof entradaPublicaDoPlacarSchema>;

/**
 * Indicadores da unidade, servidos pelo heartbeat -- nunca gravados na
 * config. `M3.5-BR-001` proibe dado de aluno na tela publica: os dois
 * inteiros nao carregam identidade nenhuma, e `placar` so carrega o que
 * `resolverExposicao()` ja filtrou e resolveu no SERVIDOR -- nome exibido,
 * nunca `studentId`. Modulo `xp` desligado ou placar retido chega como
 * lista vazia, nunca ausente.
 */
export const indicadoresDaUnidadeSchema = z.object({
  checkinsDeHoje: z.number().int().nonnegative(),
  treinandoAgora: z.number().int().nonnegative(),
  placar: z.array(entradaPublicaDoPlacarSchema),
});

export type IndicadoresDaUnidade = z.infer<typeof indicadoresDaUnidadeSchema>;

export const kioskConfigSchema = z.object({
  marca: z.object({
    nomeDaAcademia: z.string().min(1),
    nomeDaUnidade: z.string().min(1),
    slogan: z.string(),
    logotipoUrl: z.string().url().nullable(),
  }),
  aparencia: z.object({
    accent: z.enum(ACCENTS_DO_TOTEM),
    /** Padrao de BOOT da unidade. O botao do aluno vence durante a sessao. */
    altoContrastePadrao: z.boolean(),
  }),
  sessao: z.object({
    duracaoSegundos: z.union([
      z.literal(45),
      z.literal(60),
      z.literal(90),
      z.literal(120),
    ]),
    incrementoSegundos: z.literal(30),
    tetoSegundos: z.literal(99),
    avisoSonoroNaRecusa: z.boolean(),
  }),
  identificacao: z.object({
    cpf: z.boolean(),
    facial: z.boolean(),
    qrCodeDoApp: z.boolean(),
  }),
  modulos: z.object({
    pagamento: z.boolean(),
    historicoDePagamentos: z.boolean(),
    avaliacao: z.boolean(),
    evolucao: z.boolean(),
    historicoDeAvaliacoes: z.boolean(),
    ranking: z.boolean(),
    xp: z.boolean(),
    /**
     * Desafios na area do aluno (F34, Slice 5.5, ADR-048).
     *
     * Config ja publicada NAO tem esta chave, e nao precisa ter: `sobrepor`
     * mescla a camada sobre o padrao, e ausente herda `false`. Nenhuma
     * republicacao e exigida de quem ja configurou o totem -- o modulo nasce
     * desligado, como todos os outros (`M5-BR-001`).
     */
    desafios: z.boolean(),
  }),
  /**
   * Tela publica (F51). A ORDEM DO ARRAY E A ORDEM DO RODIZIO -- nao ha
   * campo `ordem` a manter em sincronia, e reordenar e mover no array.
   * Campo `ordem` separado permitiria dois blocos com o mesmo numero, e o
   * desempate cairia na ordem fisica -- que e exatamente o defeito que
   * `include-sem-orderby-embaralha` documenta.
   */
  blocos: z.object({
    tempoPorBlocoSegundos: z.union([
      z.literal(8),
      z.literal(12),
      z.literal(20),
      z.literal(30),
    ]),
    itens: z.array(blocoDaTelaPublicaSchema).max(TIPOS_DE_BLOCO.length),
  }),
  /**
   * Faixa de patrocinadores (ADR-042, Decisao 4).
   *
   * VITRINE, NAO MIDIA: nao ha campo de periodo, de campanha, de contador
   * nem de destino de clique -- e a ausencia deles no CONTRATO que impede o
   * contador de aparecer "em silencio" depois. Acrescentar qualquer um
   * exige ADR proprio, que e o gatilho que a Decisao 4 escreveu.
   */
  patrocinio: z.object({
    habilitado: z.boolean(),
    /** Vazio nao apaga o rotulo: cai em `ROTULO_PADRAO_DE_PATROCINIO`. */
    rotulo: z.string(),
    marcas: z
      .array(
        z.object({
          nome: z.string().min(1),
          logotipoUrl: z.string().url().nullable(),
        }),
      )
      .max(MAXIMO_DE_PATROCINADORES),
  }),
});

export type KioskConfig = z.infer<typeof kioskConfigSchema>;

/**
 * O rotulo que a faixa exibe -- `M3.5-BR-006` e CDC art. 36.
 *
 * PURA e exportada porque a REGRA e uma so e os dois lados a aplicam: o
 * painel para pre-visualizar, o totem para exibir. Duas implementacoes de
 * "vazio cai no padrao" divergiriam no primeiro `trim()` esquecido.
 */
export function rotuloDePatrocinio(configurado: string): string {
  const limpo = configurado.trim();

  return limpo === '' ? ROTULO_PADRAO_DE_PATROCINIO : limpo;
}

/**
 * Os blocos que entram no rodizio, na ordem publicada.
 *
 * PURA: entra config, sai lista. Desabilitado nao entra; a ordem e a do
 * array. Existe como funcao — e nao como filtro inline na tela — porque o
 * painel pre-visualiza a MESMA sequencia que o totem roda.
 */
export function blocosEmRodizio(config: KioskConfig): readonly BlocoDaTelaPublica[] {
  return config.blocos.itens.filter((bloco) => bloco.habilitado);
}

/**
 * O padrao que a F49 entrega enquanto a F50 nao existe para escrever.
 *
 * Modulo desligado nao e omissao: e a Decisao 5 do ADR-042 (trava 2) --
 * modulo cuja fatia de origem nao entregou NAO aparece. Na F49 nenhum
 * entregou. `facial` e `qrCodeDoApp` estao desligados por decisao do PI de
 * 25/08/2026.
 */
export const CONFIG_PADRAO_DO_TOTEM: KioskConfig = {
  marca: {
    nomeDaAcademia: 'ArenaHub',
    nomeDaUnidade: 'Unidade',
    slogan: '',
    logotipoUrl: null,
  },
  aparencia: {
    accent: 'AZUL',
    altoContrastePadrao: false,
  },
  sessao: {
    duracaoSegundos: 60,
    incrementoSegundos: 30,
    tetoSegundos: 99,
    avisoSonoroNaRecusa: true,
  },
  identificacao: {
    cpf: true,
    facial: false,
    qrCodeDoApp: false,
  },
  modulos: {
    pagamento: false,
    historicoDePagamentos: false,
    avaliacao: false,
    evolucao: false,
    historicoDeAvaliacoes: false,
    ranking: false,
    xp: false,
    desafios: false,
  },
  /**
   * Nenhum bloco por padrao. O `DS-TOTEM.md` §4 ja cobre este estado -- "se
   * todos os blocos opcionais estiverem desligados, hero e CTA se distribuem
   * com o espaco restante". Um bloco de exemplo no padrao apareceria na tela
   * de quem nunca configurou nada, com texto que a academia nao escreveu.
   */
  blocos: {
    tempoPorBlocoSegundos: 12,
    itens: [],
  },
  patrocinio: {
    habilitado: false,
    rotulo: '',
    marcas: [],
  },
};

export interface KioskConfigLayers {
  readonly tenant?: unknown;
  readonly unidade?: unknown;
  readonly dispositivo?: unknown;
}

// Zod 4 removeu `.deepPartial()` (instancia e global) -- footgun conhecido,
// sem substituto direto (changelog oficial). Como nenhuma secao do schema
// tem aninhamento alem de 1 nivel, um partial RASO em cada secao equivale
// a um deep partial aqui: cada secao vira opcional, e por dentro dela cada
// campo tambem vira opcional.
//
// `blocos` e `patrocinio` seguem a MESMA regra rasa, e a consequencia esta
// nos ARRAYS: camada que define `itens` SUBSTITUI a lista inteira da camada
// de baixo -- nao concatena. E o que se quer: a unidade que monta a propria
// tela publica nao herda metade dos blocos do tenant intercalados com os
// seus. Concatenar produziria ordem de rodizio que ninguem definiu.
const kioskConfigSchemaParcial = z.object({
  marca: kioskConfigSchema.shape.marca.partial().optional(),
  aparencia: kioskConfigSchema.shape.aparencia.partial().optional(),
  sessao: kioskConfigSchema.shape.sessao.partial().optional(),
  identificacao: kioskConfigSchema.shape.identificacao.partial().optional(),
  modulos: kioskConfigSchema.shape.modulos.partial().optional(),
  blocos: kioskConfigSchema.shape.blocos.partial().optional(),
  patrocinio: kioskConfigSchema.shape.patrocinio.partial().optional(),
});

/**
 * Sobrepoe em `base` so as chaves de `camada` que nao sao `undefined`.
 *
 * O parse com `.partial()` tipa cada campo como `T | undefined`; um spread
 * direto desse resultado sobrescreveria o campo da base com `undefined`
 * caso a chave viesse presente e vazia. `Object.assign` malha aqui porque
 * so define no destino as chaves realmente presentes em `camada` -- e o
 * filtro `!== undefined` remove as que vieram vazias antes disso.
 *
 * Cast estreito: apos o filtro, o valor de cada chave restante e sempre
 * `T[K]` (nunca `undefined`) -- e o que o filtro acima garante em runtime,
 * mas o TS nao consegue provar so pela assinatura de `Object.fromEntries`.
 */
function sobrepor<T extends Record<string, unknown>>(
  base: T,
  camada: Record<string, unknown> | undefined,
): T {
  if (!camada) return base;

  const definidos = Object.fromEntries(
    Object.entries(camada).filter(([, valor]) => valor !== undefined),
  ) as Partial<T>;

  return { ...base, ...definidos };
}

/** Mescla um nivel de profundidade: `sessao` inteira nao apaga `marca`. */
function mesclar(base: KioskConfig, camada: unknown): KioskConfig {
  const parcial = kioskConfigSchemaParcial.safeParse(camada);

  // Camada invalida e IGNORADA em vez de derrubar a resolucao: um payload
  // torto no banco nao pode apagar a tela do totem.
  if (!parcial.success) return base;

  const dados = parcial.data;

  return {
    marca: sobrepor(base.marca, dados.marca),
    aparencia: sobrepor(base.aparencia, dados.aparencia),
    sessao: sobrepor(base.sessao, dados.sessao),
    identificacao: sobrepor(base.identificacao, dados.identificacao),
    modulos: sobrepor(base.modulos, dados.modulos),
    blocos: sobrepor(base.blocos, dados.blocos),
    patrocinio: sobrepor(base.patrocinio, dados.patrocinio),
  };
}

/**
 * Resolve as tres camadas (ADR-042, Decisao 8) -- a mais especifica vence.
 *
 * PURA: sem banco, sem relogio, sem rede.
 */
export function resolverConfig(camadas: KioskConfigLayers): KioskConfig {
  return [camadas.tenant, camadas.unidade, camadas.dispositivo].reduce<KioskConfig>(
    (acumulado, camada) => (camada === undefined ? acumulado : mesclar(acumulado, camada)),
    CONFIG_PADRAO_DO_TOTEM,
  );
}
