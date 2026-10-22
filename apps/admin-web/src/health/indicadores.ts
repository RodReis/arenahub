import type { TomDeEstado } from '@arenahub/ui';

/**
 * Indicadores da ficha de avaliação física — F91 (SPEC-091).
 *
 * Fórmulas, faixas e observações copiadas das três páginas que o PI entregou
 * em 22/10/2026 (*Indicadores antropométricos, cardiovasculares e perfusão*).
 * A ficha INTERPRETA pela tabela por decisão do PI (ADR-066): cada leitura é
 * referência, não diagnóstico, e menor de 18 anos nunca recebe ponto de corte
 * adulto — a própria tabela manda usar a referência pediátrica.
 *
 * Funções puras: sem relógio, sem rede. A idade entra pronta.
 *
 * ponytail: mora no admin-web porque só o painel desenha a ficha hoje; o app
 * do professor (mobile, depois) leva este arquivo para `packages/` quando
 * precisar dele, em vez de copiar as faixas.
 */

export type Sexo = 'MALE' | 'FEMALE';

/** O que a tabela diz sobre um valor. */
export interface Leitura {
  /** Texto da coluna "Referência / Interpretação". */
  readonly classe: string;
  readonly tom: TomDeEstado;
  /** Só na faixa que a tabela manda avaliar na hora (PA ≥ 180/120). */
  readonly alerta?: boolean;
}

export interface Perfil {
  /** `null` quando o cadastro não informa: a faixa por sexo não se aplica. */
  readonly sexo: Sexo | null;
  /** Anos completos na data da avaliação. `null` sem nascimento. */
  readonly idade: number | null;
}

/** O que o professor digita. `null` é campo vazio, nunca zero. */
export interface Entradas {
  readonly pesoKg: number | null;
  readonly estaturaCm: number | null;
  readonly cinturaCm: number | null;
  readonly quadrilCm: number | null;
  readonly gorduraPct: number | null;
  readonly pas: number | null;
  readonly pad: number | null;
  readonly fcRepouso: number | null;
  readonly vo2max: number | null;
}

export type Equacao = 'TRADICIONAL' | 'TANAKA';

export interface Indicador {
  readonly valor: number | null;
  readonly leitura: Leitura | null;
  /** Faixas da tabela para desenhar. `null` quando não há régua adulta. */
  readonly regua: Regua | null;
  /** Onde o marcador pousa, quando não é o próprio valor (PA: a categoria). */
  readonly naRegua?: number | null;
}

export interface ZonaDeTreino {
  readonly de: number;
  readonly ate: number;
  readonly rotulo: string;
  readonly bpmDe: number;
  readonly bpmAte: number;
}

export interface Indicadores {
  readonly imc: Indicador;
  readonly cintura: Indicador;
  readonly rce: Indicador;
  readonly rcq: Indicador;
  readonly gordura: Indicador;
  readonly massaGorda: Indicador;
  readonly massaMagra: Indicador;
  readonly pa: Indicador;
  readonly pam: Indicador;
  readonly fcRepouso: Indicador;
  readonly fcMaxTradicional: number | null;
  readonly fcMaxTanaka: number | null;
  readonly rfc: number | null;
  readonly zonas: readonly ZonaDeTreino[];
  readonly vo2max: Indicador;
}

/** Idade em que as tabelas deixam de ser pediátricas. */
export const IDADE_ADULTA = 18;

const PEDIATRICO: Leitura = {
  classe: 'Usar referência pediátrica por idade e sexo',
  tom: 'neutral',
};

const SEM_SEXO: Leitura = {
  classe: 'Sexo não informado no cadastro — faixa depende do sexo',
  tom: 'neutral',
};

/** Arredonda para as casas que a tela mostra — classificar e exibir o mesmo número. */
function casas(valor: number, digitos: number): number {
  const fator = 10 ** digitos;

  return Math.round(valor * fator) / fator;
}

function ehAdulto(perfil: Perfil): boolean {
  return perfil.idade !== null && perfil.idade >= IDADE_ADULTA;
}

/**
 * Hoje no fuso de Brasília (`AAAA-MM-DD`).
 *
 * ponytail: deslocamento fixo de -3 h (o Brasil não tem horário de verão
 * desde 2019); academia em outro fuso troca isto pelo fuso da unidade.
 */
