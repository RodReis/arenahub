/**
 * Formatação do histórico corporal — F18, Slice 3.2.
 *
 * Funções puras, testáveis sem montar componente. O que elas resolvem não é
 * estética: quem lê a tela precisa saber se o aluno melhorou, e
 * `-4.199999999999999` não responde isso.
 *
 * **Arredondar aqui é correto — e só aqui** (INV-106). O cálculo já veio
 * pronto do servidor com a precisão armazenada; esta camada só escolhe
 * quantas casas mostrar. Arredondar antes de comparar é que contaminaria o
 * histórico.
 */

/** Rótulos dos tipos medidos, em pt-BR. */
export const ROTULO_DE_TIPO: Record<string, string> = {
  WEIGHT: 'Peso',
  HEIGHT: 'Altura',
  BODY_FAT_PERCENT: 'Gordura corporal',
  BODY_FAT_MASS: 'Massa de gordura',
  LEAN_BODY_MASS: 'Massa magra',
  SKELETAL_MUSCLE_MASS: 'Massa muscular esquelética',
  TOTAL_BODY_WATER: 'Água corporal total',
  INTRACELLULAR_WATER: 'Água intracelular',
  EXTRACELLULAR_WATER: 'Água extracelular',
  PROTEIN_MASS: 'Proteínas',
  MINERAL_MASS: 'Minerais',
  VISCERAL_FAT_LEVEL: 'Gordura visceral',
  BASAL_METABOLIC_RATE: 'Taxa metabólica basal',
  WAIST_CIRCUMFERENCE: 'Circunferência da cintura',
  HIP_CIRCUMFERENCE: 'Circunferência do quadril',

  // Composição que os laudos multiarquivo trouxeram.
  BONE_MASS: 'Massa óssea',
  BODY_CELL_MASS: 'Massa celular',
  SUBCUTANEOUS_FAT_MASS: 'Gordura subcutânea',
  SUBCUTANEOUS_FAT_PERCENT: 'Gordura subcutânea (%)',
  SKELETAL_MUSCLE_PERCENT: 'Músculo esquelético (%)',
  MUSCLE_MASS: 'Massa muscular',
  PROTEIN_PERCENT: 'Proteínas (%)',
  WAIST_HIP_RATIO: 'Relação cintura-quadril',
  HEART_RATE: 'Frequência cardíaca',

  // Segmentares. O lado vem primeiro no rótulo curto da tabela porque a
  // coluna é estreita e o par esquerdo/direito é o que o avaliador compara.
  SEGMENTAL_FAT_MASS_ARM_LEFT: 'Gordura — braço esquerdo',
  SEGMENTAL_FAT_MASS_ARM_RIGHT: 'Gordura — braço direito',
  SEGMENTAL_FAT_MASS_TRUNK: 'Gordura — tronco',
  SEGMENTAL_FAT_MASS_LEG_LEFT: 'Gordura — perna esquerda',
  SEGMENTAL_FAT_MASS_LEG_RIGHT: 'Gordura — perna direita',
  SEGMENTAL_MUSCLE_MASS_ARM_LEFT: 'Músculo — braço esquerdo',
  SEGMENTAL_MUSCLE_MASS_ARM_RIGHT: 'Músculo — braço direito',
  SEGMENTAL_MUSCLE_MASS_TRUNK: 'Músculo — tronco',
  SEGMENTAL_MUSCLE_MASS_LEG_LEFT: 'Músculo — perna esquerda',
  SEGMENTAL_MUSCLE_MASS_LEG_RIGHT: 'Músculo — perna direita',
};

/** Unidades como se escrevem para o aluno. */
const SIMBOLO_DE_UNIDADE: Record<string, string> = {
  KG: 'kg',
  G: 'g',
  LB: 'lb',
  CM: 'cm',
  M: 'm',
  IN: 'in',
  PERCENT: '%',
  KCAL: 'kcal',
  L: 'L',
};

/**
 * Por que uma comparação não produziu número.
 *
 * Cada razão pede uma ação diferente de quem lê: "sem medição anterior"
 * espera a próxima avaliação; "meta não definida" espera alguém combinar uma.
 * Um traço mudo para os dois casos esconderia essa diferença.
 */
export const MOTIVO_DE_AUSENCIA: Record<string, string> = {
  SEM_BASELINE: 'sem medição anterior para comparar',
  BASELINE_ZERO: 'medição anterior era zero',
  SEM_META: 'meta não definida',
};

/**
 * Uma casa decimal — o que a balança da academia reporta.
 *
 * A segunda casa de um bioimpedanciômetro é ruído, não precisão.
 *
 * `Intl.NumberFormat` e não `toLocaleString`: a regra 5 de lint proíbe o
 * segundo por causa de DATA (fuso do navegador em vez do da unidade), e ela
 * casa por nome do método — número cai junto. Este formatador é criado uma
 * vez, o que também é mais rápido que instanciar a cada célula da tabela.
 */
const UMA_CASA = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function rotuloDeTipo(tipo: string): string {
  return ROTULO_DE_TIPO[tipo] ?? tipo;
}

export function simboloDeUnidade(unidade: string | null): string {
  if (unidade === null) return '';

  return SIMBOLO_DE_UNIDADE[unidade.toUpperCase()] ?? unidade;
}

