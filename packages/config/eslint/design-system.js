/**
 * As 6 regras de lint do design system -- docs/design/DS-PAINEL.md §11.
 *
 * Cada regra faz valer mecanicamente uma linha do contrato de design. Regra
 * que so existe em documento nao vale: e a mesma tese do eslint/base.js.
 *
 * A regra 4 (contraste) NAO esta aqui -- ela nao e sintatica. Vive no
 * pipeline de tokens (`packages/ui/scripts/build-tokens.mjs`), que falha o
 * build quando um par texto/superficie fica abaixo do alvo. Fica registrada
 * abaixo como comentario para que a numeracao do documento continue batendo
 * com o codigo; quem procurar "regra 4" aqui precisa achar para onde ela foi.
 *
 * COMO LIGAR, no eslint.config.js do workspace de UI:
 *
 *   import base from '@arenahub/config/eslint';
 *   import ds from '@arenahub/config/eslint/design-system';
 *
 *   export default [...base, ...ds];
 *
 * O proprio `packages/ui/tokens/**` fica de fora: e a unica fonte legitima de
 * hex no repositorio, e a regra 1 existe justamente para manter assim.
 */

/**
 * Os componentes que as regras 5 e 6 existem para PROTEGER.
 *
 * Uma regra que diz "so dentro de TenantDateTime" precisa deixar o proprio
 * `TenantDateTime` formatar data -- senao o unico lugar autorizado do
 * repositorio e o unico que nao consegue fazer o trabalho, e a saida vira um
 * `eslint-disable` solto, que e exatamente o que a regra queria impedir.
 *
 * A lista e nominal e curta de proposito: um glob generoso (`**\/*[Dd]ate*`)
 * abriria a excecao para qualquer arquivo com "date" no nome.
 */
const FORMATADORES_AUTORIZADOS = [
  '**/TenantDateTime.tsx',
  '**/TenantDateTime.spec.tsx',
  '**/Money.tsx',
  '**/Money.spec.tsx',
  /**
   * F53 Task 12 -- `situacaoDeVencimento` compara o DIA da invoice contra o
   * DIA de agora no fuso da unidade (nunca o instante, ver o cabecalho do
   * proprio arquivo). Sem biblioteca de data nova permitida nesta fatia, a
   * unica forma de obter o dia civil num fuso IANA em JS puro e
   * `Intl.DateTimeFormat(...).formatToParts()` -- mesma tecnica que
   * `apps/api/.../bloqueio-por-inadimplencia.ts` ja usa no backend para o
   * mesmo problema (ADR-019). A funcao nunca formata texto para tela; so
   * decide o enum que os componentes de UI (esses sim, `TenantDateTime`)
   * depois exibem.
   */
  '**/vencimento.ts',
  '**/vencimento.test.ts',
  /**
   * FIX #379 -- `periodoPadraoDeEventos` calcula as ultimas 24h no FUSO DA
   * ACADEMIA para preencher `De`/`Ate` como valor inicial do filtro de
   * eventos de acesso. A API ja abre o periodo assim (`PERIODO_PADRAO_HORAS`)
   * mas nunca devolve o calculo na resposta; sem preencher, o operador via os
   * campos em branco com a lista cheia. Mesma tecnica de `vencimento.ts`.
   */
  '**/periodo-padrao.ts',
  '**/periodo-padrao.test.ts',
];

/** Arquivos onde `--ah-action-*` e proibido -- regra 3. */
const ESTADO_FILES = [
  '**/*[Bb]adge*.{ts,tsx}',
  '**/*[Aa]lert*.{ts,tsx}',
  '**/*[Tt]oast*.{ts,tsx}',
  '**/*[Ss]tate*.{ts,tsx}',
  '**/*[Cc]hart*.{ts,tsx}',
  '**/*[Rr]isk*.{ts,tsx}',
];

