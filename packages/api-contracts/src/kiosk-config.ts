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
  }),
});

export type KioskConfig = z.infer<typeof kioskConfigSchema>;

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
const kioskConfigSchemaParcial = z.object({
  marca: kioskConfigSchema.shape.marca.partial().optional(),
  aparencia: kioskConfigSchema.shape.aparencia.partial().optional(),
  sessao: kioskConfigSchema.shape.sessao.partial().optional(),
  identificacao: kioskConfigSchema.shape.identificacao.partial().optional(),
  modulos: kioskConfigSchema.shape.modulos.partial().optional(),
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
