import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Os calculos do painel financeiro gerencial. F54, `SPEC-054`.
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`). Recebem os
 * totais ja agregados PELO BANCO e devolvem os indicadores derivados.
 *
 * POR QUE SEPARAR ISTO DO USE CASE: cada numero aqui tem um caso de borda que
 * decide se a tela informa ou mente -- divisao por zero, serie curta demais
 * para virar linha, base em formacao. Sao exatamente os casos que a `SPEC-054`
 * §5 manda tratar, e testa-los contra o banco custaria uma fixture por
 * hipotese. Puro, cada um e tres linhas de teste.
 */

export class JanelaDoResumoInvalidaError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_SUMMARY_INVALID_WINDOW', 422, motivo);
  }
}

/**
 * A janela do resumo: `de` inclusivo, `ate` EXCLUSIVO e fechado.
 *
 * MESMO MOTIVO DA CONCILIACAO DA F16 (`SPEC-054` §3.1): periodo em curso
 * produz numero que muda embaixo de quem esta lendo. O gestor que abre o
 * painel as 14h e de novo as 18h veria "recebido no periodo" diferente sem
 * nada ter mudado de decisao -- e passaria a nao confiar em nenhum dos dois.
 *
 * `ate` exclusivo e o que faz "agosto" ser `[01/08, 01/09)` sem a hora final
 * ambigua que `<=` traz: com `ate` inclusivo, um pagamento as 23:59:30 do dia
 * 31 entra ou nao conforme a precisao do timestamp gravado.
 */
export function validarJanela(de: Date, ate: Date, agora: Date): void {
  if (ate.getTime() <= de.getTime()) {
    throw new JanelaDoResumoInvalidaError('o fim da janela tem de ser depois do inicio');
  }

  if (ate.getTime() > agora.getTime()) {
    throw new JanelaDoResumoInvalidaError(
      'a janela precisa estar fechada; periodo em curso produz numero que muda embaixo de quem le',
    );
  }
}

/**
 * Ticket medio: recebido dividido por pagamentos confirmados.
 *
 * `null` E NAO ZERO quando nao houve pagamento nenhum (`SPEC-054` §5.3 e
 * `DS-PAINEL` §7). Academia que nao recebeu nada no periodo nao tem ticket
 * medio de R$ 0,00 -- ela tem um ticket medio que NAO EXISTE. Zero seria lido
 * como "o aluno medio pagou nada", que e uma afirmacao sobre o comportamento
 * dos alunos; a verdade e que nao ha do que tirar media.
 *
 * Arredonda para centavo inteiro (INV-065): o ticket e dinheiro, e dinheiro
 * nao tem casa fracionaria de centavo. `Math.round` e nao `floor` porque a
 * media e estatistica de leitura, nao valor a cobrar -- ninguem paga o ticket
 * medio, entao truncar so afastaria o numero exibido do real.
 */
export function ticketMedio(recebidoMinor: number, pagamentosConfirmados: number): number | null {
  if (pagamentosConfirmados === 0) {
    return null;
  }

  return Math.round(recebidoMinor / pagamentosConfirmados);
}

/**
 * Taxa de inadimplencia: alunos com fatura vencida sobre alunos que deveriam
 * estar pagando.
 *
 * O DENOMINADOR E O MESMO DA F15, e a razao esta la
 * (`consultar-inadimplencia.use-case.ts`): contar so as assinaturas `ACTIVE`
 * faria a taxa CAIR quando mais gente ficasse inadimplente, porque o proprio
 * atraso tira a assinatura de `ACTIVE`. O indicador se moveria para o lado
 * errado exatamente quando a academia piorasse.
 *
 * `null` e nao zero sem pagante algum: 0% seria uma meta batida em cima de
 * nada.
 *
 * Uma casa decimal: duas dariam precisao que a base nao tem (`SPEC-054` §5.2
 * -- os 1.926 importados como `CANCELLED` e os ~340 ativados distorcem o
 * percentual), e zero casa esconderia movimento real numa base de 340.
 */
export function taxaDeInadimplencia(
  alunosInadimplentes: number,
  alunosPagantes: number,
): number | null {
  if (alunosPagantes === 0) {
    return null;
  }

  return Math.round((alunosInadimplentes / alunosPagantes) * 1000) / 10;
}

/**
 * Taxa de churn: cancelamentos no periodo sobre alunos pagantes no INICIO do
 * periodo -- F74, `SPEC-074` §4.1.
 *
 * O denominador e a base de ONTEM, nao a de hoje: a base de hoje ja reflete
 * os proprios cancelamentos do periodo, e dividir por ela subestimaria a
 * taxa exatamente quando mais gente saiu.
 *
 * `null` sem pagante no inicio do periodo -- mesma razao de
 * `taxaDeInadimplencia`: 0% seria meta batida em cima de nada.
 */
export function taxaDeChurn(cancelamentos: number, pagantesNoInicio: number): number | null {
  if (pagantesNoInicio === 0) {
    return null;
  }

  return Math.round((cancelamentos / pagantesNoInicio) * 1000) / 10;
}

/** Um par criacao/cancelamento com os dois eventos de timeline presentes. */
export interface ParDeVidaDaAssinatura {
  readonly criadoEm: Date;
  readonly canceladoEm: Date;
}

const MS_POR_MES = 30 * 86_400_000;

/**
 * Vida media, em meses, dos cancelamentos com os DOIS eventos de timeline
 * presentes -- F74, `SPEC-074` §3 e §4.1.
 *
 * SO PARES COMPLETOS ENTRAM: os ~1.926 registros importados do Pacto tem
 * `SUBSCRIPTION_CANCELLED`... na verdade nem isso -- entraram como status
 * `CANCELLED` sem NENHUM evento de timeline (ADR-033). Um cancelamento sem o
 * `SUBSCRIPTION_CREATED` correspondente nao tem "vida" para medir, e
 * inventar uma data de inicio contrariaria o `CLAUDE.md` ("sem dado
 * inventado no caminho de producao"). O CHAMADOR decide o que fazer com uma
 * lista vazia -- aqui so se calcula a media do que existe de verdade.
 *
 * Meses de 30 dias, nao mes de calendario: a vida de uma assinatura nao
 * anda em meses de calendario (fevereiro tem menos dias que julho), e o
 * numero aqui e estatistica de leitura, nao data a cravar.
 */
export function vidaMediaEmMeses(pares: readonly ParDeVidaDaAssinatura[]): number | null {
  if (pares.length === 0) {
    return null;
  }

  const totalDeMeses = pares.reduce((soma, par) => {
    const meses = (par.canceladoEm.getTime() - par.criadoEm.getTime()) / MS_POR_MES;

    return soma + meses;
  }, 0);

  // Uma casa decimal: o dia calendario nao divide exato por "mes de 30
  // dias", e duas casas exibiriam ruido de arredondamento como se fosse
  // precisao real sobre uma base que ja e aproximacao.
  return Math.round((totalDeMeses / pares.length) * 10) / 10;
}

/**
 * Piso de cancelamentos com timeline completa para o LTV virar numero --
 * `SPEC-074` §4.2. Mesma disciplina de `MINIMO_DE_PONTOS_DA_SERIE`: um ou
 * dois cancelamentos nao sustentam uma media que o dono vai usar para
 * decidir algo.
 */
export const MINIMO_DE_CANCELAMENTOS_PARA_LTV = 3;

/**
 * LTV: ticket medio vezes vida media observada -- decisao do PI em
 * `SPEC-074` §2.4.
 *
 * `null` sem ticket medio, sem vida media, OU com menos cancelamentos
 * completos que o piso -- qualquer um dos tres torna o numero uma afirmacao
 * sobre amostra vazia ou pequena demais, e a tela mostra ausencia em vez de
 * um valor que parece preciso e nao e.
 */
export function ltv(
  ticketMedioMinor: number | null,
  vidaMedia: number | null,
  cancelamentosComTimelineCompleta: number,
): number | null {
  if (ticketMedioMinor === null || vidaMedia === null) {
    return null;
  }

  if (cancelamentosComTimelineCompleta < MINIMO_DE_CANCELAMENTOS_PARA_LTV) {
    return null;
  }

  return Math.round(ticketMedioMinor * vidaMedia);
}

/** Um ponto da serie por competencia. Competencia e `YYYY-MM`, nunca instante. */
export interface PontoDaSerie {
  readonly competencia: string;
  readonly faturadoMinor: number;
  readonly recebidoMinor: number;
}

/**
 * Minimo de pontos para a serie virar linha.
 *
 * TRES, e o numero nao e estetico: com um ponto nao ha comparacao nenhuma;
 * com dois ha uma reta, e reta entre dois pontos sempre parece tendencia --
 * o olho le inclinacao onde ha apenas duas medicoes. A terceira e a primeira
 * que pode CONTRARIAR a reta, e por isso a primeira que informa.
 *
 * O `STATUS.md` de 19/08 ja registrou o caso na F15: *"nao ha evolucao mensal
 * no grafico: o sistema tem um mes de dado, e uma linha com um ponto
 * mentiria"*. Num painel que existe para comparar periodos, o risco piora --
 * e por isso vira estado explicito, e nao grafico vazio.
 */
export const MINIMO_DE_PONTOS_DA_SERIE = 3;

export interface SerieDeCompetencia {
  readonly pontos: readonly PontoDaSerie[];
  /**
   * `false` quando ha menos de tres competencias. A tela mostra estado de
   * dado insuficiente, NAO uma linha curta -- ver `MINIMO_DE_PONTOS_DA_SERIE`.
   */
  readonly suficienteParaLinha: boolean;
}

/**
 * Monta a serie por competencia a partir dos dois lados ja agregados.
 *
 * FATURADO E RECEBIDO VEM DE FONTES DIFERENTES, e e de proposito:
 * "faturado" e a invoice na competencia dela; "recebido" e o pagamento
 * confirmado, atribuido a competencia DA INVOICE que ele quitou -- nao ao mes
 * em que o dinheiro entrou (`SPEC-054` §3.1: *"serie por competencia, nao por
 * data de pagamento"*). Quem paga agosto atrasado em setembro faz agosto
 * fechar, e nao setembro inflar.
 *
 * COMPETENCIA SEM MOVIMENTO NAO E OMITIDA -- e o outro lado da regra "ausencia
 * nunca e zero". Aqui a ausencia É zero de verdade: um mes em que nada foi
 * faturado faturou zero, e pular o mes faria a linha ligar julho a setembro
 * como se agosto nao tivesse existido. O preenchimento e do chamador, que
 * conhece a janela; esta funcao apenas nao inventa mes fora dela.
 *
 * A UNIAO DAS DUAS CHAVES, e nao as chaves do faturado: os dois lados vem de
 * consultas INDEPENDENTES, e nada garante que toda competencia exista nos
 * dois mapas. Iterar so um deles perderia, calada, a competencia que so o
 * outro conhece.
 */
export function montarSerie(
  faturadoPorCompetencia: ReadonlyMap<string, number>,
  recebidoPorCompetencia: ReadonlyMap<string, number>,
): SerieDeCompetencia {
  const competencias = [
    ...new Set([...faturadoPorCompetencia.keys(), ...recebidoPorCompetencia.keys()]),
  ].sort();

  const pontos = competencias.map<PontoDaSerie>((competencia) => ({
    competencia,
    faturadoMinor: faturadoPorCompetencia.get(competencia) ?? 0,
    recebidoMinor: recebidoPorCompetencia.get(competencia) ?? 0,
  }));

  return {
    pontos,
    suficienteParaLinha: pontos.length >= MINIMO_DE_PONTOS_DA_SERIE,
  };
}

/**
 * A janela default: o ULTIMO MES FECHADO, em UTC.
 *
 * POR QUE MES FECHADO E NAO "o mes corrente": o mes em curso e exatamente a
 * janela que `validarJanela` recusa -- numero que muda embaixo de quem le. Um
 * default que a propria validacao rejeitaria faria a tela abrir em erro.
 *
 * POR QUE UTC E NAO O FUSO DA UNIDADE: o resumo e do TENANT inteiro, que pode
 * ter unidades em fusos diferentes (ADR-019) -- nao existe "o" fuso da
 * academia para ancorar o corte. UTC e a unica escolha que nao privilegia uma
 * unidade sobre a outra, e a janela vai ECOADA na resposta justamente para a
 * tela mostrar qual periodo foi somado em vez de supor.
 *
 * Quem quiser o mes no fuso local manda `de`/`ate` explicitos -- e o que a
 * tela faz quando o gestor escolhe o periodo.
 */
export function janelaPadrao(agora: Date): { de: Date; ate: Date } {
  const ate = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
  const de = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1));

  return { de, ate };
}