export default [
  {
    ignores: ['**/tokens/**', '**/*.generated.ts', '**/dist-tokens/**'],
  },

  {
    rules: {
      'no-restricted-syntax': [
        'error',

        // --- Regra 1: hex literal fora de packages/ui/tokens e erro --------
        // O protagonista silencioso desta regra sao os .dc.html de
        // docs/design/: eles sao PROTOTIPO VISUAL, nao codigo a instalar
        // (ADR-026 decisao 2). Colar um deles despeja dezenas de hex literais
        // -- e e exatamente o atalho que esta regra intercepta.
        {
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message:
            'Hex literal fora de packages/ui/tokens (regra 1 do DS §11). ' +
            'Use a variavel semantica: var(--ah-text-secondary). ' +
            'Os .dc.html de docs/design/ sao prototipo visual, nao codigo a colar.',
        },
        {
          selector:
            'TemplateElement[value.raw=/#[0-9a-fA-F]{6}\\b/]',
          message:
            'Hex literal em template string (regra 1 do DS §11). ' +
            'Use a variavel semantica.',
        },

        // --- Regra 2: componente nao le token primitivo -------------------
        // Primitivo e valor bruto; semantico e papel. Um componente que le
        // --ah-carbon-700 direto congela a decisao "esta cor" no lugar de
        // "este papel" -- e na proxima mudanca de paleta ele nao acompanha.
        {
          selector: 'Literal[value=/--ah-carbon-/]',
          message:
            'Componente nao le token primitivo (regra 2 do DS §11). ' +
            '--ah-carbon-* e valor bruto: use o papel (--ah-text-*, ' +
            '--ah-surface-*, --ah-border-*).',
        },
        {
          selector: 'Literal[value=/--ah-accent-[0-9]/]',
          message:
            'Componente nao le tom de accent direto (regra 2 do DS §11). ' +
            'Use --ah-action-solid, --ah-action-text ou --ah-focus-ring: ' +
            'eles sao RESOLVIDOS POR CONTRASTE e acompanham o seed do tenant.',
        },
        {
          selector: 'TemplateElement[value.raw=/--ah-(carbon-|accent-[0-9])/]',
          message:
            'Componente nao le token primitivo (regra 2 do DS §11).',
        },

        // --- Regra 5: `toLocaleString` fora de TenantDateTime -------------
        // Data e hora seguem o timezone da UNIDADE, nunca o do navegador. Uma
        // recepcionista em outro fuso lendo o horario da propria maquina toma
        // decisao de acesso sobre um horario que nao existe na academia.
        {
          selector:
            'CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]',
          message:
            'Formatacao de data/hora so dentro de TenantDateTime (regra 5 do ' +
            'DS §11). O timezone e o da UNIDADE, nunca o do navegador.',
        },
        {
          selector: 'NewExpression[callee.object.name="Intl"][callee.property.name="DateTimeFormat"]',
          message:
            'Intl.DateTimeFormat so dentro de TenantDateTime (regra 5 do DS §11). ' +
            'O timezone da unidade tem de ser passado explicitamente.',
        },

        // --- Regra 6: aritmetica de moeda fora de Money -------------------
        // Complementa @arenahub/config/eslint/money, que pega o literal
        // decimal. Aqui cai a formatacao de moeda solta, que e o outro jeito
        // de dinheiro virar float sem ninguem ver.
        {
          selector:
            'CallExpression[callee.property.name="toLocaleString"] > ObjectExpression Property[key.name="currency"]',
          message:
            'Formatacao de moeda so dentro de Money (regra 6 do DS §11). ' +
            'Dinheiro e inteiro na menor unidade monetaria (M2-BR-001).',
        },
      ],
    },
  },

  // --- Excecao nominal das regras 5 e 6 ---------------------------------
  // `TenantDateTime` e `Money` sao os componentes que estas duas regras
  // existem para proteger: a mensagem de cada uma diz "so dentro de X". Sem
  // esta excecao, X e o unico arquivo do repositorio proibido de fazer o
  // trabalho que so ele pode fazer.
  //
  // Desliga so `no-restricted-syntax`, e so nestes quatro arquivos. Todo o
  // resto das regras continua valendo neles.
  {
    files: FORMATADORES_AUTORIZADOS,
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // --- Regra 3: accent do tenant nunca veste estado ---------------------
  // Escopo estreito de proposito: `--ah-action-*` e LEGITIMO num botao. O que
  // nao pode e um badge de ALLOW/DENY, um alerta ou uma faixa de risco vestir
  // a cor da academia -- estado tem tom fixo, senao dois tenants leem a mesma
  // tela com significados diferentes (DS-PAINEL.md §2.3).
  {
    files: ESTADO_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/--ah-action-/]',
          message:
            'Accent do tenant e proibido em badge, alerta, toast, grafico de ' +
            'estado e faixa de risco (regra 3 do DS §11). Estado usa tom ' +
            'semantico FIXO: --ah-state-success, --ah-state-danger, etc.',
        },
        {
          selector: 'TemplateElement[value.raw=/--ah-action-/]',
          message:
            'Accent do tenant e proibido em componente de estado (regra 3 do DS §11).',
        },
      ],
    },
  },
];