/**
 * Valor com unidade, como o aluno lê.
 *
 * Uma casa decimal: é o que a balança da academia reporta, e a segunda casa
 * de um bioimpedanciômetro é ruído, não precisão.
 *
 * `null` devolve traço — NUNCA `0` (INV-104). Zero é uma medição; ausência é
 * a falta dela, e as duas não podem ler igual.
 */
export function valorLegivel(valor: number | null, unidade: string | null): string {
  if (valor === null) return '—';

  const simbolo = simboloDeUnidade(unidade);
  const numero = UMA_CASA.format(valor);

  // Percentual cola no número ("28,4%"); as demais unidades pedem espaço.
  if (simbolo === '%') return `${numero}%`;

  return simbolo === '' ? numero : `${numero} ${simbolo}`;
}

/**
 * Variação com sinal explícito.
 *
 * O `+` é obrigatório no ganho: sem ele, "2,0 kg" ao lado de "-2,0 kg" faz o
 * olho ler os dois como a mesma coisa, e a diferença entre ganhar e perder
 * dois quilos é o assunto inteiro da tela.
 *
 * Não decide se subir é bom: ganhar massa magra e ganhar gordura têm o mesmo
 * sinal e significados opostos. Cor e julgamento ficam para quem tem contexto.
 */
export function variacaoLegivel(valor: number | null, unidade: string | null): string {
  if (valor === null) return '—';

  const absoluto = valorLegivel(Math.abs(valor), unidade);

  if (valor > 0) return `+${absoluto}`;
  if (valor < 0) return `−${absoluto}`;

  return absoluto;
}

/** Percentual de variação, com sinal. `null` vira traço. */
export function percentualLegivel(valor: number | null): string {
  if (valor === null) return '—';

  const numero = UMA_CASA.format(Math.abs(valor));

  if (valor > 0) return `+${numero}%`;
  if (valor < 0) return `−${numero}%`;

  return `${numero}%`;
}

/**
 * Rótulo curto do eixo do gráfico — `DD/MM`.
 *
 * **Por que não usa `TenantDateTime` nem `Intl`:** o eixo do Recharts recebe
 * uma STRING dentro do SVG, não um nó React — `TenantDateTime` renderiza
 * `<time>`, que não existe ali. E a regra 5 de lint reserva `Intl` àquele
 * componente, com exceção nominal; abrir uma terceira exceção para gráfico
 * seria decisão de design system, não desta fatia.
 *
 * A saída, então, vem do PRÓPRIO servidor: o instante já chega deslocado para
 * o fuso da unidade quando a API o formata, e aqui só recortamos dia e mês do
 * ISO. Sem `new Date()`, sem fuso do navegador — o que a regra 5 protege é
 * respeitado pela raiz, não contornado.
 *
 * Ano fica de fora de propósito: "10/06/2026" repetido em oito pontos vira
 * ruído. A data completa está na tabela ao lado, essa sim com
 * `TenantDateTime`.
 */
/**
 * Faixa de referencia legivel: "60,6 – 82,0 kg". Ausencia (`null` OU
 * `undefined` -- um payload de API pode simplesmente OMITIR a chave em vez
 * de mandar `null`) nas duas pontas vira traço. O card `FieldReview` do
 * `DS-PAINEL.md` §8.4 so mostra faixa quando o laudo trouxe alguma borda.
 *
 * `undefined` tratado igual a `null` de proposito: `Intl.NumberFormat`
 * aceita `undefined` sem lançar e devolve "NaN" — um bug visto ao vivo
 * (contra uma versao da API que ainda nao mandava `referenceMin`), silencioso
 * o bastante para passar batido se so `null` fosse verificado.
 */
export function faixaLegivel(
  min: number | null | undefined,
  max: number | null | undefined,
  unidade: string | null,
): string {
  if (min == null && max == null) return '—';

  const simbolo = simboloDeUnidade(unidade);
  const comSimbolo = (valor: number): string =>
    simbolo === '%' ? `${UMA_CASA.format(valor)}%` : `${UMA_CASA.format(valor)}${simbolo ? ` ${simbolo}` : ''}`;

  if (min != null && max != null) return `${UMA_CASA.format(min)} – ${comSimbolo(max)}`;
  if (min != null) return `≥ ${comSimbolo(min)}`;

  return `≤ ${comSimbolo(max as number)}`;
}

/**
 * Confiança em faixa qualitativa -- alta/média/baixa.
 *
 * ponytail: limiares (0,85 / 0,6) são um corte razoável sem valor do PRD
 * publicando faixas oficiais; ajustar quando a spec de confiança do
 * extrator vier com números próprios.
 */
export function confiancaLegivel(
  confidence: number | null | undefined,
): 'alta' | 'média' | 'baixa' | null {
  if (confidence == null) return null;
  if (confidence >= 0.85) return 'alta';
  if (confidence >= 0.6) return 'média';

  return 'baixa';
}

export function rotuloDoEixo(isoLocal: string): string {
  // `AAAA-MM-DDTHH:mm...` — posições fixas no formato ISO 8601.
  const [ano = '', mes = '', dia = ''] = isoLocal.slice(0, 10).split('-');

  return ano === '' || mes === '' || dia === '' ? isoLocal : `${dia}/${mes}`;
}