export function hojeEmBrasilia(agora: number = Date.now()): string {
  return new Date(agora - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Anos completos entre o nascimento e a data da avaliação (`AAAA-MM-DD`). */
export function idadeEm(nascimento: string, data: string): number | null {
  const [an, mn, dn] = nascimento.slice(0, 10).split('-').map(Number);
  const [aa, ma, da] = data.slice(0, 10).split('-').map(Number);

  if ([an, mn, dn, aa, ma, da].some((parte) => parte === undefined || Number.isNaN(parte))) {
    return null;
  }

  const fezAniversario = ma! > mn! || (ma === mn && da! >= dn!);
  const idade = aa! - an! - (fezAniversario ? 0 : 1);

  return idade >= 0 ? idade : null;
}

/** Uma linha da tabela: vale enquanto o valor estiver abaixo de `ate` (`null` = sem teto). */
export interface Faixa {
  readonly ate: number | null;
  readonly leitura: Leitura;
}

/**
 * A tabela como régua: as faixas e o trecho do eixo que a tela desenha.
 *
 * A MESMA lista classifica o valor e desenha a régua — limiar escrito duas
 * vezes divergiria no primeiro ajuste, e a régua mostraria o aluno numa faixa
 * enquanto o rótulo diz outra.
 */
export interface Regua {
  readonly faixas: readonly Faixa[];
  readonly min: number;
  readonly max: number;
  /** Eixo de CATEGORIA, não de número: sem marcos numéricos (PA). */
  readonly categorica?: boolean;
}

export type Medidor = 'imc' | 'cintura' | 'rce' | 'rcq' | 'gordura' | 'pam' | 'fcRepouso';

const MENOR_RISCO = 'Menor risco';

function faixas(...linhas: [number | null, string, TomDeEstado][]): readonly Faixa[] {
  return linhas.map(([ate, classe, tom]) => ({ ate, leitura: { classe, tom } }));
}

/** Régua por sexo: sem sexo no cadastro, a faixa não se aplica. */
function porSexo(perfil: Perfil, homem: Regua, mulher: Regua): Regua | null {
  if (perfil.sexo === null) return null;

  return perfil.sexo === 'MALE' ? homem : mulher;
}

/** Leitura de quem não tem régua adulta: o que a tabela manda fazer no lugar. */
const SEM_REGUA_ADULTA: Readonly<Record<Medidor, Leitura>> = {
  imc: PEDIATRICO,
  cintura: PEDIATRICO,
  rce: { classe: 'Triagem por 0,50; percentis por idade podem ser preferíveis', tom: 'neutral' },
  rcq: PEDIATRICO,
  gordura: PEDIATRICO,
  pam: { classe: 'Sem faixa única: interpretar pela idade e condição clínica', tom: 'neutral' },
  fcRepouso: { classe: 'FC é idade-dependente: usar tabela pediátrica', tom: 'neutral' },
};

/** Régua adulta do indicador. `null` para menor de 18 ou sexo ausente. */
export function reguaDe(medidor: Medidor, perfil: Perfil): Regua | null {
  if (!ehAdulto(perfil)) return null;

  switch (medidor) {
    // 1. IMC
    case 'imc':
      return {
        min: 15,
        max: 45,
        faixas: faixas(
          [18.5, 'Baixo peso', 'warning'],
          [25, 'Eutrofia', 'success'],
          [30, 'Sobrepeso', 'warning'],
          [35, 'Obesidade grau I', 'danger'],
          [40, 'Obesidade grau II', 'danger'],
          [null, 'Obesidade grau III', 'danger'],
        ),
      };
    // 2. Circunferência da cintura
    case 'cintura':
      return porSexo(
        perfil,
        {
          min: 70,
          max: 120,
          faixas: faixas(
            [94, MENOR_RISCO, 'success'],
            [102, 'Risco aumentado', 'warning'],
            [null, 'Risco substancialmente aumentado', 'danger'],
          ),
        },
        {
          min: 60,
          max: 110,
          faixas: faixas(
            [80, MENOR_RISCO, 'success'],
            [88, 'Risco aumentado', 'warning'],
            [null, 'Risco substancialmente aumentado', 'danger'],
          ),
        },
      );
    // 3. Relação cintura/estatura
    case 'rce':
      return {
        min: 0.3,
        max: 0.7,
        faixas: faixas(
          [0.4, 'Muito baixa', 'info'],
          [0.5, 'Geralmente favorável', 'success'],
          [0.6, 'Risco aumentado', 'warning'],
          [null, 'Risco elevado', 'danger'],
        ),
      };
    // 4. Relação cintura/quadril
    case 'rcq':
      return porSexo(
        perfil,
        {
          min: 0.7,
          max: 1.1,
          faixas: faixas([0.9, MENOR_RISCO, 'success'], [null, 'Maior risco cardiometabólico', 'warning']),
        },
        {
          min: 0.65,
          max: 1.05,
          faixas: faixas([0.85, MENOR_RISCO, 'success'], [null, 'Maior risco cardiometabólico', 'warning']),
        },
      );
    // 5. Percentual de gordura
    case 'gordura':
      return porSexo(
        perfil,
        {
          min: 0,
          max: 35,
          faixas: faixas(
            [6, 'Muito baixo', 'warning'],
            [14, 'Atlético', 'success'],
            [18, 'Fitness', 'success'],
            [25, 'Adequado', 'success'],
            [null, 'Elevado', 'warning'],
          ),
        },
        {
          min: 8,
          max: 42,
          faixas: faixas(
            [14, 'Muito baixo', 'warning'],
            [21, 'Atlético', 'success'],
            [25, 'Fitness', 'success'],
            [32, 'Adequado', 'success'],
            [null, 'Elevado', 'warning'],
          ),
        },
      );
    // 9. Pressão arterial média — 70 a 100 inclusive (PAM sai inteira).
    case 'pam':
      return {
        min: 55,
        max: 115,
        faixas: faixas(
          [70, 'Fora da referência geral (70–100 mmHg)', 'warning'],
          // PAM sai inteira: 100,4 separa 100 (dentro) de 101 (fora) e o marco lê "100".
          [100.4, 'Dentro da referência geral (70–100 mmHg)', 'success'],
          [null, 'Fora da referência geral (70–100 mmHg)', 'warning'],
        ),
      };
    // 10. Frequência cardíaca de repouso
    case 'fcRepouso':
      return {
        min: 40,
        max: 110,
        faixas: faixas(
          [50, 'Bradicardia relativa — pode ser normal em atletas', 'warning'],
          // 50–59 bpm: a tabela não traz faixa. Dizer isso, e não inventar uma.
          [60, 'Fora das faixas da tabela (habitual: 60–79)', 'neutral'],
          [80, 'Faixa habitual em repouso', 'success'],
          [100, 'Elevada', 'warning'],
          [null, 'Taquicardia — avaliar contexto', 'danger'],
        ),
      };
  }
}

/**
 * PA classifica pelo PAR — régua só da sistólica mentiria quando a diastólica
 * decide. Por isso a régua é de categoria: as cinco linhas da tabela em faixas
 * iguais, e o marcador pousa no meio da categoria lida.
 */
export const REGUA_DA_PA: Regua = {
  min: 0,
  max: 5,
  categorica: true,
  faixas: faixas(
    [1, 'Normal', 'success'],
    [2, 'Elevada', 'warning'],
    [3, 'Hipertensão estágio 1', 'warning'],
    [4, 'Hipertensão estágio 2', 'danger'],
    [null, 'Muito elevada — avaliação imediata conforme contexto clínico', 'danger'],
  ),
};

/** Lê o valor na régua do indicador; sem régua, diz o que a tabela manda. */
export function classificar(medidor: Medidor, valor: number, perfil: Perfil): Leitura {
  const regua = reguaDe(medidor, perfil);

  if (regua === null) return ehAdulto(perfil) ? SEM_SEXO : SEM_REGUA_ADULTA[medidor];

  const faixa = regua.faixas.find((linha) => linha.ate === null || valor < linha.ate);

  return (faixa ?? regua.faixas[regua.faixas.length - 1]!).leitura;
}

// 8. Pressão arterial — da faixa mais grave para a mais branda.
export function classificarPa(pas: number, pad: number, perfil: Perfil): Leitura {
  if (!ehAdulto(perfil)) {
    return { classe: 'Interpretar por idade, sexo e estatura (percentis pediátricos)', tom: 'neutral' };
  }

  if (pas >= 180 || pad >= 120) {
    return {
      classe: 'Muito elevada — avaliação imediata conforme contexto clínico',
      tom: 'danger',
      alerta: true,
    };
  }
  if (pas >= 140 || pad >= 90) return { classe: 'Hipertensão estágio 2', tom: 'danger' };
  if (pas >= 130 || pad >= 80) return { classe: 'Hipertensão estágio 1', tom: 'warning' };
  if (pas >= 120) return { classe: 'Elevada', tom: 'warning' };

  return { classe: 'Normal', tom: 'success' };
}

// 13. Zonas de Karvonen
export const ZONAS_DE_KARVONEN = [
  { de: 50, ate: 60, rotulo: 'Leve' },
  { de: 60, ate: 70, rotulo: 'Moderada' },
  { de: 70, ate: 80, rotulo: 'Moderada/alta' },
  { de: 80, ate: 90, rotulo: 'Alta' },
  { de: 90, ate: 100, rotulo: 'Muito alta/máxima' },
] as const;

function indicador(medidor: Medidor, valor: number | null, perfil: Perfil): Indicador {
  return {
    valor,
    leitura: valor === null ? null : classificar(medidor, valor, perfil),
    regua: reguaDe(medidor, perfil),
  };
}

function indicadorDaPa(pas: number | null, pad: number | null, perfil: Perfil): Indicador {
  if (pas === null || pad === null) return { valor: null, leitura: null, regua: null };

  const leitura = classificarPa(pas, pad, perfil);
  const categoria = REGUA_DA_PA.faixas.findIndex((f) => f.leitura.classe === leitura.classe);

  return {
    valor: pas,
    leitura,
    regua: ehAdulto(perfil) ? REGUA_DA_PA : null,
    naRegua: categoria === -1 ? null : categoria + 0.5,
  };
}

export function calcularIndicadores(
  entradas: Entradas,
  perfil: Perfil,
  equacao: Equacao = 'TRADICIONAL',
): Indicadores {
  const { pesoKg, estaturaCm, cinturaCm, quadrilCm, gorduraPct, pas, pad, fcRepouso, vo2max } =
    entradas;

  const imc =
    pesoKg !== null && estaturaCm !== null ? casas(pesoKg / (estaturaCm / 100) ** 2, 1) : null;
  const rce =
    cinturaCm !== null && estaturaCm !== null ? casas(cinturaCm / estaturaCm, 2) : null;
  const rcq = cinturaCm !== null && quadrilCm !== null ? casas(cinturaCm / quadrilCm, 2) : null;
  const massaGorda =
    pesoKg !== null && gorduraPct !== null ? casas(pesoKg * (gorduraPct / 100), 1) : null;
  const massaMagra = pesoKg !== null && massaGorda !== null ? casas(pesoKg - massaGorda, 1) : null;
  const pam = pas !== null && pad !== null ? Math.round(pad + (pas - pad) / 3) : null;

  // 11. Estimativa adulta: a tabela proíbe aplicá-la a criança.
  const idade = ehAdulto(perfil) ? perfil.idade : null;
  const fcMaxTradicional = idade !== null ? 220 - idade : null;
  const fcMaxTanaka = idade !== null ? Math.round(208 - 0.7 * idade) : null;
  const fcMax = equacao === 'TANAKA' ? fcMaxTanaka : fcMaxTradicional;

  // 12. Reserva de FC
  // FC de repouso acima da FCmáx estimada não tem reserva: sem número em vez de negativo.
  const diferenca = fcMax !== null && fcRepouso !== null ? fcMax - fcRepouso : null;
  const rfc = diferenca !== null && diferenca > 0 ? diferenca : null;
  const zonas =
    rfc === null || fcRepouso === null
      ? []
      : ZONAS_DE_KARVONEN.map((zona) => ({
          ...zona,
          bpmDe: Math.round(fcRepouso + (rfc * zona.de) / 100),
          bpmAte: Math.round(fcRepouso + (rfc * zona.ate) / 100),
        }));

  return {
    imc: indicador('imc', imc, perfil),
    cintura: indicador('cintura', cinturaCm, perfil),
    rce: indicador('rce', rce, perfil),
    rcq: indicador('rcq', rcq, perfil),
    gordura: indicador('gordura', gorduraPct, perfil),
    // 6 e 7: sem ponto de corte universal em kg — a tabela manda ler pelo %GC.
    massaGorda: { valor: massaGorda, leitura: null, regua: null },
    massaMagra: { valor: massaMagra, leitura: null, regua: null },
    pa: indicadorDaPa(pas, pad, perfil),
    pam: indicador('pam', pam, perfil),
    fcRepouso: indicador('fcRepouso', fcRepouso, perfil),
    fcMaxTradicional,
    fcMaxTanaka,
    rfc,
    zonas,
    // 14. Sem ponto de corte único: valor, sem rótulo.
    vo2max: { valor: vo2max, leitura: null, regua: null },
  };
}
